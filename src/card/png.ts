/**
 * Minimal PNG chunk reader/writer: enough to read and write the text chunks
 * that SillyTavern and other frontends use to embed cards.
 */
import { unzlibSync, zlibSync } from "fflate";
import { concatBytes, latin1Decode, latin1Encode, startsWith, utf8Decode } from "./bytes";

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export interface PngText {
  keyword: string;
  text: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return crc;
}

export const isPng = (bytes: Uint8Array) => startsWith(bytes, PNG_SIGNATURE);

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = latin1Decode(bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error(`PNG chunk ${type} is truncated`);
    chunks.push({ type, data: bytes.slice(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === "IEND") break;
  }
  if (chunks.at(-1)?.type !== "IEND") throw new Error("PNG file has no IEND chunk");
  return chunks;
}

export function writeChunks(chunks: PngChunk[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE)];
  for (const { type, data } of chunks) {
    const head = new Uint8Array(8);
    const view = new DataView(head.buffer);
    view.setUint32(0, data.length);
    const typeBytes = latin1Encode(type);
    head.set(typeBytes, 4);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, (crc32(data, crc32(typeBytes)) ^ 0xffffffff) >>> 0);
    parts.push(head, data, crc);
  }
  return concatBytes(parts);
}

/** Reads tEXt, zTXt and iTXt chunks. Unreadable chunks are skipped. */
export function readTextChunks(chunks: PngChunk[]): PngText[] {
  const texts: PngText[] = [];
  for (const { type, data } of chunks) {
    try {
      const nul = data.indexOf(0);
      if (nul < 0) continue;
      const keyword = latin1Decode(data.subarray(0, nul));
      if (type === "tEXt") {
        texts.push({ keyword, text: latin1Decode(data.subarray(nul + 1)) });
      } else if (type === "zTXt") {
        texts.push({ keyword, text: latin1Decode(unzlibSync(data.subarray(nul + 2))) });
      } else if (type === "iTXt") {
        const compressed = data[nul + 1] === 1;
        let p = nul + 3;
        p = data.indexOf(0, p) + 1; // language tag
        p = data.indexOf(0, p) + 1; // translated keyword
        if (p <= 0) continue;
        const body = data.subarray(p);
        texts.push({ keyword, text: utf8Decode(compressed ? unzlibSync(body) : body) });
      }
    } catch {
      // A broken text chunk shouldn't stop the rest of the image from loading.
    }
  }
  return texts;
}

export function textChunk(keyword: string, text: string): PngChunk {
  return { type: "tEXt", data: concatBytes([latin1Encode(keyword), new Uint8Array([0]), latin1Encode(text)]) };
}

/** Keyword of a text chunk, or undefined for other chunk types. */
export function chunkKeyword(chunk: PngChunk): string | undefined {
  if (chunk.type !== "tEXt" && chunk.type !== "zTXt" && chunk.type !== "iTXt") return undefined;
  const nul = chunk.data.indexOf(0);
  return nul < 0 ? undefined : latin1Decode(chunk.data.subarray(0, nul));
}

/**
 * Returns the image with text chunks matching `drop` removed and `add` inserted before IEND,
 * which is where SillyTavern places them.
 */
export function replaceTextChunks(
  bytes: Uint8Array,
  drop: (keyword: string) => boolean,
  add: PngText[],
): Uint8Array {
  const kept = readChunks(bytes).filter((c) => {
    const keyword = chunkKeyword(c);
    return keyword === undefined || !drop(keyword);
  });
  const iend = kept.pop()!;
  return writeChunks([...kept, ...add.map((t) => textChunk(t.keyword, t.text)), iend]);
}

/** Encodes a solid-colour RGB PNG. Used as the image when a card has no PNG avatar. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, no filter, no interlace
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  return writeChunks([
    { type: "IHDR", data: ihdr },
    { type: "IDAT", data: zlibSync(raw) },
    { type: "IEND", data: new Uint8Array() },
  ]);
}
