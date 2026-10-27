import { useState } from "react";
import { AutoTextarea, Button, Dialog } from "../../components/ui";
import { toast } from "../../components/toast";
import { applyTracker, readTracker } from "../../editor/trackers";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { effectiveConfig } from "../../engine/modules/compile";
import { runtime, type UpdateResult } from "../../engine/runtime";
import {
  applyEngine,
  initialState,
  newEngine,
  newVar,
  readEngine,
  rulesText,
  sampleReply,
  sideCallPrompt,
  sideCallTokens,
  starterVar,
  stateSchema,
  varLabel,
  varsFromTracker,
  type EngineConfig,
  type EngineVar,
} from "../../engine/sheet";
import { CardBar } from "../editor/CardBar";
import { EngineerPage } from "./EngineerPage";
import { NoCard } from "../editor/NoCard";
import { LookPage, PanelPreview } from "./LookPage";
import { ModulesPage } from "./ModulesPage";
import { PlaytestPage } from "./PlaytestPage";
import { SandboxPage } from "./SandboxPage";
import { useEngineer } from "../../engine/engineer/session";
import { turnEngineOff } from "../../engine/convert";
import { readMechanics } from "../../editor/mechanics";
import { nameProblem, summary, VarEditor } from "./VarEditor";
import { useViewTab } from "../../app/useViewTab";

const TABS = { vars: "Variables", modules: "Modules", look: "Look", engineer: "Engineer", test: "Test", sandbox: "Sandbox", playtest: "Playtest" } as const;
type Tab = keyof typeof TABS;

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
  const [tab, setTab] = useViewTab<Tab>("engine", "vars");
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

  const light = (tracker?.fields.length ?? 0) > 0 || readMechanics(data).length > 0;
  /** Turns the engine on empty and has the engineer plan the conversion; it asks before changing anything. */
  const convert = async () => {
    save(newEngine());
    setTab("engineer");
    const engineer = useEngineer.getState();
    await engineer.load(useEditor.getState().record!.id);
    await engineer.send(
      "Convert this light card into an engine card. Read it first, tell me the plan, and ask me before converting.",
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 pb-3 backdrop-blur">
        <CardBar detail={config ? `Engine on · ${config.vars.length} values` : "Engine off"} />
      </div>
      <div className={`mx-auto flex w-full flex-1 flex-col gap-4 p-4 ${config && (tab === "sandbox" || tab === "playtest") ? "max-w-5xl" : "max-w-3xl"}`}>
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
              <Button variant="primary" onClick={() => save({ ...newEngine(), vars: [starterVar()] })}>
                Turn on the engine
              </Button>
              {light && <Button onClick={() => void convert()}>✦ Convert with the UI engineer</Button>}
              {tracker && tracker.fields.length > 0 && (
                <Button onClick={importTracker}>Start from the status tracker</Button>
              )}
            </div>
          </section>
        ) : (
          <>
            <div role="tablist" aria-label="Engine" className="flex overflow-x-auto rounded-lg border border-border p-0.5">
              {(Object.keys(TABS) as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`min-h-9 flex-1 shrink-0 rounded-md px-2 text-sm whitespace-nowrap ${tab === t ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
                >
                  {TABS[t]}
                </button>
              ))}
            </div>
            {tab === "vars" ? (
              <VarsPage config={config} save={save} onImport={tracker?.fields.length ? importTracker : undefined} />
            ) : tab === "modules" ? (
              <ModulesPage config={config} save={save} />
            ) : tab === "look" ? (
              <LookPage config={config} save={save} />
            ) : tab === "engineer" ? (
              <EngineerPage />
            ) : tab === "test" ? (
              <TestPage config={config} />
            ) : tab === "sandbox" ? (
              <SandboxPage config={config} save={save} />
            ) : (
              <PlaytestPage
                onFlag={(text) => {
                  useEngineer.getState().setDraft(text);
                  setTab("engineer");
                  toast("The flagged reply is ready in the engineer's message box");
                }}
              />
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
            {config?.light?.tracker && " The card was converted from a light card, so its status tracker comes back."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOff(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                useEditor.getState().replaceData(turnEngineOff(useEditor.getState().record!.card.data));
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
  const side = config.updateMode === "side";
  const rules = side ? sideCallPrompt(effectiveConfig(config)) : rulesText(config);

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
      <fieldset className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm">
        <legend className="px-1 font-medium">Who writes the updates</legend>
        <label className="flex min-h-8 items-start gap-2">
          <input type="radio" name="update-mode" className="mt-1 size-4" checked={!side} onChange={() => save({ ...config, updateMode: "reply" })} />
          <span>
            The roleplay model, at the end of each reply
            <span className="block text-xs text-ink-muted">No extra calls. The rules sit in the prompt and the reply carries an update block, hidden from the player.</span>
          </span>
        </label>
        <label className="flex min-h-8 items-start gap-2">
          <input type="radio" name="update-mode" className="mt-1 size-4" checked={side} onChange={() => save({ ...config, updateMode: "side" })} />
          <span>
            A side call after each reply
            <span className="block text-xs text-ink-muted">
              The reply stays pure prose; a silent second call on the player's own API reads it and writes the update. About{" "}
              {sideCallTokens(config)} extra tokens a turn. Players can turn it off in the card's settings app.
            </span>
          </span>
        </label>
      </fieldset>
      <details className="rounded-xl border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {side ? `What the side call is told (~${estimateTokens(rules)} tokens a turn)` : `What the model is told (~${estimateTokens(rules)} tokens, always on)`}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap">{rules}</pre>
      </details>
    </div>
  );
}

function TestPage({ config }: { config: EngineConfig }) {
  const [reply, setReply] = useState(() => sampleReply(config));
  const [result, setResult] = useState<UpdateResult>();
  const run = () => {
    const full = effectiveConfig(config);
    setResult(runtime.cfUpdate(initialState(full), reply, stateSchema(full)));
  };
  const changes = result ? Object.entries(result.delta) : [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Paste a reply with its update block and run it on the starting values, the way the engine will in SillyTavern. Module scripts (like the clock's day roll) run in the Sandbox.
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
