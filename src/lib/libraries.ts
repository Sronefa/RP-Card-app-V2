/**
 * Libraries shared by every project: NPCs, visual sheets, image setups, story templates, lore packs
 * and greeting sets. Each can go out as a pack file and come back in on another device; a pack can
 * also carry the mechanics, engine parts and kits libraries.
 */
import type { LorebookEntry } from "../card";
import { getSetting, putSetting } from "../db/db";
import type { Arc, ArcSettings, Beat } from "../editor/arc";
import type { MechanicModule } from "../editor/mechanics";
import type { EngineModule } from "../engine/modules/types";
import type { Kit } from "../engine/parts/catalog";
import type { ComfyWorkflow } from "../images/comfy";
import type { EmotionSet, Shot } from "../images/shots";
import type { VisualSheet } from "../images/visual";
import { newId } from "./id";

export interface Payloads {
  /** An NPC's world page fields. */
  npc: { fields: Record<string, string> };
  /** A sheet without the card's own reference picture. */
  sheet: Omit<VisualSheet, "reference" | "referenceSeed">;
  image: { shots: Shot[]; emotionSet: EmotionSet; customEmotions: string[]; workflows: ComfyWorkflow[] };
  /** An arc's settings and the shape of its beats, for the co-writer to adapt. */
  story: { settings: ArcSettings; beats: Pick<Beat, "title" | "summary">[]; ending: string };
  lore: { entries: LorebookEntry[] };
  /** A greeting planner grid. */
  greetings: { moods: string[]; places: string[]; stages: string[] };
}

export type LibraryKind = keyof Payloads;

export const LIBRARY_KINDS: Record<LibraryKind, { label: string; one: string; hint: string }> = {
  npc: { label: "NPCs", one: "NPC", hint: "People to bring into other worlds." },
  sheet: { label: "Visual sheets", one: "visual sheet", hint: "A look with its outfits and signature details." },
  image: { label: "Image setups", one: "image setup", hint: "A shot list, the emotion set and ComfyUI workflows." },
  story: { label: "Story templates", one: "story template", hint: "Arc structures the co-writer adapts to a card." },
  lore: { label: "Lore packs", one: "lore pack", hint: "A magic system, a city, an economy: lorebook entries that travel together." },
  greetings: { label: "Greeting sets", one: "greeting set", hint: "The greeting planner's moods, places and stages." },
};

export interface LibraryItem<K extends LibraryKind = LibraryKind> {
  id: string;
  kind: K;
  name: string;
  createdAt: number;
  payload: Payloads[K];
}

const key = (kind: LibraryKind) => `library:${kind}`;

export async function loadItems<K extends LibraryKind>(kind: K): Promise<LibraryItem<K>[]> {
  const list = await getSetting<LibraryItem<K>[]>(key(kind));
  return Array.isArray(list) ? list.filter((i) => i && i.kind === kind && typeof i.name === "string") : [];
}

/** Saves an item, replacing one of the same kind saved under the same name. */
export async function saveItem<K extends LibraryKind>(kind: K, name: string, payload: Payloads[K]): Promise<LibraryItem<K>[]> {
  const clean = name.trim() || LIBRARY_KINDS[kind].one;
  const item: LibraryItem<K> = { id: newId(), kind, name: clean, createdAt: Date.now(), payload: structuredClone(payload) };
  const next = [...(await loadItems(kind)).filter((i) => i.name.toLowerCase() !== clean.toLowerCase()), item].sort((a, b) => a.name.localeCompare(b.name));
  await putSetting(key(kind), next);
  return next;
}

export async function removeItem<K extends LibraryKind>(kind: K, id: string): Promise<LibraryItem<K>[]> {
  const next = (await loadItems(kind)).filter((i) => i.id !== id);
  await putSetting(key(kind), next);
  return next;
}

/** The older libraries a pack can carry too, stored under their own keys. */
export const EXTRA_KEYS = { mechanics: "mechanicsLibrary", parts: "engineModuleLibrary", kits: "engineKits" } as const;
export type ExtraKind = keyof typeof EXTRA_KEYS;
export const EXTRA_LABELS: Record<ExtraKind, string> = { mechanics: "Mechanics", parts: "Engine parts", kits: "Engine kits" };

export interface Pack {
  format: "cardforge-pack";
  version: 1;
  items: LibraryItem[];
  mechanics?: MechanicModule[];
  parts?: EngineModule[];
  kits?: Kit[];
}

export const PACK_EXT = "cfpack";

/** A pack of the chosen libraries, or of chosen items. */
export async function makePack(kinds: (LibraryKind | ExtraKind)[], only?: LibraryItem[]): Promise<Pack> {
  const pack: Pack = { format: "cardforge-pack", version: 1, items: only ?? [] };
  for (const kind of kinds) {
    if (kind in EXTRA_KEYS) {
      const list = await getSetting<unknown[]>(EXTRA_KEYS[kind as ExtraKind]);
      if (Array.isArray(list) && list.length) (pack as unknown as Record<string, unknown[]>)[kind] = list;
    } else if (!only) pack.items.push(...(await loadItems(kind as LibraryKind)));
  }
  return pack;
}

export const packBytes = (pack: Pack) => new TextEncoder().encode(JSON.stringify(pack, null, 1));

export function readPack(bytes: Uint8Array): Pack {
  let parsed: Partial<Pack>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This isn't a CardForge pack.");
  }
  if (parsed?.format !== "cardforge-pack") throw new Error("This isn't a CardForge pack.");
  return { format: "cardforge-pack", version: 1, items: Array.isArray(parsed.items) ? parsed.items : [], mechanics: parsed.mechanics, parts: parsed.parts, kits: parsed.kits };
}

/** What a pack holds, for the import summary. */
export function packSummary(pack: Pack): string {
  const counts = new Map<string, number>();
  for (const i of pack.items) if (i.kind in LIBRARY_KINDS) counts.set(LIBRARY_KINDS[i.kind].label, (counts.get(LIBRARY_KINDS[i.kind].label) ?? 0) + 1);
  for (const kind of Object.keys(EXTRA_KEYS) as ExtraKind[]) if (pack[kind]?.length) counts.set(EXTRA_LABELS[kind], pack[kind]!.length);
  return [...counts].map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ") || "nothing";
}

/**
 * Adds a pack to the libraries. Items keep their names; one with the name of an item already saved
 * replaces it. Mechanics, parts and kits are added the same way, by name or id.
 */
export async function importPack(pack: Pack) {
  for (const kind of Object.keys(LIBRARY_KINDS) as LibraryKind[]) {
    const incoming = pack.items.filter((i) => i.kind === kind && typeof i.name === "string" && i.payload);
    if (!incoming.length) continue;
    const names = new Set(incoming.map((i) => i.name.toLowerCase()));
    const kept = (await loadItems(kind)).filter((i) => !names.has(i.name.toLowerCase()));
    await putSetting(key(kind), [...kept, ...incoming.map((i) => ({ ...i, id: newId() }))].sort((a, b) => a.name.localeCompare(b.name)));
  }
  const merge = async <T extends { id: string; name: string }>(store: string, incoming: T[] | undefined, same: (a: T, b: T) => boolean) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    const list = (await getSetting<T[]>(store)) ?? [];
    await putSetting(store, [...list.filter((x) => !incoming.some((y) => same(x, y))), ...incoming].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.toLowerCase() === b.name.toLowerCase();
  await merge(EXTRA_KEYS.mechanics, pack.mechanics, byName);
  await merge(EXTRA_KEYS.parts, pack.parts, (a, b) => a.id === b.id);
  await merge(EXTRA_KEYS.kits, pack.kits, byName);
}

// What each kind keeps from the card, and how it comes back.

export function storyPayload(arc: Arc): Payloads["story"] {
  return { settings: arc.settings, beats: arc.beats.map(({ title, summary }) => ({ title, summary })), ending: arc.ending };
}

/** The template as a request to the co-writer: keep the shape, make it this card's story. */
export function storyTemplateText(t: Payloads["story"]): string {
  return [
    "Use this story template: keep its structure (the number and order of beats, what each one does for the story, the kind of ending), but make every beat about this card's characters, places and conflicts.",
    ...t.beats.map((b, i) => `${i + 1}. ${b.title}: ${b.summary}`),
    t.ending && `Ending: ${t.ending}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Shots for a card: ones about a world page this card doesn't have fall back to the card's character. */
export function shotsFor(shots: Shot[], subjects: Set<string>): Shot[] {
  return shots.map((s) => ({
    ...structuredClone(s),
    id: newId(),
    ...(s.subject && !subjects.has(s.subject) ? { subject: "card" } : {}),
    ...(s.place && !subjects.has(s.place) ? { place: undefined } : {}),
  }));
}
