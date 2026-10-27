import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useCowriter } from "../../cowriter/store";
import { complete } from "../../cowriter/engine";
import { textOf } from "../../cowriter/polish";
import { checkCard } from "../../editor/checker";
import { findPatterns, overusedNames, sameOpenings } from "../../editor/patterns";
import { phrasesOf, repeatedPhrases, trackPhrases } from "../../editor/phraseStats";
import { DEFAULT_SLOP_PHRASES, slopInText } from "../../editor/slop";
import { useEditor } from "../../editor/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { ChatView } from "../cowriter/ChatView";

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

const SLOPPY = "Sera keeps the ferry. Her voice is barely above a whisper when she counts the fares, and she hums old songs to the river.";
const CLEAN = "Sera keeps the ferry. She counts the fares under her breath, and she hums old songs to the river.";

let projectId = "";
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
      providers: [{ id: "p", kind: "openai", name: "Kobold", baseUrl: "http://localhost:5001/v1", apiKey: "" }],
      defaultModel: { providerId: "p", model: "local" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
    },
  });
  const project = await createProject("P");
  projectId = project.id;
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
});

describe("slop while writing", () => {
  it("rewrites overused phrasing before the proposal shows, and says what it fixed", async () => {
    script.replies = [
      reply("Here.", [["set_field", { field: "description", text: SLOPPY }]]),
      reply("", [["polish", { text: CLEAN, changes: ["replaced a stock phrase"] }]]),
      reply("Done."),
    ];
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    await useCowriter.getState().load(useEditor.getState().record!.id);
    await useCowriter.getState().send("Write the description");
    const [proposal] = useCowriter.getState().chat!.proposals;
    expect(textOf(proposal.call)).toBe(CLEAN);
    expect(proposal.fixed).toEqual(["barely above a whisper"]);
    expect(script.requests[1].system).toMatch(/Right now you're the line editor/);
    expect(script.requests[1].messages[0].role === "user" && script.requests[1].messages[0].text).toMatch(/Rewrite only the lines[\s\S]*"barely above a whisper"/);
    expect(await screen.findByText(/Rewrote overused phrasing: "barely above a whisper"/)).toBeInTheDocument();
  });

  it("leaves clean text alone and can be turned off", async () => {
    script.replies = [reply("Here.", [["set_field", { field: "description", text: CLEAN }]]), reply("Done.")];
    await useCowriter.getState().load(useEditor.getState().record!.id);
    await useCowriter.getState().send("Write it");
    expect(script.requests).toHaveLength(2);

    useAiSettings.setState((s) => ({ settings: { ...s.settings, slopRewrite: false } }));
    script.replies = [reply("Here.", [["set_field", { field: "description", text: SLOPPY }]]), reply("Done.")];
    await useCowriter.getState().send("Again");
    expect(textOf(useCowriter.getState().chat!.proposals[1].call)).toBe(SLOPPY);
  });

  it("finds AI patterns, same openings and overused names", () => {
    expect(findPatterns("It was not fear, but something colder. She smiled.").map((h) => h.pattern)).toEqual(['"not X, but Y"']);
    expect(findPatterns("A dark, quiet and lonely street.").map((h) => h.pattern)).toEqual(["adjective triplet"]);
    expect(findPatterns("She ran. She hid. She waited.").map((h) => h.pattern)).toEqual(["sentences that start the same way"]);
    expect(findPatterns("One — two — three — four words here.").map((h) => h.pattern)).toEqual(["em-dash overuse"]);
    const d = useEditor.getState().record!.card.data;
    const card = { ...d, name: "Elara", first_mes: "*She looks up.*", alternate_greetings: ["*She looks up from the map.*", "*She looks up, startled.*"] };
    expect(sameOpenings(card)).toBe("she looks");
    expect(overusedNames(card)).toEqual(["Elara"]);
    const issues = checkCard({ ...useEditor.getState().record!, card: { ...useEditor.getState().record!.card, data: card } }, { slopPhrases: [] });
    expect(issues.filter((i) => i.kind === "slop").map((i) => i.message)).toEqual([
      'Most greetings open with "she looks". Openings that differ make each greeting feel like its own scene.',
      '"Elara" is a name AI models use constantly. A name that fits the setting\'s culture stands out more.',
    ]);
    expect(slopInText(SLOPPY, DEFAULT_SLOP_PHRASES)).toEqual(["barely above a whisper"]);
  });

  it("counts phrases the models repeat across projects", async () => {
    expect(phrasesOf("The lamp flickered in the dark hall")).toContain("lamp flickered in the");
    for (let i = 0; i < 5; i++) await trackPhrases(["the lamp flickered in the dark"], i % 2 ? "a" : "b");
    await trackPhrases(["only once in a project here"], "a");
    const repeated = await repeatedPhrases(DEFAULT_SLOP_PHRASES);
    expect(repeated.map((r) => r.phrase)).toContain("lamp flickered in the");
    expect(repeated.map((r) => r.phrase)).not.toContain("only once in a");
  });

  it("sends the slop list to a local backend that bans phrases", async () => {
    useAiSettings.setState((s) => ({ settings: { ...s.settings, providers: [{ ...s.settings.providers[0], banPhrases: true }] } }));
    script.replies = [reply("ok")];
    await complete("refine", { system: "", messages: [{ role: "user", text: "hi" }], tools: [] });
    expect(script.requests[0].bannedPhrases).toContain("barely above a whisper");
    expect(script.requests[0].bannedPhrases!.some((p) => p.includes("*"))).toBe(false);
  });
});

describe("prose editor pass", () => {
  it("polishes a pending proposal and a field on demand", async () => {
    script.replies = [reply("Here.", [["set_field", { field: "scenario", text: CLEAN }]]), reply("Done.")];
    await useCowriter.getState().load(useEditor.getState().record!.id);
    await useCowriter.getState().send("Write the scenario");
    render(<ChatView store={useCowriter} starters={[]} intro="" />);
    script.replies = [reply("", [["polish", { text: `${CLEAN} The river is high tonight.`, changes: ["rhythm", "stronger verbs"] }]])];
    fireEvent.click(await screen.findByRole("button", { name: "Polish edit 1" }));
    await waitFor(() => expect(useCowriter.getState().chat!.proposals[0].polished).toEqual(["rhythm", "stronger verbs"]));
    expect(textOf(useCowriter.getState().chat!.proposals[0].call)).toMatch(/high tonight/);
    expect(screen.getByText("Polished: rhythm; stronger verbs")).toBeInTheDocument();

    useEditor.getState().setField("description", CLEAN);
    script.replies = [reply("", [["polish", { text: "Sera keeps the ferry and counts every fare twice.", changes: ["tightened"] }]])];
    await useCowriter.getState().polishField("description", "description");
    const last = useCowriter.getState().chat!.proposals.at(-1)!;
    expect(last.call.input).toEqual({ field: "description", text: "Sera keeps the ferry and counts every fare twice." });
  });

  it("rejects an edit that drops most of the text", async () => {
    script.replies = [reply("Here.", [["set_field", { field: "scenario", text: CLEAN }]]), reply("Done.")];
    await useCowriter.getState().load(useEditor.getState().record!.id);
    await useCowriter.getState().send("Write the scenario");
    script.replies = [reply("", [["polish", { text: "Sera.", changes: [] }]])];
    await useCowriter.getState().polish(useCowriter.getState().chat!.proposals[0].id);
    expect(useCowriter.getState().error).toBe("The editor cut too much. Try again.");
    expect(textOf(useCowriter.getState().chat!.proposals[0].call)).toBe(CLEAN);
    expect(projectId).toBeTruthy();
  });
});
