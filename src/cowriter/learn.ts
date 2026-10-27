/**
 * Learning from the user: feedback chips that revise a proposal, reasons for a rejection, and hand
 * edits to accepted text. Each feeds personal style notes the co-writer reads in everything it writes.
 */
import { systemPrompt } from "../ai/prompts";
import type { ChatRecord, Proposal } from "../ai/records";
import { useAiSettings } from "../ai/settings";
import type { ToolDef } from "../ai/types";
import type { CardDataV3 } from "../card";
import type { CardRecord } from "../db/db";
import { complete, gatherContext, partsText } from "./engine";
import { POLISH_TOOL, readPolish, STYLE_KEYS, type Polished } from "./polish";

export interface Feedback {
  id: string;
  label: string;
  /** What the rewrite is asked to do. */
  ask: string;
  /** The style note it suggests once the user keeps asking for it. */
  note: string;
}

export const FEEDBACK: Feedback[] = [
  { id: "shorter", label: "Shorter", ask: "Make it shorter. Cut padding and keep the strongest lines.", note: "Keep drafts tight. Cut any line that doesn't earn its place." },
  { id: "longer", label: "Longer", ask: "Make it longer. Give it more room and more specific detail, without padding.", note: "Give drafts room: fuller scenes and more specific detail." },
  { id: "darker", label: "Darker", ask: "Make it darker in tone: higher stakes, sharper edges, less comfort.", note: "Lean darker in tone than the obvious choice." },
  { id: "warmer", label: "Warmer", ask: "Make it warmer: more tenderness, humor and human connection.", note: "Lean warmer: let tenderness and humor in." },
  { id: "dialogue", label: "More dialogue", ask: "Carry more of it through dialogue in the character's own voice.", note: "Carry scenes through dialogue more than narration." },
  { id: "purple", label: "Less purple", ask: "Make the prose plainer: fewer adjectives and metaphors, simpler words, no ornament.", note: "Write plain prose: few adjectives, few metaphors, no ornament." },
  { id: "grounded", label: "More grounded", ask: "Make it more grounded: concrete physical detail and plausible behavior over abstraction.", note: "Stay grounded: concrete detail and plausible behavior over abstraction." },
  { id: "voice", label: "More in voice", ask: "Bring it closer to the character's own voice: their words, rhythm and attitude.", note: "Stay close to the character's own voice in every field." },
];

export interface Reason {
  id: string;
  label: string;
  /** The feedback whose note it counts toward, or its own note. */
  counts?: string;
  note?: string;
}

export const REASONS: Reason[] = [
  { id: "long", label: "Too long", counts: "shorter" },
  { id: "short", label: "Too short", counts: "longer" },
  { id: "purple", label: "Too purple", counts: "purple" },
  { id: "voice", label: "Wrong voice", counts: "voice" },
  { id: "canon", label: "Contradicts the card", note: "Check the card, lore and story bible before adding a fact, and never contradict them." },
  { id: "asked", label: "Not what I asked" },
];

/** Times the same feedback is given before its note is offered. */
export const OFFER_AFTER = 3;

export const feedbackLabel = (id: string) => FEEDBACK.find((f) => f.id === id)?.label ?? id;
export const reasonLabel = (id: string) => REASONS.find((r) => r.id === id)?.label ?? id;

/** Counts feedback toward a style note: a chip's id, or a rejection reason's id. */
export async function countFeedback(id: string) {
  const reason = REASONS.find((r) => r.id === id);
  const key = reason ? (reason.counts ?? (reason.note ? reason.id : undefined)) : id;
  if (!key) return;
  const { settings, update } = useAiSettings.getState();
  const feedback = settings.feedback ?? { counts: {}, offered: [] };
  await update({ feedback: { ...feedback, counts: { ...feedback.counts, [key]: (feedback.counts[key] ?? 0) + 1 } } });
}

/** A style note the user's feedback keeps pointing at, not yet offered or saved. */
export function noteSuggestion(settings: { feedback?: { counts: Record<string, number>; offered: string[] }; styleNotes?: string[] }) {
  const { counts, offered } = settings.feedback ?? { counts: {}, offered: [] };
  for (const [key, n] of Object.entries(counts)) {
    if (n < OFFER_AFTER || offered.includes(key)) continue;
    const source = FEEDBACK.find((f) => f.id === key) ?? REASONS.find((r) => r.id === key);
    const note = source?.note;
    if (note && !(settings.styleNotes ?? []).includes(note)) return { key, label: "label" in source ? source.label : key, note, count: n };
  }
  return undefined;
}

/** Saves a style note, and marks a suggestion as offered. */
export async function saveNote(note: string, key?: string) {
  const { settings, update } = useAiSettings.getState();
  const notes = settings.styleNotes ?? [];
  const feedback = settings.feedback ?? { counts: {}, offered: [] };
  await update({
    ...(note.trim() && !notes.includes(note.trim()) ? { styleNotes: [...notes, note.trim()] } : {}),
    ...(key ? { feedback: { ...feedback, offered: [...feedback.offered, key] } } : {}),
  });
}

async function styleContext(record: CardRecord) {
  return partsText((await gatherContext(record)).filter((p) => STYLE_KEYS.includes(p.key)));
}

/** A text rewritten with the user's feedback. A request for shorter text may cut more. */
export async function reviseText(record: CardRecord, text: string, where: string, ids: string[], signal?: AbortSignal): Promise<Polished> {
  const asks = ids.map((id) => FEEDBACK.find((f) => f.id === id)!.ask);
  const result = await complete("rewrite", {
    system: systemPrompt("rewrite"),
    messages: [
      {
        role: "user",
        text: `${await styleContext(record)}\n\nRevise ${where}. ${asks.join(" ")}\n\n<text>\n${text}\n</text>\n\nHand in the whole text with polish.`,
      },
    ],
    tools: [POLISH_TOOL],
    signal,
  });
  return readPolish(
    result.toolCalls.find((c) => c.name === POLISH_TOOL.name),
    text,
    ids.includes("shorter") ? 0.2 : 0.5,
  );
}

/** Long text fields whose hand edits are worth learning from. */
const LEARN_FIELDS = new Set(["description", "personality", "scenario", "first_mes", "mes_example", "system_prompt", "post_history_instructions"]);

const words = (t: string): string[] => t.toLowerCase().match(/[\p{L}']+/gu) ?? [];

/**
 * Accepted edits the user has since changed by hand, newest first: the field still reads like the
 * co-writer's text (most of its words are kept) but at least a few words differ.
 */
export function handEdits(chat: ChatRecord, data: CardDataV3): { proposal: Proposal; field: string; before: string; after: string }[] {
  const out: { proposal: Proposal; field: string; before: string; after: string }[] = [];
  const seen = new Set<string>();
  for (const p of [...chat.proposals].reverse()) {
    if (p.call.name !== "set_field" || p.status !== "accepted") continue;
    const field = String(p.call.input.field);
    // Only the last accepted edit to a field says what the co-writer last wrote there.
    if (seen.has(field)) continue;
    seen.add(field);
    const before = typeof p.call.input.text === "string" ? p.call.input.text : "";
    const after = data[field as keyof CardDataV3];
    if (p.learned || !LEARN_FIELDS.has(field) || typeof after !== "string" || !after.trim() || after === before) continue;
    const a = words(before);
    const b = new Set(words(after));
    const kept = a.filter((w) => b.has(w)).length;
    const changed = a.length - kept + [...b].filter((w) => !a.includes(w)).length;
    if (a.length && kept / a.length >= 0.4 && changed >= 3) out.push({ proposal: p, field, before, after });
  }
  return out;
}

const NOTE_TOOL: ToolDef = {
  name: "style_note",
  description: "Hand in the style note, or an empty note when the change shows no preference.",
  parameters: {
    type: "object",
    properties: { note: { type: "string", description: "One short instruction, or empty" } },
    required: ["note"],
    additionalProperties: false,
  },
};

/** The preference a hand edit shows, as a style note, or "" when it was only a fact fix. */
export async function noteFromEdit(field: string, before: string, after: string, signal?: AbortSignal): Promise<string> {
  const result = await complete("rewrite", {
    system: systemPrompt("rewrite"),
    messages: [
      {
        role: "user",
        text: [
          `The co-writer wrote the ${field.replace(/_/g, " ")} below, and the user changed it by hand.`,
          `<written>\n${before}\n</written>`,
          `<changed_to>\n${after}\n</changed_to>`,
          'What writing preference does the change show? Hand in one short instruction the co-writer can follow in every future draft, such as "Use short sentences in greetings" or "Never describe eyes". If the change only fixes a fact or a name, hand in an empty note.',
        ].join("\n\n"),
      },
    ],
    tools: [NOTE_TOOL],
    signal,
  });
  const note = result.toolCalls.find((c) => c.name === NOTE_TOOL.name)?.input.note;
  return typeof note === "string" ? note.trim() : "";
}
