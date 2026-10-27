import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { collectInbox, landsFor, loadParked, park } from "../../app/inbox";
import { cardProgress, STEPS, stepStatuses } from "../../app/guide";
import { useUi } from "../../app/store";
import { newCard, type CardDataV3 } from "../../card";
import { useCowriter, useLoreChat } from "../../cowriter/store";
import { createCard, createProject, getProject, resetDbForTests, type CardRecord, type ProjectRecord } from "../../db/db";
import { readMechanics, newModule } from "../../editor/mechanics";
import { useEditor } from "../../editor/store";
import { worldMeta } from "../../editor/world";
import { useEngineer } from "../../engine/engineer/session";
import { readAssetTags } from "../../images/filing";
import { latestStudio, newStudio, saveStudio, type Candidate, type Shot } from "../../images/shots";
import { CardBar } from "../editor/CardBar";
import { LorebookView } from "../lorebook/LorebookView";
import { GuidePanel } from "../library/GuidePanel";

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const candidate = (id: string): Candidate => ({ id, bytes: PNG, mime: "image/png", model: "img/flux", at: 1 });
const shot = (id: string, label: string): Shot => ({ id, group: "avatars", kind: "avatar", label, subject: "card", outfit: "default", framing: "portrait" });

function card(): CardDataV3 {
  const d = newCard("Sera").data;
  d.description = "A ferrywoman.";
  return d;
}

let record: CardRecord;
let project: ProjectRecord;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false });
  useLoreChat.setState({ chat: undefined, busy: false });
  useEngineer.setState({ chat: undefined, busy: false });
  useUi.setState({ section: "editor", tabRequest: undefined });
  project = await createProject("P");
  record = await createCard(project.id, "character");
  await useEditor.getState().open(record.id);
  useEditor.getState().replaceData(card());
});

/** A co-writer edit, a parked module and items, and two shots with images: one to accept, one to pick. */
async function fill() {
  await useCowriter.getState().addTurn(record.id, "Write her personality", "Write her personality", [
    { text: "Here.", toolCalls: [{ id: "t1", name: "set_field", input: { field: "personality", text: "Dry, patient." } }] },
  ]);
  await park(record.id, { source: "wizard", summary: 'Mechanic "Tides"', module: newModule({ name: "Tides", rules: "The tide turns." }), keep: false });
  await park(record.id, { source: "bulk", summary: "1 items: Oar", items: [{ name: "Oar", price: "2 coins" }] });
  await saveStudio({
    ...newStudio(record.id),
    shots: [shot("s1", "Sera: portrait"), shot("s2", "Sera: smiling")],
    candidates: { s1: [candidate("c1")], s2: [candidate("c2"), candidate("c3")] },
  });
}

describe("proposal inbox", () => {
  it("gathers what's pending from every source, with where each lands", async () => {
    await fill();
    const items = await collectInbox(record.id);
    expect(items.map((i) => [i.source, i.summary, i.lands.label, !!i.accept])).toEqual([
      ["cowriter", expect.stringMatching(/^Edit 1: /), "Editor", true],
      ["wizard", 'Mechanic "Tides"', "Mechanics", true],
      ["bulk", "1 items: Oar", "Economy", true],
      ["images", "Sera: portrait: 1 image to pick from", "Image Studio", true],
      ["images", "Sera: smiling: 2 images to pick from", "Image Studio", false],
    ]);
    expect(landsFor("add_npc")).toMatchObject({ section: "lorebook" });
    expect(landsFor("write_tiers")).toMatchObject({ section: "engine", tab: "vars" });
  });

  it("accepts all from the card bar and leaves the image choice for the studio", async () => {
    await fill();
    render(<CardBar />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox, 5 waiting" }));
    const dialog = screen.getByRole("dialog", { name: "Inbox" });
    expect(within(dialog).getByText("Pick one in the Image Studio")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept all (4)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Inbox, 1 waiting" })).toBeInTheDocument());

    const data = useEditor.getState().record!.card.data;
    expect(data.personality).toBe("Dry, patient.");
    expect(readMechanics(data).map((m) => m.name)).toEqual(["Tides"]);
    expect(data.character_book!.entries.map((e) => worldMeta(e)?.fields?.name)).toContain("Oar");
    expect(Object.values(readAssetTags(data))).toEqual([expect.objectContaining({ subject: "card", kind: "portrait" })]);
    expect(await loadParked(record.id)).toEqual([]);
    const studio = await latestStudio(record.id);
    expect(studio.candidates!.s1[0].asset).toBeTruthy();
    expect(useCowriter.getState().chat!.proposals[0].status).toBe("accepted");
  });

  it("rejects one item and opens where another lands, on its tab", async () => {
    await fill();
    render(<CardBar />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox, 5 waiting" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject Sera: smiling: 2 images to pick from" }));
    await waitFor(async () => expect((await latestStudio(record.id)).candidates!.s2).toBeUndefined());
    fireEvent.click(screen.getByRole("button", { name: "Economy →" }));
    expect(useUi.getState()).toMatchObject({ section: "lorebook", tabRequest: { section: "lorebook", tab: "economy" } });
    render(<LorebookView />);
    expect(screen.getByRole("tab", { name: "Economy" })).toHaveAttribute("aria-selected", "true");
    expect(useUi.getState().tabRequest).toBeUndefined();
  });
});

describe("guided path", () => {
  it("knows the done steps from the card and suggests the next", async () => {
    const progress = await cardProgress(useEditor.getState().record!);
    expect([...progress]).toEqual(["idea"]);
    const statuses = stepStatuses({ on: true, skipped: ["interview"], done: [] }, progress);
    expect(STEPS.map((s) => statuses[s.id])).toEqual(["done", "skipped", "suggested", "todo", "todo", "todo", "todo", "todo", "todo"]);
    // Skipping the engine skips the playtest too.
    expect(stepStatuses({ on: true, skipped: ["engine"], done: ["draft"] }, progress).playtest).toBe("skipped");
  });

  it("turns on, skips, marks done and resumes from the project page", async () => {
    const Harness = () => {
      const [p, setP] = useState(project);
      return (
        <GuidePanel
          project={p}
          cards={[useEditor.getState().record!]}
          onChange={setP}
          onOpen={async () => undefined}
          onNewCharacter={async () => record}
          onSurprise={() => undefined}
          onExport={() => undefined}
        />
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show the guided path" }));
    const path = await screen.findByRole("region", { name: "Guided path" });
    await waitFor(() => expect(within(path).getByRole("button", { name: "Go to Interview" })).toHaveTextContent("Continue"));
    fireEvent.click(within(path).getByRole("button", { name: "Skip Interview" }));
    await waitFor(() => expect(within(path).getByRole("button", { name: "Go to Draft" })).toHaveTextContent("Continue"));
    fireEvent.click(within(path).getByRole("button", { name: "Mark Draft done" }));
    await waitFor(() => expect(within(path).getByRole("button", { name: "Go to World pages" })).toHaveTextContent("Continue"));
    expect((await getProject(project.id))!.guide).toEqual({ on: true, skipped: ["interview"], done: ["draft"] });

    fireEvent.click(within(path).getByRole("button", { name: "Go to World pages" }));
    await waitFor(() => expect(useUi.getState()).toMatchObject({ section: "lorebook", tabRequest: { tab: "npcs" } }));
  });

  it("shows the next step on the card bar", async () => {
    render(<CardBar />);
    expect(screen.queryByRole("button", { name: /Next step/ })).toBeNull();
    const { updateGuide } = await import("../../app/guide");
    await updateGuide(project.id, (g) => ({ ...g, on: true }));
    useEditor.getState().replaceData({ ...useEditor.getState().record!.card.data, first_mes: "Hi." });
    fireEvent.click(await screen.findByRole("button", { name: "Next step: Interview" }));
    expect(useUi.getState()).toMatchObject({ section: "cowriter", cowriterTab: "interview" });
  });
});
