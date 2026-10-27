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

/** An XML-tagged entry, like the arc and mechanics entries: attributes for the short facts, lines for the rest. */
function tagged(tag: string, attrs: Record<string, string | undefined>, body: (string | false | undefined)[]): string {
  const attr = Object.entries(attrs)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => ` ${k}="${v!.trim().replace(/"/g, "'")}"`)
    .join("");
  return [`<${tag}${attr}>`, ...body.filter((p) => p && p.trim()), `</${tag}>`].join("\n");
}

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
        hint: "the coins or notes, what they look like, and how they convert",
      },
      {
        key: "wages",
        label: "Wages and prices",
        multiline: true,
        placeholder: "e.g. a labourer earns 2 shillings a day; a meal costs 3 pennies",
        hint: "what a day's wage is and what common things cost, as a few reference prices",
      },
      {
        key: "economy",
        label: "Economy",
        multiline: true,
        placeholder: "Who mints it, how scarce it is, barter, debt, banks",
        hint: "how money works: who issues it, scarcity, barter, credit and debt, and who holds the wealth",
      },
      { key: "notes", label: "Notes", multiline: true, hint: "anything else about money that matters in play: forgery, taxes, foreign coin" },
    ],
    render: (f) =>
      tagged("currency", { name: f.name }, [
        f.units && `Coins: ${f.units}`,
        f.wages && `Wages and prices: ${f.wages}`,
        f.economy && `Economy: ${f.economy}`,
        f.notes,
      ]),
    keys: () => ["price", "cost", "pay", "buy", "sell", "coin", "money"],
  },
  item: {
    label: "item",
    plural: "Items",
    many: "items",
    fields: [
      { key: "name", label: "Item", hint: "the item's or service's name" },
      { key: "price", label: "Price", placeholder: "e.g. 3 shillings", hint: "the usual price, in the world's currency" },
      { key: "category", label: "Category", placeholder: "e.g. healing, weapon, lodging", hint: "its category, one or two words" },
      { key: "type", label: "Item or service", placeholder: "item or service", hint: '"item" for goods, "service" for something done for {{user}}' },
      { key: "quality", label: "Quality", placeholder: "e.g. average", hint: "poor, average, fine or masterwork" },
      { key: "rarity", label: "Rarity", placeholder: "e.g. common", hint: "common, uncommon, rare or unique" },
      { key: "effect", label: "Effect", multiline: true, hint: "what it does or provides, concretely, one or two sentences" },
      { key: "shop", label: "Sold at", placeholder: "Where to get it", hint: "who sells it or where to find it" },
      { key: "notes", label: "Notes", multiline: true, hint: "anything else: side effects, legality, who wants it" },
      ALIASES,
    ],
    render: (f) =>
      tagged(
        "item",
        { name: f.name, category: f.category, type: f.type, price: f.price, quality: f.quality, rarity: f.rarity },
        [f.effect, f.shop && `Sold at: ${f.shop}`, f.notes],
      ),
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
      tagged("shop", { name: f.name, where: f.place, owner: f.owner }, [f.sells && `Sells: ${f.sells}`, f.notes]),
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

/** The meta of a world page entry (NPC, place, money, item or shop); other CardForge entries have none. */
export function pageMeta(entry: LorebookEntry): (WorldMeta & { kind: WorldKind }) | undefined {
  const meta = worldMeta(entry);
  return meta && Object.hasOwn(KINDS, meta.kind) ? (meta as WorldMeta & { kind: WorldKind }) : undefined;
}

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

/** "an NPC", "a place", "an item": a kind's label with its article. */
export const aKind = (kind: WorldKind) => `${/^[aeiou]|^NPC/.test(KINDS[kind].label) ? "an" : "a"} ${KINDS[kind].label}`;

/** The world kinds the co-writer can add as typed entries. */
export const TYPED_KINDS = ["npc", "location", "item", "shop"] as const satisfies WorldKind[];
export type TypedKind = (typeof TYPED_KINDS)[number];

/** An entry CardForge didn't make: no world page, arc, mechanics or tracker tag. */
export const isPlainEntry = (entry: LorebookEntry) => !entry.extensions[EXT];

/** Every field any typed kind has, for tools that may file an entry under any of them. */
export const ALL_WORLD_FIELDS: FieldDef[] = [
  ...new Map(TYPED_KINDS.flatMap((k) => KINDS[k].fields).map((f) => [f.key, f])).values(),
];

/** Keeps only the fields this kind has, trimmed. */
export function fieldsFor(kind: WorldKind, input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of KINDS[kind].fields) {
    const v = input[f.key];
    if (typeof v === "string" && v.trim()) out[f.key] = v.trim();
  }
  return out;
}

const CUES: Record<TypedKind, RegExp> = {
  npc: /\b(years? old|aged? \d|in (?:his|her|their) (?:teens|twenties|thirties|forties|fifties|sixties|\d0s)|\d0s\b|woman|man|girl|boy|wife|husband|daughter|son|mother|father|sister|brother|widow|captain|merchant|knight|guard|priest(?:ess)?|innkeeper|smith|personality|speaks|voice|appearance|eyes|hair)\b/gi,
  location: /\b(located|district|city|town|village|tavern|inn|forest|castle|street|room|building|hall|temple|harbou?r|port|market|island|mountains?|river|ruins|quarter|square|alley|cave|keep|tower|lake|valley|road|docks?)\b/gi,
  item: /\b(item|weapon|sword|blade|dagger|bow|potion|elixir|artifact|artefact|amulet|ring|relic|armou?r|wield|enchanted|crafted|costs?|price|worth)\b/gi,
  shop: /\b(shop|store|sells|for sale|vendor|stall|emporium|bakery|apothecary|forge|counter|customers)\b/gi,
};
const PRONOUN = /\b(he|she|him|his|her|hers)\b/i;

/**
 * A best guess at what a plain entry describes, from cue words. Only a clear lead counts, and a
 * person needs a personal pronoun, so rules and history entries stay plain.
 */
export function guessWorldKind(title: string, content: string): TypedKind | undefined {
  const text = `${title}\n${content}`;
  const score = (k: TypedKind) => text.match(CUES[k])?.length ?? 0;
  const scores = TYPED_KINDS.map((k) => [k, score(k)] as const).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = scores;
  if (top < 2 || top < second * 1.5) return undefined;
  if (best === "npc" && !PRONOUN.test(content)) return undefined;
  return best;
}

/** Fields for a plain entry filed under a kind: its title as the name, its text kept whole. */
export function plainFields(kind: TypedKind, title: string, keys: string[], content: string): Record<string, string> {
  const textField = { npc: "notes", location: "details", item: "effect", shop: "notes" }[kind];
  const aliases = keys.filter((k) => k.trim() && k.trim().toLowerCase() !== title.trim().toLowerCase()).join(", ");
  return { name: title.trim(), [textField]: content.trim(), ...(aliases ? { aliases } : {}) };
}

/** How the co-writer sees a world entry: its kind and fields, which it edits instead of the text. */
export function worldFieldsText(meta: WorldMeta & { kind: WorldKind }): string {
  return KINDS[meta.kind].fields
    .filter((f) => meta.fields[f.key]?.trim())
    .map((f) => `${f.key}: ${meta.fields[f.key].trim()}`)
    .join("\n");
}
