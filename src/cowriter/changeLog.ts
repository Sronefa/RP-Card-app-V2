/**
 * The change log the co-writer and the UI engineer share for each card: what the user accepted
 * from either side, so each sees what the other changed since it last looked.
 */
import { getSetting, putSetting } from "../db/db";

export type ChangeSide = "cowriter" | "engineer";

export interface ChangeEntry {
  at: number;
  by: ChangeSide;
  summary: string;
}

/** Older entries drop off; the latest ones are what the other side needs. */
const KEEP = 60;
const key = (cardId: string) => `changes:${cardId}`;

export async function readChanges(cardId: string): Promise<ChangeEntry[]> {
  return ((await getSetting<ChangeEntry[]>(key(cardId)).catch(() => undefined)) ?? []).filter(
    (e) => e && typeof e.summary === "string",
  );
}

/** Writes are queued per card so two accepts in a row don't overwrite each other. */
const queues = new Map<string, Promise<unknown>>();

export function logChange(cardId: string, by: ChangeSide, summaries: string[]): Promise<void> {
  const list = summaries.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return Promise.resolve();
  const at = Date.now();
  const run = (queues.get(cardId) ?? Promise.resolve())
    .then(async () => {
      const entries = [...(await readChanges(cardId)), ...list.map((summary) => ({ at, by, summary }))];
      await putSetting(key(cardId), entries.slice(-KEEP));
    })
    .catch(() => undefined);
  queues.set(cardId, run);
  return run;
}

/** The other side's changes, newest last, as lines for a prompt. */
export function changesText(entries: ChangeEntry[], from: ChangeSide, since = 0, limit = 15): string {
  return entries
    .filter((e) => e.by === from && e.at > since)
    .slice(-limit)
    .map((e) => `- ${new Date(e.at).toISOString().slice(0, 16).replace("T", " ")}: ${e.summary}`)
    .join("\n");
}
