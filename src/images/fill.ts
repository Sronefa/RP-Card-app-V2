/**
 * The co-writer fills a visual sheet from what the card already says, and asks only about the gaps.
 */
import { systemPrompt } from "../ai/prompts";
import type { ToolCall, ToolDef } from "../ai/types";
import { complete } from "../cowriter/engine";
import { fieldsOf, gapsOf, OUTFIT_NAMES, type Outfit, type SheetKind, type Subject, type VisualSheet } from "./visual";

const str = (description: string) => ({ type: "string", description });

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false as const,
});

/** The fill tool for one kind of sheet; its fields are that kind's fields. */
export function fillTool(kind: SheetKind): ToolDef {
  return {
    name: "fill_visual_sheet",
    description: "Hand in the visual sheet: what the card says or clearly implies, and questions about the rest.",
    parameters: obj(
      {
        fields: obj(Object.fromEntries(fieldsOf(kind).map((f) => [f.key, str(f.hint)])), []),
        ...(kind === "character"
          ? {
              outfits: {
                type: "array",
                description: "Named outfits, default first",
                items: obj(
                  {
                    name: str(`One of ${OUTFIT_NAMES.join(", ")}, or another short name`),
                    garments: str("The pieces of clothing"),
                    colors: str("Their colours"),
                    materials: str("Fabrics and materials"),
                    accessories: str("Jewellery, bags, weapons worn"),
                    footwear: str("Shoes or boots"),
                  },
                  ["name"],
                ),
              },
            }
          : {}),
        signature: { type: "array", items: { type: "string" }, description: "Three or four traits that must be in every image" },
        questions: {
          type: "array",
          items: { type: "string" },
          description: "Short questions for the user about what the card leaves open, one per gap that matters",
        },
      },
      ["fields", "questions"],
    ),
  };
}

export interface SheetFill {
  fields: Record<string, string>;
  outfits: Outfit[];
  signature: string[];
  questions: string[];
}

export function readFill(call: ToolCall): SheetFill {
  const i = call.input;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const fields =
    i.fields && typeof i.fields === "object" && !Array.isArray(i.fields)
      ? Object.fromEntries(
          Object.entries(i.fields as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
        )
      : {};
  const outfits = Array.isArray(i.outfits)
    ? (i.outfits as Record<string, unknown>[]).filter((o) => o && typeof o.name === "string").map((o) => o as unknown as Outfit)
    : [];
  return {
    fields,
    outfits,
    signature: strings(i.signature),
    questions: strings(i.questions),
  };
}

export function fillRequest(
  subject: Subject,
  sheet: VisualSheet,
  context: string,
  answers: { question: string; answer: string }[],
): string {
  const fields = fieldsOf(sheet.kind);
  const locked = new Set(sheet.locked);
  return [
    `<subject name="${subject.name}" kind="${subject.kind}">\n${subject.text.trim() || "(nothing written yet)"}\n</subject>`,
    context.trim() && `<card>\n${context.trim()}\n</card>`,
    `Fields (key: what goes in it):\n${fields.map((f) => `- ${f.key}: ${f.hint}${locked.has(f.key) ? " (locked, leave it)" : ""}${sheet.fields[f.key] ? ` [now: ${sheet.fields[f.key]}]` : ""}`).join("\n")}`,
    sheet.kind === "character" &&
      `Outfits: name each and describe garments, colours, materials, accessories and footwear. Default is what they usually wear.${sheet.outfits.length ? ` Now: ${sheet.outfits.map((o) => o.name).join(", ")}.` : ""}`,
    `Signature: three or four visual traits that make ${subject.name} recognisable in every image.${locked.has("signature") ? " (locked, leave it)" : ""}`,
    answers.length && `The user answered:\n${answers.map((a) => `- ${a.question} ${a.answer}`).join("\n")}`,
    `Fill what the card says or clearly implies, in short concrete visual phrases an artist can draw. Don't invent what matters to the story; ask about it instead. Gaps now: ${
      gapsOf(sheet)
        .map((g) => g.key)
        .join(", ") || "none"
    }. Hand it in with fill_visual_sheet.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function fillSheet(
  subject: Subject,
  sheet: VisualSheet,
  context: string,
  answers: { question: string; answer: string }[],
  signal?: AbortSignal,
): Promise<SheetFill> {
  const result = await complete("image", {
    system: systemPrompt("image"),
    messages: [{ role: "user", text: fillRequest(subject, sheet, context, answers) }],
    tools: [fillTool(sheet.kind)],
    signal,
  });
  const call = result.toolCalls.find((c) => c.name === "fill_visual_sheet");
  if (!call) throw new Error("The co-writer didn't fill the sheet. Try again.");
  return readFill(call);
}
