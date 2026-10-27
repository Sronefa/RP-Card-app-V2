import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useCowriter } from "../../cowriter/store";
import { textOf } from "../../cowriter/polish";
import { handEdits } from "../../cowriter/learn";
import { useEditor } from "../../editor/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { ChatView } from "../cowriter/ChatView";
import { WritingStyle } from "../settings/WritingStyle";

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

const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.requests.length}-${i}-${Math.random()}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});

const GREETING = "The ferry knocks against the dock. Sera counts the fares twice and waits for you to step aboard.";
const DESC = "Sera keeps the ferry on the black river. She counts every fare twice and hums old songs to the water.";
const userText = (r: CompletionRequest) => r.messages.map((m) => (m.role === "user" ? m.text : "")).join("\n");

async function propose(field: string, text: string) {
  script.replies = [reply("Here.", [["set_field", { field, text }]]), reply("Done.")];
  await useCowriter.getState().send(`Write the ${field}`);
  return useCowriter.getState().chat!.proposals.at(-1)!;
}

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Local", baseUrl: "http://localhost:5001/v1", apiKey: "" }],
      defaultModel: { providerId: "p", model: "local" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
      slopRewrite: false,
    },
  });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  await useCowriter.getState().load(card.id);
});

describe("learn from the user", () => {
  it("revises a proposal with one tap on a feedback chip", async () => {
    await propose("description", DESC);
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    script.replies = [reply("", [["polish", { text: "Sera keeps the ferry and counts every fare twice.", changes: ["cut"] }]])];
    fireEvent.click(within(await screen.findByRole("group", { name: "Revise edit 1" })).getByRole("button", { name: "Shorter" }));
    await waitFor(() => expect(useCowriter.getState().chat!.proposals[0].revised).toEqual(["shorter"]));
    expect(textOf(useCowriter.getState().chat!.proposals[0].call)).toBe("Sera keeps the ferry and counts every fare twice.");
    expect(screen.getByText("Revised: Shorter")).toBeInTheDocument();
    const req = script.requests.at(-1)!;
    expect(req.system).toMatch(/Right now you're rewriting one piece of card text/);
    expect(userText(req)).toMatch(/Make it shorter/);
    expect(useCowriter.getState().chat!.unreported.at(-1)).toMatch(/edit 1 revised: shorter/);
    await waitFor(() => expect(useAiSettings.getState().settings.feedback?.counts.shorter).toBe(1));
  });

  it("takes an optional reason on a rejection, and offers a style note after repeated feedback", async () => {
    await propose("description", DESC);
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Why was edit 1 rejected?" })).getByRole("button", { name: "Too long" }));
    expect(await screen.findByText("Why: Too long")).toBeInTheDocument();
    expect(useCowriter.getState().chat!.unreported.at(-1)).toBe("The user rejected edit 1 because: too long. Keep this in mind for what you write next.");
    await waitFor(() => expect(useAiSettings.getState().settings.feedback?.counts.shorter).toBe(1));

    await act(() => useAiSettings.getState().update({ feedback: { counts: { shorter: 3 }, offered: [] } }));
    expect(await screen.findByText(/"Shorter" came up in your feedback 3 times/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(useAiSettings.getState().settings.styleNotes).toEqual(["Keep drafts tight. Cut any line that doesn't earn its place."]));
    expect(screen.queryByText(/came up in your feedback/)).toBeNull();

    await propose("scenario", DESC);
    expect(userText(script.requests.at(-2)!)).toMatch(/<notes title="The user's style notes">[\s\S]*- Keep drafts tight/);
  });

  it("offers to learn from a hand edit of an accepted proposal", async () => {
    const p = await propose("description", DESC);
    useCowriter.getState().decide(p.id, true);
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    expect(screen.queryByText(/by hand/)).toBeNull();
    act(() => useEditor.getState().setField("description", "Sera keeps the ferry on the black river. She counts each fare twice, lips moving, and never sings."));
    expect(await screen.findByText(/You changed the description from edit 1 by hand/)).toBeInTheDocument();
    script.replies = [reply("", [["style_note", { note: "Show habits through small actions, not songs." }]])];
    fireEvent.click(screen.getByRole("button", { name: "✦ Learn from my edit" }));
    const box = (await screen.findByRole("textbox", { name: "Style note" })) as HTMLTextAreaElement;
    expect(box.value).toBe("Show habits through small actions, not songs.");
    expect(userText(script.requests.at(-1)!)).toMatch(/<changed_to>\nSera keeps the ferry on the black river\. She counts each fare twice/);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(useAiSettings.getState().settings.styleNotes).toEqual(["Show habits through small actions, not songs."]));
    expect(useCowriter.getState().chat!.proposals[0].learned).toBe(true);
    expect(screen.queryByText(/by hand/)).toBeNull();
  });

  it("only counts real edits of the co-writer's text as hand edits", async () => {
    const p = await propose("description", DESC);
    useCowriter.getState().decide(p.id, true);
    const chat = useCowriter.getState().chat!;
    const data = useEditor.getState().record!.card.data;
    expect(handEdits(chat, data)).toEqual([]);
    expect(handEdits(chat, { ...data, description: "A different text entirely about a lighthouse keeper named Bram." })).toEqual([]);
    expect(handEdits(chat, { ...data, description: DESC.replace("black", "grey") })).toEqual([]);
    expect(handEdits(chat, { ...data, description: DESC.replace("hums old songs to the water", "never says a word to anyone") })).toHaveLength(1);
  });

  it("lists, adds and deletes style notes in Settings", async () => {
    render(<WritingStyle />);
    fireEvent.change(screen.getByRole("textbox", { name: "New style note" }), { target: { value: "Never describe eye color" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Never describe eye color")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete note: Never describe eye color" }));
    await waitFor(() => expect(useAiSettings.getState().settings.styleNotes).toEqual([]));
  });
});

describe("variants", () => {
  it("writes versions side by side, ranks them, and uses one or merged paragraphs", async () => {
    await propose("first_mes", GREETING);
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    expect(screen.queryByRole("button", { name: "Variants of edit 1" })).toBeInTheDocument();
    script.replies = [
      reply("", [
        [
          "variants",
          {
            versions: [
              { approach: "quiet", text: "Fog on the water.\n\nSera folds her hands over the fare box." },
              { approach: "action", text: "The rope snaps.\n\nSera grabs your wrist as the ferry lurches." },
              { approach: "dialogue", text: '"Fare first," Sera says.\n\n"Then we talk about where you\'re going."' },
            ],
          },
        ],
      ]),
    ];
    fireEvent.click(screen.getByRole("button", { name: "Variants of edit 1" }));
    const group = await screen.findByRole("group", { name: "Variants" });
    expect(within(group).getByText("First draft")).toBeInTheDocument();
    expect(within(group).getByText("Mid-action")).toBeInTheDocument();
    expect(userText(script.requests.at(-1)!)).toMatch(/- Dialogue-led: open on the character speaking/);

    fireEvent.click(within(group).getByRole("button", { name: "Use the Mid-action version" }));
    expect(textOf(useCowriter.getState().chat!.proposals[0].call)).toBe("The rope snaps.\n\nSera grabs your wrist as the ferry lurches.");

    script.replies = [reply("", [["rank", { ranking: [{ version: 4, why: "Hooks fast" }, { version: 3, why: "Tense" }] }]])];
    fireEvent.click(within(group).getByRole("button", { name: "✦ Rank them" }));
    expect(await within(group).findByText("#1 · Dialogue-led")).toBeInTheDocument();
    expect(within(group).getByText("Hooks fast")).toBeInTheDocument();
    expect(script.requests.at(-1)!.system).toMatch(/Right now you're judging versions/);

    fireEvent.click(within(group).getByRole("button", { name: "Merge paragraphs" }));
    fireEvent.click(within(group).getByRole("checkbox", { name: "Quiet, paragraph 1" }));
    fireEvent.click(within(group).getByRole("checkbox", { name: "Dialogue-led, paragraph 1" }));
    fireEvent.click(within(group).getByRole("button", { name: "Use the checked paragraphs" }));
    expect(textOf(useCowriter.getState().chat!.proposals[0].call)).toBe('Fog on the water.\n\n"Fare first," Sera says.');
    expect(useCowriter.getState().chat!.unreported.at(-1)).toBe("The user put lines merged from several versions in edit 1; it is still waiting for their decision.");
  });

  it("offers variants only for greetings, descriptions and example dialogue", async () => {
    await propose("scenario", DESC);
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    await screen.findByRole("group", { name: "Revise edit 1" });
    expect(screen.queryByRole("button", { name: "Variants of edit 1" })).toBeNull();
  });
});
