import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { tiersEntryOf } from "../../ai/engineTools";
import { newCard, type CardDataV3 } from "../../card";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { addAddon, applyTracker, newTracker, readTracker } from "../../editor/trackers";
import { worldEntry } from "../../editor/world";
import { finishConversion, planConversion, turnEngineOff } from "../../engine/convert";
import { newEngineerChat, useEngineer } from "../../engine/engineer/session";
import { ENGINEER_TOOLS, runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { replay } from "../../engine/engineer/workspace";
import { applyEngine, newEngine, readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

/** A light card: stats and relationship stages, two NPCs and a place. */
function lightCard(): CardDataV3 {
  let d = newCard("Sera").data;
  d.first_mes = "Sera looks up.";
  d = applyTracker(d, addAddon(addAddon(newTracker(), "stats"), "relationship"));
  let book = d.character_book ?? emptyBook();
  for (const name of ["Holt", "Mira"]) book = { ...book, entries: [...book.entries, worldEntry(book, "npc", { name })] };
  book = { ...book, entries: [...book.entries, worldEntry(book, "location", { name: "The Ferry" })] };
  return { ...d, character_book: book };
}

let n = 0;
const call = (name: string, input: Record<string, unknown>) => ({ id: `t${++n}`, name, input });

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().replaceData(lightCard());
});

describe("light card to engine", () => {
  it("plans one affection value with the stages as its tiers", () => {
    const plan = planConversion(lightCard());
    expect(plan.values.map((v) => `${v.group}.${v.name}`)).toEqual(["Player.Health", "Player.Stamina", "Relationship.Affection"]);
    expect(plan.stages?.variable).toBe("Relationship.Affection");
    expect(plan.stages?.tiers[0]).toMatchObject({ from: 0, to: 20, name: "Strangers" });
    expect(plan.backup?.fields).toHaveLength(4);
    const full = planConversion(lightCard(), { people: true, places: true });
    expect(full.values.map((v) => `${v.group}.${v.name}`)).toEqual(
      expect.arrayContaining(["People.Holt", "People.Mira", "World.location"]),
    );
    expect(full.values.find((v) => v.name === "location")?.options).toEqual(["The Ferry"]);
  });

  it("converts only after the user's yes, and the result replays", async () => {
    expect(ENGINEER_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["read_light_card", "convert_light_card"]));
    const data = applyEngine(lightCard(), newEngine());
    const ctx = { data, draft: readEngine(data)!, ops: [], skills: [] } as EngineerContext;
    expect((await runEngineerTool(ctx, call("read_light_card", {}))).content).toMatch(/Relationship\.Affection[\s\S]*ask before/);
    const refused = await runEngineerTool(ctx, call("convert_light_card", { confirmed: false }));
    expect(refused.isError).toBe(true);
    expect(ctx.ops).toHaveLength(0);
    const done = await runEngineerTool(ctx, call("convert_light_card", { confirmed: true, people: true }));
    expect(done.isError).toBeFalsy();
    expect(ctx.draft.vars.map((v) => v.name)).toEqual(expect.arrayContaining(["Affection", "Holt", "Mira"]));
    expect(ctx.draft.light?.tracker?.fields).toHaveLength(4);
    expect(replay(readEngine(data)!, ctx.ops).config.vars).toHaveLength(ctx.draft.vars.length);
  });

  it("turns the tracker off and writes the tiers on accept, and brings the tracker back when the engine goes off", async () => {
    const data = applyEngine(lightCard(), newEngine());
    const ctx = { data, draft: readEngine(data)!, ops: [], skills: [] } as EngineerContext;
    await runEngineerTool(ctx, call("convert_light_card", { confirmed: true }));
    const converted = finishConversion(applyEngine(data, ctx.draft));
    expect(readTracker(converted)).toBeUndefined();
    expect(tiersEntryOf(converted, "Relationship.Affection")?.content).toContain("Strangers");
    const off = turnEngineOff(converted);
    expect(readEngine(off)).toBeUndefined();
    expect(readTracker(off)?.fields.map((f) => f.label)).toEqual(["Health", "Stamina", "Affection", "Stage"]);
  });

  it("accepting the engineer's conversion has the co-writer offer starting states", async () => {
    const id = useEditor.getState().record!.id;
    useEditor.getState().replaceData(applyEngine(useEditor.getState().record!.card.data, newEngine()));
    const ctx = {
      data: useEditor.getState().record!.card.data,
      draft: readEngine(useEditor.getState().record!.card.data)!,
      ops: [],
      skills: [],
    } as EngineerContext;
    await runEngineerTool(ctx, call("convert_light_card", { confirmed: true }));
    useEngineer.setState({
      chat: {
        ...newEngineerChat(id),
        proposals: [
          { id: "p1", number: 1, calls: ctx.ops, summaries: [], changes: [], status: "pending", errors: 0, warnings: 0, at: 0 },
        ],
      },
    });
    useEngineer.getState().decide("p1", true);
    const card = useEditor.getState().record!.card.data;
    expect(readEngine(card)?.vars.some((v) => v.name === "Affection")).toBe(true);
    expect(readTracker(card)).toBeUndefined();
    await waitFor(() =>
      expect(useCowriter.getState().chat?.messages.at(-1)).toMatchObject({ text: expect.stringMatching(/starting state/) }),
    );
  });

  it("offers the conversion on the engine page and restores the tracker when turned off", async () => {
    render(<EngineView />);
    expect(screen.getByRole("button", { name: "✦ Convert with the UI engineer" })).toBeTruthy();
    // Convert by hand, as an accepted proposal would, then turn the engine off.
    const data = useEditor.getState().record!.card.data;
    const ctx = { data, draft: newEngine(), ops: [], skills: [] } as EngineerContext;
    await runEngineerTool(ctx, call("convert_light_card", { confirmed: true }));
    useEditor.getState().replaceData(finishConversion(applyEngine(data, ctx.draft)));
    fireEvent.click(await screen.findByRole("button", { name: "Turn the engine off" }));
    expect(screen.getByText(/its status tracker comes back/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn it off" }));
    expect(readTracker(useEditor.getState().record!.card.data)?.fields).toHaveLength(4);
  });
});
