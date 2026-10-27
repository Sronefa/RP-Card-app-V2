/**
 * The visual bible: one sheet per character, NPC, place and item that every image prompt is
 * built from, and the project's style lock. Sheets live in the card (extensions.cardforge.visual),
 * so they travel with it; the style lock is a project setting.
 */
import type { CardDataV3, LorebookEntry } from "../card";
import type { CardKind } from "../db/db";
import { entryTitle } from "../editor/lorebook";
import { pageMeta } from "../editor/world";

export type SheetKind = "character" | "place" | "item";

export interface SheetField {
  key: string;
  label: string;
  hint: string;
}

const f = (key: string, label: string, hint: string): SheetField => ({
  key,
  label,
  hint,
});

export const SHEET_FIELDS: Record<SheetKind, { label: string; groups: { label: string; fields: SheetField[] }[] }> = {
  character: {
    label: "Character",
    groups: [
      {
        label: "Face and head",
        fields: [
          f("face", "Face", "face shape, nose, lips, brows"),
          f("eyes", "Eyes", "colour, shape, anything unusual"),
          f("skin", "Skin", "tone and texture, freckles, scars on the face"),
          f("makeup", "Makeup", "if they wear any"),
        ],
      },
      {
        label: "Hair",
        fields: [
          f("hair", "Hair", "colour, length, style, texture"),
          f("hairVariants", "Hair variants", "wet, messy, tied up, and when"),
        ],
      },
      {
        label: "Body",
        fields: [
          f("age", "Apparent age", "how old they look; adults only in sexual content"),
          f("build", "Height and build", "height, build, proportions"),
          f("posture", "Posture", "how they stand and move"),
          f("marks", "Marks", "tattoos, scars, piercings, birthmarks"),
          f("features", "Other features", "non-human features, prosthetics, cyberware"),
        ],
      },
    ],
  },
  place: {
    label: "Place",
    groups: [
      {
        label: "Look",
        fields: [
          f("architecture", "Architecture", "shapes, materials, scale"),
          f("palette", "Palette", "the main colours"),
          f("lighting", "Lighting", "light sources and mood"),
          f("props", "Props", "objects that make it recognisable"),
        ],
      },
      {
        label: "Variants",
        fields: [
          f("times", "Times of day", "how it changes from morning to night"),
          f("weather", "Weather", "the usual weather and how it looks"),
          f("seasons", "Seasons", "how it changes with the seasons"),
        ],
      },
    ],
  },
  item: {
    label: "Item",
    groups: [
      {
        label: "Look",
        fields: [
          f("shape", "Shape and size", "silhouette and scale"),
          f("materials", "Materials", "what it's made of, wear and finish"),
          f("colors", "Colours", "the main colours"),
          f("details", "Details", "engravings, glow, damage, anything distinctive"),
        ],
      },
    ],
  },
};

export const fieldsOf = (kind: SheetKind) => SHEET_FIELDS[kind].groups.flatMap((g) => g.fields);

export const OUTFIT_NAMES = ["default", "combat", "formal", "sleepwear", "casual", "swimwear", "uniform"];

export interface Outfit {
  name: string;
  garments: string;
  colors: string;
  materials: string;
  accessories: string;
  footwear: string;
  /** The economy item it links to, by name. */
  item?: string;
}

export const newOutfit = (name = "default"): Outfit => ({
  name,
  garments: "",
  colors: "",
  materials: "",
  accessories: "",
  footwear: "",
});

export interface VisualSheet {
  kind: SheetKind;
  fields: Record<string, string>;
  outfits: Outfit[];
  /** Three or four traits in every image, never trimmed from a prompt. */
  signature: string[];
  /** Field keys the co-writer leaves alone: a field key, "outfit:<name>", or "signature". */
  locked: string[];
  /** For local ComfyUI: a LoRA and its trigger word. */
  lora?: { name: string; trigger: string; weight?: number };
  /** The chosen base reference image, by asset uri. */
  reference?: string;
}

export const newSheet = (kind: SheetKind): VisualSheet => ({
  kind,
  fields: {},
  outfits: kind === "character" ? [newOutfit()] : [],
  signature: [],
  locked: [],
});

/** Someone or something to draw: the card's character, or a world page entry. */
export interface Subject {
  /** "card", or "entry:<id>". */
  key: string;
  kind: SheetKind;
  name: string;
  /** What the card says about it, for the co-writer to fill the sheet from. */
  text: string;
}

const EXT = "cardforge";

export function readSheets(data: CardDataV3): Record<string, VisualSheet> {
  const visual = (data.extensions[EXT] as { visual?: { sheets?: Record<string, VisualSheet> } } | undefined)?.visual;
  return visual?.sheets && typeof visual.sheets === "object" ? visual.sheets : {};
}

export function writeSheet(data: CardDataV3, key: string, sheet: VisualSheet | undefined): CardDataV3 {
  const ext = (data.extensions[EXT] as Record<string, unknown> | undefined) ?? {};
  const sheets = { ...readSheets(data) };
  if (sheet) sheets[key] = sheet;
  else delete sheets[key];
  const visual = { ...(ext.visual as object | undefined), sheets };
  return {
    ...data,
    extensions: { ...data.extensions, [EXT]: { ...ext, visual } },
  };
}

const entryKey = (e: LorebookEntry) => `entry:${String(e.id)}`;

/** The card's character (for a character card), then its NPCs, places and items. */
export function subjectsOf(data: CardDataV3, kind: CardKind): Subject[] {
  const out: Subject[] = [];
  if (kind === "character")
    out.push({
      key: "card",
      kind: "character",
      name: data.name || "The character",
      text: [data.description, data.personality].filter((t) => t.trim()).join("\n\n"),
    });
  for (const e of data.character_book?.entries ?? []) {
    const meta = pageMeta(e);
    const sheetKind: SheetKind | undefined =
      meta?.kind === "npc" ? "character" : meta?.kind === "location" ? "place" : meta?.kind === "item" ? "item" : undefined;
    if (!meta || !sheetKind) continue;
    out.push({
      key: entryKey(e),
      kind: sheetKind,
      name: meta.fields.name?.trim() || entryTitle(e),
      text: e.content,
    });
  }
  return out;
}

export const sheetOf = (data: CardDataV3, subject: Subject): VisualSheet =>
  readSheets(data)[subject.key] ?? newSheet(subject.kind);

/**
 * Merges what the co-writer wrote into a sheet. Locked fields, outfits and the signature keep the
 * user's version; empty answers never wipe a filled field.
 */
export function mergeSheet(
  sheet: VisualSheet,
  update: {
    fields?: Record<string, string>;
    outfits?: Outfit[];
    signature?: string[];
  },
): VisualSheet {
  const locked = new Set(sheet.locked);
  const known = new Set(fieldsOf(sheet.kind).map((x) => x.key));
  const fields = { ...sheet.fields };
  for (const [k, v] of Object.entries(update.fields ?? {}))
    if (known.has(k) && !locked.has(k) && typeof v === "string" && v.trim()) fields[k] = v.trim();
  let outfits = sheet.outfits;
  for (const o of update.outfits ?? []) {
    const name = o.name?.trim().toLowerCase();
    if (!name || locked.has(`outfit:${name}`)) continue;
    const clean = {
      ...newOutfit(name),
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")),
      name,
    };
    outfits = outfits.some((x) => x.name.toLowerCase() === name)
      ? outfits.map((x) =>
          x.name.toLowerCase() === name
            ? {
                ...x,
                ...Object.fromEntries(Object.entries(clean).filter(([, v]) => v)),
              }
            : x,
        )
      : [...outfits, clean];
  }
  const signature =
    update.signature?.length && !locked.has("signature")
      ? update.signature
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 4)
      : sheet.signature;
  return { ...sheet, fields, outfits, signature };
}

/** The empty, unlocked fields: what the co-writer still has to ask about. */
export const gapsOf = (sheet: VisualSheet) => fieldsOf(sheet.kind).filter((x) => !sheet.fields[x.key]?.trim());

/** The project's art direction, applied to every prompt. Saved image styles become these. */
export interface StyleLock {
  /** The saved image style it came from, if any. */
  styleId?: string;
  format: "tags" | "prose";
  style: string;
  medium: string;
  palette: string;
  lineWeight: string;
  /** Always at the front of the prompt, like quality tags. */
  fixedTags: string;
  negative: string;
  /** The image model family, for the prompt length it handles well. */
  family: ModelFamily;
}

export type ModelFamily = "sd" | "sdxl" | "flux" | "dalle" | "other";

/** A comfortable prompt length per family, in tokens. CLIP models read 75 per chunk. */
export const PROMPT_BUDGET: Record<ModelFamily, { label: string; tokens: number }> = {
  sd: { label: "Stable Diffusion 1.5", tokens: 75 },
  sdxl: { label: "SDXL, Pony, Illustrious", tokens: 150 },
  flux: { label: "Flux", tokens: 250 },
  dalle: { label: "GPT Image, DALL-E, Imagen", tokens: 400 },
  other: { label: "Other", tokens: 200 },
};

export const newStyleLock = (): StyleLock => ({
  format: "tags",
  style: "",
  medium: "",
  palette: "",
  lineWeight: "",
  fixedTags: "",
  negative: "",
  family: "sdxl",
});

/** A saved image style as a style lock. */
export function lockFromStyle(style: {
  id: string;
  format: "tags" | "prose";
  style: string;
  prefix: string;
  negative: string;
}): StyleLock {
  return {
    ...newStyleLock(),
    styleId: style.id,
    format: style.format,
    style: style.style,
    fixedTags: style.prefix,
    negative: style.negative,
    family: style.format === "tags" ? "sdxl" : "flux",
  };
}
