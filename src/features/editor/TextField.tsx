import { useState } from "react";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
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
  const [squeezing, setSqueezing] = useState(false);
  const name = info.label.toLowerCase();
  const tokens = estimateTokens(value ?? "");
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
          ~{tokens} tokens
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
          {tokens > 20 && (
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1 text-sm text-ink-muted hover:border-accent hover:text-ink"
              onClick={() => {
                setAsking(false);
                setSqueezing(true);
              }}
            >
              Squeeze…
            </button>
          )}
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
      {squeezing && (
        <Squeeze
          name={name}
          tokens={tokens}
          onCancel={() => setSqueezing(false)}
          onSqueeze={(target) => {
            setSqueezing(false);
            void askCowriter({ send: squeezeRequest(name, tokens, target) });
          }}
        />
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

const squeezeRequest = (name: string, tokens: number, target: number) =>
  `Squeeze the ${name} down to about ${target} tokens (it is about ${tokens} now). Keep every fact from the story bible and the card; cut wording, repetition and filler, not facts. Rewrite the whole ${name} in one edit.`;

/** Picks how many tokens a field should shrink to. */
function Squeeze({
  name,
  tokens,
  onSqueeze,
  onCancel,
}: {
  name: string;
  tokens: number;
  onSqueeze: (target: number) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(Math.max(10, Math.round((tokens * 0.7) / 10) * 10));
  const valid = target >= 10 && target < tokens;
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2"
      aria-label={`Squeeze the ${name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSqueeze(target);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Target tokens
        <TextInput
          type="number"
          min={10}
          step={10}
          max={tokens - 1}
          value={target}
          className="w-28"
          onChange={(e) => setTarget(Number(e.target.value))}
        />
      </label>
      <span className="pb-2 text-xs text-ink-muted">
        now ~{tokens}
        {valid && `, ${Math.round((1 - target / tokens) * 100)}% shorter`}
      </span>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!valid}>
          Squeeze
        </Button>
      </div>
    </form>
  );
}
