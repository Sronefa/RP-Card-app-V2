/**
 * Slop detector: finds overused AI phrasing in the card's text.
 *
 * Phrases are plain text, matched without case. `*` inside a word stands for any letters, and `*` on its
 * own for up to three words, so "shiver* * down * spine" matches "shivers down her spine" and "a shiver
 * ran down his spine".
 */
import type { CardDataV3 } from "../card";
import type { GroupId } from "../features/editor/fields";
import { arcHidden, isArcEntry } from "./arc";
import { entryTitle } from "./lorebook";

export const DEFAULT_SLOP_PHRASES = [
  "shiver* * down * spine",
  "send* shivers",
  "barely above a whisper",
  "voice dripping with",
  "smell* of ozone",
  "scent of ozone",
  "a mix of",
  "a mixture of",
  "mischievous glint",
  "glint in * eye*",
  "eyes sparkl* with",
  "smirk* playfully",
  "maybe, just maybe",
  "little did * know",
  "ministrations",
  "testament to",
  "tapestry of",
  "the air * thick with",
  "electricity in the air",
  "can't help but",
  "couldn't help but",
  "a wave of",
  "padded over",
  "bit* * lip",
  "breath * didn't know * holding",
  "jaw tighten*",
  "knuckles white",
  "unspoken promise",
  "dance of",
  "palpable",
  "in a world where",
  "the game is afoot",
  "you're mine",
  "half-lidded",
  "pupils blown",
  "eyes darken* with",
  "for what felt like an eternity",
  "the weight of * words",
  "nestled",
  "bustling",
  "stark contrast",
  "delve",
];

export interface SlopHit {
  /** Where the text is, as a label the user knows ("First message", "Lorebook: Ash Ford"). */
  where: string;
  /** How to ask the co-writer to change it ("the first message", "alternate greeting 2"). */
  ref: string;
  target: { section: "editor"; group: GroupId } | { section: "lorebook"; entry: number };
  phrase: string;
  /** The words that matched, as written in the card. */
  match: string;
  /** The sentence the phrase is in. */
  line: string;
}

function phraseRegex(phrase: string): RegExp | undefined {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const word = (w: string) =>
    w
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\w'’-]*");
  const [first, ...rest] = words[0] === "*" ? words.slice(1) : words;
  if (!first) return undefined;
  const source = word(first) + rest.map((w) => (w === "*" ? "(?:\\s+[\\w'’-]+){0,3}" : `\\s+${word(w)}`)).join("");
  return new RegExp(`(?<![\\w'’])${source}(?![\\w'’])`, "gi");
}

/** The sentence around a match, trimmed to a readable length. */
function sentenceAt(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const from = Math.max(before.search(/[^.!?\n]*$/), 0);
  const rest = text.slice(end);
  const stop = rest.search(/[.!?\n]/);
  let line = text.slice(from, stop === -1 ? text.length : end + stop + 1).trim();
  if (line.length > 240) line = line.slice(0, 237).trimEnd() + "…";
  return line;
}

type Source = Omit<SlopHit, "phrase" | "match" | "line"> & { text: string };

function sources(data: CardDataV3): Source[] {
  const hidden = arcHidden(data);
  const field = (text: string, where: string, group: GroupId): Source => ({
    text,
    where,
    ref: `the ${where.toLowerCase()}`,
    target: { section: "editor", group },
  });
  return [
    field(data.description, "Description", "description"),
    field(data.personality, "Personality", "personality"),
    field(data.scenario, "Scenario", "scenario"),
    field(data.first_mes, "First message", "greetings"),
    ...data.alternate_greetings.map((text, i) => ({
      ...field(text, `Alternate greeting ${i + 1}`, "greetings"),
      ref: `alternate greeting ${i + 1}`,
    })),
    field(data.mes_example, "Example dialogues", "examples"),
    // A secret story arc stays out of sight, so its entries aren't quoted here.
    ...(data.character_book?.entries ?? []).flatMap((e, i): Source[] =>
      hidden && isArcEntry(e)
        ? []
        : [
            {
              text: e.content,
              where: `Lorebook: ${entryTitle(e)}`,
              ref: `the lorebook entry "${entryTitle(e)}"`,
              target: { section: "lorebook", entry: i },
            },
          ],
    ),
  ];
}

/** Every use of a slop phrase, one hit per phrase per sentence. */
export function findSlop(data: CardDataV3, phrases: string[]): SlopHit[] {
  const regexes = phrases.map((p) => [p.trim(), phraseRegex(p)] as const).filter(([, r]) => r);
  const hits: SlopHit[] = [];
  for (const source of sources(data)) {
    if (!source.text.trim()) continue;
    const { text, ...rest } = source;
    const seen = new Set<string>();
    for (const [phrase, regex] of regexes) {
      for (const m of text.matchAll(regex!)) {
        const line = sentenceAt(text, m.index, m.index + m[0].length);
        if (seen.has(`${phrase}\n${line}`)) continue;
        seen.add(`${phrase}\n${line}`);
        hits.push({ ...rest, phrase, match: m[0], line });
      }
    }
  }
  return hits;
}

/** The co-writer request that rewrites one flagged line. */
export const slopRequest = (hit: SlopHit) =>
  `In ${hit.ref}, rewrite this line so it doesn't use the overused phrase "${hit.match}". Keep what it says and the voice, and change only this line: "${hit.line}"`;
