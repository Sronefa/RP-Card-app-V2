import { useState } from "react";
import type { Variant } from "../../ai/records";
import { Button } from "../../components/ui";
import { paragraphsOf } from "../../cowriter/variants";

/**
 * A proposal's versions side by side: use one whole, or check paragraphs from several and use
 * those, in the order the versions are shown.
 */
export function Variants({
  variants,
  current,
  busy,
  onUse,
  onRank,
}: {
  variants: Variant[];
  /** The proposal's text as it is now. */
  current: string;
  busy: boolean;
  onUse: (text: string, label: string) => void;
  onRank: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const ranked = variants.some((v) => v.rank);
  const pieces = (i: number) => paragraphsOf(variants[i].text).map((text, j) => ({ key: `${i}:${j}`, text }));
  const merged = variants.flatMap((_, i) => pieces(i).filter((p) => checked.has(p.key)).map((p) => p.text)).join("\n\n");

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Variants">
      <div className="grid gap-2 md:grid-cols-2">
        {variants.map((v, i) => {
          const inUse = v.text === current;
          return (
            <div key={i} className={`flex flex-col gap-2 rounded-lg border p-2 ${inUse ? "border-accent" : "border-border"}`}>
              <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
                <span className="font-medium text-ink">
                  {v.rank ? `#${v.rank} · ` : ""}
                  {v.approach}
                </span>
                {inUse && <span className="text-accent">In the edit</span>}
              </div>
              {v.why && <p className="text-xs text-ink-muted italic">{v.why}</p>}
              {merging ? (
                <ul className="flex flex-col gap-1">
                  {pieces(i).map((p) => (
                    <li key={p.key}>
                      <label className="flex gap-2 text-sm whitespace-pre-wrap">
                        <input
                          type="checkbox"
                          className="mt-1"
                          aria-label={`${v.approach}, paragraph ${Number(p.key.split(":")[1]) + 1}`}
                          checked={checked.has(p.key)}
                          onChange={(e) => {
                            const next = new Set(checked);
                            if (e.target.checked) next.add(p.key);
                            else next.delete(p.key);
                            setChecked(next);
                          }}
                        />
                        <span>{p.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="max-h-60 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">{v.text}</p>
              )}
              {!merging && !inUse && (
                <Button className="self-end" aria-label={`Use the ${v.approach} version`} onClick={() => onUse(v.text, `the ${v.approach} version`)}>
                  Use this
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {merging ? (
          <>
            <Button variant="ghost" onClick={() => setMerging(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!merged}
              onClick={() => {
                onUse(merged, "lines merged from several versions");
                setMerging(false);
                setChecked(new Set());
              }}
            >
              Use the checked paragraphs
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMerging(true)}>
              Merge paragraphs
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onRank}>
              {ranked ? "Rank again" : "✦ Rank them"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
