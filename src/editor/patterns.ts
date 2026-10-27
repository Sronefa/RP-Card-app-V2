/**
 * AI-prose patterns beyond single phrases: "not X, but Y", em-dash overuse, adjective triplets,
 * runs of sentences that start the same way, greetings that all open alike, and overused names.
 */
import type { CardDataV3 } from "../card";
import type { GroupId } from "../features/editor/fields";
import { worldMeta } from "./world";

export interface PatternHit {
  pattern: string;
  /** The words that show it. */
  match: string;
}

const PATTERNS: { name: string; test: (text: string) => string[] }[] = [
  {
    name: '"not X, but Y"',
    test: (t) => [
      ...[...t.matchAll(/\bnot (?:just |only |merely |simply )?[^.,;!?\n]{1,40}, but\b[^.,;!?\n]{0,40}/gi)].map((m) => m[0]),
      ...[...t.matchAll(/\b(?:it|this|that)(?:'s| is| was) not [^.!?\n]{1,40}[.;] (?:it|this|that)(?:'s| is| was) [^.!?\n]{1,40}/gi)].map((m) => m[0]),
    ],
  },
  {
    name: "em-dash overuse",
    test: (t) => {
      const dashes = (t.match(/—/g) ?? []).length;
      const words = t.split(/\s+/).filter(Boolean).length;
      return dashes >= 3 && dashes / Math.max(words, 1) > 0.015 ? [`${dashes} em dashes in ${words} words`] : [];
    },
  },
  {
    name: "adjective triplet",
    test: (t) => [...t.matchAll(/\b(?:a|an|the|his|her|their|its|my|your)\s+[a-z]+,\s+[a-z]+,?\s+and\s+[a-z]+\s+[a-z]+/gi)].map((m) => m[0]),
  },
  {
    name: "sentences that start the same way",
    test: (t) => {
      const firsts = t
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.replace(/^[*"“'(]+/, "").split(/\s+/)[0]?.toLowerCase() ?? "")
        .filter(Boolean);
      const out: string[] = [];
      for (let i = 2; i < firsts.length; i++)
        if (firsts[i] === firsts[i - 1] && firsts[i] === firsts[i - 2] && !out.includes(firsts[i]) && firsts[i] !== "{{char}}")
          out.push(`three sentences in a row start with "${firsts[i]}"`);
      return out;
    },
  },
];

/** Every pattern hit in a text. */
export function findPatterns(text: string): PatternHit[] {
  return PATTERNS.flatMap((p) => p.test(text).map((match) => ({ pattern: p.name, match: match.trim() })));
}

/** Names AI models reach for again and again. */
export const OVERUSED_NAMES = [
  "Elara",
  "Lyra",
  "Kael",
  "Seraphina",
  "Thorne",
  "Aria",
  "Zephyr",
  "Vex",
  "Elias",
  "Silas",
  "Kira",
  "Luna",
  "Nyx",
  "Aurelia",
  "Lysandra",
  "Evelyn",
  "Marcus",
  "Eldrin",
  "Elysia",
  "Caelan",
  "Riven",
  "Sable",
  "Orion",
  "Isolde",
  "Valeria",
  "Rowan",
  "Sarah Chen",
  "Dr. Chen",
];

/** Overused names in the card's name and its NPCs. */
export function overusedNames(data: CardDataV3): string[] {
  const names = [data.name, ...(data.character_book?.entries ?? []).map((e) => (worldMeta(e)?.kind === "npc" ? worldMeta(e)!.fields.name : ""))];
  const found = new Set<string>();
  for (const n of names)
    for (const o of OVERUSED_NAMES) if (n && new RegExp(`(^|\\s)${o.replace(".", "\\.")}(\\s|$)`, "i").test(n.trim())) found.add(o);
  return [...found];
}

/** Opening words shared by most greetings, e.g. three that start with "*She looks up". */
export function sameOpenings(data: CardDataV3): string | undefined {
  const greetings = [data.first_mes, ...data.alternate_greetings].filter((g) => g.trim());
  if (greetings.length < 3) return undefined;
  const open = (g: string) =>
    g
      .replace(/^[*"“'_\s]+/, "")
      .split(/\s+/)
      .slice(0, 2)
      .join(" ")
      .toLowerCase()
      .replace(/[.,!?;:*"”]+$/, "");
  const counts = new Map<string, number>();
  for (const g of greetings) counts.set(open(g), (counts.get(open(g)) ?? 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n >= 3 && n / greetings.length >= 0.5 ? top : undefined;
}

/** The card's prose fields, for the checker. */
export function patternSources(data: CardDataV3): { where: string; ref: string; group: GroupId; text: string }[] {
  return [
    { where: "Description", ref: "the description", group: "description" as GroupId, text: data.description },
    { where: "Personality", ref: "the personality", group: "personality" as GroupId, text: data.personality },
    { where: "Scenario", ref: "the scenario", group: "scenario" as GroupId, text: data.scenario },
    { where: "First message", ref: "the first message", group: "greetings" as GroupId, text: data.first_mes },
    ...data.alternate_greetings.map((text, i) => ({ where: `Alternate greeting ${i + 1}`, ref: `alternate greeting ${i + 1}`, group: "greetings" as GroupId, text })),
    { where: "Example dialogues", ref: "the example dialogues", group: "examples" as GroupId, text: data.mes_example },
  ].filter((s) => s.text.trim());
}
