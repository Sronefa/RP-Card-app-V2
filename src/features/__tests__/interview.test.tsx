import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useInterview } from "../../cowriter/interview";
import { useCowriter, useLoreChat } from "../../cowriter/store";
import { createCard, createProject, getChat, getInterview, loreChatKey, resetDbForTests, saveProject } from "../../db/db";
import { useEditor } from "../../editor/store";
import { CowriterPanel } from "../cowriter/CowriterPanel";
import { LorebookView } from "../lorebook/LorebookView";

/** Scripted model: each call takes the next reply. Requests are recorded. */
const script = vi.hoisted(() => ({
  replies: [] as (CompletionResult | Error)[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      if (next instanceof Error) throw next;
      if (next.text) req.onText?.(next.text);
      return next;
    },
  }),
}));

let callId = 0;
const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input]) => ({ id: `c${++callId}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});

const ask = (...questions: [string, string[]][]) =>
  ["ask_questions", { questions: questions.map(([question, suggestions]) => ({ theme: "Core concept", question, suggestions })) }] as [
    string,
    Record<string, unknown>,
  ];

const lastText = (req: CompletionRequest) => {
  const m = req.messages.at(-1)!;
  return m.role === "user" ? m.text : m.role === "tool" ? m.results.map((r) => r.content).join("\n") : m.text;
};

let projectId = "";
async function setup(depth: "quick" | "standard" | "deep") {
  const project = await createProject("P");
  projectId = project.id;
  await saveProject({ ...project, cowriter: { contentMode: "unhinged", tone: "", genre: "fantasy", depth, suggestions: "balanced", presetIds: [] } });
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  return card.id;
}

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useLoreChat.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useInterview.setState({ interview: undefined, busy: false, status: "", streaming: "", error: undefined });
  useUi.setState({ cowriterTab: "chat" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [
        { id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" },
        { id: "q", kind: "openai", name: "Cheap", baseUrl: "https://y/v1", apiKey: "k" },
      ],
      defaultModel: { providerId: "p", model: "big-model" },
      modeModels: { gap: { providerId: "q", model: "small-model" }, critic: { providerId: "q", model: "" } },
      noToolModels: [],
      presets: [],
    },
  });
});

const idle = () => waitFor(() => expect(useInterview.getState().busy).toBe(false));

async function startInterview(premise: string) {
  fireEvent.click(screen.getByRole("tab", { name: "Interview" }));
  fireEvent.change(await screen.findByRole("textbox", { name: /Your idea/ }), { target: { value: premise } });
  fireEvent.click(screen.getByRole("button", { name: "Start the interview" }));
  await idle();
}

const DRAFT_REPLIES = () => [
  reply("", [
    ["set_field", { field: "name", text: "Vex" }],
    ["set_field", { field: "description", text: "Vex is a 30-year-old dragon librarian." }],
  ]),
  reply("", [
    ["set_field", { field: "first_mes", text: "Vex looks up from a ledger." }],
    ["add_greeting", { text: "A storm hits the library." }],
  ]),
  reply("", [["add_example_dialogue", { text: "{{char}}: Shh." }]]),
  reply("", [["add_lore_entry", { title: "The Archive", keys: ["archive"], content: "A vault of banned books.", why: "Her secret." }]]),
];

describe("interview", () => {
  it("runs the standard pipeline: rounds, gap check, dig deeper, story bible, draft", async () => {
    const cardId = await setup("standard");
    script.replies.push(
      reply("Let's begin.", [
        ["note_facts", { facts: ["A dragon librarian"] }],
        ask(["What does she guard?", ["Banned books", "A sleeping god"]], ["How old is she?", ["30", "300"]]),
      ]),
    );
    render(<CowriterPanel />);
    await startInterview("a dragon librarian");

    // The kickoff carries the idea, the themes for the content mode and the depth plan.
    const kickoff = lastText(script.requests[0]);
    expect(script.requests[0].system).toContain("interviewing the user");
    expect(kickoff).toContain("My idea: a dragon librarian");
    expect(kickoff).toContain("Sex: bodies, kinks");
    expect(kickoff).toContain("Depth: Standard");
    expect(screen.getByText("What I know so far (1)")).toBeInTheDocument();

    // Pick a suggestion for one question and leave the other to the co-writer.
    fireEvent.click(screen.getByRole("button", { name: "Banned books" }));
    expect(screen.getByRole("button", { name: "Banned books" })).toHaveAttribute("aria-pressed", "true");
    script.replies.push(reply("", [["note_facts", { facts: ["Guards banned books"] }], ["finish_interview", {}]]));
    script.replies.push(
      reply("", [["write_memo", { missing: ["Her stance toward {{user}}"], vague: [], contradictions: [], opportunities: ["A rival"], clean: false }]]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await idle();

    // The answers went back as the result of the ask_questions call.
    const answers = script.requests[1].messages.at(-1)!;
    expect(answers.role).toBe("tool");
    expect(lastText(script.requests[1])).toContain("A: Banned books");
    expect(lastText(script.requests[1])).toContain("A: (You decide.)");
    // The gap check ran on its own model, in a fresh conversation.
    expect(script.requests[2].model).toBe("small-model");
    expect(script.requests[2].messages).toHaveLength(1);
    expect(lastText(script.requests[2])).toContain("Guards banned books");
    expect(screen.getByText(/Her stance toward/)).toBeInTheDocument();

    script.replies.push(reply("", [ask(["How does she treat visitors?", ["Coldly", "Like prey"]])]));
    fireEvent.click(screen.getByRole("button", { name: "Dig deeper" }));
    await idle();
    expect(lastText(script.requests[3])).toContain("Her stance toward {{user}}");

    // Standard runs one gap loop, so the next answers lead straight to the story bible.
    fireEvent.change(screen.getByRole("textbox", { name: /Your answer: How does she treat visitors/ }), { target: { value: "With suspicion" } });
    script.replies.push(
      reply("", [["write_story_bible", { sections: [{ title: "Core", facts: ["Vex guards banned books", "She is 30"] }] }]]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await idle();
    const bibleRequest = script.requests[4];
    expect(bibleRequest.model).toBe("big-model");
    expect(bibleRequest.messages.at(-2)!.role).toBe("tool");
    expect(lastText(bibleRequest)).toContain("Write the story bible");
    const bible = screen.getByRole("textbox", { name: "Story bible" });
    expect(bible).toHaveValue("## Core\n- Vex guards banned books\n- She is 30");
    fireEvent.change(bible, { target: { value: "## Core\n- Vex guards banned books\n- She is 31" } });

    script.replies.push(...DRAFT_REPLIES());
    fireEvent.click(screen.getByRole("button", { name: "Draft the card" }));
    await idle();

    // One call per field group, each written from the edited bible and the draft so far.
    const drafts = script.requests.slice(5);
    expect(drafts).toHaveLength(4);
    expect(drafts.every((r) => r.system.includes("drafting the card") && r.messages.length === 1)).toBe(true);
    expect(lastText(drafts[0])).toContain("She is 31");
    expect(lastText(drafts[1])).toContain("Vex is a 30-year-old dragon librarian.");
    expect(drafts[0].tools.map((t) => t.name)).toEqual(["set_field", "add_greeting", "add_example_dialogue", "add_lore_entry"]);

    // The draft lands in the chat as proposals, and the chat tab opens.
    await screen.findByText(/Here's the first draft/);
    expect(useUi.getState().cowriterTab).toBe("chat");
    fireEvent.click(screen.getByRole("button", { name: "Accept all 6 edits" }));
    const data = useEditor.getState().record!.card.data;
    expect(data.name).toBe("Vex");
    expect(data.alternate_greetings).toEqual(["A storm hits the library."]);
    expect(data.mes_example).toBe("<START>\n{{char}}: Shh.");
    expect(data.character_book?.entries.map((e) => e.comment)).toEqual(["The Archive"]);

    // The chat keeps to the bible from now on.
    script.replies.push(reply("Sure."));
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the co-writer" }), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(useCowriter.getState().busy).toBe(false));
    expect(lastText(script.requests.at(-1)!)).toContain("She is 31");

    const stored = await getInterview(cardId);
    expect(stored?.stage).toBe("done");
  });

  it("drafts right after one round on Quick, and retries after an error", async () => {
    await setup("quick");
    script.replies.push(new Error("HTTP 500: overloaded"));
    render(<CowriterPanel />);
    await startInterview("");
    expect(screen.getByRole("alert")).toHaveTextContent("overloaded");
    expect(lastText(script.requests[0])).toContain("I have no idea yet");

    script.replies.push(reply("", [ask(["Who is she?", ["A thief", "A queen"]])]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "A queen" }));
    script.replies.push(...DRAFT_REPLIES());
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await idle();

    // No gap check and no bible: the draft is written from the answers.
    expect(script.requests).toHaveLength(6);
    expect(lastText(script.requests[2])).toContain("A: A queen");
    await screen.findByText(/Here's the first draft, written from the interview/);
  });

  it("keeps going on Deep until the memo is clean", async () => {
    await setup("deep");
    script.replies.push(reply("", [ask(["Q1?", ["a", "b"]])]));
    render(<CowriterPanel />);
    await startInterview("x");
    // Deep keeps asking until the interviewer finishes.
    script.replies.push(reply("", [ask(["Q2?", ["a", "b"]])]));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await idle();
    expect(screen.getByText("Q2?")).toBeInTheDocument();
    script.replies.push(reply("", [["write_memo", { missing: ["A name"], vague: [], contradictions: [], opportunities: [], clean: false }]]));
    fireEvent.click(screen.getByRole("button", { name: "Enough questions" }));
    await idle();
    script.replies.push(reply("", [ask(["Her name?", ["Ana", "Bo"]])]));
    fireEvent.click(screen.getByRole("button", { name: "Dig deeper" }));
    await idle();
    script.replies.push(reply("", [["write_memo", { missing: [], vague: [], contradictions: [], opportunities: [], clean: true }]]));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await idle();
    // On Deep a second gap check runs; this one is clean.
    expect(screen.getByText(/Nothing important is missing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dig deeper" })).not.toBeInTheDocument();
    script.replies.push(reply("", [["write_story_bible", { sections: [{ title: "Core", facts: ["Ana"] }] }]]));
    fireEvent.click(screen.getByRole("button", { name: "Write the story bible" }));
    await idle();
    expect(screen.getByRole("textbox", { name: "Story bible" })).toHaveValue("## Core\n- Ana");
  });

  it("brainstorms an answer to one question", async () => {
    await setup("standard");
    script.replies.push(reply("", [ask(["What does she guard?", ["Books"]])]));
    render(<CowriterPanel />);
    await startInterview("x");

    script.replies.push(
      reply("Some ideas.", [
        [
          "suggest_answers",
          {
            ideas: [
              { title: "Bones", answer: "The bones of the first king." },
              { title: "A door", answer: "A door that opens into yesterday." },
            ],
          },
        ],
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "✦ Brainstorm" }));
    const dialog = await screen.findByRole("dialog", { name: "Brainstorm" });
    await within(dialog).findByText("The bones of the first king.");
    const req = script.requests.at(-1)!;
    expect(req.system).toContain("brainstorming the answer");
    expect(lastText(req)).toContain("The question: What does she guard?");
    expect(lastText(req)).toContain("Content mode: Unhinged");

    script.replies.push(reply("", [["final_answer", { answer: "A door made of the first king's bones." }]]));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Pick Bones" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Pick A door" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Combine 2 picked" }));
    await within(dialog).findByText("A door made of the first king's bones.");
    const combine = script.requests.at(-1)!;
    expect(combine.messages.at(-2)!.role).toBe("tool");
    expect(lastText(combine)).toBe('Combine "Bones" and "A door" into one answer.');

    const final = within(dialog).getByText("A door made of the first king's bones.").closest("div")!.parentElement!;
    fireEvent.click(within(final).getByRole("button", { name: "Use this" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Your answer: What does she guard/ })).toHaveValue("A door made of the first king's bones.");
  });
});

describe("critic", () => {
  it("reviews the card, then has the co-writer fix what it found", async () => {
    await setup("standard");
    useEditor.getState().setField("description", "She is nice.");
    script.replies.push(reply("1. description: \"nice\" is vague."), reply("", [["patch_field", { field: "description", find: "nice", replace: "patient" }]]), reply("Fixed."));
    render(<CowriterPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Critic" }));
    await screen.findByText("Fixed.");
    // The critic has no tools and falls back to the default model when its own isn't finished.
    expect(script.requests[0].tools).toEqual([]);
    expect(script.requests[0].model).toBe("big-model");
    expect(script.requests[0].system).toContain("you're the critic");
    expect(lastText(script.requests[1])).toContain('"nice" is vague');
    expect(screen.getByText(/Fix what the critic found/)).toBeInTheDocument();
    expect(screen.getByText(/Edit 1: Change description/)).toBeInTheDocument();
  });
});

describe("lorebook brainstorm", () => {
  it("pitches entries in its own chat and asks for more like one", async () => {
    const cardId = await setup("standard");
    script.replies.push(
      reply("One place.", [["add_lore_entry", { title: "The Archive", why: "Where her secret lives.", keys: ["archive"], content: "A vault." }]]),
    );
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "Brainstorm" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pitch places worth having entries for" }));
    await screen.findByText("Where her secret lives.");
    expect(script.requests[0].system).toContain("brainstorming lorebook entries");
    expect(script.requests[0].tools.map((t) => t.name)).toEqual(["add_lore_entry", "update_lore_entry", "delete_lore_entry", "pitch"]);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(useEditor.getState().record!.card.data.character_book?.entries[0].content).toBe("A vault.");

    script.replies.push(reply("Another."));
    fireEvent.click(screen.getByRole("button", { name: "More like this" }));
    await screen.findByText("Another.");
    expect(lastText(script.requests.at(-1)!)).toContain('More like edit 1 ("The Archive").');

    expect((await getChat(loreChatKey(cardId)))?.messages.length).toBeGreaterThan(0);
    expect(await getChat(cardId)).toBeUndefined();
    fireEvent.click(screen.getByRole("tab", { name: "Entries" }));
    expect(screen.getByText("The Archive")).toBeInTheDocument();
    expect(projectId).not.toBe("");
  });
});
