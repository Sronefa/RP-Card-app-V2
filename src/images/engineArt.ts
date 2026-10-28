/**
 * Art for the engine's screens: how a screen asks for an image, the shots the engineer asks for,
 * and the art slots the installed parts can fill.
 */
import type { CardDataV3 } from "../card";
import { applyEngine, readEngine, varPath } from "../engine/sheet";
import { cleanPortraits } from "../engine/theme";
import { effectiveConfig, modulesOf } from "../engine/modules/compile";
import { stageSettings } from "../engine/modules/stage";
import { newId } from "../lib/id";
import type { AssetKind } from "./filing";
import { assetManifest, type ManifestEntry } from "./manifest";
import type { Shot } from "./shots";
import { subjectsOf } from "./visual";

const q = (s: string) => JSON.stringify(s);

/** Rewrites the engine script so its asset manifest has the card's latest tagged images. */
export function withFreshArt(data: CardDataV3): CardDataV3 {
  const config = readEngine(data);
  return config ? applyEngine(data, config) : data;
}

/** The CF.assets call that finds an image. */
export function assetCall(e: Pick<ManifestEntry, "s" | "k" | "v">): string {
  switch (e.k) {
    case "portrait":
      return `CF.assets.portrait(${q(e.s)})`;
    case "emotion":
      return `CF.assets.portrait(${q(e.s)}, { emotion: ${q(e.v ?? "")} })`;
    case "outfit":
      return `CF.assets.portrait(${q(e.s)}, { outfit: ${q(e.v ?? "")} })`;
    case "background":
      return `CF.assets.background(${q(e.s)}${e.v ? `, ${q(e.v)}` : ""})`;
    case "icon":
      return `CF.assets.icon(${q(e.s)})`;
    default:
      return e.v ? `CF.assets.scene(${q(e.v)})` : `CF.assets.find({ kind: ${q(e.k)}${e.s ? `, subject: ${q(e.s)}` : ""} })`;
  }
}

/** A shot from the engineer's request_asset input. */
export function requestedShot(data: CardDataV3, input: Record<string, unknown>): Shot {
  const kind = String(input.kind ?? "scene") as AssetKind;
  const name = typeof input.subject === "string" ? input.subject.trim() : "";
  const variant = typeof input.variant === "string" ? input.variant.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const subject = subjectsOf(data, "character").find((s) => s.name.toLowerCase() === name.toLowerCase() || (s.key === "card" && data.name.toLowerCase() === name.toLowerCase()));
  const base = { id: newId(), action: description, ...(subject ? { subject: subject.key } : {}) };
  const label = (what: string) => [name, what].filter(Boolean).join(": ");
  switch (kind) {
    case "portrait":
      return { ...base, group: "avatars", kind: "avatar", label: label("portrait"), outfit: "default", framing: "portrait" };
    case "emotion":
      return { ...base, group: "emotions", kind: "emotion", label: label(variant || "neutral"), emotion: variant || "neutral", outfit: "default", framing: "half" };
    case "outfit":
      return { ...base, group: "character", kind: "outfit", label: label(variant || "outfit"), outfit: variant || "default", framing: "half" };
    case "background": {
      const { subject: place, ...rest } = base;
      return { ...rest, group: "backgrounds", kind: "background", label: [name, variant].filter(Boolean).join(", ") || "Background", ...(place ? { place } : {}), ...(variant ? { time: variant } : {}), weather: "clear", framing: "landscape" };
    }
    case "icon":
      return { ...base, group: "engine", kind: "icon", label: `Icon: ${name || description.slice(0, 30)}`, framing: "icon" };
    default:
      return { ...base, group: "engine", kind: "engine", label: variant ? `${variant[0].toUpperCase()}${variant.slice(1)}` : description.slice(0, 40), ...(variant ? { variant } : {}), framing: "scene" };
  }
}

/** A picture a part can show, and whether the card has it. */
export interface ArtSlot {
  key: string;
  label: string;
  /** Which part shows it. */
  part: string;
  filled: boolean;
  /** The tag a fitting image has, for the asset picker. */
  tag: { kind: AssetKind; subject?: string; variant?: string };
  /** The shot that makes it. */
  shot: () => Shot;
}

/** The art the card's parts can use: portraits for People and the phone, title, map and wallpaper art, the stage's backgrounds and moods. */
export function artSlots(data: CardDataV3): ArtSlot[] {
  const config = readEngine(data);
  if (!config) return [];
  const ids = new Set(modulesOf(config).filter((m) => m.enabled).map((m) => m.core ?? m.id));
  const manifest = assetManifest(data);
  const subjects = subjectsOf(data, "character");
  const has = (test: (e: ManifestEntry) => boolean) => manifest.some(test);
  const lower = (s: string) => s.toLowerCase();
  const out: ArtSlot[] = [];
  const add = (slot: Omit<ArtSlot, "shot">, input: Record<string, unknown>) => out.push({ ...slot, shot: () => requestedShot(data, input) });

  if (["people", "phone", "routes", "case", "title"].some((p) => ids.has(p)))
    for (const s of subjects.filter((x) => x.kind === "character"))
      add(
        {
          key: `portrait:${s.key}`,
          label: `${s.name}'s portrait`,
          part: ids.has("people") ? "People" : ids.has("phone") ? "Phone contacts" : "Cast",
          filled: has((e) => e.k === "portrait" && lower(e.s) === lower(s.name)),
          tag: { kind: "portrait", subject: s.key },
        },
        { kind: "portrait", subject: s.name, description: `A portrait of ${s.name}` },
      );
  const scene = (part: string, variant: string, label: string, description: string) =>
    add({ key: `scene:${variant}`, label, part, filled: has((e) => e.v === variant), tag: { kind: "scene", variant } }, { kind: "scene", variant, description });
  if (ids.has("title")) scene("Title screen", "title", "Title art", "Key art for the title screen");
  if (ids.has("map")) scene("Map", "map", "Map art", "An illustrated map of the setting");
  if (ids.has("phone")) scene("Phone", "wallpaper", "Phone wallpaper", "A vertical phone wallpaper");

  const stage = modulesOf(config).find((m) => m.core === "stage" && m.enabled);
  if (stage) {
    for (const place of subjects.filter((x) => x.kind === "place"))
      add(
        {
          key: `background:${place.key}`,
          label: `${place.name} background`,
          part: "Stage",
          filled: has((e) => e.k === "background" && lower(e.s) === lower(place.name)),
          tag: { kind: "background", subject: place.key },
        },
        { kind: "background", subject: place.name, description: `${place.name}, wide shot with no people` },
      );
    for (const member of stageSettings(stage.settings).cast)
      for (const mood of member.moods.length ? member.moods : ["neutral"]) {
        const subject = subjects.find((s) => lower(s.name) === lower(member.name));
        add(
          {
            key: `emotion:${member.name}:${mood}`,
            label: `${member.name}, ${mood}`,
            part: "Stage",
            filled: has((e) => e.k === "emotion" && lower(e.s) === lower(member.name) && e.v === mood),
            tag: { kind: "emotion", ...(subject ? { subject: subject.key } : {}), variant: mood },
          },
          { kind: "emotion", subject: member.name, variant: mood, description: `${member.name} looking ${mood}` },
        );
      }
  }
  // Expressive portraits: every emotion and outfit their values can name.
  const theme = config.theme;
  if (theme) {
    const vars = effectiveConfig(config).vars;
    const optionsAt = (path?: string) => {
      const v = path ? vars.find((x) => varPath(x).join(".").toLowerCase() === path.toLowerCase()) : undefined;
      return v && v.type === "choice" ? (v.options ?? []).map((o) => o.trim()).filter(Boolean) : [];
    };
    const keys = new Set(out.map((s) => s.key));
    for (const b of cleanPortraits(theme.portraits)) {
      const subject = subjects.find((s) => lower(s.name) === lower(b.name));
      const tagSubject = subject ? { subject: subject.key } : {};
      const uniq = (list: string[]) => list.filter((x, i) => list.findIndex((y) => lower(y) === lower(x)) === i);
      for (const emotion of uniq([...optionsAt(b.emotion), ...(b.emotions ?? []), ...(b.hurt ? [b.hurt.emotion] : [])])) {
        const key = `emotion:${b.name}:${emotion}`;
        if (keys.has(key)) continue;
        keys.add(key);
        add(
          {
            key,
            label: `${b.name}, ${emotion}`,
            part: "Expressive portraits",
            filled: has((e) => e.k === "emotion" && lower(e.s) === lower(b.name) && lower(e.v ?? "") === lower(emotion)),
            tag: { kind: "emotion", ...tagSubject, variant: emotion },
          },
          { kind: "emotion", subject: b.name, variant: emotion, description: `${b.name} looking ${emotion}` },
        );
      }
      for (const outfit of uniq([...optionsAt(b.outfit), ...(b.outfits ?? [])])) {
        const key = `outfit:${b.name}:${outfit}`;
        if (keys.has(key)) continue;
        keys.add(key);
        add(
          {
            key,
            label: `${b.name} in ${outfit}`,
            part: "Expressive portraits",
            filled: has((e) => e.k === "outfit" && lower(e.s) === lower(b.name) && lower(e.v ?? "") === lower(outfit)),
            tag: { kind: "outfit", ...tagSubject, variant: outfit },
          },
          { kind: "outfit", subject: b.name, variant: outfit, description: `${b.name} wearing ${outfit}` },
        );
      }
    }
  }
  return out;
}
