/** Editing one value of the game state: on the Variables tab and inside modules. */
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { startValue, VAR_TYPES, type EngineVar, type VarType } from "../../engine/sheet";

export const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

/** Why a value's name can't be used, if it can't. */
export function nameProblem(v: EngineVar, all: EngineVar[]): string | undefined {
  const name = v.name.trim();
  if (!name) return "Give it a name.";
  if (/[.[\]"'/~]/.test(name) || /[.[\]"'/~]/.test(v.group)) return "Names can't contain . [ ] / ~ or quotes.";
  if (/^[$_]/.test(name)) return 'Use the checkboxes for hidden or read-only values instead of "$" or "_".';
  const clash = all.find(
    (o) => o.id !== v.id && o.group.trim() === v.group.trim() && o.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return "Another value in this group has the same name.";
  if (!v.group.trim() && all.some((o) => o.group.trim() === name)) return "A group has this name.";
}


export function summary(v: EngineVar): string {
  const type = VAR_TYPES[v.type].label;
  const range = v.type === "number" && (v.min !== undefined || v.max !== undefined) ? ` ${v.min ?? "…"}–${v.max ?? "…"}` : "";
  const start = startValue(v);
  const shown = Array.isArray(start)
    ? start.join(", ")
    : typeof start === "object" && start
      ? Object.entries(start).map(([k, n]) => `${k} ${n}`).join(", ")
      : typeof start === "boolean"
        ? start
          ? "yes"
          : "no"
        : String(start);
  return `${type}${range}, starts at ${shown || "nothing"}`;
}

const numberOrUndefined = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));

export function VarEditor({
  v,
  groups,
  problem,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  v: EngineVar;
  groups: string[];
  problem?: string;
  onChange: (patch: Partial<EngineVar>, key: string) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  first: boolean;
  last: boolean;
}) {
  const listId = `engine-groups-${v.id}`;
  return (
    <div className="flex flex-col gap-3 border-t border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Group
          <TextInput list={listId} value={v.group} placeholder="None" onChange={(e) => onChange({ group: e.target.value }, "group")} />
          <datalist id={listId}>
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <TextInput value={v.name} placeholder="e.g. Health" onChange={(e) => onChange({ name: e.target.value }, "name")} />
        </label>
      </div>
      {problem && <p className="text-sm text-red-300">{problem}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select className={selectClass} value={v.type} onChange={(e) => onChange({ type: e.target.value as VarType }, "type")}>
            {(Object.keys(VAR_TYPES) as VarType[]).map((t) => (
              <option key={t} value={t}>
                {VAR_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Starts at
          {v.type === "toggle" ? (
            <select className={selectClass} value={startValue(v) ? "yes" : "no"} onChange={(e) => onChange({ start: e.target.value }, "start")}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          ) : v.type === "choice" && v.options?.length ? (
            <select className={selectClass} value={String(startValue(v))} onChange={(e) => onChange({ start: e.target.value }, "start")}>
              {v.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <TextInput
              value={v.start}
              inputMode={v.type === "number" ? "decimal" : undefined}
              placeholder={v.type === "counts" ? "rope: 1, arrows: 20" : v.type === "list" ? "a, b, c" : undefined}
              onChange={(e) => onChange({ start: e.target.value }, "start")}
            />
          )}
        </label>
        {v.type === "number" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Lowest
              <TextInput
                inputMode="decimal"
                value={v.min ?? ""}
                placeholder="None"
                onChange={(e) => onChange({ min: numberOrUndefined(e.target.value) }, "min")}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Highest
              <TextInput
                inputMode="decimal"
                value={v.max ?? ""}
                placeholder="None"
                onChange={(e) => onChange({ max: numberOrUndefined(e.target.value) }, "max")}
              />
            </label>
          </>
        )}
      </div>
      <p className="text-xs text-ink-muted">{VAR_TYPES[v.type].help}</p>
      {v.type === "choice" && (
        <label className="flex flex-col gap-1 text-sm">
          Options, separated by commas
          <TextInput
            value={(v.options ?? []).join(", ")}
            placeholder="Strangers, Friends, Close"
            onChange={(e) =>
              onChange(
                {
                  options: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                "options",
              )
            }
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        When it changes
        <AutoTextarea
          rows={2}
          value={v.rule}
          placeholder="e.g. Drops when {{user}} is hurt; rises a little with each night's rest."
          onChange={(e) => onChange({ rule: e.target.value }, "rule")}
        />
      </label>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex min-h-8 items-center gap-2">
          <input type="checkbox" className="size-4" checked={v.pinned !== false} onChange={(e) => onChange({ pinned: e.target.checked }, "pinned")} />
          Show it in the compact panel
        </label>
        <label className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={!!v.hidden}
            onChange={(e) => onChange({ hidden: e.target.checked, readOnly: false }, "hidden")}
          />
          Hidden from the AI (the panel still shows it)
        </label>
        <label className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={!!v.readOnly}
            onChange={(e) => onChange({ readOnly: e.target.checked, hidden: false }, "readOnly")}
          />
          Read-only for the AI (only scripts and the player change it)
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={first} onClick={() => onMove(-1)}>
          Move up
        </Button>
        <Button variant="ghost" disabled={last} onClick={() => onMove(1)}>
          Move down
        </Button>
        <Button variant="danger" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

