export interface DiffPart {
  type: "same" | "add" | "del";
  text: string;
}

/** Above this many word pairs, the diff shows a plain before/after instead. */
const MAX_CELLS = 4_000_000;

/** Word-level diff of two texts (longest common subsequence), with whitespace kept. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > MAX_CELLS) return merge([...(before ? [{ type: "del" as const, text: before }] : []), ...(after ? [{ type: "add" as const, text: after }] : [])]);
  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ type: "same", text: a[i++] });
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) parts.push({ type: "del", text: a[i++] });
    else parts.push({ type: "add", text: b[j++] });
  }
  while (i < a.length) parts.push({ type: "del", text: a[i++] });
  while (j < b.length) parts.push({ type: "add", text: b[j++] });
  return merge(parts);
}

function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.type === p.type) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}
