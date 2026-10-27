/**
 * The shot-aware prompt writer: style lock + subject sheet + outfit + emotion or pose + place +
 * framing, as tags or sentences. Over the model's comfortable length, the least important parts go
 * first; the signature details and the LoRA trigger never do.
 */
import type { CardDataV3 } from "../card";
import type { CardKind } from "../db/db";
import { estimateTokens } from "../lib/tokens";
import type { Framing, Shot } from "./shots";
import { PROMPT_BUDGET, sheetOf, subjectsOf, type StyleLock, type Subject, type VisualSheet } from "./visual";

interface Part {
  label: string;
  text: string;
  /** Higher stays longer. Infinity is never trimmed. */
  weight: number;
}

const FRAMING: Record<Framing, { tags: string; prose: string; negative?: string }> = {
  portrait: {
    tags: "portrait, close-up, looking at viewer",
    prose: "A close-up portrait, looking at the viewer",
  },
  half: { tags: "cowboy shot, upper body", prose: "A half-body shot" },
  full: { tags: "full body, standing", prose: "A full-body shot, standing" },
  refsheet: {
    tags: "character reference sheet, multiple views, front view, side view, back view, plain white background",
    prose: "A character reference sheet showing the front, side and back on a plain white background",
  },
  landscape: {
    tags: "scenery, no humans, wide shot",
    prose: "A wide establishing shot with no people",
    negative: "people, characters",
  },
  scene: { tags: "cinematic composition", prose: "A cinematic scene" },
  icon: {
    tags: "game item icon, centered, simple background",
    prose: "A game item icon, centred on a simple background",
    negative: "text, clutter",
  },
  square: { tags: "", prose: "" },
};

const has = (s?: string): s is string => !!s && !!s.trim();

function subjectParts(sheet: VisualSheet, shot: Shot): Part[] {
  const f = sheet.fields;
  const p = (label: string, text: string | undefined, weight: number): Part[] =>
    has(text) ? [{ label, text: text.trim(), weight }] : [];
  if (sheet.kind === "place")
    return [
      ...p("architecture", f.architecture, 60),
      ...p("lighting", f.lighting, 58),
      ...p("place palette", f.palette, 40),
      ...p("props", f.props, 35),
    ];
  if (sheet.kind === "item")
    return [
      ...p("shape", f.shape, 70),
      ...p("materials", f.materials, 60),
      ...p("colours", f.colors, 55),
      ...p("details", f.details, 45),
    ];
  const outfit = sheet.outfits.find((o) => o.name.toLowerCase() === (shot.outfit ?? "default").toLowerCase()) ?? sheet.outfits[0];
  // A reference sheet shows the body as designed; scenes show the whole look.
  return [
    ...p("apparent age", f.age, 78),
    ...p("build", f.build, 70),
    ...p("hair", f.hair, 72),
    ...p("eyes", f.eyes, 65),
    ...p("other features", f.features, 68),
    ...p("face", f.face, 55),
    ...p("skin", f.skin, 50),
    ...p("marks", f.marks, 45),
    ...p("makeup", f.makeup, 25),
    ...p("posture", f.posture, 30),
    ...(outfit
      ? [
          ...p("outfit", outfit.garments, 75),
          ...p("outfit colours", outfit.colors, 60),
          ...p("accessories", outfit.accessories, 45),
          ...p("outfit materials", outfit.materials, 35),
          ...p("footwear", outfit.footwear, shot.framing === "full" || shot.framing === "refsheet" ? 50 : 20),
        ]
      : []),
  ];
}

export interface WrittenPrompt {
  positive: string;
  negative: string;
  tokens: number;
  budget: number;
  /** What was left out to fit, least important first. */
  trimmed: string[];
}

/** Writes the prompt for a shot. A prompt the user edited is returned as it is. */
export function writePrompt(data: CardDataV3, kind: CardKind, shot: Shot, lock: StyleLock): WrittenPrompt {
  const budget = PROMPT_BUDGET[lock.family].tokens;
  if (shot.prompt)
    return {
      ...shot.prompt,
      tokens: estimateTokens(shot.prompt.positive),
      budget,
      trimmed: [],
    };
  const subjects = subjectsOf(data, kind);
  const find = (key?: string): Subject | undefined => subjects.find((s) => s.key === key);
  const subject = find(shot.subject);
  const place = find(shot.place);
  const sheet = subject && sheetOf(data, subject);
  const placeSheet = place && sheetOf(data, place);
  const tags = lock.format === "tags";
  const framing = FRAMING[shot.framing];

  const parts: Part[] = [];
  const add = (label: string, text: string | undefined, weight: number) => {
    if (has(text)) parts.push({ label, text: text.trim(), weight });
  };
  add("quality tags", lock.fixedTags, 90);
  if (sheet?.lora?.trigger) add("LoRA trigger", sheet.lora.trigger, Infinity);
  add("framing", tags ? framing.tags : framing.prose, 95);
  if (subject && !tags) add("subject", subject.kind === "character" ? subject.name : `${subject.name}`, 96);
  for (const s of sheet?.signature ?? []) add("signature", s, Infinity);
  add("emotion", shot.emotion && (tags ? `${shot.emotion} expression` : `with a look of ${shot.emotion}`), 92);
  add("pose", shot.pose, 80);
  add("action", shot.action, 80);
  if (sheet) parts.push(...subjectParts(sheet, shot));
  if (place && placeSheet) {
    add("place", tags ? place.name.toLowerCase() : `in ${place.name}`, 62);
    for (const s of placeSheet.signature) add("place signature", s, 84);
    parts.push(...subjectParts(placeSheet, shot));
  }
  add("time of day", shot.time && (tags ? shot.time : `at ${shot.time}`), 88);
  add("weather", shot.weather && shot.weather !== "clear" ? shot.weather : undefined, 70);
  add("style", lock.style, 85);
  add("medium", lock.medium, 50);
  add("palette", lock.palette, 40);
  add("line weight", lock.lineWeight, 30);

  const join = (list: Part[]) =>
    tags
      ? list.map((p) => p.text.replace(/\.\s*$/, "")).join(", ")
      : list
          .map((p) => p.text.replace(/[.,;\s]+$/, ""))
          .filter(Boolean)
          .map((t) => t[0].toUpperCase() + t.slice(1))
          .join(". ") + ".";

  // Drop the lightest parts until it fits, keeping the original order.
  const kept = [...parts];
  const trimmed: string[] = [];
  const byWeight = [...parts].filter((p) => p.weight !== Infinity).sort((a, b) => a.weight - b.weight);
  while (estimateTokens(join(kept)) > budget && byWeight.length) {
    const drop = byWeight.shift()!;
    kept.splice(kept.indexOf(drop), 1);
    trimmed.push(drop.label);
  }
  const positive = join(kept);
  const negative = [lock.negative, framing.negative].filter(has).join(", ");
  return {
    positive,
    negative,
    tokens: estimateTokens(positive),
    budget,
    trimmed,
  };
}
