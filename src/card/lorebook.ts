/**
 * Standalone lorebook files: the V3 `lorebook_v3` format and SillyTavern World Info JSON.
 *
 * The World Info mapping mirrors SillyTavern's own conversion between World Info and
 * embedded character books, so ST-only settings survive a round trip through `extensions`.
 */
import { utf8Decode } from "./bytes";
import { normalizeLorebook, parseCardJson } from "./normalize";
import type { Lorebook, LorebookEntry, LorebookV3File } from "./types";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** SillyTavern World Info settings that have no V3 field, stored in entry.extensions under these names. */
const WI_EXTENSION_FIELDS: [wiKey: string, extKey: string, fallback: unknown][] = [
  ["excludeRecursion", "exclude_recursion", false],
  ["preventRecursion", "prevent_recursion", false],
  ["delayUntilRecursion", "delay_until_recursion", false],
  ["probability", "probability", 100],
  ["useProbability", "useProbability", true],
  ["depth", "depth", 4],
  ["selectiveLogic", "selectiveLogic", 0],
  ["group", "group", ""],
  ["groupOverride", "group_override", false],
  ["groupWeight", "group_weight", 100],
  ["scanDepth", "scan_depth", null],
  ["matchWholeWords", "match_whole_words", null],
  ["useGroupScoring", "use_group_scoring", null],
  ["automationId", "automation_id", ""],
  ["role", "role", 0],
  ["vectorized", "vectorized", false],
  ["sticky", "sticky", null],
  ["cooldown", "cooldown", null],
  ["delay", "delay", null],
];

/** SillyTavern World Info positions. 0 and 1 map to the V3 before_char/after_char. */
export const WI_POSITIONS = {
  beforeChar: 0,
  afterChar: 1,
  authorsNoteTop: 2,
  authorsNoteBottom: 3,
  atDepth: 4,
  examplesTop: 5,
  examplesBottom: 6,
} as const;

const looksLikeRegex = (key: string) => /^\/.+\/[a-z]*$/s.test(key);

export function isWorldInfo(json: unknown): boolean {
  return isObject(json) && isObject(json.entries) && !("spec" in json);
}

/** Reads a lorebook from a V3 lorebook file, SillyTavern World Info, a bare character book, or a card. */
export function importLorebook(input: Uint8Array | string): Lorebook {
  const json = parseCardJson(typeof input === "string" ? input : utf8Decode(input));
  if (!isObject(json)) throw new Error("Lorebook file is not a JSON object");
  if (json.spec === "lorebook_v3" && isObject(json.data)) return normalizeLorebook(json.data);
  if (isWorldInfo(json)) return fromWorldInfo(json);
  if (Array.isArray(json.entries)) return normalizeLorebook(json);
  const book = isObject(json.data) ? json.data.character_book : undefined;
  if (isObject(book)) return normalizeLorebook(book);
  throw new Error("This file doesn't contain a lorebook");
}

export function toLorebookV3File(book: Lorebook): LorebookV3File {
  return { spec: "lorebook_v3", data: book };
}

export function fromWorldInfo(json: Json): Lorebook {
  const raw = Object.values(isObject(json.entries) ? json.entries : {}).filter(isObject);
  raw.sort((a, b) => Number(a.displayIndex ?? a.uid ?? 0) - Number(b.displayIndex ?? b.uid ?? 0));
  const entries = raw.map((e, index): Json => {
    const keys = Array.isArray(e.key) ? e.key.map(String) : [];
    const secondary = Array.isArray(e.keysecondary) ? e.keysecondary.map(String) : [];
    const extensions: Json = { ...(isObject(e.extensions) ? e.extensions : {}) };
    extensions.position = typeof e.position === "number" ? e.position : WI_POSITIONS.beforeChar;
    extensions.display_index = typeof e.displayIndex === "number" ? e.displayIndex : index;
    for (const [wiKey, extKey] of WI_EXTENSION_FIELDS) if (wiKey in e) extensions[extKey] = e[wiKey];
    if ("caseSensitive" in e) extensions.case_sensitive = e.caseSensitive;
    return {
      id: e.uid ?? index,
      keys,
      secondary_keys: secondary,
      comment: typeof e.comment === "string" ? e.comment : "",
      content: e.content,
      constant: e.constant === true,
      selective: e.selective === true,
      insertion_order: e.order,
      enabled: e.disable !== true,
      position: e.position === WI_POSITIONS.beforeChar ? "before_char" : "after_char",
      use_regex: [...keys, ...secondary].some(looksLikeRegex),
      case_sensitive: typeof e.caseSensitive === "boolean" ? e.caseSensitive : undefined,
      extensions,
    };
  });
  return normalizeLorebook({
    name: typeof json.name === "string" ? json.name : undefined,
    description: typeof json.description === "string" ? json.description : undefined,
    entries,
    extensions: {},
  });
}

export function toWorldInfo(book: Lorebook): Json {
  const entries: Record<string, Json> = {};
  book.entries.forEach((entry: LorebookEntry, index) => {
    const ext = entry.extensions;
    const uid = typeof entry.id === "number" && !(String(entry.id) in entries) ? entry.id : index;
    const wi: Json = {
      uid,
      key: entry.keys,
      keysecondary: entry.secondary_keys ?? [],
      comment: entry.comment || entry.name || "",
      content: entry.content,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
      order: entry.insertion_order,
      position:
        typeof ext.position === "number"
          ? ext.position
          : entry.position === "after_char"
            ? WI_POSITIONS.afterChar
            : WI_POSITIONS.beforeChar,
      disable: !entry.enabled,
      addMemo: Boolean(entry.comment || entry.name),
      displayIndex: typeof ext.display_index === "number" ? ext.display_index : index,
      caseSensitive: ext.case_sensitive ?? entry.case_sensitive ?? null,
    };
    for (const [wiKey, extKey, fallback] of WI_EXTENSION_FIELDS) wi[wiKey] = extKey in ext ? ext[extKey] : fallback;
    entries[String(uid)] = wi;
  });
  return { ...(book.name ? { name: book.name } : {}), entries };
}
