/**
 * World pages: NPCs, places, money, items and shops kept as structured lorebook entries.
 *
 * The fields live in the entry's `extensions.cardforge`, and the entry's text and keys are written
 * from them, so SillyTavern sees ordinary lorebook entries.
 */
import type { Lorebook, LorebookEntry } from "../card";
import { newEntry } from "./lorebook";

export type WorldKind = "npc" | "location" | "currency" | "item" | "shop";

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** What the co-writer should write in it. */
  hint: string;
}

export interface KindDef {
  label: string;
  plural: string;
  /** The plural inside a sentence. */
  many: string;
  fields: FieldDef[];
  /** The entry text, from the fields. */
  render: (f: Record<string, string>) => string;
  /** Extra keys besides the name and aliases. */
  keys?: (f: Record<string, string>) => string[];
}

const ALIASES: FieldDef = {
  key: "aliases",
  label: "Other names",
  placeholder: "Comma-separated, e.g. the captain, Holt",
  hint: "other names, titles or nicknames the chat may use, comma-separated",
};

const lines = (...parts: (string | false | undefined)[]) => parts.filter((p) => p && p.trim()).join("\n");

export const KINDS: Record<WorldKind, KindDef> = {
  npc: {
    label: "NPC",
    plural: "NPCs",
    many: "NPCs",
    fields: [
      { key: "name", label: "Name", hint: "the NPC's name" },
      { key: "role", label: "Role", placeholder: "e.g. ferryman, rebel leader", hint: "their role in the world, a few words" },
      { key: "age", label: "Age", placeholder: "e.g. 40s", hint: "their age; adults for anyone in sexual content" },
      { key: "look", label: "Look", placeholder: "Two or three details that stick", hint: "two or three striking physical details" },
      {
        key: "voice",
        label: "Voice",
        placeholder: "How they talk: rhythm, words they use, a verbal habit",
        multiline: true,
        hint: "how they talk, so the narrator keeps them distinct: rhythm, word choice, a verbal habit, a sample line",
      },
      { key: "notes", label: "Notes", multiline: true, hint: "what they want, what they hide, how they treat {{user}}" },
      ALIASES,
    ],
    render: (f) =>
      lines(
        `${f.name}${f.role ? ` (${f.role})` : ""}${f.age ? `, ${f.age}` : ""}`,
        f.look && `Look: ${f.look}`,
        f.voice && `Voice: ${f.voice}`,
        f.notes,
      ),
  },
  location: {
    label: "place",
    plural: "Places",
    many: "places",
    fields: [
      { key: "name", label: "Name", hint: "the place's name" },
      { key: "mood", label: "Mood", placeholder: "e.g. damp, watchful, half-abandoned", hint: "the mood in a few words" },
      {
        key: "senses",
        label: "Senses",
        placeholder: "What you see, hear, smell and feel there",
        multiline: true,
        hint: "concrete sensory details: sight, sound, smell, touch",
      },
      { key: "details", label: "Details", multiline: true, hint: "who is there, what happens there, what matters for the story" },
      ALIASES,
    ],
    render: (f) => lines(f.name, f.mood && `Mood: ${f.mood}`, f.senses && `Senses: ${f.senses}`, f.details),
  },
  currency: {
    label: "currency",
    plural: "Money",
    many: "currencies",
    fields: [
      { key: "name", label: "Currency", placeholder: "e.g. crowns", hint: "the currency's name" },
      {
        key: "units",
        label: "Coins and exchange",
        placeholder: "e.g. 1 crown = 12 shillings = 144 pennies",
        hint: "the coins or notes and how they convert",
      },
      {
        key: "notes",
        label: "Notes",
        multiline: true,
        placeholder: "What a day's wage buys, who mints it, barter",
        hint: "what a day's wage is and buys, and anything unusual about money",
      },
    ],
    render: (f) => lines(`Money: ${f.name}.${f.units ? ` ${f.units}.` : ""}`, f.notes),
    keys: () => ["price", "cost", "pay", "buy", "sell", "coin", "money"],
  },
  item: {
    label: "item",
    plural: "Items",
    many: "items",
    fields: [
      { key: "name", label: "Item", hint: "the item's name" },
      { key: "price", label: "Price", placeholder: "e.g. 3 shillings", hint: "the usual price, in the world's currency" },
      { key: "notes", label: "Notes", multiline: true, hint: "what it does or why it matters, one or two sentences" },
      ALIASES,
    ],
    render: (f) => lines(`${f.name}${f.price ? `: costs ${f.price}.` : "."}`, f.notes),
  },
  shop: {
    label: "shop",
    plural: "Shops",
    many: "shops",
    fields: [
      { key: "name", label: "Shop", hint: "the shop's name" },
      { key: "place", label: "Where", placeholder: "e.g. Lantern Street, the docks", hint: "where it is" },
      { key: "owner", label: "Owner", hint: "who runs it, a few words" },
      { key: "sells", label: "Sells", multiline: true, hint: "what it sells, with a few prices in the world's currency" },
      { key: "notes", label: "Notes", multiline: true, hint: "atmosphere, rules, secrets" },
      ALIASES,
    ],
    render: (f) =>
      lines(
        `${f.name}${f.place ? `, ${f.place}` : ""}.${f.owner ? ` Run by ${f.owner}.` : ""}`,
        f.sells && `Sells: ${f.sells}`,
        f.notes,
      ),
  },
};

export interface WorldMeta {
  kind: WorldKind | "cast";
  fields: Record<string, string>;
}

const EXT = "cardforge";

export function worldMeta(entry: LorebookEntry): WorldMeta | undefined {
  const meta = entry.extensions[EXT] as WorldMeta | undefined;
  return meta && typeof meta === "object" && typeof meta.kind === "string" ? meta : undefined;
}

export const isKind = (entry: LorebookEntry, kind: WorldMeta["kind"]) => worldMeta(entry)?.kind === kind;

const splitAliases = (s = "") =>
  s
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

/** The entry for these fields: a new one, or the existing one with its text and keys rewritten. */
export function worldEntry(book: Lorebook, kind: WorldKind, fields: Record<string, string>, existing?: LorebookEntry): LorebookEntry {
  const def = KINDS[kind];
  const keys = [...new Set([fields.name?.trim(), ...splitAliases(fields.aliases), ...(def.keys?.(fields) ?? [])].filter(Boolean))];
  const base = existing ?? newEntry(book);
  return {
    ...base,
    comment: fields.name?.trim() || `New ${def.label}`,
    keys: keys as string[],
    content: def.render(fields),
    extensions: { ...base.extensions, [EXT]: { kind, fields } satisfies WorldMeta },
  };
}

/** One always-on line per NPC, so the narrator keeps every voice distinct. */
export function castText(entries: LorebookEntry[]): string {
  const npcs = entries.map(worldMeta).filter((m): m is WorldMeta => m?.kind === "npc");
  return lines(
    "Cast. Keep each character's voice distinct:",
    ...npcs.map(({ fields: f }) => `- ${f.name}${f.role ? ` (${f.role})` : ""}: ${f.voice || "voice not set"}`),
  );
}

/** Rewrites the cast list entry, if there is one, after the NPCs changed. */
export function syncCast(book: Lorebook): Lorebook {
  const i = book.entries.findIndex((e) => isKind(e, "cast"));
  if (i === -1) return book;
  const content = castText(book.entries);
  if (book.entries[i].content === content) return book;
  return { ...book, entries: book.entries.map((e, j) => (j === i ? { ...e, content } : e)) };
}

/** Adds or removes the always-on cast list entry. */
export function setCastList(book: Lorebook, on: boolean): Lorebook {
  const has = book.entries.some((e) => isKind(e, "cast"));
  if (on === has) return book;
  if (!on) return { ...book, entries: book.entries.filter((e) => !isKind(e, "cast")) };
  const entry = newEntry(book, {
    comment: "Cast list",
    constant: true,
    content: castText(book.entries),
    extensions: { [EXT]: { kind: "cast", fields: {} } satisfies WorldMeta },
  });
  return { ...book, entries: [...book.entries, entry] };
}
