/**
 * Tasks the co-writer and the UI engineer hand each other, for cards on the Immersive Engine. Writing
 * something the engine should show files a task for the engineer (a new NPC becomes "add a contact");
 * building something that needs words files one for the co-writer (a new value needs its rule). Tasks
 * also come from the catch-up scan, which lists every gap between card and engine. Every task waits
 * in the inbox for the user to approve, edit or dismiss; an approved engineer task runs in the
 * background, an approved co-writer task becomes a message in the co-writer chat.
 */
import type { CardDataV3 } from "../card";
import { getCard, getRecord, saveRecord } from "../db/db";
import { engineGaps, newGaps, type Gap, type GapTo } from "../editor/gaps";
import { newId } from "../lib/id";
import { useInboxVersion } from "./inboxVersion";

export type TaskFrom = "cowriter" | "engineer" | "scan";
export type TaskStatus = "pending" | "started" | "dismissed";

export interface HandoffTask extends Gap {
  id: string;
  at: number;
  from: TaskFrom;
  status: TaskStatus;
}

interface TaskRecord {
  /** `tasks:<card id>` */
  cardId: string;
  tasks: HandoffTask[];
}

export const tasksKey = (cardId: string) => `tasks:${cardId}`;

/** Finished tasks kept, so a gap that was dealt with isn't filed again right away. */
const KEEP_DONE = 200;

const writes = new Map<string, Promise<unknown>>();

async function readTasks(cardId: string): Promise<HandoffTask[]> {
  return (await getRecord<TaskRecord>(tasksKey(cardId)))?.tasks ?? [];
}

/** A card's tasks, after any change still being written. */
export async function loadTasks(cardId: string): Promise<HandoffTask[]> {
  await writes.get(cardId);
  return readTasks(cardId);
}

/** Changes a card's task list; changes to one card run one after another. */
function updateTasks<T>(cardId: string, fn: (tasks: HandoffTask[]) => { tasks: HandoffTask[]; out: T }): Promise<T> {
  const run = (writes.get(cardId) ?? Promise.resolve()).then(async () => {
    const { tasks, out } = fn(await readTasks(cardId));
    const done = tasks.filter((t) => t.status !== "pending");
    const drop = new Set(done.slice(0, Math.max(0, done.length - KEEP_DONE)).map((t) => t.id));
    await saveRecord<TaskRecord>({ cardId: tasksKey(cardId), tasks: tasks.filter((t) => !drop.has(t.id)) });
    useInboxVersion.getState().bump();
    return out;
  });
  writes.set(cardId, run.catch(() => undefined));
  return run;
}

/**
 * Files gaps as tasks. A gap already waiting is never filed twice; one the user dismissed or started
 * comes back only from an explicit scan when `again` is set. Resolves to what was filed.
 */
export function fileTasks(cardId: string, gaps: Gap[], from: TaskFrom, again = false): Promise<{ filed: HandoffTask[]; skipped: number }> {
  return updateTasks(cardId, (tasks) => {
    const filed: HandoffTask[] = [];
    let skipped = 0;
    for (const gap of gaps) {
      const same = tasks.filter((t) => t.key === gap.key);
      if (same.some((t) => t.status === "pending") || filed.some((t) => t.key === gap.key)) continue;
      if (same.length && !again) {
        skipped++;
        continue;
      }
      filed.push({ ...gap, id: newId(), at: Date.now(), from, status: "pending" });
    }
    return { tasks: [...tasks, ...filed], out: { filed, skipped } };
  });
}

/** A task asked for in a chat (ask_engineer, ask_cowriter): always filed, under its own key. */
export function askFor(cardId: string, to: GapTo, from: "cowriter" | "engineer", title: string, brief: string, source?: Gap["source"]) {
  const id = newId();
  return fileTasks(cardId, [{ key: `ask:${id}`, to, title, brief, ...(source ? { source } : {}) }], from);
}

/** After an accepted change: files what it opened up for the other side. */
export async function fileNewGaps(cardId: string, before: CardDataV3, after: CardDataV3, from: "cowriter" | "engineer") {
  const gaps = newGaps(before, after, from === "cowriter" ? "engineer" : "cowriter");
  return gaps.length ? fileTasks(cardId, gaps, from) : { filed: [], skipped: 0 };
}

/** The catch-up scan: every gap between the card and its engine, filed as tasks to approve. */
export async function scanGaps(cardId: string, data?: CardDataV3) {
  const card = data ?? (await getCard(cardId))?.card.data;
  if (!card) return { filed: [], skipped: 0, found: 0 };
  const gaps = engineGaps(card);
  const out = await fileTasks(cardId, gaps, "scan");
  return { ...out, found: gaps.length };
}

export const pendingTasks = async (cardId: string) => (await loadTasks(cardId)).filter((t) => t.status === "pending");

function setStatus(cardId: string, id: string, status: TaskStatus, brief?: string) {
  return updateTasks(cardId, (tasks) => ({
    tasks: tasks.map((t) => (t.id === id ? { ...t, status, ...(brief !== undefined ? { brief } : {}) } : t)),
    out: undefined,
  }));
}

export const dismissTask = (cardId: string, id: string) => setStatus(cardId, id, "dismissed");
export const editTask = (cardId: string, id: string, brief: string) =>
  updateTasks(cardId, (tasks) => ({ tasks: tasks.map((t) => (t.id === id ? { ...t, brief } : t)), out: undefined }));
export const markStarted = (cardId: string, id: string) => setStatus(cardId, id, "started");
/** Back to waiting, when an approved task couldn't start (its card was closed first). */
export const reopenTask = (cardId: string, id: string) => setStatus(cardId, id, "pending");

const FROM_LABEL: Record<TaskFrom, string> = {
  cowriter: "the co-writer",
  engineer: "the UI engineer",
  scan: "the catch-up scan",
};

/** The message an approved task sends: the task, why, and the lore it links to. */
export function taskBrief(task: HandoffTask): string {
  return [
    `A task from ${FROM_LABEL[task.from]}, approved by the user: ${task.title}.`,
    task.brief,
    task.source?.text ? `From ${task.source.label}:\n<source>\n${task.source.text}\n</source>` : task.source ? `It comes from ${task.source.label}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
