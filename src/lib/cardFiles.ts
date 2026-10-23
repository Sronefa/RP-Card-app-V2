/** Import and export of card records through files. */
import { exportCharx, exportJson, exportPng, importCard, mainIcon, embeddedPath, type CardPackage } from "../card";
import type { CardKind, CardRecord } from "../db/db";
import { safeFileName, saveFile } from "./files";

export type ExportFormat = "png" | "charx" | "json";

export const CARD_FILE_ACCEPT = ".png,.charx,.json,.jpg,.jpeg,image/png,application/json";

const FORMATS = {
  png: { ext: "png", mime: "image/png", filterName: "PNG card" },
  charx: { ext: "charx", mime: "application/zip", filterName: "CHARX card" },
  json: { ext: "json", mime: "application/json", filterName: "JSON card" },
} as const;

/** CardForge notes the card type in its own extension so it survives export and re-import. */
function withKind(record: CardRecord): CardPackage {
  const card = structuredClone(record.card);
  const own = (card.data.extensions.cardforge as Record<string, unknown> | undefined) ?? {};
  card.data.extensions = { ...card.data.extensions, cardforge: { ...own, kind: record.kind } };
  return { card, files: record.files, image: record.image };
}

export function kindOf(pkg: CardPackage): CardKind {
  const own = pkg.card.data.extensions.cardforge as { kind?: unknown } | undefined;
  return own?.kind === "world" ? "world" : "character";
}

/** Exports a card and saves it. Returns warnings, or undefined if the user cancelled. */
export async function exportRecord(record: CardRecord, format: ExportFormat): Promise<string[] | undefined> {
  const pkg = withKind(record);
  const result = format === "png" ? exportPng(pkg) : format === "charx" ? exportCharx(pkg) : exportJson(pkg);
  const f = FORMATS[format];
  const saved = await saveFile(`${safeFileName(record.card.data.name)}.${f.ext}`, result.bytes, {
    filterName: f.filterName,
    extensions: [f.ext],
    mime: f.mime,
  });
  return saved ? result.warnings : undefined;
}

export { importCard };

/** The image shown for a card: its default image, else its main icon if embedded. */
export function cardImage(pkg: CardPackage): Uint8Array | undefined {
  if (pkg.image) return pkg.image;
  const icon = mainIcon(pkg.card.data.assets);
  const path = icon && embeddedPath(icon.uri);
  return path ? pkg.files[path] : undefined;
}
