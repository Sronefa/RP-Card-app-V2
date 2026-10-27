/**
 * Rough token estimate (about 4 characters per token for English prose).
 * Good enough for a live hint; the card checker will use a real tokenizer.
 */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}

/** Width and height of a base64 PNG, from its header. */
export function pngSize(base64: string): { width: number; height: number } | undefined {
  try {
    const head = atob(base64.slice(0, 44));
    if (!head.startsWith("\x89PNG")) return undefined;
    const u32 = (at: number) => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
    return { width: u32(16), height: u32(20) };
  } catch {
    return undefined;
  }
}

/** Rough tokens an image costs a vision model: about one per 750 pixels, at most ~1,600 after downscaling. */
export function imageTokens(base64: string): number {
  const size = pngSize(base64);
  return size ? Math.min(1600, Math.ceil((size.width * size.height) / 750)) : 1600;
}
