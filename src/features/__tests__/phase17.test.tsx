import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, getProject, listPersonas, resetDbForTests, saveCard } from "../../db/db";
import { useEditor } from "../../editor/store";
import { ProjectDetail } from "../library/ProjectDetail";

const script = vi.hoisted(() => ({ replies: [] as CompletionResult[], requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      return next;
    },
  }),
}));

let n = 0;
const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input]) => ({ id: `c${++n}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});
const lastText = (req: CompletionRequest) => (req.messages.at(-1) as { text: string }).text;

let projectId = "";
beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useUi.setState({ section: "library" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "m" },
      modeModels: {},
      noToolModels: [],
      presets: [],
      imageStyles: [],
    },
  });
  projectId = (await createProject("P")).id;
});

describe("persona from a card", () => {
  it("starts from the world card, focuses on look and capabilities, and links the persona to the project", async () => {
    const world = await createCard(projectId, "world");
    world.card.data.name = "Silverwood";
    world.card.data.description = "A drowned forest ruled by river guilds.";
    await saveCard(world);
    const mira = await createCard(projectId, "character");
    mira.card.data.name = "Mira";
    await saveCard(mira);
    render(<ProjectDetail projectId={projectId} />);
    fireEvent.click(await screen.findByRole("button", { name: "✦ Build from a card" }));
    const dialog = screen.getByRole("dialog", { name: "Build a persona" });
    const start = within(dialog).getByRole("combobox", { name: "Start from" });
    expect(within(start).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Silverwood (world)",
      "Mira (character)",
      "Nothing, start fresh",
    ]);

    script.replies.push(
      reply("", [["ask_questions", { questions: [{ theme: "Look", question: "What do they wear?", suggestions: ["Oilskins", "Guild robes"] }] }]]),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Oilskins" }));
    const kickoff = lastText(script.requests[0]);
    expect(kickoff).toContain('<source_card kind="world card" name="Silverwood">');
    expect(kickoff).toContain("A drowned forest ruled by river guilds.");
    expect(kickoff).toContain("capabilities (skills, training, powers, gear, resources)");

    script.replies.push(reply("", [["write_persona", { name: "Tam", description: "{{user}} is a 30-year-old boatman in oilskins." }]]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the persona" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Save to library" }));
    expect(lastText(script.requests[1])).toContain("appearance first, then capabilities and gear");
    await waitFor(async () => expect((await getProject(projectId))!.personaIds).toHaveLength(1));
    const [tam] = await listPersonas();
    expect(tam.name).toBe("Tam");
    expect((await getProject(projectId))!.personaIds).toEqual([tam.id]);
    // The project's persona list shows it.
    await screen.findByRole("button", { name: "Remove Tam from project" });
  });

  it("can start fresh instead", async () => {
    await createCard(projectId, "character");
    render(<ProjectDetail projectId={projectId} />);
    fireEvent.click(await screen.findByRole("button", { name: "✦ Build from a card" }));
    const dialog = screen.getByRole("dialog", { name: "Build a persona" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Start from" }), { target: { value: "" } });
    script.replies.push(reply("", [["ask_questions", { questions: [{ theme: "Look", question: "Q?", suggestions: ["A"] }] }]]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await within(dialog).findByRole("button", { name: "A" });
    expect(lastText(script.requests[0])).not.toContain("<source_card");
  });
});
