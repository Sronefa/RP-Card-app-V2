/**
 * Variants: other versions of a drafted greeting, description or example dialogue, each taking a
 * different approach, to pick from or merge, with an optional ranking by a judge model.
 */
import { systemPrompt } from "../ai/prompts";
import type { Variant } from "../ai/records";
import type { ToolCall, ToolDef } from "../ai/types";
import type { CardRecord } from "../db/db";
import { complete, gatherContext, partsText } from "./engine";
import { STYLE_KEYS, textOf } from "./polish";

type Kind = "greeting" | "description" | "example";

/** The approaches for each kind of text, with what each one asks for. */
export const APPROACHES: Record<Kind, { name: string; ask: string }[]> = {
  greeting: [
    { name: "Quiet", ask: "a quiet opening: a small moment, mood and character first, the hook underneath" },
    { name: "Mid-action", ask: "open in the middle of something happening, with {{user}} already caught up in it" },
    { name: "Dialogue-led", ask: "open on the character speaking, and let the scene come through what they say" },
  ],
  example: [
    { name: "Quiet", ask: "a calm exchange that shows how the character talks when nothing is at stake" },
    { name: "Mid-action", ask: "an exchange under pressure that shows how the character acts and speaks in a crisis" },
    { name: "Dialogue-led", ask: "mostly the character's own lines, with little narration" },
  ],
  description: [
    { name: "Spare", ask: "plain and concrete: the fewest words that make the character playable" },
    { name: "Scene-led", ask: "show the character through what they do and what is around them" },
    { name: "Voice-led", ask: "let the character's own voice and attitude carry it" },
  ],
};

/** Which kind of text a call writes, when variants fit it. */
export function variantKind(call: ToolCall): Kind | undefined {
  if (!textOf(call)) return undefined;
  if (call.name === "add_greeting" || call.name === "update_greeting") return "greeting";
  if (call.name === "add_example_dialogue") return "example";
  if (call.name !== "set_field") return undefined;
  const field = String(call.input.field);
  return field === "first_mes" ? "greeting" : field === "mes_example" ? "example" : field === "description" ? "description" : undefined;
}

const VARIANTS_TOOL: ToolDef = {
  name: "variants",
  description: "Hand in the versions, one per approach, in the order asked.",
  parameters: {
    type: "object",
    properties: {
      versions: {
        type: "array",
        items: {
          type: "object",
          properties: { approach: { type: "string" }, text: { type: "string" } },
          required: ["approach", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["versions"],
    additionalProperties: false,
  },
};

/** The first draft and one version per approach. */
export async function writeVariants(record: CardRecord, call: ToolCall, signal?: AbortSignal): Promise<Variant[]> {
  const kind = variantKind(call)!;
  const text = textOf(call)!;
  const approaches = APPROACHES[kind];
  const parts = (await gatherContext(record)).filter((p) => [...STYLE_KEYS, "card"].includes(p.key));
  const result = await complete("rewrite", {
    system: systemPrompt("rewrite"),
    messages: [
      {
        role: "user",
        text: [
          partsText(parts),
          `Here is a draft ${kind === "example" ? "example dialogue" : kind}:\n<text>\n${text}\n</text>`,
          `Write ${approaches.length} other versions of it, each about as long, keeping its facts and situation but taking a different approach:\n${approaches.map((a) => `- ${a.name}: ${a.ask}`).join("\n")}`,
          "Hand them in with variants.",
        ].join("\n\n"),
      },
    ],
    tools: [VARIANTS_TOOL],
    signal,
  });
  const versions = result.toolCalls.find((c) => c.name === VARIANTS_TOOL.name)?.input.versions;
  const written = (Array.isArray(versions) ? versions : [])
    .filter((v): v is { approach: string; text: string } => typeof v?.text === "string" && !!v.text.trim())
    .map((v, i) => ({ approach: approaches[i]?.name ?? String(v.approach), text: v.text.trim() }));
  if (!written.length) throw new Error("The co-writer didn't hand back any versions. Try again.");
  return [{ approach: "First draft", text }, ...written];
}

const RANK_TOOL: ToolDef = {
  name: "rank",
  description: "Hand in the versions' numbers, best first, each with a short reason.",
  parameters: {
    type: "object",
    properties: {
      ranking: {
        type: "array",
        items: {
          type: "object",
          properties: { version: { type: "number" }, why: { type: "string" } },
          required: ["version", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["ranking"],
    additionalProperties: false,
  },
};

/** The variants with the judge's rank and reason on each it ranked. */
export async function rankVariants(variants: Variant[], signal?: AbortSignal): Promise<Variant[]> {
  const result = await complete("judge", {
    system: systemPrompt("judge"),
    messages: [
      {
        role: "user",
        text: `${variants.map((v, i) => `<version number="${i + 1}">\n${v.text}\n</version>`).join("\n\n")}\n\nRank these versions with rank.`,
      },
    ],
    tools: [RANK_TOOL],
    signal,
  });
  const ranking = result.toolCalls.find((c) => c.name === RANK_TOOL.name)?.input.ranking;
  const ranked = (Array.isArray(ranking) ? ranking : []).filter(
    (r): r is { version: number; why: string } => typeof r?.version === "number" && r.version >= 1 && r.version <= variants.length,
  );
  if (!ranked.length) throw new Error("The judge didn't rank them. Try again.");
  const out: Variant[] = variants.map((v) => ({ approach: v.approach, text: v.text }));
  ranked.forEach((r, i) => {
    out[r.version - 1] = { ...out[r.version - 1], rank: i + 1, why: typeof r.why === "string" ? r.why : "" };
  });
  return out;
}

/** The paragraphs of a text, for merging lines from several versions. */
export const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
