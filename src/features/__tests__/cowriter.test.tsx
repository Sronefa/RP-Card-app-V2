import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { ToolsUnsupportedError } from "../../ai/types";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, getChat, resetDbForTests, saveProject } from "../../db/db";
import { useEditor } from "../../editor/store";
import { CowriterPanel } from "../cowriter/CowriterPanel";

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
      req.onText?.(next.text);
      return next;
    },
  }),
}));

const reply = (text: string, calls: [string, Record<string, unknown>][] = [], stop?: CompletionResult["stop"]): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.requests.length}-${i}`, name, input })),
  stop: stop ?? (calls.length ? "tool_use" : "end"),
});

let cardId = "";
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
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "big-model" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [{ id: "pre", name: "House style", text: "Present tense." }],
    },
  });
  const project = await createProject("P");
  await saveProject({ ...project, cowriter: { contentMode: "dark", tone: "grim", genre: "", depth: "standard", suggestions: "quiet", presetIds: ["pre"] } });
  const card = await createCard(project.id, "character");
  cardId = card.id;
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("description", "Sera is kind.");
});

async function say(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message to the co-writer" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(useCowriter.getState().busy).toBe(false));
}

describe("co-writer", () => {
  it("asks for a model when none is set", () => {
    useAiSettings.setState({ settings: { ...useAiSettings.getState().settings, defaultModel: undefined } });
    render(<CowriterPanel />);
    expect(screen.getByRole("button", { name: "Set up a model" })).toBeInTheDocument();
  });

  it("turns tool calls into proposals, applies accepted ones and reports decisions", async () => {
    script.replies.push(
      reply("", [
        ["patch_field", { field: "description", find: "kind", replace: "fierce" }],
        ["set_field", { field: "scenario", text: "A storm." }],
        ["patch_field", { field: "description", find: "missing", replace: "x" }],
      ]),
      reply("Made her fiercer and set the scene."),
    );
    render(<CowriterPanel />);
    await say("Make her meaner");

    // The first request carries the settings, presets and card; the system prompt stays generic.
    const first = script.requests[0];
    expect(first.useTools).toBe(true);
    expect(first.system).not.toContain("Sera");
    const sent = first.messages[0] as { text: string };
    expect(sent.text).toContain("Content: Dark");
    expect(sent.text).toContain("Tone: grim.");
    expect(sent.text).toContain("Present tense.");
    expect(sent.text).toContain("Sera is kind.");
    expect(sent.text).toMatch(/Make her meaner$/);
    // The invalid call went back to the model as an error; it saw the results and replied.
    const results = script.requests[1].messages[2] as { role: string; results: { isError?: boolean; content: string }[] };
    expect(results.role).toBe("tool");
    expect(results.results.map((r) => !!r.isError)).toEqual([false, false, true]);

    expect(screen.getByText("Make her meaner")).toBeInTheDocument();
    expect(screen.getByText("Made her fiercer and set the scene.")).toBeInTheDocument();
    const edit1 = screen.getByText(/Edit 1: Change description/).closest("div")!.parentElement!;
    expect(within(edit1).getByText("fierce.")).toBeInTheDocument();

    fireEvent.click(within(edit1).getByRole("button", { name: "Accept" }));
    expect(useEditor.getState().record!.card.data.description).toBe("Sera is fierce.");
    const edit2 = screen.getByText(/Edit 2: Write scenario/).closest("div")!.parentElement!;
    fireEvent.click(within(edit2).getByRole("button", { name: "Reject" }));
    expect(useEditor.getState().record!.card.data.scenario).toBe("");

    // The next message reports the decisions and the changed card, but not the unchanged settings.
    script.replies.push(reply("Noted."));
    await say("Thanks");
    const next = (script.requests[2].messages.at(-1) as { text: string }).text;
    expect(next).toContain("Edit 1 (Change description): accepted");
    expect(next).toContain("Edit 2 (Write scenario): rejected");
    expect(next).not.toContain("Content mode");
    expect(next).toContain("<card");

    // Accepting is one undo step. Back to what the co-writer last saw, so the card isn't sent again.
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().record!.card.data.description).toBe("Sera is kind.");
    script.replies.push(reply("Ok."));
    await say("Undid it");
    expect((script.requests[3].messages.at(-1) as { text: string }).text).toContain("<card");

    // Decided edits keep their description even though the card has moved on.
    expect(screen.getByText(/Edit 1: Change description/)).toBeInTheDocument();
    const stored = await getChat(cardId);
    expect(stored?.proposals.map((p) => p.status)).toEqual(["accepted", "rejected"]);
  });

  it("falls back to JSON edits when the model can't use tools", async () => {
    script.replies.push(new ToolsUnsupportedError("no tools"), reply("Set.", [["set_field", { field: "scenario", text: "Night." }]], "end"));
    render(<CowriterPanel />);
    await say("Set the scene");
    expect(script.requests.map((r) => r.useTools)).toEqual([true, false]);
    expect(useAiSettings.getState().settings.noToolModels).toEqual(["p/big-model"]);
    // JSON edits end the turn: no second call to read results.
    expect(script.requests).toHaveLength(2);
    expect(screen.getByText(/Edit 1: Write scenario/)).toBeInTheDocument();
  });

  it("shows errors and keeps the chat usable", async () => {
    script.replies.push(new Error("HTTP 401: invalid key"));
    render(<CowriterPanel />);
    await say("Hello");
    expect(screen.getByRole("alert")).toHaveTextContent("invalid key");
    script.replies.push(reply("Hi!"));
    await say("Hello again");
    expect(screen.getByText("Hi!")).toBeInTheDocument();
  });

  it("sends a pitch back when the user uses it", async () => {
    script.replies.push(reply("One idea.", [["pitch", { title: "A twin", idea: "She has a twin sister." }]], "end"));
    render(<CowriterPanel />);
    await say("Ideas?");
    script.replies.push(reply("Working it in."));
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(screen.getByText("Working it in.")).toBeInTheDocument());
    const last = (script.requests.at(-1)!.messages.at(-1) as { text: string }).text;
    expect(last).toContain('Use idea 1 ("A twin")');
  });
});
