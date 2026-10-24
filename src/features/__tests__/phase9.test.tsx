import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { CardBar } from "../editor/CardBar";
import { TextField } from "../editor/TextField";
import { TEXT_FIELDS } from "../editor/fields";
import { ProposalCard } from "../cowriter/ProposalCard";

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

const done: CompletionResult = { text: "Done.", toolCalls: [], stop: "end" };
const lastText = (req: CompletionRequest) => (req.messages.at(-1) as { text: string }).text;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useUi.setState({ section: "editor", cowriterTab: "chat" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "m" },
      modeModels: {},
      noToolModels: [],
      presets: [],
      imageStyles: [],
      slopPhrases: ["barely above a whisper"],
    },
  });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mira");
});

describe("card check", () => {
  it("shows the health score, overused phrasing and names without entries", async () => {
    useEditor.getState().setField("description", "Mira guards the Ash Ford. Her voice is barely above a whisper.");
    useEditor.getState().setField("first_mes", "*Mira waits.*");
    render(<CardBar />);
    fireEvent.click(screen.getByRole("button", { name: /^Check/ }));
    const dialog = screen.getByRole("dialog", { name: "Card check" });
    expect(within(dialog).getByLabelText(/Card health \d+ out of 100/)).toBeInTheDocument();
    const slop = within(dialog).getByRole("region", { name: "Overused phrasing" });
    expect(slop).toHaveTextContent('Description uses "barely above a whisper": "Her voice is barely above a whisper."');
    const names = within(dialog).getByRole("region", { name: "Names without lorebook entries" });
    expect(names).toHaveTextContent('"Ash Ford" is mentioned once');

    fireEvent.click(within(names).getByRole("button", { name: "Add an empty entry for Ash Ford" }));
    const entries = useEditor.getState().record!.card.data.character_book!.entries;
    expect(entries.map((e) => [e.comment, e.keys])).toEqual([["Ash Ford", ["Ash Ford"]]]);
    expect(useUi.getState()).toMatchObject({ section: "lorebook", focusEntry: 0 });
  });

  it("rewrites a flagged line with the co-writer", async () => {
    useEditor.getState().setField("description", "Her voice is barely above a whisper.");
    script.replies.push(done);
    render(<CardBar />);
    fireEvent.click(screen.getByRole("button", { name: /^Check/ }));
    fireEvent.click(screen.getByRole("button", { name: /Fix with the co-writer: Description uses/ }));
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toContain(
      'In the description, rewrite this line so it doesn\'t use the overused phrase "barely above a whisper".',
    );
  });
});

describe("token squeeze", () => {
  it("asks for a field squeezed to the chosen size and shows the new size on the edit", async () => {
    const long = "Mira is a ranger of the north who guards the gate. ".repeat(10).trim();
    useEditor.getState().setField("description", long);
    script.replies.push(done);
    render(<TextField info={TEXT_FIELDS.description![0]} />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Ask co-writer" }));
    fireEvent.click(screen.getByRole("button", { name: "Squeeze…" }));
    const form = screen.getByRole("form", { name: "Squeeze the description" });
    const target = within(form).getByRole("spinbutton", { name: "Target tokens" });
    expect(target).toHaveValue(90);
    fireEvent.change(target, { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: "Squeeze" }));
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toContain("Squeeze the description down to about 60 tokens (it is about 128 now).");

    render(
      <ProposalCard
        proposal={{ id: "x", number: 1, status: "pending", call: { id: "c", name: "set_field", input: { field: "description", text: "Mira guards the north gate." } } }}
        data={useEditor.getState().record!.card.data}
        onDecide={() => {}}
      />,
    );
    expect(screen.getByText("~128 → ~7 tokens")).toBeInTheDocument();
  });
});
