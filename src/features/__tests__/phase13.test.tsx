import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { readArc } from "../../editor/arc";
import { LorebookView } from "../lorebook/LorebookView";

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

const entries = () => useEditor.getState().record!.card.data.character_book?.entries ?? [];
const lastText = (req: CompletionRequest) => (req.messages.at(-1) as { text: string }).text;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useUi.setState({ section: "lorebook" });
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
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mira");
});

const villain = {
  name: "Holt",
  role: "harbourmaster",
  age: "52",
  look: "salt-white beard",
  voice: "Speaks in tide tables.",
  goal: "Raise the drowned city.",
  methods: "The watch is his.",
  moves: "Frames {{user}}.",
  secret: "He can't swim.",
  aliases: "",
};
const arcReply = (beats: number): CompletionResult => ({
  text: "",
  stop: "tool_use",
  toolCalls: [
    {
      id: "a1",
      name: "write_arc",
      input: {
        title: "The Drowned Bell",
        premise: "A bell rings under the harbour.",
        beats: Array.from({ length: beats }, (_, i) => ({
          title: `Beat title ${i + 1}`,
          summary: `Something happens ${i + 1}.`,
          direction: "Slowly.",
          antagonist: "Holt watches.",
        })),
        ending: "Ring it or sink it.",
      },
    },
  ],
});

async function openArc() {
  render(<LorebookView />);
  fireEvent.click(screen.getByRole("tab", { name: "Story arc" }));
  return screen.findByRole("region", { name: "Arc settings" });
}

describe("story arc", () => {
  it("lets the co-writer pick a hidden antagonist, writes a secret arc and reveals it behind a confirm", async () => {
    const settings = await openArc();
    fireEvent.change(within(settings).getByRole("combobox", { name: "Death" }), { target: { value: "anyone" } });
    fireEvent.change(within(settings).getByRole("spinbutton", { name: "Beats" }), { target: { value: "3" } });
    script.replies.push({ text: "", stop: "tool_use", toolCalls: [{ id: "v", name: "write_antagonist", input: villain }] });
    fireEvent.click(screen.getByRole("button", { name: "✦ Let the co-writer decide" }));
    await screen.findByText("The antagonist is ready, and hidden.");
    expect(screen.queryByText(/Holt/)).toBeNull();
    expect(lastText(script.requests[0])).toContain("Death: Anyone (permadeath).");
    expect(lastText(script.requests[0])).toContain("surprise them");
    expect(readArc(useEditor.getState().record!.card.data)!.antagonist!.name).toBe("Holt");

    script.replies.push(arcReply(3));
    fireEvent.change(screen.getByRole("textbox", { name: "What you want from it" }), { target: { value: "a heist" } });
    fireEvent.click(screen.getByRole("button", { name: "✦ Write the arc" }));
    await screen.findByText(/Arc written: 3 beats \(hidden\)/);
    const request = lastText(script.requests[1]);
    expect(script.requests[1].system).toContain("plotting a story arc");
    expect(request).toContain("exactly 3 beats");
    expect(request).toContain('<antagonist name="Holt">');
    expect(request).toContain("What I want from this arc: a heist");
    expect(screen.queryByText(/Beat title/)).toBeNull();
    expect(entries().map((e) => e.comment)).toEqual([
      "Story arc: rules",
      "Story arc: beat 1",
      "Story arc: beat 2",
      "Story arc: beat 3",
      "Story arc: antagonist",
    ]);

    // The lorebook's entry list hides the arc too.
    fireEvent.click(screen.getByRole("tab", { name: "Entries" }));
    expect(screen.getByRole("button", { name: "5 story arc entries, kept secret. Reveal them on the Story arc tab." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /story arc entries, kept secret/ }));

    fireEvent.click(screen.getByRole("button", { name: "Reveal the arc…" }));
    const dialog = screen.getByRole("dialog", { name: "Reveal the story arc?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it secret" }));
    expect(screen.queryByText(/Beat title/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal the arc…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reveal" }));
    expect(screen.getByText("Beat 2: Beat title 2")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Goal" })).toHaveProperty("value", "Raise the drowned city.");
    fireEvent.change(screen.getAllByRole("textbox", { name: "What happens" })[0], { target: { value: "The bell rings." } });
    expect(entries()[1].content).toContain("What happens: The bell rings.");

    fireEvent.click(screen.getByRole("button", { name: "Remove the arc" }));
    expect(entries()).toEqual([]);
    expect(readArc(useEditor.getState().record!.card.data)).toBeUndefined();
  });

  it("builds the antagonist with an interview", async () => {
    await openArc();
    script.replies.push({
      text: "",
      stop: "tool_use",
      toolCalls: [
        {
          id: "q",
          name: "ask_questions",
          input: { questions: [{ theme: "Goal", question: "What do they want?", suggestions: ["Revenge", "The city"] }] },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Build the antagonist" }));
    const dialog = screen.getByRole("dialog", { name: "Build the antagonist" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Your idea, if you have one" }), {
      target: { value: "the harbourmaster" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "The city" }));
    expect(lastText(script.requests[0])).toContain("My idea: the harbourmaster");
    expect(script.requests[0].tools!.map((t) => t.name)).toEqual(["ask_questions"]);

    script.replies.push({ text: "", stop: "tool_use", toolCalls: [{ id: "v", name: "write_antagonist", input: villain }] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the antagonist" }));
    const name = await within(dialog).findByRole("textbox", { name: "Name" });
    expect(lastText(script.requests[1])).toContain("Q: What do they want?\nA: The city");
    fireEvent.change(name, { target: { value: "Old Holt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this antagonist" }));
    expect(readArc(useEditor.getState().record!.card.data)!.antagonist!.name).toBe("Old Holt");
    // No beats yet, so nothing goes into the lorebook until the arc is written.
    expect(entries()).toEqual([]);
  });
});
