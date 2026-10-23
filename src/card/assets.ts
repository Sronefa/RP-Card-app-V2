import type { CardAsset } from "./types";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "opus"]);

/** `embeded` is the spelling the V3 spec uses; accept the correct spelling too. */
const EMBEDDED_PREFIXES = ["embeded://", "embedded://"];

export const DEFAULT_ICON: CardAsset = { type: "icon", uri: "ccdefault:", name: "main", ext: "png" };

/** Package path for an embedded asset, following the CHARX folder layout. */
export function assetPath(asset: Pick<CardAsset, "type" | "name" | "ext">, taken: Set<string> = new Set()): string {
  const ext = (asset.ext || "bin").toLowerCase();
  const category = IMAGE_EXTS.has(ext) ? "images" : AUDIO_EXTS.has(ext) ? "audio" : "other";
  const type = safe(asset.type) || "other";
  const base = safe(asset.name) || "asset";
  let path = `assets/${type}/${category}/${base}.${ext}`;
  for (let i = 2; taken.has(path); i++) path = `assets/${type}/${category}/${base}-${i}.${ext}`;
  taken.add(path);
  return path;
}

const safe = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");

/** Package path of an embedded URI, or undefined if the URI is not embedded. */
export function embeddedPath(uri: string): string | undefined {
  const prefix = EMBEDDED_PREFIXES.find((p) => uri.startsWith(p));
  return prefix ? uri.slice(prefix.length) : undefined;
}

export const embeddedUri = (path: string) => `embeded://${path}`;

/** The asset frontends use as the avatar: the icon named `main`, else the first icon. */
export function mainIcon(assets: CardAsset[] | undefined): CardAsset | undefined {
  const list = assets ?? [{ ...DEFAULT_ICON }];
  const icons = list.filter((a) => a.type === "icon");
  return icons.find((a) => a.name === "main") ?? icons[0];
}
