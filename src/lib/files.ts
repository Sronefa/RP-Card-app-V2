/**
 * Saving and opening files. In the Tauri app a native save dialog is used; in a browser,
 * a download. Opening uses a file input, which works in both.
 */
import { isTauri } from "@tauri-apps/api/core";

export interface SaveOptions {
  /** Shown in the save dialog's file type filter, e.g. "PNG card". */
  filterName: string;
  extensions: string[];
  mime: string;
}

/** Returns false when the user cancelled the save dialog. */
export async function saveFile(fileName: string, bytes: Uint8Array, options: SaveOptions): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({ defaultPath: fileName, filters: [{ name: options.filterName, extensions: options.extensions }] });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: options.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Opens the system file picker. Resolves with no files if the user cancels. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** File name made safe for Windows and Android. */
export function safeFileName(name: string, fallback = "card"): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "").trim().replace(/[. ]+$/, "");
  return cleaned || fallback;
}

/** Converts any browser-decodable image to PNG bytes, scaled down to fit within maxSize. */
export async function toPng(file: Blob, maxSize = 1024): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not convert the image"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
