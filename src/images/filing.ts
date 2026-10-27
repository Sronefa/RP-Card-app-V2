/**
 * Picked images become card assets: resized and converted to WebP, typed so exports put them where
 * SillyTavern looks (emotions as expression sprites, backgrounds as the card's backgrounds, the rest
 * under /user/images/<card>/), and tagged with subject, kind and variant.
 */
import { assetPath, embeddedUri, type CardAsset, type CardDataV3 } from "../card";
import type { Candidate, Shot } from "./shots";

export type AssetKind = "portrait" | "emotion" | "outfit" | "background" | "scene" | "icon" | "ui";
export const ASSET_KINDS: Record<AssetKind, string> = {
  portrait: "Portrait",
  emotion: "Emotion",
  outfit: "Outfit",
  background: "Background",
  scene: "Scene",
  icon: "Icon",
  ui: "UI",
};

export interface AssetTag {
  /** The visual sheet's key: "card" or "entry:<id>". */
  subject?: string;
  kind: AssetKind;
  /** The emotion, outfit, time of day or other variant. */
  variant?: string;
}

const EXT = "cardforge";

export function readAssetTags(data: CardDataV3): Record<string, AssetTag> {
  const tags = (data.extensions[EXT] as { assetTags?: Record<string, AssetTag> } | undefined)?.assetTags;
  return tags && typeof tags === "object" ? tags : {};
}

export function writeAssetTag(data: CardDataV3, uri: string, tag: AssetTag | undefined): CardDataV3 {
  const ext = (data.extensions[EXT] as Record<string, unknown> | undefined) ?? {};
  const assetTags = { ...readAssetTags(data) };
  if (tag) assetTags[uri] = tag;
  else delete assetTags[uri];
  return { ...data, extensions: { ...data.extensions, [EXT]: { ...ext, assetTags } } };
}

/** The tag a shot's image gets. */
export function tagOf(shot: Shot): AssetTag {
  const kind: AssetKind =
    shot.kind === "emotion"
      ? "emotion"
      : shot.kind === "outfit"
        ? "outfit"
        : shot.kind === "background"
          ? "background"
          : shot.kind === "icon"
            ? "icon"
            : shot.kind === "scene" || shot.kind === "cg" || shot.kind === "engine" || shot.kind === "custom"
              ? "scene"
              : "portrait";
  const variant = shot.variant ?? shot.emotion ?? (shot.kind === "outfit" ? shot.outfit : undefined) ?? (shot.time ? [shot.time, shot.weather !== "clear" && shot.weather].filter(Boolean).join(" ") : undefined);
  return { ...((shot.subject ?? shot.place) ? { subject: shot.subject ?? shot.place } : {}), kind, ...(variant ? { variant } : {}) };
}

/** The card asset type, which decides where an export puts the file. */
export const assetTypeOf = (shot: Shot) => (shot.kind === "emotion" ? "emotion" : shot.kind === "background" ? "background" : "other");

/** Lower case with underscores, the way SillyTavern names gallery files on import, so the engine finds them. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "image";

/** The longest side for each kind: sprites stay sharp, icons stay small. */
const MAX_SIDE: Record<string, number> = { emotion: 1216, background: 1920, icon: 256, other: 1536 };

/** Resizes and converts to WebP where the browser can; otherwise the image stays as it is. */
export async function toWebp(bytes: Uint8Array, mime: string, maxSide: number): Promise<{ bytes: Uint8Array; ext: string }> {
  const keep = { bytes, ext: mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png" };
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return keep;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return keep;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob || blob.type !== "image/webp") return keep;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: "webp" };
  } catch {
    return keep;
  }
}

/** The asset a picked candidate becomes, with its file. Emotions are named by their label, as SillyTavern expects. */
export async function fileCandidate(
  data: CardDataV3,
  files: Record<string, Uint8Array>,
  shot: Shot,
  candidate: Candidate,
): Promise<{ data: CardDataV3; files: Record<string, Uint8Array>; asset: CardAsset }> {
  const type = assetTypeOf(shot);
  const converted = await toWebp(candidate.bytes, candidate.mime, MAX_SIDE[type] ?? MAX_SIDE.other);
  const assets = data.assets ?? [];
  const name =
    shot.kind === "emotion" && shot.emotion
      ? shot.emotion
      : type === "background" && !assets.some((a) => a.type === "background" && a.name === "main")
        ? "main"
        : slug(shot.label);
  // A new pick for the same emotion replaces the old sprite.
  const replaced = shot.kind === "emotion" ? assets.find((a) => a.type === "emotion" && a.name === name) : undefined;
  const base = { type, name, ext: converted.ext, uri: "" };
  const path = assetPath(base, new Set(Object.keys(files)));
  const asset: CardAsset = { ...base, uri: embeddedUri(path) };
  let next: CardDataV3 = { ...data, assets: [...assets.filter((a) => a !== replaced), asset] };
  if (replaced) next = writeAssetTag(next, replaced.uri, undefined);
  next = writeAssetTag(next, asset.uri, tagOf(shot));
  return { data: next, files: { [path]: converted.bytes }, asset };
}
