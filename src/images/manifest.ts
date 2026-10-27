/**
 * The asset manifest the engine core gets: every tagged image with its subject's name, kind and
 * variant, so screens ask for art by meaning (`CF.assets.portrait("Mira", { emotion: "joy" })`)
 * instead of by file name.
 */
import { embeddedPath, type CardAsset, type CardDataV3 } from "../card";
import { stImagePath } from "../editor/mechanics";
import { pageMeta } from "../editor/world";
import { readAssetTags, type AssetKind } from "./filing";

export interface ManifestEntry {
  /** The subject's name, as screens know it ("Mira", "The Ferry"); empty for none. */
  s: string;
  k: AssetKind;
  /** The variant: an emotion, an outfit, a time of day, "title". */
  v?: string;
  /** The file's name, for the preview's overrides. */
  f: string;
  /** Where SillyTavern serves it after a CHARX import. */
  u: string;
}

/**
 * Where SillyTavern keeps an imported card's file. Gallery images follow its charx.js (checked);
 * expression sprites sit in the character's sprite folder and backgrounds in the card's own
 * background folder, as SillyTavern names them.
 */
export function servedPath(cardName: string, asset: CardAsset): string | undefined {
  if (!embeddedPath(asset.uri)) return undefined;
  if (asset.type === "emotion" || asset.type === "expression")
    return `/characters/${encodeURIComponent(cardName)}/${encodeURIComponent(asset.name)}.${asset.ext}`;
  if (asset.type === "background") return `/backgrounds/${encodeURIComponent(asset.name)}.${asset.ext}`;
  return stImagePath(cardName, asset);
}

/** The names subjects go by: the card's own name, and each world page's. */
export function subjectNames(data: CardDataV3): Record<string, string> {
  const names: Record<string, string> = { card: data.name };
  for (const e of data.character_book?.entries ?? []) {
    const name = pageMeta(e)?.fields.name?.trim();
    if (name) names[`entry:${String(e.id)}`] = name;
  }
  return names;
}

export function assetManifest(data: CardDataV3): ManifestEntry[] {
  const tags = readAssetTags(data);
  const names = subjectNames(data);
  return (data.assets ?? []).flatMap((a) => {
    const tag = tags[a.uri];
    const u = tag && servedPath(data.name, a);
    if (!tag || !u) return [];
    return [{ s: tag.subject ? (names[tag.subject] ?? "") : "", k: tag.kind, ...(tag.variant ? { v: tag.variant } : {}), f: `${a.name}.${a.ext}`, u }];
  });
}

/** The first tagged image that fits, as a file name for a part's settings ("mira.webp"). */
export function taggedFile(data: CardDataV3, test: (e: ManifestEntry) => boolean): string {
  const hit = assetManifest(data).find(test);
  return hit ? hit.f : "";
}
