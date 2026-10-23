import { AutoTextarea, Button } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { TextField } from "./TextField";

export function GreetingsGroup() {
  return (
    <>
      <TextField
        info={{
          field: "first_mes",
          label: "First message",
          help: "Sets the tone and length of the replies. Never speak or act for {{user}}, and end on a hook.",
        }}
      />
      <StringList
        field="alternate_greetings"
        label="Alternate greetings"
        help="Other openings the user can swipe to. For a world card, each one is a different way into the world."
        addLabel="Add greeting"
      />
      <StringList
        field="group_only_greetings"
        label="Group-only greetings"
        help="Used instead of the greetings above when the card is in a group chat."
        addLabel="Add group greeting"
      />
    </>
  );
}

function StringList({
  field,
  label,
  help,
  addLabel,
}: {
  field: "alternate_greetings" | "group_only_greetings";
  label: string;
  help: string;
  addLabel: string;
}) {
  const items = useEditor((s) => s.record!.card.data[field]);
  const setField = useEditor((s) => s.setField);

  const update = (next: string[], coalesceKey?: string) => setField(field, next, coalesceKey ?? null);
  const move = (i: number, by: number) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    update(next);
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{label}</h3>
      <p className="text-xs text-ink-muted">{help}</p>
      {items.map((text, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-xl border border-border p-2">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              #{i + 1} · ~{estimateTokens(text)} tokens
            </span>
            <span className="flex gap-1">
              <Button variant="ghost" aria-label={`Move ${label} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${label} ${i + 1} down`}
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                aria-label={`Remove ${label} ${i + 1}`}
                onClick={() => update(items.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </span>
          </div>
          <AutoTextarea
            aria-label={`${label} ${i + 1}`}
            value={text}
            onChange={(e) => update(items.map((t, j) => (j === i ? e.target.value : t)), `${field}.${i}`)}
          />
        </div>
      ))}
      <Button className="self-start" onClick={() => update([...items, ""])}>
        {addLabel}
      </Button>
    </section>
  );
}
