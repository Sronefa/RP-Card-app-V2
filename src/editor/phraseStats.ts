/**
 * Phrases the user's models keep writing, counted across projects from what the co-writer
 * proposes, so the slop list can grow from the user's own models instead of a generic list.
 */
import { getSetting, putSetting } from "../db/db";
import { slopInText } from "./slop";

interface Stats {
  /** Four-word phrases with how many texts used them and in which projects (up to three). */
  grams: Record<string, { n: number; p: string[] }>;
  /** Phrases the user waved off. */
  ignored: string[];
}

const KEY = "phraseStats";
/** Phrases kept; the rarest go first. */
const MAX = 3000;
const STOP = new Set(
  "a an the and or but of to in on at by for with from as is was were be been it its his her their they them he she you your i my me we our this that these those there then than so not no into over up down out".split(" "),
);

/** The four-word phrases in a text, each once, skipping ones made mostly of small words. */
export function phrasesOf(text: string): string[] {
  const words = text
    .replace(/\{\{\w+\}\}/g, " ")
    .toLowerCase()
    .split(/[^a-z'’]+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 4 <= words.length; i++) {
    const gram = words.slice(i, i + 4);
    if (gram.filter((w) => !STOP.has(w)).length >= 2) out.add(gram.join(" "));
  }
  return [...out];
}

let queue = Promise.resolve();

async function load(): Promise<Stats> {
  const s = await getSetting<Stats>(KEY);
  return { grams: s?.grams ?? {}, ignored: s?.ignored ?? [] };
}

/** Counts the phrases in proposed texts for a project. */
export function trackPhrases(texts: string[], projectId: string): Promise<void> {
  queue = queue
    .then(async () => {
      const stats = await load();
      for (const text of texts)
        for (const gram of phrasesOf(text)) {
          const g = (stats.grams[gram] ??= { n: 0, p: [] });
          g.n++;
          if (!g.p.includes(projectId) && g.p.length < 3) g.p.push(projectId);
        }
      const entries = Object.entries(stats.grams);
      if (entries.length > MAX) stats.grams = Object.fromEntries(entries.sort((a, b) => b[1].n - a[1].n).slice(0, MAX));
      await putSetting(KEY, stats);
    })
    .catch(() => undefined);
  return queue;
}

/** Phrases used at least five times in two or more projects, not yet on the slop list. */
export async function repeatedPhrases(slopList: string[], limit = 10): Promise<{ phrase: string; count: number }[]> {
  const stats = await load();
  return Object.entries(stats.grams)
    .filter(([gram, g]) => g.n >= 5 && g.p.length >= 2 && !stats.ignored.includes(gram) && !slopInText(gram, slopList).length)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([phrase, g]) => ({ phrase, count: g.n }));
}

export function ignorePhrase(phrase: string): Promise<void> {
  queue = queue.then(async () => {
    const stats = await load();
    await putSetting(KEY, { ...stats, ignored: [...stats.ignored, phrase] });
  });
  return queue;
}
