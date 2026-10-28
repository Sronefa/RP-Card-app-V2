/**
 * The proposal inbox: everything waiting for the user's decision on the open card, wherever it was
 * made. Co-writer and UI engineer proposals stay in their chats and are decided there too; Game
 * Wizard modules and bulk items can be parked here instead of added from their dialogs; Image Studio
 * shots with generated images nobody has picked yet wait here as well.
 */
import { getRecord, saveRecord } from "../db/db";
import { useCowriter, useLoreChat, type ChatState } from "../cowriter/store";
import { useEngineer } from "../engine/engineer/session";
import { useEditor } from "../editor/store";
import { applyMechanics, readMechanics, type MechanicModule } from "../editor/mechanics";
import { emptyBook } from "../editor/lorebook";
import { syncCast, worldEntry } from "../editor/world";
import { saveToLibrary } from "../features/mechanics/library";
import { latestStudio, updateStudio } from "../images/shots";
import { fileInCard, markPicked } from "../images/pick";
import { newId } from "../lib/id";
import { dismissTask, editTask, markStarted, reopenTask, pendingTasks, taskBrief, type HandoffTask } from "./handoff";
import { useInboxVersion } from "./inboxVersion";
import type { SectionId } from "./sections";

export type InboxSource = "cowriter" | "lore" | "engineer" | "wizard" | "bulk" | "images" | "for-engineer" | "for-cowriter";

export const SOURCE_LABEL: Record<InboxSource, string> = {
  cowriter: "Co-writer",
  lore: "Lorebook brainstorm",
  engineer: "UI engineer",
  wizard: "Game Wizard",
  bulk: "Bulk items",
  images: "Image Studio",
  "for-engineer": "Tasks for the UI engineer",
  "for-cowriter": "Tasks for the co-writer",
};

/** Where an accepted item lands, to open it there. */
export interface Landing {
  label: string;
  section: SectionId;
  tab?: string;
}

export interface InboxItem {
  key: string;
  source: InboxSource;
  summary: string;
  lands: Landing;
  /** Missing when the item needs a choice made where it lives, like one of several images. */
  accept?: () => Promise<void>;
  reject: () => Promise<void>;
  /** Why it can't be accepted from the inbox. */
  note?: string;
  /** A task's brief, which the user can change before approving it. */
  edit?: { text: string; save: (text: string) => Promise<void> };
  /** Where the item came from, shown under its summary. */
  detail?: string;
}

/** A Game Wizard module or a batch of items, parked for later. */
export type Parked =
  | { id: string; at: number; source: "wizard"; summary: string; module: MechanicModule; keep: boolean }
  | { id: string; at: number; source: "bulk"; summary: string; items: Record<string, string>[] };

interface ParkedRecord {
  /** `inbox:<card id>` */
  cardId: string;
  items: Parked[];
}

export const inboxKey = (cardId: string) => `inbox:${cardId}`;

export { useInboxVersion };

export async function loadParked(cardId: string): Promise<Parked[]> {
  return (await getRecord<ParkedRecord>(inboxKey(cardId)))?.items ?? [];
}

const writes = new Map<string, Promise<unknown>>();
/** Changes the parked list; changes to one card run one after another. */
function updateParked(cardId: string, fn: (items: Parked[]) => Parked[]): Promise<Parked[]> {
  const run = (writes.get(cardId) ?? Promise.resolve()).then(async () => {
    const items = fn(await loadParked(cardId));
    await saveRecord<ParkedRecord>({ cardId: inboxKey(cardId), items });
    useInboxVersion.getState().bump();
    return items;
  });
  writes.set(cardId, run.catch(() => undefined));
  return run;
}

/** Parks a Game Wizard module or a batch of items for the open card. */
export function park(cardId: string, item: Omit<Extract<Parked, { source: "wizard" }>, "id" | "at"> | Omit<Extract<Parked, { source: "bulk" }>, "id" | "at">) {
  return updateParked(cardId, (items) => [...items, { ...item, id: newId(), at: Date.now() } as Parked]);
}

const unpark = (cardId: string, id: string) => updateParked(cardId, (items) => items.filter((p) => p.id !== id));

/** Where a co-writer edit lands, by its tool. */
export function landsFor(tool: string): Landing {
  if (tool === "pitch") return { label: "Co-writer chat", section: "cowriter" };
  if (["add_variable", "set_update_rule", "write_tiers"].includes(tool)) return { label: "Engine values", section: "engine", tab: "vars" };
  if (tool.includes("lore") || tool.includes("world") || tool.startsWith("add_")) {
    if (tool === "add_greeting" || tool === "add_example_dialogue") return { label: "Editor", section: "editor" };
    return { label: "Lorebook", section: "lorebook" };
  }
  return { label: "Editor", section: "editor" };
}

function chatItems(source: "cowriter" | "lore", store: ChatState): InboxItem[] {
  return (store.chat?.proposals ?? [])
    .filter((p) => p.status === "pending")
    .map((p) => ({
      key: `${source}:${p.id}`,
      source,
      summary: `${p.call.name === "pitch" ? "Idea" : "Edit"} ${p.number}: ${p.summary ?? p.call.name}`,
      lands: landsFor(p.call.name),
      accept: async () => store.decide(p.id, true),
      reject: async () => store.decide(p.id, false),
    }));
}

/** Everything waiting on the open card `cardId`. */
export async function collectInbox(cardId: string): Promise<InboxItem[]> {
  await Promise.all([useCowriter.getState().load(cardId), useLoreChat.getState().load(cardId), useEngineer.getState().load(cardId)]);
  const items: InboxItem[] = [...chatItems("cowriter", useCowriter.getState()), ...chatItems("lore", useLoreChat.getState())];

  const engineer = useEngineer.getState();
  for (const p of engineer.chat?.proposals ?? [])
    if (p.status === "pending")
      items.push({
        key: `engineer:${p.id}`,
        source: "engineer",
        summary: `Change ${p.number}: ${p.summaries.join("; ") || "engine changes"}`,
        lands: { label: "Engineer", section: "engine", tab: "engineer" },
        accept: async () => useEngineer.getState().decide(p.id, true),
        reject: async () => useEngineer.getState().decide(p.id, false),
      });

  for (const p of await loadParked(cardId))
    items.push({
      key: `parked:${p.id}`,
      source: p.source,
      summary: p.summary,
      lands: p.source === "wizard" ? { label: "Mechanics", section: "trackers", tab: "mechanics" } : { label: "Economy", section: "lorebook", tab: "economy" },
      accept: async () => {
        applyParked(p);
        await unpark(cardId, p.id);
      },
      reject: async () => void (await unpark(cardId, p.id)),
    });

  for (const t of await pendingTasks(cardId)) items.push(taskItem(cardId, t));

  const studio = await latestStudio(cardId);
  for (const shot of studio.shots) {
    const list = studio.candidates?.[shot.id] ?? [];
    if (!list.length || list.some((c) => c.asset)) continue;
    items.push({
      key: `images:${shot.id}`,
      source: "images",
      summary: `${shot.label}: ${list.length === 1 ? "1 image" : `${list.length} images`} to pick from`,
      lands: { label: "Image Studio", section: "assets", tab: "studio" },
      ...(list.length === 1
        ? {
            accept: async () => {
              const asset = await fileInCard(cardId, shot, list[0]);
              if (asset) await updateStudio(cardId, (s) => markPicked(s, shot.id, list[0].id, asset.uri));
            },
          }
        : { note: "Pick one in the Image Studio" }),
      reject: async () => {
        await updateStudio(cardId, (s) => {
          const candidates = { ...s.candidates };
          delete candidates[shot.id];
          return { ...s, candidates };
        });
      },
    });
  }
  return items;
}

/** Adds a parked module or batch of items to the open card. */
function applyParked(p: Parked) {
  const editor = useEditor.getState();
  const data = editor.record!.card.data;
  if (p.source === "wizard") {
    editor.replaceData(applyMechanics(data, [...readMechanics(data), p.module]));
    if (p.keep) void saveToLibrary(p.module);
  } else {
    let book = data.character_book ?? emptyBook();
    for (const fields of p.items) book = { ...book, entries: [...book.entries, worldEntry(book, "item", fields)] };
    editor.setField("character_book", syncCast(book), null);
  }
}

/** Accepts every item that can be accepted from the inbox, in order. */
export async function acceptAll(items: InboxItem[]) {
  for (const item of items) if (item.accept) await item.accept();
}

export async function rejectAll(items: InboxItem[]) {
  for (const item of items) await item.reject();
}

const TASK_FROM: Record<HandoffTask["from"], string> = { cowriter: "From the co-writer", engineer: "From the UI engineer", scan: "From the catch-up scan" };

function taskItem(cardId: string, t: HandoffTask): InboxItem {
  return {
    key: `task:${t.id}`,
    source: t.to === "engineer" ? "for-engineer" : "for-cowriter",
    summary: t.title,
    detail: `${TASK_FROM[t.from]}${t.source ? `, about ${t.source.label}` : ""}`,
    lands: t.to === "engineer" ? { label: "Engineer", section: "engine", tab: "engineer" } : { label: "Co-writer chat", section: "cowriter" },
    accept: () => approveTask(cardId, t),
    reject: () => dismissTask(cardId, t.id),
    edit: { text: t.brief, save: (text) => editTask(cardId, t.id, text) },
  };
}

/**
 * Starts an approved task: an engineer task runs in the background (on this card, open or not); a
 * co-writer task becomes a message in the open card's co-writer chat.
 */
export async function approveTask(cardId: string, task: HandoffTask) {
  const brief = taskBrief(task);
  if (task.to === "engineer") {
    const record = useEditor.getState().record;
    const name = record?.id === cardId ? record.card.data.name : "";
    await markStarted(cardId, task.id);
    void useEngineer.getState().queue(cardId, name, task.title, brief);
    return;
  }
  if (useEditor.getState().record?.id !== cardId) throw new Error("Open the card to start a co-writer task.");
  await markStarted(cardId, task.id);
  // Co-writer tasks take turns: each waits for the chat to be free.
  cowriterTasks = cowriterTasks
    .then(cowriterIdle)
    .then(async () => {
      if (useEditor.getState().record?.id !== cardId) return void (await reopenTask(cardId, task.id));
      await useCowriter.getState().load(cardId);
      await useCowriter.getState().send(brief, `Task: ${task.title}`);
    })
    .catch(() => undefined);
}

let cowriterTasks: Promise<void> = Promise.resolve();

const cowriterIdle = () =>
  new Promise<void>((resolve) => {
    if (!useCowriter.getState().busy) return resolve();
    const stop = useCowriter.subscribe((s) => {
      if (s.busy) return;
      stop();
      resolve();
    });
  });
