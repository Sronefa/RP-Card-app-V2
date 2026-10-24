import type { LorebookEntry } from "../../card";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { AT_DEPTH, ST_POSITIONS, entryTitle, stDepth, stPosition, withStPosition } from "../../editor/lorebook";
import { estimateTokens } from "../../lib/tokens";
import { KeysInput } from "./KeysInput";

/** SillyTavern's rule for combining primary and secondary keys (extensions.selectiveLogic). */
export const SELECTIVE_LOGIC = [
  { value: 0, label: "and any secondary key" },
  { value: 3, label: "and all secondary keys" },
  { value: 2, label: "and none of the secondary keys" },
  { value: 1, label: "and not all secondary keys" },
];

interface Props {
  entry: LorebookEntry;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** coalesceKey groups typing in one text box into one undo step. */
  onChange: (entry: LorebookEntry, coalesceKey?: string) => void;
  onMove: (by: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function EntryEditor({ entry, index, count, open, onToggle, onChange, onMove, onDuplicate, onDelete }: Props) {
  const title = entryTitle(entry);
  const set = (fields: Partial<LorebookEntry>, coalesceKey?: string) => onChange({ ...entry, ...fields }, coalesceKey);
  const setExt = (fields: Record<string, unknown>, coalesceKey?: string) =>
    onChange({ ...entry, extensions: { ...entry.extensions, ...fields } }, coalesceKey);
  const position = stPosition(entry);
  const logic = typeof entry.extensions.selectiveLogic === "number" ? entry.extensions.selectiveLogic : 0;
  const id = `entry-${index}`;

  return (
    <div className={`rounded-xl border bg-surface-raised ${open ? "border-ink-muted" : "border-border"}`}>
      <div className="flex items-center gap-2 p-2 pl-3">
        <input
          type="checkbox"
          className="size-4 shrink-0"
          aria-label={`Enable ${title}`}
          checked={entry.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className={`flex min-h-10 min-w-0 flex-1 flex-col justify-center text-left ${entry.enabled ? "" : "opacity-50"}`}
        >
          <span className="truncate font-medium">{title}</span>
          <span className="truncate text-xs text-ink-muted">
            {entry.constant ? "Always on" : entry.keys.join(", ") || "No keys"} · ~{estimateTokens(entry.content)} tokens
          </span>
        </button>
        <span aria-hidden className="px-2 text-ink-muted">
          {open ? "▴" : "▾"}
        </span>
      </div>

      {open && (
        <div id={id} className="flex flex-col gap-3 border-t border-border p-3">
          <label className="flex flex-col gap-1 text-sm">
            Title
            <span className="text-xs text-ink-muted">For you only; it isn't sent to the model.</span>
            <TextInput
              value={entry.comment || entry.name || ""}
              placeholder={entry.keys[0]}
              onChange={(e) => set({ comment: e.target.value, name: e.target.value || undefined }, "title")}
            />
          </label>

          <KeysInput label="Keys" keys={entry.keys} onChange={(keys) => set({ keys })} />
          <p className="-mt-2 text-xs text-ink-muted">
            The entry triggers when any key appears in recent messages. Write /pattern/i for a regular expression.
          </p>

          <label className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              Content <span className="text-ink-muted">~{estimateTokens(entry.content)} tokens</span>
            </span>
            <AutoTextarea
              value={entry.content}
              className="min-h-24"
              placeholder="Facts the model needs when this comes up. Short and concrete."
              onChange={(e) => set({ content: e.target.value }, "content")}
            />
          </label>

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="sr-only">Options</legend>
            <Check label="Constant: always sent, even without a key" checked={!!entry.constant} onChange={(constant) => set({ constant })} />
            <Check label="Case-sensitive keys" checked={!!entry.case_sensitive} onChange={(case_sensitive) => set({ case_sensitive })} />
            <Check
              label="Keys are regular expressions"
              checked={entry.use_regex}
              onChange={(use_regex) => set({ use_regex })}
            />
            <Check
              label="Also require secondary keys"
              checked={!!entry.selective}
              onChange={(selective) => set({ selective })}
            />
          </fieldset>

          {entry.selective && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <label className="flex flex-col gap-1 text-sm">
                Trigger on a key
                <select
                  className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2"
                  value={logic}
                  onChange={(e) => setExt({ selectiveLogic: Number(e.target.value) })}
                >
                  {SELECTIVE_LOGIC.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <KeysInput
                label="Secondary keys"
                keys={entry.secondary_keys ?? []}
                onChange={(secondary_keys) => set({ secondary_keys })}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-1">
              Position
              <select
                className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2"
                value={position}
                onChange={(e) => onChange(withStPosition(entry, Number(e.target.value)))}
              >
                {ST_POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {position === AT_DEPTH && (
              <label className="flex flex-col gap-1 text-sm">
                Depth
                <TextInput
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={stDepth(entry)}
                  onChange={(e) => setExt({ depth: Math.max(0, Math.round(Number(e.target.value)) || 0) }, "depth")}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Insertion order
              <TextInput
                type="number"
                inputMode="numeric"
                value={entry.insertion_order}
                onChange={(e) => set({ insertion_order: Math.round(Number(e.target.value)) || 0 }, "order")}
              />
            </label>
          </div>
          <p className="-mt-2 text-xs text-ink-muted">Entries with a higher order are placed closer to the end of the prompt.</p>

          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-1">
              <Button variant="ghost" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => onMove(-1)}>
                ↑
              </Button>
              <Button variant="ghost" aria-label={`Move ${title} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
                ↓
              </Button>
              <Button onClick={onDuplicate}>Duplicate</Button>
            </div>
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-8 items-center gap-2">
      <input type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
