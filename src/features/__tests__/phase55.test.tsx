import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFeaturesText, ENGINE_WRITING_TOOLS } from "../../ai/engineTools";
import { useAiSettings } from "../../ai/settings";
import { applyEdit, planEdit } from "../../ai/tools";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { askFor, dismissTask, fileNewGaps, fileTasks, loadTasks, pendingTasks, scanGaps, taskBrief } from "../../app/handoff";
import { collectInbox } from "../../app/inbox";
import type { CardDataV3 } from "../../card";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, getChat, resetDbForTests, saveProject } from "../../db/db";
import { engineGaps, newGaps } from "../../editor/gaps";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { worldEntry, type WorldKind } from "../../editor/world";
import { LEAD_TOOLS } from "../../engine/engineer/worker";
import { useEngineer } from "../../engine/engineer/session";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { EXAMPLES } from "../../engine/engineer/examples";
import { coreModules, newModule } from "../../engine/modules/compile";
import { newLiveFeed } from "../../engine/modules/live";
import { mapModule } from "../../engine/modules/map";
import { phoneModule } from "../../engine/modules/phone";
import type { EngineModule } from "../../engine/modules/types";
import { applyEngine, newEngine, newVar, readEngine, type EngineConfig } from "../../engine/sheet";
import { InboxDialog } from "../inbox/InboxDialog";

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
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.requests.length}-${i}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});

const page = (data: CardDataV3, kind: WorldKind, fields: Record<string, string>): CardDataV3 => {
  const book = data.character_book ?? emptyBook();
  return { ...data, character_book: { ...book, entries: [...book.entries, worldEntry(book, kind, fields)] } };
};

const game = EXAMPLES.find((e) => e.id === "lockpicking")!;

function engine(modules: EngineModule[] = []): EngineConfig {
  return {
    ...newEngine(),
    vars: [
      newVar({ id: "trust", group: "Mina", name: "Trust", type: "number", start: "20", min: 0, max: 100, pinned: false, rule: "" }),
      newVar({ id: "mood", group: "Mina", name: "Mood", type: "text", start: "calm", pinned: true, rule: "Her mood in a word, changing when the scene does." }),
    ],
    modules: [...coreModules(), phoneModule({ apps: ["messages", "contacts", "shop"], contacts: [{ name: "Mina", role: "neighbour" }] }), mapModule({ places: [{ name: "Old Pier", description: "Rotten planks." }] }), ...modules],
    theme: { ...newEngine().theme!, moods: [{ id: "mood-1", name: "Mood 1", path: "Mina.Trust", min: 70, tokens: { accent: "#e0313f" } }], portraits: [{ name: "Mina", outfit: "Mina.Mood" }] } as EngineConfig["theme"],
  };
}

let data: CardDataV3;
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
      presets: [],
    },
  });
  const project = await createProject("P");
  await saveProject({ ...project, cowriter: { contentMode: "dark", tone: "", genre: "", depth: "standard", suggestions: "quiet", presetIds: [], engineMode: true } });
  const card = await createCard(project.id, "character");
  cardId = card.id;
  await useEditor.getState().open(card.id);
  const feed = newLiveFeed("Texts", { id: "texts" });
  data = applyEngine(useEditor.getState().record!.card.data, engine([{ ...game, tags: [], settings: {} }, { ...newModule("Mina texts"), id: "mina-texts", live: [feed] }]));
  data = page(data, "npc", { name: "Holt", role: "harbour master" });
  data = page(data, "location", { name: "Lantern Street", mood: "busy" });
  useEditor.getState().replaceData(data);
});

describe("the gap scan", () => {
  it("lists what the engine should show and what needs words, with stable keys", () => {
    const gaps = engineGaps(data);
    const keys = gaps.map((g) => `${g.to} ${g.key}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "engineer contact:holt",
        "engineer place:lantern street",
        "engineer meter:mina.trust",
        "cowriter place-lore:old pier",
        "cowriter shop-goods",
        "cowriter pack:mina-texts:texts",
        "cowriter game-lines:lockpicking",
        "cowriter mood:mood-1",
        "cowriter expressions:mina",
      ]),
    );
    // Mina is already a contact, and an engine-ready issue (no rule) is a co-writer task.
    expect(keys).not.toContain("engineer contact:mina");
    expect(gaps.some((g) => g.to === "cowriter" && g.key.startsWith("ready:") && /Write one with set_update_rule/.test(g.brief))).toBe(true);
    const holt = gaps.find((g) => g.key === "contact:holt")!;
    expect(holt.source!.text).toContain("Holt (harbour master)");
    expect(engineGaps({ ...data, extensions: {} })).toEqual([]);
  });

  it("tells what an accepted change opened up, for one side", () => {
    const after = page(data, "npc", { name: "Rook", role: "smuggler" });
    expect(newGaps(data, after).map((g) => g.key)).toEqual(["contact:rook"]);
    expect(newGaps(data, after, "cowriter")).toEqual([]);
  });
});

describe("tasks", () => {
  it("files each gap once, keeps dismissed ones out unless asked, and builds the brief from the lore", async () => {
    const gaps = engineGaps(data);
    const first = await fileTasks(cardId, gaps, "scan");
    expect(first.filed).toHaveLength(gaps.length);
    expect((await fileTasks(cardId, gaps, "scan")).filed).toEqual([]);
    const holt = first.filed.find((t) => t.key === "contact:holt")!;
    await dismissTask(cardId, holt.id);
    const again = await scanGaps(cardId, data);
    expect(again).toMatchObject({ filed: [], skipped: 1, found: gaps.length });
    expect((await fileTasks(cardId, [holt], "scan", true)).filed).toHaveLength(1);
    const brief = taskBrief(holt);
    expect(brief).toMatch(/^A task from the catch-up scan, approved by the user: Add Holt as a phone contact\./);
    expect(brief).toContain("<source>\nHolt (harbour master)");
  });

  it("files what an accepted change opened up for the other side", async () => {
    const after = page(data, "npc", { name: "Rook" });
    const out = await fileNewGaps(cardId, data, after, "cowriter");
    expect(out.filed.map((t) => [t.to, t.from, t.title])).toEqual([["engineer", "cowriter", "Add Rook as a phone contact"]]);
    const config = readEngine(data)!;
    const more = applyEngine(data, { ...config, vars: [...config.vars, newVar({ id: "gold", group: "Player", name: "Gold", type: "number", start: "5", pinned: true, rule: "" })] });
    const words = await fileNewGaps(cardId, data, more, "engineer");
    expect(words.filed.every((t) => t.to === "cowriter" && t.from === "engineer")).toBe(true);
    expect(words.filed.map((t) => t.title).join("\n")).toMatch(/Player\.Gold/);
  });
});

describe("the inbox", () => {
  it("shows tasks to approve, edit or dismiss; an approved engineer task runs in the background", async () => {
    const queue = vi.fn(async () => ({ status: "done" as const }));
    useEngineer.setState({ queue });
    await scanGaps(cardId, data);
    const items = await collectInbox(cardId);
    const holt = items.find((i) => i.summary === "Add Holt as a phone contact")!;
    expect(holt).toMatchObject({ source: "for-engineer", detail: 'From the catch-up scan, about lorebook page "Holt"' });
    const view = render(<InboxDialog items={items} open onClose={() => {}} />);
    const row = screen.getByText("Add Holt as a phone contact").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit Add Holt as a phone contact" }));
    fireEvent.change(within(row).getByLabelText("Brief for Add Holt as a phone contact"), { target: { value: "Add Holt, with a gruff avatar." } });
    fireEvent.click(within(row).getByRole("button", { name: "Save the brief" }));
    await waitFor(async () => expect((await loadTasks(cardId)).find((t) => t.key === "contact:holt")!.brief).toBe("Add Holt, with a gruff avatar."));
    view.unmount();
    const fresh = (await collectInbox(cardId)).find((i) => i.summary === "Add Holt as a phone contact")!;
    await fresh.accept!();
    expect(queue).toHaveBeenCalledWith(cardId, expect.any(String), "Add Holt as a phone contact", expect.stringContaining("Add Holt, with a gruff avatar."));
    expect((await pendingTasks(cardId)).some((t) => t.key === "contact:holt")).toBe(false);
  });

  it("has a catch-up scan button, and an approved co-writer task becomes a co-writer message", async () => {
    render(<InboxDialog items={[]} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Find gaps between card and engine" }));
    await waitFor(async () => expect((await pendingTasks(cardId)).length).toBeGreaterThan(5));
    const task = (await pendingTasks(cardId)).find((t) => t.key === "place-lore:old pier")!;
    script.replies.push(reply("Written.", [["add_place", { name: "Old Pier", mood: "rotting", senses: "Gulls, tar.", details: "Smugglers meet here." }]]), reply("Done."));
    const item = (await collectInbox(cardId)).find((i) => i.key === `task:${task.id}`)!;
    await item.accept!();
    await waitFor(() => expect(script.requests).toHaveLength(2));
    await waitFor(() => expect(useCowriter.getState().busy).toBe(false));
    const chat = await getChat(cardId);
    expect(chat!.messages[0]).toMatchObject({ role: "user", display: "Task: Write a lorebook page for Old Pier" });
    expect(chat!.proposals[0].summary).toBe('Add place "Old Pier"');
  });
});

describe("the co-writer and the engineer hand each other work", () => {
  it("the co-writer files ask_engineer in the inbox, and its accepted edits file the engineer's tasks", async () => {
    script.replies.push(
      reply("", [
        ["ask_engineer", { title: "Show Mina's trust on the phone", brief: "A heart meter on her contact page.", source: "Mina.Trust" }],
        ["add_npc", { name: "Rook", role: "smuggler" }],
      ]),
      reply("Filed it."),
    );
    await useCowriter.getState().load(cardId);
    await useCowriter.getState().send("Add a smuggler.");
    const tools = script.requests[0].tools!.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(ENGINE_WRITING_TOOLS.map((t) => t.name)));
    expect(JSON.stringify(script.requests[1].messages)).toContain("Filed for the UI engineer");
    let tasks = await pendingTasks(cardId);
    expect(tasks.map((t) => [t.from, t.title])).toEqual([["cowriter", "Show Mina's trust on the phone"]]);
    const proposal = useCowriter.getState().chat!.proposals[0];
    useCowriter.getState().decide(proposal.id, true);
    await waitFor(async () => expect((await pendingTasks(cardId)).map((t) => t.title)).toContain("Add Rook as a phone contact"));
    tasks = await pendingTasks(cardId);
    expect(tasks).toHaveLength(2);
  });

  it("the engineer's lead files ask_cowriter tasks", async () => {
    expect(LEAD_TOOLS.some((t) => t.name === "ask_cowriter")).toBe(true);
    const ctx = { data, draft: readEngine(data)!, ops: [], skills: [] } as unknown as EngineerContext;
    const out = await runEngineerTool(ctx, { id: "a", name: "ask_cowriter", input: { title: "Write tiers for Mina.Trust", brief: "Five tiers." } });
    expect(out.content).toMatch(/Filed for the co-writer/);
    expect(ctx.tasks).toEqual([{ title: "Write tiers for Mina.Trust", brief: "Five tiers." }]);
    await askFor(cardId, "cowriter", "engineer", "Write tiers for Mina.Trust", "Five tiers.");
    expect((await pendingTasks(cardId))[0]).toMatchObject({ to: "cowriter", from: "engineer" });
  });
});

describe("the co-writer writes for the engine's screens", () => {
  let d: CardDataV3;
  const edit = (name: string, input: Record<string, unknown>) => (d = applyEdit(d, planEdit(d, { id: name, name, input })));

  it("writes a living screen's pack, minigame lines, a scene, a mood's name and a portrait's expressions", () => {
    d = data;
    edit("write_live_pack", { module: "mina-texts", feed: "texts", voice: "lowercase", format: "a text", fallback: ["Mina: hey"] });
    const feed = readEngine(d)!.modules!.find((m) => m.id === "mina-texts")!.live![0];
    expect(feed).toMatchObject({ enabled: false, pack: { voice: "lowercase", format: "a text" }, fallback: ["Mina: hey"] });
    edit("write_minigame_lines", { module: "lockpicking", win: "{{user}} slips the lock.", loss: "The pick snaps." });
    expect(readEngine(d)!.modules!.find((m) => m.id === "lockpicking")!.settings.outcomes).toEqual({ win: { line: "{{user}} slips the lock." }, loss: { line: "The pick snaps." } });
    edit("write_scene", { module: "mina-texts", name: "intro", steps: [{ bg: "the pier" }, { say: "You came back.", who: "Mina" }] });
    expect(readEngine(d)!.modules!.find((m) => m.id === "mina-texts")!.settings.scenes).toEqual({ intro: [{ bg: "the pier" }, { say: "You came back.", who: "Mina" }] });
    expect(() => edit("write_scene", { module: "mina-texts", name: "bad", steps: [{ dance: 1 }] })).toThrow(/doesn't play/);
    edit("name_mood", { mood: "Mood 1", name: "Trusted", description: "She lets her guard down." });
    expect(readEngine(d)!.theme!.moods![0]).toMatchObject({ name: "Trusted", description: "She lets her guard down.", min: 70 });
    edit("list_expressions", { name: "Mina", emotions: ["neutral", "happy", "flustered"] });
    expect(readEngine(d)!.theme!.portraits![0]).toMatchObject({ name: "Mina", outfit: "Mina.Mood", emotions: ["neutral", "happy", "flustered"] });
    const left = engineGaps(d).map((g) => g.key);
    for (const key of ["pack:mina-texts:texts", "game-lines:lockpicking", "mood:mood-1", "expressions:mina"]) expect(left).not.toContain(key);
  });

  it("sees the screens that need words in its view of the card", () => {
    const text = engineFeaturesText(readEngine(data)!);
    expect(text).toContain('living screen texts on module mina-texts ("Texts", off): no content pack yet');
    expect(text).toContain("minigame lockpicking");
    expect(text).toContain('mood "Mood 1" (follows Mina.Trust), no description yet');
    expect(text).toContain("portrait of Mina: no expressions listed yet");
  });
});
