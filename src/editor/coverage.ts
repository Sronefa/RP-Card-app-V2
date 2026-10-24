/**
 * Lore coverage: names, places and factions the card mentions that no lorebook entry covers.
 *
 * Proper nouns are found by capitalisation. A single capitalised word only counts when it shows up
 * mid-sentence somewhere, so "Rain hammers the gate." doesn't make "Rain" a name.
 */
import type { CardDataV3, LorebookEntry } from "../card";
import { entryTitle, isRegexKey } from "./lorebook";

export interface Uncovered {
  name: string;
  /** How many times the card mentions it. */
  count: number;
}

const WORD = "\\p{Lu}\\p{Ll}[\\p{L}'’-]*";
const JOINER = "(?:of|the|de|du|des|del|von|van|al|el|la|le|na)";
const NAME = new RegExp(`(?<![\\p{L}\\p{N}_'’-])${WORD}(?:\\s+(?:${JOINER}\\s+)?${WORD})*`, "gu");

/** Words that start a capitalised run without being part of the name ("The Ash Ford"). */
const LEADING = new Set(
  "the a an in at on to by of from into for with and but or as his her their its my your our this that these those when while after before if".split(
    " ",
  ),
);
/** Capitalised words that are never names. */
const NOT_NAMES = new Set(
  (
    "i i'm i'll i've i'd oh ok okay yes no hey hello hi please thanks sorry well god gods mr mrs ms dr sir madam " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august " +
    "september october november december english start char user"
  ).split(" "),
);

const clean = (text: string) =>
  text
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/[*_~`#]/g, " ");

const stripPossessive = (name: string) => name.replace(/['’]s$/u, "").replace(/['’-]+$/u, "");

/** True when the text before a match ends a sentence (or a quote or line opens there). */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  // `"Wrong forest," Mira says.` goes on after the quote.
  if (/,["”»]$/.test(before)) return false;
  return before === "" || /[.!?:;"“”«»(\n-]$/.test(before) || /\n\s*$/.test(text.slice(0, index));
}

/** Proper nouns in the text with their counts. */
export function properNouns(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const midSentence = new Set<string>();
  const t = clean(text);
  for (const m of t.matchAll(NAME)) {
    let words = m[0].split(/\s+/);
    let start = atSentenceStart(t, m.index);
    while (words.length > 0 && LEADING.has(words[0].toLowerCase())) {
      words = words.slice(1);
      start = false;
    }
    if (words.length === 0) continue;
    const name = stripPossessive(words.join(" "));
    if (!name || NOT_NAMES.has(name.toLowerCase())) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!start || words.length > 1) midSentence.add(name);
  }
  for (const name of counts.keys()) if (!midSentence.has(name)) counts.delete(name);
  return counts;
}

/** True when an entry would trigger on the name, or is plainly about it. */
function covers(entry: LorebookEntry, name: string): boolean {
  const lower = name.toLowerCase();
  if (entryTitle(entry).toLowerCase() === lower) return true;
  return [...entry.keys, ...(entry.secondary_keys ?? [])].some((key) => {
    const k = key.trim();
    if (!k) return false;
    if (isRegexKey(k) || entry.use_regex) {
      const m = /^\/(.+)\/([a-z]*)$/s.exec(k);
      try {
        return new RegExp(m ? m[1] : k, m ? m[2] : "i").test(name);
      } catch {
        return false;
      }
    }
    const kl = k.toLowerCase();
    return kl === lower || lower.split(/\s+/).includes(kl) || kl.includes(lower);
  });
}

/**
 * Names in the card's fields, greetings and examples that no entry covers, most mentioned first.
 * `otherEntries` are entries that also count, such as the project world's lorebook.
 */
export function findUncovered(data: CardDataV3, otherEntries: LorebookEntry[] = []): Uncovered[] {
  const text = [
    data.description,
    data.personality,
    data.scenario,
    data.first_mes,
    ...data.alternate_greetings,
    data.mes_example,
  ].join("\n\n");
  const own = new Set(
    [data.name, data.nickname ?? ""].flatMap((n) => [n.toLowerCase(), ...n.toLowerCase().split(/\s+/)]).filter(Boolean),
  );
  const entries = [...(data.character_book?.entries ?? []), ...otherEntries];
  return [...properNouns(text)]
    .filter(([name]) => !own.has(name.toLowerCase()) && !entries.some((e) => covers(e, name)))
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The co-writer request that writes entries for uncovered names. */
export const coverageRequest = (names: string[]) =>
  `The card mentions ${names.map((n) => `"${n}"`).join(", ")} but the lorebook has no entries for ${names.length === 1 ? "it" : "them"}. Add a short lorebook entry for each, built from what the card already says, with keys that will trigger on them.`;
