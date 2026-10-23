/**
 * Rough token estimate (about 4 characters per token for English prose).
 * Good enough for a live hint; the card checker will use a real tokenizer.
 */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 4) : 0;
}
