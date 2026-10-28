import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchRequest } from "../../ai/prompts";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useActivity } from "../../app/activity";
import { pendingTasks } from "../../app/handoff";
import { collectInbox } from "../../app/inbox";
import { runningLine } from "../../app/keepAlive";
import type { CardDataV3 } from "../../card";
import { acceptBatchItem, loadBatches, runBatch } from "../../cowriter/batch";
import { createCard, createProject, resetDbForTests, saveProject } from "../../db/db";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { pageMeta, worldEntry } from "../../editor/world";
import { coreModules } from "../../engine/modules/compile";
import { phoneModule } from "../../engine/modules/phone";
import { applyEngine, newEngine } from "../../engine/sheet";
import { ActivityDialog } from "../activity/ActivityChip";
import { BigJobDialog } from "../cowriter/BigJobDialog";
import { GreetingPlanner } from "../greetings/GreetingPlanner";
import { InboxDialog } from "../inbox/InboxDialog";

type Scripted = CompletionResult | ((req: CompletionRequest) => Promise<CompletionResult>);
const script = vi.hoisted(() => ({ replies: [] as unknown[], requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift() as Scripted | undefined;
      if (!next) throw new Error("no scripted reply");
      return typeof next === "function" ? next(req) : next;
    },
  }),
}));
const reply = (calls: [string, Record<string, unknown>][]): CompletionResult => ({
  text: "",
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.requests.length}-${i}`, name, input })),
  stop: "tool_use",
});
const npc = (name: string, role = "dockworker") => ["add_npc", { name, role, voice: `${name} talks slow and low.` }] as [string, Record<string, unknown>];

let cardId = "";

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useActivity.setState({ items: [] });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
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
  await saveProject({ ...project, cowriter: { contentMode: "dark", tone: "", genre: "", depth: "standard", suggestions: "quiet", presetIds: [] } });
  const card = await createCard(project.id, "character");
  cardId = card.id;
  await useEditor.getState().open(card.id);
  let data: CardDataV3 = { ...useEditor.getState().record!.card.data, name: "Mina" };
  data = applyEngine(data, { ...newEngine(), modules: [...coreModules(), phoneModule({ apps: ["messages", "contacts"], contacts: [] })] });
  const book = emptyBook();
  data = { ...data, character_book: { ...book, entries: [worldEntry(book, "npc", { name: "Holt", role: "harbour master" })] } };
  useEditor.getState().replaceData(data);
});

const npcNames = () =>
  (useEditor.getState().record!.card.data.character_book?.entries ?? []).map((e) => pageMeta(e)).filter((m) => m?.kind === "npc").map((m) => m!.fields.name);

describe("a background batch", () => {
  it("writes in rounds of five, skips repeats, and lands as one batch", async () => {
    script.replies = [
      reply([npc("Rook"), npc("Holt"), ["set_field", { field: "description", text: "x" }], npc("Wren"), npc("Tamsin"), npc("Odo")]),
      reply([npc("Rook"), npc("Bel"), npc("Cass")]),
    ];
    const outcome = await runBatch(cardId, "Mina", { kind: "npcs", ask: "NPCs for the harbor district", count: 6 });
    expect(outcome.status).toBe("done");
    expect(outcome.detail).toBe("6 items wait in the inbox; 2 skipped as repeats or invalid");
    expect(script.requests).toHaveLength(2);
    // Only the batch's own tool, and the second round knows what the first wrote.
    expect(script.requests[0].tools!.map((t) => t.name)).toEqual(["add_npc"]);
    const second = script.requests[1].messages[0];
    expect(second.role === "user" && second.text).toContain("Write 2 now, one add_npc call each.");
    expect(second.role === "user" && second.text).toContain("Already written in this batch: Rook; Wren; Tamsin; Odo.");
    const [batch] = await loadBatches(cardId);
    expect(batch.items.map((i) => i.summary)).toEqual([
      'Add NPC "Rook"',
      'Add NPC "Wren"',
      'Add NPC "Tamsin"',
      'Add NPC "Odo"',
      'Add NPC "Bel"',
      'Add NPC "Cass"',
    ]);
    // Nothing touches the card until the user accepts.
    expect(npcNames()).toEqual(["Holt"]);
    expect(useActivity.getState().items[0]).toMatchObject({ kind: "cowriter", status: "done" });
  });

  it("lists each item in the inbox, and accepting one adds it and files its engine task", async () => {
    script.replies = [reply([npc("Rook", "smuggler"), npc("Wren")])];
    await runBatch(cardId, "Mina", { kind: "npcs", ask: "Two smugglers", count: 2, label: "Smugglers" });
    const items = (await collectInbox(cardId)).filter((i) => i.source === "batch");
    expect(items.map((i) => [i.summary, i.detail])).toEqual([
      ['Add NPC "Rook"', 'From the batch "Smugglers", 1 of 2'],
      ['Add NPC "Wren"', 'From the batch "Smugglers", 2 of 2'],
    ]);
    expect(items[0].preview).toBe("smuggler · Rook talks slow and low.");
    await items[0].accept!();
    expect(npcNames()).toEqual(["Holt", "Rook"]);
    await waitFor(async () => expect((await pendingTasks(cardId)).map((t) => t.key)).toContain("contact:rook"));
    await items[1].reject();
    expect(await loadBatches(cardId)).toEqual([]);
    expect((await collectInbox(cardId)).filter((i) => i.source === "batch")).toEqual([]);
  });

  it("re-checks an item against the card when it's accepted", async () => {
    script.replies = [reply([npc("Rook")])];
    await runBatch(cardId, "Mina", { kind: "npcs", ask: "One", count: 1 });
    const [batch] = await loadBatches(cardId);
    // Someone else added Rook in the meantime.
    const data = useEditor.getState().record!.card.data;
    useEditor.getState().replaceData({ ...data, character_book: { ...data.character_book!, entries: [...data.character_book!.entries, worldEntry(data.character_book!, "npc", { name: "Rook" })] } });
    await expect(acceptBatchItem(cardId, batch.id, batch.items[0])).rejects.toThrow(/already an NPC named Rook/);
    useEditor.setState({ record: undefined });
    await expect(acceptBatchItem(cardId, batch.id, batch.items[0])).rejects.toThrow("Open the card");
  });

  it("writes one greeting per planner cell, five cells a round", async () => {
    const specs = Array.from({ length: 7 }, (_, i) => `mood: M${i}; relationship stage: Strangers; place: Pier`);
    script.replies = [
      reply(specs.slice(0, 5).map((s, i) => ["add_greeting", { text: `Greeting ${i}. ${s}` }])),
      reply(specs.slice(5).map((s, i) => ["add_greeting", { text: `Greeting ${i + 5}. ${s}` }])),
    ];
    const outcome = await runBatch(cardId, "Mina", { kind: "greetings", ask: "Openings", count: 99, specs });
    expect(outcome.status).toBe("done");
    const first = script.requests[0].messages[0];
    expect(first.role === "user" && first.text).toContain("Write these 5 now, one add_greeting call each:\n- mood: M0");
    const second = script.requests[1].messages[0];
    expect(second.role === "user" && second.text).toContain("- mood: M5");
    const [batch] = await loadBatches(cardId);
    expect(batch.count).toBe(7);
    for (const item of batch.items) await acceptBatchItem(cardId, batch.id, item);
    expect(useEditor.getState().record!.card.data.alternate_greetings).toHaveLength(7);
  });

  it("gives up after two rounds that write nothing", async () => {
    script.replies = [reply([]), reply([npc("Holt")])];
    const outcome = await runBatch(cardId, "Mina", { kind: "npcs", ask: "More", count: 3 });
    expect(outcome.status).toBe("failed");
    expect(script.requests).toHaveLength(2);
    expect(await loadBatches(cardId)).toEqual([]);
  });

  it("stops from the activity queue and keeps what it wrote", async () => {
    let started!: () => void;
    const waiting = new Promise<void>((r) => (started = r));
    script.replies = [
      reply([npc("Rook"), npc("Wren")]),
      (req: CompletionRequest) =>
        new Promise<CompletionResult>((_, reject) => {
          started();
          req.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    ];
    const run = runBatch(cardId, "Mina", { kind: "npcs", ask: "Lots", count: 10 });
    await waiting;
    const item = useActivity.getState().items[0];
    expect(item.progress).toBe("2 of 10 npcs written");
    expect(runningLine(item, { round: 0 })).toBe("Co-writer: 2 of 10 npcs written");
    render(<ActivityDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await run).toEqual({ status: "stopped", detail: "2 items wait in the inbox" });
    expect((await loadBatches(cardId))[0].items).toHaveLength(2);
  });

  it("asks the model for distinct items and only tool calls", () => {
    const text = batchRequest({ ask: "Harbor NPCs", tool: "add_npc", n: 5, count: 20, written: [] });
    expect(text).toContain("A background job for the user: Harbor NPCs");
    expect(text).toContain("This is part of a batch of 20. Don't repeat those or anything the card already has");
    expect(text).toContain("Only make the tool calls.");
  });
});

describe("starting a batch", () => {
  it("runs a big job from the co-writer's dialog", async () => {
    script.replies = [reply([npc("Rook"), npc("Wren"), npc("Odo")])];
    render(<BigJobDialog open onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Describe them"), { target: { value: "Harbor district regulars" } });
    fireEvent.click(screen.getByRole("button", { name: "Start in the background" }));
    await waitFor(() => expect(useActivity.getState().items[0]?.status).toBe("done"));
    expect(useActivity.getState().items[0]).toMatchObject({ kind: "cowriter", label: "3 npcs: Harbor district regulars" });
    render(<InboxDialog items={await collectInbox(cardId)} open onClose={() => undefined} />);
    expect(screen.getByRole("region", { name: "Co-writer batches" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: 'Accept Add NPC "Wren"' }));
    await waitFor(() => expect(npcNames()).toEqual(["Holt", "Wren"]));
  });

  it("fills every open cell of the greeting planner in the background", async () => {
    script.replies = Array.from({ length: 5 }, () => reply([]));
    render(<GreetingPlanner onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fill all 25 gaps in the background" }));
    await waitFor(() => expect(script.requests.length).toBeGreaterThan(0));
    expect(useActivity.getState().items[0]).toMatchObject({ kind: "cowriter", label: "25 greetings for the planner's gaps" });
    const text = script.requests[0].messages[0];
    expect(text.role === "user" && text.text).toContain("- mood: Calm; relationship stage: Strangers; place: a place no other greeting uses");
  });
});
