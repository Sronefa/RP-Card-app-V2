/**
 * Card import and export: PNG (ccv3 + chara chunks), CHARX (zip) and JSON.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { assetPath, embeddedPath, embeddedUri, mainIcon } from "./assets";
import { base64Decode, base64Encode, startsWith, utf8Decode, utf8Encode } from "./bytes";
import { detectSpec, parseCardJson, toV2, toV3 } from "./normalize";
import { isPng, readChunks, readTextChunks, replaceTextChunks, solidPng } from "./png";
import type { CardAsset, CardPackage, ImportResult } from "./types";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_ASSET_PREFIX = "chara-ext-asset_:";
const PNG_ASSET_URI = "__asset:";

const isCardChunk = (keyword: string) =>
  keyword === "chara" || keyword === "ccv3" || keyword.startsWith(PNG_ASSET_PREFIX);

/** Reads a card from file bytes, detecting PNG, CHARX (also appended to a JPEG) or JSON. */
export function importCard(bytes: Uint8Array): ImportResult {
  if (isPng(bytes)) return importPng(bytes);
  if (startsWith(bytes, ZIP_SIGNATURE)) return importCharx(bytes, "charx");
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    const zipStart = findBytes(bytes, ZIP_SIGNATURE);
    if (zipStart < 0) throw new Error("This JPEG has no card data in it");
    return importCharx(bytes.subarray(zipStart), "jpeg-charx");
  }
  return importJson(utf8Decode(bytes));
}

export function importJson(text: string): ImportResult {
  const json = parseCardJson(text);
  const warnings: string[] = [];
  const sourceSpec = detectSpec(json);
  const card = toV3(json, warnings);
  for (const a of card.data.assets ?? []) {
    if (embeddedPath(a.uri) || a.uri.startsWith(PNG_ASSET_URI)) {
      warnings.push(`Asset "${a.name}" points to a file that a JSON card can't contain`);
    }
  }
  return { card, files: {}, format: "json", sourceSpec, warnings };
}

export function importPng(bytes: Uint8Array): ImportResult {
  const chunks = readChunks(bytes);
  const texts = readTextChunks(chunks);
  const ccv3 = texts.find((t) => t.keyword === "ccv3");
  const chara = texts.find((t) => t.keyword === "chara");
  const source = ccv3 ?? chara;
  if (!source) throw new Error("This PNG has no character card data in it");

  const warnings: string[] = [];
  let json: unknown;
  try {
    json = parseCardJson(utf8Decode(base64Decode(source.text)));
  } catch (e) {
    // A broken ccv3 chunk can still have a usable V2 chunk next to it.
    if (source === ccv3 && chara) {
      warnings.push("The V3 data was unreadable, so the V2 data was used");
      json = parseCardJson(utf8Decode(base64Decode(chara.text)));
    } else {
      throw e;
    }
  }
  const sourceSpec = detectSpec(json);
  const card = toV3(json, warnings);

  const assetChunks = new Map(
    texts.filter((t) => t.keyword.startsWith(PNG_ASSET_PREFIX)).map((t) => [t.keyword.slice(PNG_ASSET_PREFIX.length), t.text]),
  );
  const files: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  if (card.data.assets) {
    card.data.assets = card.data.assets.flatMap((a): CardAsset[] => {
      if (!a.uri.startsWith(PNG_ASSET_URI)) return [a];
      const data = assetChunks.get(a.uri.slice(PNG_ASSET_URI.length));
      if (data === undefined) {
        warnings.push(`Asset "${a.name}" is missing from the PNG and was dropped`);
        return [];
      }
      const path = assetPath(a, taken);
      files[path] = base64Decode(data);
      return [{ ...a, uri: embeddedUri(path) }];
    });
  }

  const image = replaceTextChunks(bytes, isCardChunk, []);
  return { card, files, image, format: "png", sourceSpec, warnings };
}

export function importCharx(bytes: Uint8Array, format: "charx" | "jpeg-charx" = "charx"): ImportResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("The CHARX file is not a valid zip archive");
  }
  const cardJson = entries["card.json"];
  if (!cardJson) throw new Error("The CHARX file has no card.json");

  const warnings: string[] = [];
  const json = parseCardJson(utf8Decode(cardJson));
  const sourceSpec = detectSpec(json);
  const card = toV3(json, warnings);

  const files: Record<string, Uint8Array> = {};
  if (card.data.assets) {
    card.data.assets = card.data.assets.filter((a) => {
      const path = embeddedPath(a.uri);
      if (path === undefined) return true;
      const data = entries[path];
      if (!data) {
        warnings.push(`Asset "${a.name}" is missing from the CHARX file and was dropped`);
        return false;
      }
      files[path] = data;
      a.uri = embeddedUri(path);
      return true;
    });
  }
  return { card, files, format, sourceSpec, warnings };
}

export interface ExportResult {
  bytes: Uint8Array;
  warnings: string[];
}

/**
 * PNG with the V3 card in a `ccv3` chunk and a V2 copy in `chara`.
 * The image is the package's default image, else the main icon if it is a PNG, else a plain placeholder.
 */
export function exportPng(pkg: CardPackage): ExportResult {
  const warnings: string[] = [];
  const card = structuredClone(pkg.card);
  const assets = card.data.assets;
  const icon = mainIcon(assets);

  let image = pkg.image;
  const iconPath = icon && embeddedPath(icon.uri);
  if (!image && icon && iconPath && pkg.files[iconPath] && isPng(pkg.files[iconPath])) {
    // The main icon becomes the PNG itself, so it isn't stored twice.
    image = pkg.files[iconPath];
    icon.uri = "ccdefault:";
  }
  if (!image) {
    warnings.push("The card has no PNG image, so a plain placeholder image was used");
    image = solidPng(400, 600, [0x1d, 0x1a, 0x26]);
  }

  const assetTexts: { keyword: string; text: string }[] = [];
  if (assets) {
    card.data.assets = assets.flatMap((a): CardAsset[] => {
      const path = embeddedPath(a.uri);
      if (path === undefined) return [a];
      const data = pkg.files[path];
      if (!data) {
        warnings.push(`Asset "${a.name}" has no file and was left out`);
        return [];
      }
      assetTexts.push({ keyword: PNG_ASSET_PREFIX + path, text: base64Encode(data) });
      return [{ ...a, uri: PNG_ASSET_URI + path }];
    });
  }

  const bytes = replaceTextChunks(image, isCardChunk, [
    { keyword: "chara", text: encodeJson(toV2(card)) },
    { keyword: "ccv3", text: encodeJson(card) },
    ...assetTexts,
  ]);
  return { bytes, warnings };
}

/** CHARX zip: `card.json` plus every embedded asset at its package path. */
export function exportCharx(pkg: CardPackage): ExportResult {
  const warnings: string[] = [];
  const card = structuredClone(pkg.card);
  const zip: Zippable = {};
  const taken = new Set(Object.keys(pkg.files));

  if (pkg.image) {
    // CHARX has no default image, so ccdefault: icons point at a stored copy of it.
    const defaults = (card.data.assets ?? []).filter((a) => a.uri === "ccdefault:");
    if (defaults.length > 0 || !card.data.assets) {
      const path = assetPath({ type: "icon", name: "main", ext: "png" }, taken);
      zip[path] = pkg.image;
      if (!card.data.assets) card.data.assets = [{ type: "icon", uri: embeddedUri(path), name: "main", ext: "png" }];
      for (const a of defaults) a.uri = embeddedUri(path);
    }
  }

  card.data.assets = card.data.assets?.filter((a) => {
    const path = embeddedPath(a.uri);
    if (path === undefined || zip[path]) return true;
    const data = pkg.files[path];
    if (!data) {
      warnings.push(`Asset "${a.name}" has no file and was left out`);
      return false;
    }
    zip[path] = data;
    return true;
  });

  zip["card.json"] = strToU8(JSON.stringify(card));
  return { bytes: zipSync(zip, { level: 6 }), warnings };
}

/** Plain V3 JSON. Embedded files can't travel in JSON, so those assets are left out. */
export function exportJson(pkg: CardPackage, pretty = true): ExportResult & { text: string } {
  const warnings: string[] = [];
  const card = structuredClone(pkg.card);
  card.data.assets = card.data.assets?.filter((a) => {
    if (embeddedPath(a.uri) === undefined) return true;
    warnings.push(`Asset "${a.name}" is a file and was left out of the JSON export; use PNG or CHARX to keep it`);
    return false;
  });
  const text = JSON.stringify(card, null, pretty ? 2 : undefined);
  return { text, bytes: utf8Encode(text), warnings };
}

const encodeJson = (value: unknown) => base64Encode(utf8Encode(JSON.stringify(value)));

function findBytes(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
