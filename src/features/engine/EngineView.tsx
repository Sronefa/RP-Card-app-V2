import { useEffect, useMemo, useRef, useState } from "react";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { applyTracker, readTracker } from "../../editor/trackers";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { panelHtml } from "../../engine/panel";
import { runtime, type UpdateResult } from "../../engine/runtime";
import {
  applyEngine,
  initialState,
  newEngine,
  newVar,
  readEngine,
  rulesText,
  sampleReply,
  startValue,
  stateSchema,
  VAR_TYPES,
  varLabel,
  varsFromTracker,
  type EngineConfig,
  type EngineVar,
  type VarType,
} from "../../engine/sheet";
import { CardBar } from "../editor/CardBar";
import { SandboxPage } from "./SandboxPage";
import { NoCard } from "../editor/NoCard";

const TABS = { vars: "Variables", panel: "Panel", test: "Test a reply", sandbox: "Sandbox" } as const;
type Tab = keyof typeof TABS;
const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

/** The Immersive Engine: a game state that updates itself after every reply, for Tavern Helper cards. */
export function EngineView() {
  const record = useEditor((s) => s.record);
  if (!record) return <NoCard />;
  return <EngineBody />;
}

function useEngine() {
  const data = useEditor((s) => s.record!.card.data);
  const replaceData = useEditor((s) => s.replaceData);
  const config = readEngine(data);
  const save = (next: EngineConfig | undefined, coalesceKey?: string) =>
    replaceData(applyEngine(useEditor.getState().record!.card.data, next), coalesceKey);
  return { data, config, save };
}

function EngineBody() {
  const { data, config, save } = useEngine();
  const [tab, setTab] = useState<Tab>("vars");
  const [confirmOff, setConfirmOff] = useState(false);
  const tracker = readTracker(data);

  const importTracker = () => {
    if (!tracker) return;
    const base = config ?? newEngine();
    const next = applyEngine(useEditor.getState().record!.card.data, { ...base, vars: [...base.vars, ...varsFromTracker(tracker)] });
    // The old status block would run alongside the engine, so it goes.
    useEditor.getState().replaceData(applyTracker(next, undefined));
    toast(`Imported ${tracker.fields.length} values from the status tracker and turned the tracker off`);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 pb-3 backdrop-blur">
        <CardBar detail={config ? `Engine on · ${config.vars.length} values` : "Engine off"} />
      </div>
      <div className={`mx-auto flex w-full flex-1 flex-col gap-4 p-4 ${config && tab === "sandbox" ? "max-w-5xl" : "max-w-3xl"}`}>
        <h1 className="text-lg font-semibold">Immersive Engine</h1>
        {!config ? (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4" aria-label="Turn on">
            <p className="text-sm">
              Give this card a game state that keeps itself up to date: the model ends each reply with an update block,
              and a status panel under the reply shows the new values. Swiping or editing a reply rolls the values back
              with it.
            </p>
            <p className="text-sm text-ink-muted">
              Engine cards need the Tavern Helper extension (JS-Slash-Runner) in SillyTavern, and the player allows the
              card's script when SillyTavern asks. The format is the MVU one, so MVU tools and Tavern Helper's variable
              manager can read it. Cards without the engine stay extension-free.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => save({ ...newEngine(), vars: [newVar({ group: "Player", name: "Health", start: "100", min: 0, max: 100, rule: "Drops when {{user}} is hurt, rises with rest or healing." })] })}>
                Turn on the engine
              </Button>
              {tracker && tracker.fields.length > 0 && (
                <Button onClick={importTracker}>Start from the status tracker</Button>
              )}
            </div>
          </section>
        ) : (
          <>
            <div role="tablist" aria-label="Engine" className="flex rounded-lg border border-border p-0.5">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`min-h-9 flex-1 rounded-md px-2 text-sm ${tab === t ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
                >
                  {TABS[t]}
                </button>
              ))}
            </div>
            {tab === "vars" ? (
              <VarsPage config={config} save={save} onImport={tracker?.fields.length ? importTracker : undefined} />
            ) : tab === "panel" ? (
              <PanelPage config={config} save={save} />
            ) : tab === "test" ? (
              <TestPage config={config} />
            ) : (
              <SandboxPage config={config} save={save} />
            )}
            <Button variant="danger" className="self-start" onClick={() => setConfirmOff(true)}>
              Turn the engine off
            </Button>
          </>
        )}
      </div>
      <Dialog open={confirmOff} title="Turn the engine off?" onClose={() => setConfirmOff(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            This takes the engine's script, lorebook entries and regex scripts out of the card. Undo brings them back.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOff(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                save(undefined);
                setConfirmOff(false);
              }}
            >
              Turn it off
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Why a value's name can't be used, if it can't. */
function nameProblem(v: EngineVar, all: EngineVar[]): string | undefined {
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

function VarsPage({
  config,
  save,
  onImport,
}: {
  config: EngineConfig;
  save: (c: EngineConfig, key?: string) => void;
  onImport?: () => void;
}) {
  const [open, setOpen] = useState<string>();
  const groups = [...new Set(config.vars.map((v) => v.group.trim()).filter(Boolean))];
  const set = (id: string, patch: Partial<EngineVar>, key: string) =>
    save({ ...config, vars: config.vars.map((v) => (v.id === id ? { ...v, ...patch } : v)) }, `engine.${id}.${key}`);
  const move = (index: number, by: number) => {
    const vars = [...config.vars];
    const [v] = vars.splice(index, 1);
    vars.splice(index + by, 0, v);
    save({ ...config, vars });
  };
  const add = () => {
    const v = newVar({ group: config.vars.at(-1)?.group ?? "", name: "" });
    save({ ...config, vars: [...config.vars, v] });
    setOpen(v.id);
  };
  const rules = rulesText(config);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        The values the game keeps. Group them (Player, Mina, World…) and say when each one changes: the model reads these
        rules and the current values before every reply.
      </p>
      <ul className="flex flex-col gap-2" aria-label="Values">
        {config.vars.map((v, i) => {
          const problem = nameProblem(v, config.vars);
          const expanded = open === v.id;
          return (
            <li key={v.id} className="rounded-xl border border-border bg-surface-raised">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? undefined : v.id)}
                className="flex min-h-12 w-full items-center gap-2 px-3 text-left text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{varLabel(v) || "New value"}</span>{" "}
                  <span className="text-ink-muted">· {summary(v)}</span>
                </span>
                {problem && <span className="text-xs text-red-300">Fix</span>}
                {v.hidden && <span className="text-xs text-ink-muted">hidden</span>}
                {v.readOnly && <span className="text-xs text-ink-muted">read-only</span>}
              </button>
              {expanded && (
                <VarEditor
                  v={v}
                  groups={groups}
                  problem={problem}
                  onChange={(patch, key) => set(v.id, patch, key)}
                  onRemove={() => save({ ...config, vars: config.vars.filter((o) => o.id !== v.id) })}
                  onMove={(by) => move(i, by)}
                  first={i === 0}
                  last={i === config.vars.length - 1}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={add}>
          Add a value
        </Button>
        {onImport && <Button onClick={onImport}>Import the status tracker</Button>}
      </div>
      <details className="rounded-xl border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          What the model is told (~{estimateTokens(rules)} tokens, always on)
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap">{rules}</pre>
      </details>
    </div>
  );
}

function summary(v: EngineVar): string {
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

function VarEditor({
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

function PanelPage({ config, save }: { config: EngineConfig; save: (c: EngineConfig, key?: string) => void }) {
  const panel = config.panel;
  const setPanel = (patch: Partial<EngineConfig["panel"]>, key: string) => save({ ...config, panel: { ...panel, ...patch } }, `engine.panel.${key}`);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-8 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={panel.enabled} onChange={(e) => setPanel({ enabled: e.target.checked }, "enabled")} />
        Show a status panel under each reply
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Title
          <TextInput value={panel.title} className="w-48" onChange={(e) => setPanel({ title: e.target.value }, "title")} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Accent colour
          <input
            type="color"
            value={panel.accent}
            className="h-10 w-16 rounded-lg border border-border bg-surface-sunken"
            onChange={(e) => setPanel({ accent: e.target.value }, "accent")}
          />
        </label>
      </div>
      <label className="flex min-h-8 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={config.reminder} onChange={(e) => save({ ...config, reminder: e.target.checked })} />
        Remind the model of the update block near the end of the prompt (helps models that forget it)
      </label>
      {panel.enabled && (
        <section className="flex flex-col gap-2" aria-label="Panel preview">
          <h2 className="font-medium">Preview, with the starting values</h2>
          <PanelPreview config={config} state={initialState(config)} />
          <p className="text-xs text-ink-muted">Values shown in the compact panel are checked on the Variables tab. "All" opens the rest.</p>
        </section>
      )}
    </div>
  );
}

/** The panel as SillyTavern shows it, fed the given state instead of a chat. */
export function PanelPreview({ config, state, delta }: { config: EngineConfig; state: unknown; delta?: unknown }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const doc = useMemo(() => {
    const data = JSON.stringify({ stat_data: state, delta_data: delta ?? {} }).replace(/</g, "\\u003c");
    const shim =
      `<script>window.Mvu = { getMvuData: function () { return ${data}; } }; window.getCurrentMessageId = function () { return 0; };` +
      `new ResizeObserver(function () { parent.postMessage({ cfPanelHeight: document.documentElement.scrollHeight }, "*"); }).observe(document.documentElement);</script>`;
    // Take on the app's text colour, the way the panel takes on SillyTavern's.
    const color = getComputedStyle(document.body).color || "inherit";
    const look = `<style>html { color-scheme: dark; } body { color: ${color}; }</style>`;
    return panelHtml(config).replace("<head>", `<head>${shim}${look}`);
  }, [config, state, delta]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && typeof e.data?.cfPanelHeight === "number") setHeight(Math.min(800, e.data.cfPanelHeight + 20));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <iframe
      ref={ref}
      title="Status panel preview"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ height }}
      className="w-full rounded-lg border border-border bg-surface-sunken p-2"
    />
  );
}

function TestPage({ config }: { config: EngineConfig }) {
  const [reply, setReply] = useState(() => sampleReply(config));
  const [result, setResult] = useState<UpdateResult>();
  const run = () => setResult(runtime.cfUpdate(initialState(config), reply, stateSchema(config)));
  const changes = result ? Object.entries(result.delta) : [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Paste a reply with its update block and run it on the starting values, the way the engine will in SillyTavern.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        A reply
        <AutoTextarea rows={8} value={reply} className="font-mono text-xs" onChange={(e) => setReply(e.target.value)} />
      </label>
      <Button variant="primary" className="self-start" onClick={run}>
        Run the update
      </Button>
      {result && (
        <section className="flex flex-col gap-3" aria-label="Result">
          <h2 className="font-medium">Result</h2>
          {changes.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {changes.map(([path, [before, after]]) => (
                <li key={path}>
                  <span className="font-medium">{path}</span>: {JSON.stringify(before) ?? "nothing"} → {JSON.stringify(after) ?? "removed"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">Nothing changed.</p>
          )}
          {result.skipped.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-red-300" aria-label="Skipped">
              {result.skipped.map((s, i) => (
                <li key={i}>
                  Skipped <code className="text-xs">{s.command}</code>: {s.error}
                </li>
              ))}
            </ul>
          )}
          {config.panel.enabled && <PanelPreview config={config} state={result.stat_data} delta={result.delta} />}
        </section>
      )}
    </div>
  );
}
