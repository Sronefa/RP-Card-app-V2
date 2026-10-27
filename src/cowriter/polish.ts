/**
 * The prose editor pass: line-level edits to drafted text, separate from the critic. It polishes a
 * field on demand, a proposal before it is accepted, every drafted edit when the project asks for
 * it, and rewrites overused phrases in proposals before the user sees them.
 */
import { systemPrompt } from "../ai/prompts";
import type { ToolCall, ToolDef } from "../ai/types";
import type { CardRecord } from "../db/db";
import { findPatterns } from "../editor/patterns";
import { slopInText } from "../editor/slop";
import { complete, gatherContext, partsText } from "./engine";

export const POLISH_TOOL: ToolDef = {
  name: "polish",
  description: "Hand in the edited text and what kinds of changes you made.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The whole text, edited" },
      changes: { type: "array", items: { type: "string" }, description: "Each kind of change, in a few words" },
    },
    required: ["text", "changes"],
    additionalProperties: false,
  },
};

export interface Polished {
  text: string;
  changes: string[];
}

/** The text a writing tool call carries, by tool and input key. Short fields (a name, a nickname) aren't polished. */
const TEXT_KEYS: Record<string, string> = {
  set_field: "text",
  add_greeting: "text",
  update_greeting: "text",
  add_example_dialogue: "text",
};
const SHORT_FIELDS = new Set(["name", "nickname", "creator", "character_version", "tags"]);

export function textOf(call: ToolCall): string | undefined {
  const key = TEXT_KEYS[call.name];
  if (!key || (call.name === "set_field" && SHORT_FIELDS.has(String(call.input.field)))) return undefined;
  const text = call.input[key];
  return typeof text === "string" && text.trim().length >= 40 ? text : undefined;
}

export const withText = (call: ToolCall, text: string): ToolCall => ({ ...call, input: { ...call.input, [TEXT_KEYS[call.name]]: text } });

/** A name for the text in the request, e.g. "the description" or "an alternate greeting". */
export function whereOf(call: ToolCall): string {
  if (call.name === "set_field") return `the ${String(call.input.field).replace(/_/g, " ")}`;
  if (call.name === "add_example_dialogue") return "an example dialogue";
  return "a greeting";
}

function polishRequest(text: string, where: string, focus?: string[]): string {
  return [
    `Edit ${where}${focus?.length ? ". Rewrite only the lines with these overused phrases and patterns, and leave every other line exactly as it is" : " line by line"}.`,
    focus?.length && `Fix: ${focus.map((f) => `"${f}"`).join(", ")}`,
    `<text>\n${text}\n</text>`,
    "Hand in the whole text with polish.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function readPolish(call: ToolCall | undefined, original: string, least = 0.5): Polished {
  const text = typeof call?.input.text === "string" ? call.input.text : "";
  if (!text.trim()) throw new Error("The editor didn't hand back the text. Try again.");
  // A reply that loses most of the text is a mistake, not an edit.
  if (text.trim().length < original.trim().length * least) throw new Error("The editor cut too much. Try again.");
  const changes = Array.isArray(call?.input.changes) ? call!.input.changes.filter((c): c is string => typeof c === "string") : [];
  return { text, changes };
}

/** The context parts a one-off rewrite of a text needs: how to write, not the whole card. */
export const STYLE_KEYS = ["settings", "notes", "style", "craft", "bible"];

/** Line edits for one text, with the project's prose settings, style and content in view. */
export async function polishText(record: CardRecord, text: string, where: string, signal?: AbortSignal, focus?: string[]): Promise<Polished> {
  const parts = (await gatherContext(record)).filter((p) => STYLE_KEYS.includes(p.key));
  const result = await complete("editor", {
    system: systemPrompt("editor"),
    messages: [{ role: "user", text: `${partsText(parts)}\n\n${polishRequest(text, where, focus)}` }],
    tools: [POLISH_TOOL],
    signal,
  });
  return readPolish(
    result.toolCalls.find((c) => c.name === POLISH_TOOL.name),
    text,
  );
}

/** Overused phrases and AI patterns in a text. */
export const slopOf = (text: string, phrases: string[]) => [...slopInText(text, phrases), ...findPatterns(text).map((h) => h.match)];

/**
 * Writing calls with their overused phrases rewritten, and what was fixed per call. A call the
 * editor can't fix is kept as it was.
 */
export async function cleanCalls(
  record: CardRecord,
  calls: ToolCall[],
  phrases: string[],
  signal?: AbortSignal,
): Promise<{ calls: ToolCall[]; fixed: Record<string, string[]> }> {
  const fixed: Record<string, string[]> = {};
  const out: ToolCall[] = [];
  for (const call of calls) {
    const text = textOf(call);
    const found = text ? slopOf(text, phrases) : [];
    if (!text || !found.length) {
      out.push(call);
      continue;
    }
    try {
      const polished = await polishText(record, text, whereOf(call), signal, found);
      const left = slopOf(polished.text, phrases);
      fixed[call.id] = found.filter((f) => !left.includes(f));
      out.push(withText(call, polished.text));
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      out.push(call);
    }
  }
  return { calls: out, fixed };
}

/** Every writing call polished in turn, for drafting when the project polishes automatically. */
export async function polishCalls(record: CardRecord, calls: ToolCall[], signal?: AbortSignal): Promise<ToolCall[]> {
  const out: ToolCall[] = [];
  for (const call of calls) {
    const text = textOf(call);
    if (!text) {
      out.push(call);
      continue;
    }
    try {
      out.push(withText(call, (await polishText(record, text, whereOf(call), signal)).text));
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      out.push(call);
    }
  }
  return out;
}
