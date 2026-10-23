/**
 * Editing helpers for a card's lorebook (character_book).
 */
import type { Lorebook, LorebookEntry } from "../card";

export const emptyBook = (): Lorebook => ({ entries: [], extensions: {} });

function nextId(book: Lorebook): number {
  return book.entries.reduce((max, e) => (typeof e.id === "number" && e.id >= max ? e.id + 1 : max), 0);
}

export function newEntry(book: Lorebook, fields: Partial<LorebookEntry> = {}): LorebookEntry {
  return {
    id: nextId(book),
    keys: [],
    secondary_keys: [],
    comment: "",
    content: "",
    constant: false,
    selective: false,
    enabled: true,
    insertion_order: 100,
    use_regex: false,
    position: "before_char",
    extensions: {},
    ...fields,
  };
}

/** Appends another book's entries, giving them fresh ids. Keeps this book's settings. */
export function mergeBooks(book: Lorebook, incoming: Lorebook): Lorebook {
  let id = nextId(book);
  return { ...book, entries: [...book.entries, ...incoming.entries.map((e) => ({ ...e, id: id++ }))] };
}

/**
 * Where SillyTavern inserts an entry. ST reads `extensions.position` first and falls back to the V3
 * `position`, so both are written. The V3 field can only say before or after the character.
 */
export const ST_POSITIONS = [
  { value: 0, label: "Before character" },
  { value: 1, label: "After character" },
  { value: 2, label: "Top of author's note" },
  { value: 3, label: "Bottom of author's note" },
  { value: 4, label: "At chat depth" },
  { value: 5, label: "Before examples" },
  { value: 6, label: "After examples" },
] as const;

export const AT_DEPTH = 4;

export function stPosition(entry: LorebookEntry): number {
  const p = entry.extensions.position;
  if (typeof p === "number") return p;
  return entry.position === "after_char" ? 1 : 0;
}

export function withStPosition(entry: LorebookEntry, position: number): LorebookEntry {
  return {
    ...entry,
    position: position === 0 ? "before_char" : "after_char",
    extensions: { ...entry.extensions, position },
  };
}

export function stDepth(entry: LorebookEntry): number {
  const d = entry.extensions.depth;
  return typeof d === "number" ? d : 4;
}

/** A key like `/dragons?/i` is a regular expression. */
export const isRegexKey = (key: string) => /^\/.+\/[a-z]*$/s.test(key);

/** Compiles a regex key and returns the error message if it is invalid. */
export function regexError(key: string): string | undefined {
  // Keys in /pattern/flags form, as SillyTavern writes them; others are a bare pattern.
  const m = /^\/(.+)\/([a-z]*)$/s.exec(key);
  try {
    if (m) new RegExp(m[1], m[2]);
    else new RegExp(key);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Splits typed or pasted text into keys. Commas separate keys, except inside a /regex/. */
export function parseKeys(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (isRegexKey(trimmed)) return [trimmed];
  return trimmed
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Display name of an entry: its name or comment (ST's "title/memo"), else its first key. */
export function entryTitle(entry: LorebookEntry): string {
  return entry.name || entry.comment || entry.keys[0] || "Untitled entry";
}
