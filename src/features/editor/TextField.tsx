import { useState } from "react";
import { AutoTextarea } from "../../components/ui";
import { askCowriter } from "../../cowriter/ask";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import type { FieldInfo } from "./fields";

export function TextField({ info }: { info: FieldInfo }) {
  const value = useEditor((s) => s.record!.card.data[info.field]);
  const kind = useEditor((s) => s.record!.kind);
  const setField = useEditor((s) => s.setField);
  const id = `field-${info.field}`;
  const [asking, setAsking] = useState(false);
  const name = info.label.toLowerCase();
  const quick = value?.trim()
    ? [
        ["Rewrite", `Rewrite the ${name}: same facts, better writing.`],
        ["Shorter", `Make the ${name} shorter without losing anything important.`],
        ["More vivid", `Make the ${name} more vivid and specific.`],
      ]
    : [["Write it", `Write the ${name}.`]];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {info.label}
        </label>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          ~{estimateTokens(value ?? "")} tokens
          <button
            type="button"
            aria-expanded={asking}
            className="rounded-md px-1.5 py-1 text-accent hover:bg-accent/10"
            onClick={() => setAsking(!asking)}
          >
            ✦ Ask co-writer
          </button>
        </span>
      </div>
      {asking && (
        <div className="flex flex-wrap gap-1.5" aria-label={`Ask the co-writer about the ${name}`}>
          {quick.map(([label, request]) => (
            <button
              key={label}
              type="button"
              className="rounded-full border border-border px-3 py-1 text-sm text-ink-muted hover:border-accent hover:text-ink"
              onClick={() => {
                setAsking(false);
                void askCowriter({ send: request });
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1 text-sm text-ink-muted hover:border-accent hover:text-ink"
            onClick={() => {
              setAsking(false);
              void askCowriter({ draft: `${info.label}: ` });
            }}
          >
            Something else…
          </button>
        </div>
      )}
      <p className="text-xs text-ink-muted">{typeof info.help === "function" ? info.help(kind) : info.help}</p>
      <AutoTextarea
        id={id}
        value={value ?? ""}
        placeholder={info.placeholder}
        onChange={(e) => setField(info.field, e.target.value)}
        className="min-h-24"
      />
    </div>
  );
}
