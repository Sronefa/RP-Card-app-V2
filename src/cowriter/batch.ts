/**
 * Big co-writer jobs in the background: "write 20 NPCs for the harbor district", "a greeting for
 * every empty cell of the greeting planner". A batch runs in the shared activity queue, a few items
 * per model call, while the user goes on working; what it writes lands in the card's inbox as one
 * batch, accepted or rejected item by item.
 */
import type { CardDataV3 } from "../card";
import { getCard, getRecord, saveRecord, type CardRecord } from "../db/db";
import { useActivity, type Outcome } from "../app/activity";
import { fileNewGaps } from "../app/handoff";
import { useInboxVersion } from "../app/inboxVersion";
import { batchRequest, systemPrompt } from "../ai/prompts";
import { applyEdit, CARD_TOOLS, describeEdit, planEdit, ToolInputError } from "../ai/tools";
import type { ToolCall } from "../ai/types";
import { useEditor } from "../editor/store";
import { newId } from "../lib/id";
import { logChange } from "./changeLog";
import { complete, gatherContext, isAbort, partsText } from "./engine";

export type BatchKind = "npcs" | "places" | "items" | "shops" | "lore" | "greetings" | "dialogues";

export const BATCH_KINDS: Record<BatchKind, { label: string; tool: string; placeholder: string }> = {
  npcs: { label: "NPCs", tool: "add_npc", placeholder: "NPCs for the harbor district: dockworkers, smugglers, the harbormaster's family" },
  places: { label: "Places", tool: "add_place", placeholder: "Places in the old town, from taverns to the bell tower" },
  items: { label: "Items", tool: "add_item", placeholder: "Goods a travelling alchemist would sell" },
  shops: { label: "Shops", tool: "add_shop", placeholder: "Shops and stalls on the market street" },
  lore: { label: "Lorebook entries", tool: "add_lore_entry", placeholder: "The history, factions and customs of the kingdom" },
  greetings: { label: "Alternate greetings", tool: "add_greeting", placeholder: "Openings in different places and moods" },
  dialogues: { label: "Example dialogues", tool: "add_example_dialogue", placeholder: "Dialogues that show how she talks when she's annoyed, flirty or scared" },
};

/** Items asked for in one model call. */
export const PER_ROUND = 5;
export const MAX_COUNT = 40;
/** Rounds in a row that write nothing new before the batch gives up. */
const EMPTY_ROUNDS = 2;

export interface BatchJob {
  kind: BatchKind;
  /** What the user asked for, as they wrote it. */
  ask: string;
  count: number;
  /** One line per item to write, when each is different (the greeting planner's cells). */
  specs?: string[];
  /** The batch's name in the inbox and the activity list; the ask when left out. */
  label?: string;
}

export interface BatchItem {
  id: string;
  call: ToolCall;
  /** "Add NPC "Old Brannoc"", as when it was written. */
  summary: string;
  /** The start of what it says, to judge it without opening it. */
  preview: string;
}

export interface Batch {
  id: string;
  at: number;
  kind: BatchKind;
  label: string;
  items: BatchItem[];
  /** How many it was asked for. */
  count: number;
}

interface BatchRecord {
  /** `batches:<card id>` */
  cardId: string;
  batches: Batch[];
}

export const batchesKey = (cardId: string) => `batches:${cardId}`;

const writes = new Map<string, Promise<unknown>>();

async function readBatches(cardId: string) {
  return (await getRecord<BatchRecord>(batchesKey(cardId)))?.batches ?? [];
}

/** A card's batches that still have items waiting, after any change still being written. */
export async function loadBatches(cardId: string): Promise<Batch[]> {
  await writes.get(cardId);
  return readBatches(cardId);
}

/** Changes a card's batches; changes to one card run one after another. Empty batches are dropped. */
function updateBatches(cardId: string, fn: (batches: Batch[]) => Batch[]) {
  const run = (writes.get(cardId) ?? Promise.resolve()).then(async () => {
    const batches = fn(await readBatches(cardId)).filter((b) => b.items.length);
    await saveRecord<BatchRecord>({ cardId: batchesKey(cardId), batches });
    useInboxVersion.getState().bump();
  });
  writes.set(cardId, run.catch(() => undefined));
  return run;
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function previewOf(call: ToolCall): string {
  const input: Record<string, unknown> = { ...call.input };
  delete input.why;
  const text = typeof input.text === "string" ? input.text : typeof input.content === "string" ? input.content : Object.entries(input)
    .filter(([k, v]) => k !== "name" && typeof v === "string" && v.trim())
    .map(([, v]) => v as string)
    .join(" · ");
  return short(text.replace(/\s+/g, " ").trim(), 240);
}

/** The card a job works on: the open one with its unsaved edits, or the stored one. */
async function cardFor(cardId: string): Promise<CardRecord | undefined> {
  const open = useEditor.getState().record;
  return open?.id === cardId ? open : getCard(cardId);
}

/**
 * Writes a batch: a few items per model call, each checked against the card as it would be with
 * the earlier ones added, until the count is reached. What was written lands in the inbox as it
 * comes, so stopping keeps it.
 */
async function writeBatch(jobId: string, cardId: string, job: BatchJob, signal: AbortSignal): Promise<Outcome> {
  const record = await cardFor(cardId);
  if (!record) return { status: "failed", detail: "The card is gone." };
  const def = BATCH_KINDS[job.kind];
  const tools = CARD_TOOLS.filter((t) => t.name === def.tool);
  const context = partsText(await gatherContext(record));
  const count = job.specs?.length || Math.max(1, Math.min(MAX_COUNT, Math.round(job.count)));
  const batch: Batch = { id: newId(), at: Date.now(), kind: job.kind, label: job.label ?? short(job.ask.split("\n")[0], 80), items: [], count };
  let working: CardDataV3 = record.card.data;
  const written: string[] = [];
  let skipped = 0;
  let empty = 0;
  const progress = () => useActivity.getState().setProgress(jobId, `${batch.items.length} of ${count} ${def.label.toLowerCase()} written`);
  progress();
  try {
    while (batch.items.length < count && empty < EMPTY_ROUNDS) {
      const specs = job.specs?.slice(batch.items.length, batch.items.length + PER_ROUND);
      const n = Math.min(PER_ROUND, count - batch.items.length);
      const result = await complete("refine", {
        system: systemPrompt("refine"),
        messages: [{ role: "user", text: `${context}\n\n${batchRequest({ ask: job.ask, tool: def.tool, n, count, specs, written })}` }],
        tools,
        signal,
      });
      let added = 0;
      for (const call of result.toolCalls) {
        if (call.name !== def.tool || batch.items.length >= count) continue;
        try {
          const edit = planEdit(working, call);
          working = applyEdit(working, edit);
          const summary = describeEdit(edit);
          batch.items.push({ id: newId(), call, summary, preview: previewOf(call) });
          written.push(typeof call.input.name === "string" ? call.input.name : short(previewOf(call), 60));
          added++;
        } catch (e) {
          if (!(e instanceof ToolInputError)) throw e;
          skipped++;
        }
      }
      empty = added ? 0 : empty + 1;
      if (added) {
        const snapshot = { ...batch, items: [...batch.items] };
        await updateBatches(cardId, (all) => [...all.filter((b) => b.id !== batch.id), snapshot]);
      }
      progress();
      if (result.stop === "refusal") return ended(batch, count, skipped, "The model declined the rest. Rephrase the job or pick another model.");
    }
  } catch (e) {
    if (isAbort(e) || signal.aborted) return { status: "stopped", detail: landed(batch) || "Stopped before anything was written." };
    if (!batch.items.length) throw e;
    return ended(batch, count, skipped, (e as Error).message);
  }
  return ended(batch, count, skipped);
}

const landed = (batch: Batch) =>
  batch.items.length ? `${batch.items.length} ${batch.items.length === 1 ? "item waits" : "items wait"} in the inbox` : "";

function ended(batch: Batch, count: number, skipped: number, problem?: string): Outcome {
  if (!batch.items.length) return { status: "failed", detail: problem ?? "The co-writer wrote nothing usable. Try again, or ask for something more specific." };
  const fewer = batch.items.length < count;
  return {
    status: fewer ? "needs-user" : "done",
    detail: [
      `${landed(batch)}${fewer ? ` (${count} asked for)` : ""}`,
      skipped ? `${skipped} skipped as repeats or invalid` : "",
      problem ?? "",
    ]
      .filter(Boolean)
      .join("; "),
  };
}

/** Starts a batch in the background queue; resolves when it ends. */
export function runBatch(cardId: string, cardName: string, job: BatchJob): Promise<Outcome> {
  const controller = new AbortController();
  return useActivity.getState().enqueue(
    { kind: "cowriter", cardId, cardName, label: job.label ?? job.ask },
    (id) => writeBatch(id, cardId, job, controller.signal),
    () => controller.abort(),
  );
}

/** Drops one item; a batch with none left goes. */
export const dropBatchItem = (cardId: string, batchId: string, itemId: string) =>
  updateBatches(cardId, (all) => all.map((b) => (b.id === batchId ? { ...b, items: b.items.filter((i) => i.id !== itemId) } : b)));

/**
 * Adds a batch item to the open card, checked against the card as it is now (an earlier item or
 * another edit may have changed it), and hands what it opened up to the UI engineer.
 */
export async function acceptBatchItem(cardId: string, batchId: string, item: BatchItem) {
  const editor = useEditor.getState();
  if (editor.record?.id !== cardId) throw new Error("Open the card to add what the batch wrote.");
  const before = editor.record.card.data;
  const edit = planEdit(before, item.call);
  const after = applyEdit(before, edit);
  editor.replaceData(after);
  void fileNewGaps(cardId, before, after, "cowriter").catch(() => undefined);
  void logChange(cardId, "cowriter", [describeEdit(edit)]);
  await dropBatchItem(cardId, batchId, item.id);
}
