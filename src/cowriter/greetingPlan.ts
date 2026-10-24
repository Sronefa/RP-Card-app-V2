/**
 * Greeting planner: which mood, place and relationship stage each greeting covers, and which
 * combinations no greeting covers yet. Kept in the app only; the card file doesn't change.
 */
import type { GreetingTag } from "../ai/interviewTools";
import type { CardDataV3 } from "../card";
import { getSetting, putSetting } from "../db/db";

export interface GreetingPlan {
  moods: string[];
  places: string[];
  stages: string[];
  /** Tags by greeting text, so reordering or editing other greetings keeps them. */
  tags: Record<string, GreetingTag>;
}

export const DEFAULT_PLAN: GreetingPlan = {
  moods: ["Calm", "Tense", "Playful", "Tender", "Grim"],
  places: [],
  stages: ["Strangers", "Acquaintances", "Allies", "Lovers", "Rivals"],
  tags: {},
};

const key = (cardId: string) => `greetingPlan:${cardId}`;

export async function loadPlan(cardId: string): Promise<GreetingPlan> {
  return { ...DEFAULT_PLAN, ...(await getSetting<GreetingPlan>(key(cardId))) };
}

export const savePlan = (cardId: string, plan: GreetingPlan) => putSetting(key(cardId), plan);

/** The first message, then the alternate greetings. */
export const allGreetings = (data: CardDataV3) => [data.first_mes, ...data.alternate_greetings].filter((g) => g.trim());

export const tagKey = (greeting: string) => greeting.trim();

export interface Placed {
  /** 0 is the first message; 1 on are alternate greetings. */
  number: number;
  text: string;
  tag?: GreetingTag;
}

export function placeGreetings(data: CardDataV3, plan: GreetingPlan): Placed[] {
  const out: Placed[] = [];
  [data.first_mes, ...data.alternate_greetings].forEach((text, number) => {
    if (text.trim()) out.push({ number, text, tag: plan.tags[tagKey(text)] });
  });
  return out;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Greetings in one cell of the mood × stage grid, optionally in one place. */
export function inCell(placed: Placed[], mood: string, stage: string, place?: string): Placed[] {
  return placed.filter(
    (p) => p.tag && same(p.tag.mood, mood) && same(p.tag.stage, stage) && (!place || same(p.tag.place, place)),
  );
}

/** Grid cells with no greeting, row by row. */
export function gaps(placed: Placed[], plan: GreetingPlan, place?: string) {
  return plan.moods.flatMap((mood) =>
    plan.stages.filter((stage) => inCell(placed, mood, stage, place).length === 0).map((stage) => ({ mood, stage, place })),
  );
}

/** Stores the sorter's tags and adds new places it named. */
export function applyTags(plan: GreetingPlan, greetings: string[], tags: Map<number, GreetingTag>): GreetingPlan {
  const next = { ...plan, tags: { ...plan.tags }, places: [...plan.places] };
  for (const [index, tag] of tags) {
    const text = greetings[index];
    if (!text) continue;
    next.tags[tagKey(text)] = tag;
    if (tag.place && !next.places.some((p) => same(p, tag.place))) next.places.push(tag.place);
  }
  // Drop tags of greetings that no longer exist.
  const live = new Set(greetings.map(tagKey));
  for (const k of Object.keys(next.tags)) if (!live.has(k)) delete next.tags[k];
  return next;
}
