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

export interface DiffLine {
  type: "same" | "add" | "del" | "gap";
  text: string;
}

/**
 * Line diff of two texts, with `context` unchanged lines kept around each change and the rest
 * folded into "gap" lines that say how many lines were skipped.
 */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  let lines: DiffLine[];
  if (a.length * b.length > MAX_CELLS) lines = [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  else {
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    lines = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        lines.push({ type: "same", text: a[i++] });
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) lines.push({ type: "del", text: a[i++] });
      else lines.push({ type: "add", text: b[j++] });
    }
    while (i < a.length) lines.push({ type: "del", text: a[i++] });
    while (j < b.length) lines.push({ type: "add", text: b[j++] });
  }
  const near = lines.map(() => false);
  lines.forEach((l, n) => {
    if (l.type === "same") return;
    for (let k = Math.max(0, n - context); k <= Math.min(lines.length - 1, n + context); k++) near[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, n) => {
    if (near[n]) {
      if (skipped) out.push({ type: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ type: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  return out;
}
