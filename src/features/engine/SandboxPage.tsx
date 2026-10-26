import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import { AutoTextarea, Button } from "../../components/ui";
import { useEditor } from "../../editor/store";
import {
  loadSandboxLibs,
  sandboxDocument,
  sandboxUrl,
  type SandboxCommand,
  type SandboxLibs,
  type SandboxMessage,
  type SandboxReport,
} from "../../engine/sandbox/sandbox";
import { scenarioOf, type EngineConfig, type ScenarioTurn } from "../../engine/sheet";

const DEVICES = {
  phone: { label: "Phone", width: 390, height: 760 },
  tablet: { label: "Tablet", width: 820, height: 1000 },
  desktop: { label: "Desktop", width: 1280, height: 800 },
} as const;
type Device = keyof typeof DEVICES;
const TEXT_SIZES = [0.9, 1, 1.15, 1.3];
const PANES = { state: "State", scenario: "Scenario", actions: "Actions", errors: "Errors" } as const;
type Pane = keyof typeof PANES;
const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

interface LogEntry {
  n: number;
  source: string;
  action: string;
  detail: string;
}

interface Problem {
  n: number;
  level: "error" | "warn";
  source: string;
  message: string;
  line?: number;
  code?: string;
  stack?: string;
}

/** The value after it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The engine sandbox: the card running in a fake SillyTavern with Tavern Helper, offline. */
export function SandboxPage({ config, save }: { config: EngineConfig; save: (c: EngineConfig, key?: string) => void }) {
  const data = useEditor((s) => s.record!.card.data);
  const [libs, setLibs] = useState<SandboxLibs>();
  const [libsFailed, setLibsFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadSandboxLibs().then(
      (l) => live && setLibs(l),
      () => live && setLibsFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  // Hot reload: the sandbox restarts with the card a moment after each edit.
  const settled = useSettled(data, 500);
  const [restarts, setRestarts] = useState(0);
  const url = useMemo(() => (libs ? sandboxUrl(sandboxDocument({ data: settled, libs })) : undefined), [libs, settled]);

  const [device, setDevice] = useState<Device>("phone");
  const [rotated, setRotated] = useState(false);
  const [textScale, setTextScale] = useState(1);
  const [pane, setPane] = useState<Pane>("state");
  const [autoRun, setAutoRun] = useState(true);
  const [ready, setReady] = useState(false);
  const [chat, setChat] = useState<SandboxMessage[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [overlay, setOverlay] = useState(true);
  const [selected, setSelected] = useState<number>();
  const frame = useRef<HTMLIFrameElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  const send = useCallback((command: SandboxCommand) => {
    frame.current?.contentWindow?.postMessage({ cfCommand: command }, "*");
  }, []);

  const scenario = scenarioOf(config);
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const autoRunRef = useRef(autoRun);
  autoRunRef.current = autoRun;
  const textScaleRef = useRef(textScale);
  textScaleRef.current = textScale;

  // The scenario isn't part of the page, so a change to it replays the chat on its own.
  const settledScenario = useSettled(JSON.stringify(scenario), 500);
  const lastScenario = useRef(settledScenario);
  useEffect(() => {
    if (settledScenario === lastScenario.current) return;
    lastScenario.current = settledScenario;
    if (autoRunRef.current) setRestarts((r) => r + 1);
  }, [settledScenario]);

  // A new page starts from nothing.
  useEffect(() => {
    setReady(false);
    setChat([]);
    setLog([]);
    setProblems([]);
    setOverlay(true);
    setSelected(undefined);
  }, [url, restarts]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const report = (e.data as { cfSandbox?: SandboxReport })?.cfSandbox;
      if (!report) return;
      const n = ++counter.current;
      switch (report.kind) {
        case "ready":
          setReady(true);
          if (textScaleRef.current !== 1) send({ type: "view", textScale: textScaleRef.current });
          if (autoRunRef.current && scenarioRef.current.length) send({ type: "scenario", turns: scenarioRef.current });
          break;
        case "state":
          setChat(report.chat);
          break;
        case "log":
          setLog((l) => [{ n, source: report.source, action: report.action, detail: report.detail }, ...l].slice(0, 300));
          break;
        case "console":
          setProblems((p) => [...p, { n, level: report.level, source: report.source, message: report.message }].slice(-100));
          if (report.level === "error") setOverlay(true);
          break;
        case "error":
          setProblems((p) => [...p, { n, level: "error" as const, ...report }].slice(-100));
          setOverlay(true);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  const restart = () => setRestarts((r) => r + 1);
  const setScenario = (turns: ScenarioTurn[], key?: string) => save({ ...config, scenario: turns }, key);
  const errors = problems.filter((p) => p.level === "error");
  const firstError = errors[0];

  let { width, height }: { width: number; height: number } = DEVICES[device];
  if (rotated && device !== "desktop") [width, height] = [height, width];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        The card running in a stand-in for SillyTavern with Tavern Helper, with no internet: its scripts, regex and
        panels behave as they will in a chat. It restarts after every change and replays the scenario.
      </p>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Sandbox view">
        <select aria-label="Device" className={selectClass} value={device} onChange={(e) => setDevice(e.target.value as Device)}>
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <option key={d} value={d}>
              {DEVICES[d].label} ({DEVICES[d].width})
            </option>
          ))}
        </select>
        <Button variant="ghost" disabled={device === "desktop"} aria-pressed={rotated} onClick={() => setRotated((r) => !r)}>
          Rotate
        </Button>
        <select
          aria-label="Text size"
          className={selectClass}
          value={textScale}
          onChange={(e) => {
            const scale = Number(e.target.value);
            setTextScale(scale);
            send({ type: "view", textScale: scale });
          }}
        >
          {TEXT_SIZES.map((s) => (
            <option key={s} value={s}>
              Text {Math.round(s * 100)}%
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={restart} disabled={!url}>
          Restart
        </Button>
      </div>

      {libsFailed ? (
        <p className="text-sm text-red-300">The sandbox couldn't load its libraries. Reload CardForge and try again.</p>
      ) : !url ? (
        <p className="text-sm text-ink-muted">Loading the sandbox…</p>
      ) : (
        <DeviceFrame
          width={width}
          height={height}
          overlay={
            overlay && firstError ? (
              <div role="alert" className="absolute inset-x-0 top-0 flex flex-col gap-1 bg-red-950/95 p-3 text-sm text-red-100">
                <p className="font-medium">
                  {errors.length === 1 ? "An error" : `${errors.length} errors`} in {firstError.source}
                  {firstError.line ? `, line ${firstError.line}` : ""}
                </p>
                <p className="break-words">{firstError.message}</p>
                {firstError.code && <code className="block truncate text-xs opacity-80">{firstError.code}</code>}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPane("errors");
                      tools.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
                    }}
                  >
                    Details
                  </Button>
                  <Button variant="ghost" onClick={() => setOverlay(false)}>
                    Hide
                  </Button>
                </div>
              </div>
            ) : undefined
          }
        >
          <iframe
            key={restarts}
            ref={frame}
            title="Sandbox"
            src={url}
            // A data: page has its own origin, so same-origin here only lets its iframes reach each other,
            // never CardForge. The sandbox still blocks popups, navigation, forms and dialogs.
            sandbox="allow-scripts allow-same-origin"
            style={{ width, height }}
            className="block border-0"
          />
        </DeviceFrame>
      )}

      <div ref={tools} role="tablist" aria-label="Sandbox tools" className="flex rounded-lg border border-border p-0.5">
        {(Object.keys(PANES) as Pane[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={`min-h-9 flex-1 rounded-md px-2 text-sm ${pane === p ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
          >
            {PANES[p]}
            {p === "errors" && problems.length > 0 ? ` (${problems.length})` : ""}
            {p === "actions" && log.length > 0 ? ` (${log.length})` : ""}
          </button>
        ))}
      </div>

      {pane === "state" ? (
        <StatePane chat={chat} ready={ready} selected={selected} onSelect={setSelected} send={send} onReset={restart} />
      ) : pane === "scenario" ? (
        <ScenarioPane
          turns={scenario}
          autoRun={autoRun}
          onAutoRun={setAutoRun}
          onChange={setScenario}
          onRun={() => {
            if (autoRun) restart();
            else send({ type: "scenario", turns: scenario });
          }}
          send={send}
          ready={ready}
        />
      ) : pane === "actions" ? (
        <ActionsPane log={log} onClear={() => setLog([])} />
      ) : (
        <ErrorsPane problems={problems} onClear={() => setProblems([])} />
      )}
    </div>
  );
}

/** Shows a device-sized page, scaled down to fit when it is wider than the space. */
function DeviceFrame({ width, height, overlay, children }: { width: number; height: number; overlay?: React.ReactNode; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(width);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom(el.clientWidth || width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  const scale = Math.min(1, room / width);
  return (
    <div ref={box} className="w-full">
      <div className="relative mx-auto overflow-hidden rounded-xl border border-border" style={{ width: width * scale, height: height * scale }}>
        <div className="relative origin-top-left" style={{ width, height, transform: scale < 1 ? `scale(${scale})` : undefined }}>
          {children}
        </div>
        {overlay}
      </div>
      {scale < 1 && <p className="mt-1 text-center text-xs text-ink-muted">Shown at {Math.round(scale * 100)}%</p>}
    </div>
  );
}

function preview(text: string) {
  const plain = text
    .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain || "(no text)";
}

function StatePane({
  chat,
  ready,
  selected,
  onSelect,
  send,
  onReset,
}: {
  chat: SandboxMessage[];
  ready: boolean;
  selected?: number;
  onSelect: (id: number) => void;
  send: (c: SandboxCommand) => void;
  onReset: () => void;
}) {
  const id = selected !== undefined && selected < chat.length ? selected : chat.length - 1;
  const message = chat[id];
  const variables = message?.variables ?? {};
  const state = (variables as { stat_data?: unknown }).stat_data;
  const delta = (variables as { delta_data?: Record<string, [unknown, unknown]> }).delta_data ?? {};
  const shown = useMemo(() => (state === undefined ? "" : YAML.stringify(state)), [state]);
  const [draft, setDraft] = useState(shown);
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    setDraft(shown);
    setProblem(undefined);
  }, [shown, id]);

  if (!ready && !chat.length) return <p className="text-sm text-ink-muted">Starting the sandbox…</p>;
  if (!chat.length) return <p className="text-sm text-ink-muted">The chat is empty: give the card a greeting, or run the scenario.</p>;

  const apply = () => {
    try {
      const parsed = YAML.parse(draft);
      setProblem(undefined);
      send({ type: "setVariables", id, variables: { ...variables, stat_data: parsed } });
    } catch (e) {
      setProblem(`That isn't valid YAML: ${(e as Error).message.split("\n")[0]}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      <ol aria-label="Messages" className="flex max-h-80 flex-col gap-1 overflow-y-auto md:w-64 md:flex-none">
        {chat.map((m) => {
          const changes = Object.keys((m.variables as { delta_data?: object }).delta_data ?? {}).length;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-current={m.id === id}
                onClick={() => onSelect(m.id)}
                className={`w-full rounded-lg border px-2 py-1.5 text-left text-sm ${m.id === id ? "border-accent bg-accent/10" : "border-border"}`}
              >
                <span className="font-medium">
                  #{m.id} {m.name}
                </span>
                {changes > 0 && <span className="ml-1 text-xs text-accent">{changes === 1 ? "1 change" : `${changes} changes`}</span>}
                <span className="block truncate text-xs text-ink-muted">{preview(m.message)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {message && (
        <section className="flex min-w-0 flex-1 flex-col gap-2" aria-label={`Message ${id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">
              Values at #{id}
              {message.swipes > 1 ? ` · swipe ${message.swipe_id + 1} of ${message.swipes}` : ""}
            </h3>
            {message.swipes > 1 && (
              <>
                <Button variant="ghost" disabled={message.swipe_id === 0} onClick={() => send({ type: "swipeTo", id, swipe: message.swipe_id - 1 })}>
                  Previous swipe
                </Button>
                <Button
                  variant="ghost"
                  disabled={message.swipe_id >= message.swipes - 1}
                  onClick={() => send({ type: "swipeTo", id, swipe: message.swipe_id + 1 })}
                >
                  Next swipe
                </Button>
              </>
            )}
          </div>
          {Object.keys(delta).length > 0 && (
            <ul aria-label="Changes" className="flex flex-col gap-0.5 text-sm">
              {Object.entries(delta).map(([path, [before, after]]) => (
                <li key={path}>
                  <span className="font-medium">{path}</span>: {JSON.stringify(before) ?? "nothing"} → {JSON.stringify(after) ?? "removed"}
                </li>
              ))}
            </ul>
          )}
          {state === undefined ? (
            <p className="text-sm text-ink-muted">No game state on this message.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                stat_data (YAML)
                <AutoTextarea rows={6} value={draft} className="font-mono text-xs" onChange={(e) => setDraft(e.target.value)} />
              </label>
              {problem && <p className="text-sm text-red-300">{problem}</p>}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {state !== undefined && (
              <Button variant="primary" disabled={draft === shown} onClick={apply}>
                Set these values
              </Button>
            )}
            <Button disabled={id === chat.length - 1} onClick={() => send({ type: "rewind", id: id + 1 })}>
              Rewind to here
            </Button>
            <Button variant="ghost" onClick={onReset}>
              Back to the starting values
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ScenarioPane({
  turns,
  autoRun,
  onAutoRun,
  onChange,
  onRun,
  send,
  ready,
}: {
  turns: ScenarioTurn[];
  autoRun: boolean;
  onAutoRun: (on: boolean) => void;
  onChange: (turns: ScenarioTurn[], key?: string) => void;
  onRun: () => void;
  send: (c: SandboxCommand) => void;
  ready: boolean;
}) {
  const [extra, setExtra] = useState("");
  const update = (i: number, turn: ScenarioTurn, key?: string) => onChange(turns.map((t, j) => (j === i ? turn : t)), key);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        The turns played after the greeting. Replies carry their update block, as your model would write it.
      </p>
      <ol aria-label="Turns" className="flex flex-col gap-3">
        {turns.map((t, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Turn ${i + 1} speaker`}
                className={selectClass}
                value={t.role}
                onChange={(e) => update(i, { ...t, role: e.target.value as ScenarioTurn["role"] })}
              >
                <option value="user">You</option>
                <option value="assistant">The character</option>
              </select>
              <span className="flex-1" />
              <Button variant="ghost" disabled={i === 0} onClick={() => onChange([...turns.slice(0, i - 1), t, turns[i - 1], ...turns.slice(i + 1)])}>
                Move up
              </Button>
              <Button variant="ghost" onClick={() => onChange(turns.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
            <AutoTextarea
              aria-label={`Turn ${i + 1}`}
              rows={t.role === "assistant" ? 5 : 1}
              value={t.text}
              className={t.role === "assistant" ? "font-mono text-xs" : ""}
              onChange={(e) => update(i, { ...t, text: e.target.value }, `scenario-${i}`)}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onChange([...turns, { role: turns.at(-1)?.role === "user" ? "assistant" : "user", text: "" }])}>Add a turn</Button>
        <Button variant="primary" onClick={onRun}>
          Run the scenario
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRun} onChange={(e) => onAutoRun(e.target.checked)} />
          Replay it after each change
        </label>
      </div>
      <section className="flex flex-col gap-2 rounded-lg border border-border p-3" aria-label="One more reply">
        <h3 className="font-medium">Try one more reply</h3>
        <p className="text-xs text-ink-muted">Goes into the running chat without changing the scenario. To type as yourself, use the chat's own box.</p>
        <AutoTextarea aria-label="Reply text" rows={4} value={extra} className="font-mono text-xs" onChange={(e) => setExtra(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready || !extra.trim()} onClick={() => send({ type: "reply", text: extra })}>
            Add as a reply
          </Button>
          <Button disabled={!ready || !extra.trim()} onClick={() => send({ type: "swipe", text: extra })}>
            Add as a swipe
          </Button>
          <Button variant="ghost" disabled={!extra.trim()} onClick={() => onChange([...turns, { role: "assistant", text: extra }])}>
            Add to the scenario
          </Button>
        </div>
      </section>
    </div>
  );
}

function ActionsPane({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  if (!log.length)
    return (
      <p className="text-sm text-ink-muted">
        Nothing yet. Messages a panel sends, slash commands, generate calls, toasts and the player's own value edits
        show here.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label="Action log" className="flex max-h-96 flex-col gap-1 overflow-y-auto">
        {log.map((l) => (
          <li key={l.n} className="rounded-md border border-border px-2 py-1 text-sm">
            <span className="font-medium">{l.action}</span> <span className="text-xs text-ink-muted">· {l.source}</span>
            {l.detail && <code className="block break-all text-xs opacity-80">{l.detail}</code>}
          </li>
        ))}
      </ol>
      <Button variant="ghost" className="self-start" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

function ErrorsPane({ problems, onClear }: { problems: Problem[]; onClear: () => void }) {
  if (!problems.length) return <p className="text-sm text-ink-muted">No errors or warnings.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label="Errors and warnings" className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {problems.map((p) => (
          <li key={p.n} className={`rounded-md border px-2 py-1.5 text-sm ${p.level === "error" ? "border-red-500/50" : "border-amber-500/40"}`}>
            <span className={p.level === "error" ? "text-red-300" : "text-amber-300"}>{p.level === "error" ? "Error" : "Warning"}</span>{" "}
            <span className="text-xs text-ink-muted">
              {p.source}
              {p.line ? `, line ${p.line}` : ""}
            </span>
            <p className="break-words">{p.message}</p>
            {p.code && <code className="block break-all text-xs opacity-80">{p.code}</code>}
            {p.stack && (
              <details>
                <summary className="cursor-pointer text-xs text-ink-muted">Stack</summary>
                <pre className="whitespace-pre-wrap text-xs">{p.stack}</pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      <Button variant="ghost" className="self-start" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
