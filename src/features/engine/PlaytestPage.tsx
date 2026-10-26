/**
 * The engine's Playtest tab: the card in the sandbox's stand-in for SillyTavern, played with a real
 * model. Replies, swipes and the card's own side calls go to the models picked in Settings; the
 * state inspector, action log and errors sit under the chat. Game states can be saved and played
 * again from, a reply can be flagged and handed to the UI engineer, and auto-play lets a second
 * model play {{user}} for a few turns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import { resolveModel, useAiSettings } from "../../ai/settings";
import type { ModeId } from "../../ai/types";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { complete, isAbort } from "../../cowriter/engine";
import { getRecord, playtestKey, saveRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { latestState, playerPrompt, replyPrompt, scriptPrompt, type BuiltPrompt, type Persona } from "../../engine/playtest/prompt";
import {
  loadSandboxLibs,
  sandboxDocument,
  sandboxUrl,
  type InjectedPrompt,
  type SandboxCommand,
  type SandboxLibs,
  type SandboxMessage,
  type SandboxReport,
} from "../../engine/sandbox/sandbox";
import { newId } from "../../lib/id";
import { ActionsPane, DEVICES, DeviceFrame, ErrorsPane, StatePane, type Device, type LogEntry, type Problem } from "./SandboxPage";
import { selectClass } from "./VarEditor";

export interface Snapshot {
  id: string;
  name: string;
  state: unknown;
  at: number;
}

interface PlaytestRecord {
  cardId: string;
  persona: Persona;
  snapshots: Snapshot[];
}

const PANES = { state: "State", actions: "Actions", errors: "Errors" } as const;
type Pane = keyof typeof PANES;

const FLAGS = ["The panel didn't update", "Time didn't move", "A value changed wrongly", "A screen looks wrong", "The model ignored the rules"];

/** Auto-play and side calls use their own model when one is picked, else the playtest's. */
function modeFor(mode: ModeId): ModeId {
  const settings = useAiSettings.getState().settings;
  return settings.modeModels[mode] || !settings.modeModels.playtest ? mode : "playtest";
}

/** The auto-player's text without a name label or quotes around it. */
const cleanPlayerText = (text: string, name: string) =>
  text
    .trim()
    .replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "")
    .replace(/^"([\s\S]*)"$/, "$1")
    .trim();

interface TurnCost {
  reply?: number;
  sideCalls: number;
  sideTokens: number;
}

export function PlaytestPage({ onFlag }: { onFlag: (text: string) => void }) {
  const data = useEditor((s) => s.record!.card.data);
  const cardId = useEditor((s) => s.record!.id);
  const { settings, load } = useAiSettings();
  useEffect(() => void load(), [load]);
  const model = resolveModel(settings, "playtest");

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

  const [record, setRecord] = useState<PlaytestRecord>({ cardId: playtestKey(cardId), persona: { name: "You", description: "" }, snapshots: [] });
  useEffect(() => {
    void getRecord<PlaytestRecord>(playtestKey(cardId)).then((r) => r && setRecord(r));
  }, [cardId]);
  const keep = (next: PlaytestRecord) => {
    setRecord(next);
    void saveRecord(next);
  };

  // A playtest keeps the card as it was when it started; the user restarts to pick up changes.
  const [started, setStarted] = useState(data);
  const [restarts, setRestarts] = useState(0);
  const persona = record.persona;
  const url = useMemo(
    () => (libs ? sandboxUrl(sandboxDocument({ data: started, libs, user: persona.name.trim() || "You", playtest: true })) : undefined),
    // The persona's name is read at the start too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libs, started, restarts],
  );
  // Saves can hand back an equal copy of the card, so this compares what's in it.
  const stale = useMemo(() => started !== data && JSON.stringify(started) !== JSON.stringify(data), [started, data]);

  const [device, setDevice] = useState<Device>("phone");
  const [pane, setPane] = useState<Pane>("state");
  const [ready, setReady] = useState(false);
  const [chat, setChat] = useState<SandboxMessage[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selected, setSelected] = useState<number>();
  const [busy, setBusy] = useState<string>();
  const [cost, setCost] = useState<TurnCost>({ sideCalls: 0, sideTokens: 0 });
  const [editing, setEditing] = useState<string>();
  const [turns, setTurns] = useState(3);
  const [goal, setGoal] = useState("");
  const [snapName, setSnapName] = useState("");
  const [flag, setFlag] = useState<{ id: number; reason: string; note: string }>();

  const frame = useRef<HTMLIFrameElement>(null);
  const counter = useRef(0);
  const chatRef = useRef<SandboxMessage[]>([]);
  const injectedRef = useRef<InjectedPrompt[]>([]);
  const controller = useRef<AbortController>(undefined);
  const waiting = useRef(new Map<number, () => void>());
  const pendingSnapshot = useRef<Snapshot>(undefined);
  const startedRef = useRef(started);
  startedRef.current = started;
  const personaRef = useRef(persona);
  personaRef.current = { name: persona.name.trim() || "You", description: persona.description };

  const send = useCallback((command: SandboxCommand) => {
    frame.current?.contentWindow?.postMessage({ cfCommand: command }, "*");
  }, []);
  /** Sends a command and waits until the sandbox has run it, card scripts and all. */
  const call = useCallback(
    (command: SandboxCommand) =>
      new Promise<void>((resolve) => {
        const requestId = 1_000_000 + ++counter.current;
        waiting.current.set(requestId, resolve);
        frame.current?.contentWindow?.postMessage({ cfCommand: { ...command, requestId } }, "*");
      }),
    [],
  );
  const addLog = (source: string, action: string, detail = "") =>
    setLog((l) => [{ n: ++counter.current, source, action, detail }, ...l].slice(0, 300));
  const addProblem = (message: string) => setProblems((p) => [...p, { n: ++counter.current, level: "error" as const, source: "playtest", message }].slice(-100));

  const input = (chatNow = chatRef.current) => ({ data: startedRef.current, chat: chatNow, injected: injectedRef.current, persona: personaRef.current });

  /** Writes the next reply with the roleplay model, streaming it into the chat. */
  const writeReply = useCallback(
    async (kind: "reply" | "swipe") => {
      if (controller.current) return toast("Still writing the last reply.");
      const ctrl = new AbortController();
      controller.current = ctrl;
      setBusy("Writing the reply…");
      let chatNow = chatRef.current;
      if (kind === "swipe" && chatNow.at(-1)?.role === "assistant") chatNow = chatNow.slice(0, -1);
      const prompt: BuiltPrompt = replyPrompt(input(chatNow));
      setCost({ reply: prompt.tokens, sideCalls: 0, sideTokens: 0 });
      addLog("playtest", kind === "swipe" ? "new swipe" : "reply", `~${prompt.tokens} tokens in · lore: ${prompt.lore.join(", ") || "none"}`);
      let text = "";
      send({ type: "typing", text: "" });
      try {
        const result = await complete("playtest", {
          system: prompt.system,
          messages: prompt.messages,
          tools: [],
          signal: ctrl.signal,
          onText: (delta) => {
            text += delta;
            send({ type: "typing", text });
          },
        });
        send({ type: "typing", text: null });
        if (result.text.trim()) await call({ type: kind, text: result.text.trim() });
        else addProblem("The model sent an empty reply.");
      } catch (e) {
        send({ type: "typing", text: null });
        if (!isAbort(e)) addProblem((e as Error).message);
      } finally {
        controller.current = undefined;
        setBusy(undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, call],
  );

  /** A card script's generate or generateRaw call, answered by the side-call model. */
  const answerScript = useCallback(
    async (report: Extract<SandboxReport, { kind: "generate" }>) => {
      const prompt = scriptPrompt({ ...input(report.chat), injected: report.injected }, report.purpose, report.options);
      setCost((c) => ({ ...c, sideCalls: c.sideCalls + 1, sideTokens: c.sideTokens + prompt.tokens }));
      try {
        const result = await complete(modeFor("sidecall"), { system: prompt.system, messages: prompt.messages, tools: [] });
        addLog("side call", report.purpose, `~${prompt.tokens} tokens in · ${result.text.slice(0, 200)}`);
        send({ type: "generated", requestId: report.requestId, text: result.text });
      } catch (e) {
        addProblem(`A side call failed: ${(e as Error).message}`);
        send({ type: "generated", requestId: report.requestId, error: (e as Error).message });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send],
  );

  // A new page starts from nothing.
  useEffect(() => {
    setReady(false);
    setChat([]);
    chatRef.current = [];
    setLog([]);
    setProblems([]);
    setSelected(undefined);
    setCost({ sideCalls: 0, sideTokens: 0 });
  }, [url]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const report = (e.data as { cfSandbox?: SandboxReport })?.cfSandbox;
      if (!report) return;
      const n = ++counter.current;
      switch (report.kind) {
        case "ready":
          setReady(true);
          break;
        case "state": {
          setChat(report.chat);
          chatRef.current = report.chat;
          injectedRef.current = report.injected ?? [];
          // A saved game state goes onto the greeting once the engine has given it its own.
          const snap = pendingSnapshot.current;
          const first = report.chat[0]?.variables as { stat_data?: unknown } | undefined;
          if (snap && first?.stat_data !== undefined) {
            pendingSnapshot.current = undefined;
            send({ type: "setVariables", id: 0, variables: { ...first, stat_data: snap.state, delta_data: {} } });
            toast(`Started from "${snap.name}"`);
          }
          break;
        }
        case "done": {
          const resolve = report.id !== undefined ? waiting.current.get(report.id) : undefined;
          if (resolve) {
            waiting.current.delete(report.id!);
            resolve();
          }
          break;
        }
        case "turn":
          void writeReply("reply");
          break;
        case "generate":
          void answerScript(report);
          break;
        case "log":
          setLog((l) => [{ n, source: report.source, action: report.action, detail: report.detail }, ...l].slice(0, 300));
          break;
        case "console":
          setProblems((p) => [...p, { n, level: report.level, source: report.source, message: report.message }].slice(-100));
          break;
        case "error":
          setProblems((p) => [...p, { n, level: "error" as const, ...report }].slice(-100));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, writeReply, answerScript]);

  const stop = () => controller.current?.abort();
  const restart = (from?: Snapshot) => {
    stop();
    pendingSnapshot.current = from;
    setStarted(useEditor.getState().record!.card.data);
    setRestarts((r) => r + 1);
  };

  const autoPlay = async () => {
    const ctrl = new AbortController();
    const outer = ctrl;
    try {
      // A message of the player's still waiting gets its reply first.
      if (chatRef.current.at(-1)?.role === "user") await writeReply("reply");
      for (let i = 0; i < turns; i++) {
        if (outer.signal.aborted) break;
        setBusy(`Auto-play: turn ${i + 1} of ${turns}…`);
        controller.current = ctrl;
        const prompt = playerPrompt(input(), goal);
        const result = await complete(modeFor("player"), { system: prompt.system, messages: prompt.messages, tools: [], signal: ctrl.signal });
        const text = cleanPlayerText(result.text, personaRef.current.name);
        if (!text) throw new Error("The auto-player sent an empty message.");
        addLog("auto-player", "says", text);
        await call({ type: "send", text });
        controller.current = undefined;
        await writeReply("reply");
        if (outer.signal.aborted) break;
      }
    } catch (e) {
      if (!isAbort(e)) addProblem((e as Error).message);
    } finally {
      controller.current = undefined;
      setBusy(undefined);
    }
  };

  const last = chat.at(-1);
  const state = latestState(chat);
  const saveSnapshot = () => {
    if (state === undefined) return;
    const name = snapName.trim() || `State at #${chat.length - 1}`;
    keep({ ...record, snapshots: [...record.snapshots, { id: newId(), name, state: structuredClone(state), at: Date.now() }] });
    setSnapName("");
    toast(`Saved "${name}"`);
  };

  const sendFlag = () => {
    if (!flag) return;
    const m = chat[flag.id];
    if (!m) return;
    const vars = m.variables as { stat_data?: unknown; delta_data?: Record<string, [unknown, unknown]> };
    const before = latestState(chat.slice(0, flag.id));
    const changes = Object.entries(vars.delta_data ?? {}).map(([path, [a, b]]) => `- ${path}: ${JSON.stringify(a) ?? "nothing"} → ${JSON.stringify(b) ?? "removed"}`);
    const previous = chat[flag.id - 1];
    onFlag(
      [
        `Playtest flag on message #${flag.id}: ${flag.reason}.${flag.note.trim() ? ` ${flag.note.trim()}` : ""}`,
        "Find out why and fix it.",
        previous?.role === "user" ? `\nThe player's message before it:\n${previous.message}` : "",
        `\nThe reply as the model wrote it:\n${m.message}`,
        before !== undefined ? `\nState before:\n${YAML.stringify(before)}` : "",
        vars.stat_data !== undefined ? `State after:\n${YAML.stringify(vars.stat_data)}` : "No game state on this message.",
        changes.length ? `Changes:\n${changes.join("\n")}` : "Nothing changed.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    setFlag(undefined);
  };

  const { width, height } = DEVICES[device];
  const errors = problems.filter((p) => p.level === "error");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Play the card with your real model and the whole engine running: panels, screens, time and the card's own side
        calls. Type in the chat's own box. Sound is off here.
      </p>

      {!model ? (
        <p className="rounded-lg border border-amber-500/40 p-3 text-sm">
          Pick a model for "Playtest roleplay" under Settings, task models (or a default model) to play.
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          Roleplay model: {model.choice.model}
          {cost.reply !== undefined && (
            <>
              {" "}
              · last turn ~{cost.reply} tokens in
              {cost.sideCalls > 0 && `, plus ${cost.sideCalls} side call${cost.sideCalls === 1 ? "" : "s"} (~${cost.sideTokens} tokens)`}
            </>
          )}
        </p>
      )}

      {stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 p-2 text-sm" role="status">
          <span className="flex-1">The card changed since this playtest started.</span>
          <Button onClick={() => restart()}>Restart with the changes</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Playtest">
        <select aria-label="Device" className={selectClass} value={device} onChange={(e) => setDevice(e.target.value as Device)}>
          {(Object.keys(DEVICES) as Device[]).map((d) => (
            <option key={d} value={d}>
              {DEVICES[d].label} ({DEVICES[d].width})
            </option>
          ))}
        </select>
        <Button disabled={!ready || !!busy || last?.role !== "assistant" || chat.length < 2 || !model} onClick={() => void writeReply("swipe")}>
          New swipe
        </Button>
        <Button disabled={!ready || !!busy || !last} onClick={() => setEditing(last?.message ?? "")}>
          Edit the last message
        </Button>
        <Button disabled={!ready || !!busy || chat.length < 2} onClick={() => void call({ type: "rewind", id: chat.length - 1 })}>
          Delete the last message
        </Button>
        {busy ? (
          <Button variant="danger" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => restart()}>
            Restart
          </Button>
        )}
      </div>
      {busy && (
        <p className="text-sm text-accent" role="status">
          {busy}
        </p>
      )}

      {libsFailed ? (
        <p className="text-sm text-red-300">The playtest couldn't load its libraries. Reload CardForge and try again.</p>
      ) : !url ? (
        <p className="text-sm text-ink-muted">Loading the playtest…</p>
      ) : (
        <DeviceFrame
          width={width}
          height={height}
          overlay={
            errors.length > 0 ? (
              <button type="button" className="absolute inset-x-0 top-0 bg-red-950/90 p-2 text-left text-xs text-red-100" onClick={() => setPane("errors")}>
                {errors.length === 1 ? "1 error" : `${errors.length} errors`}: {errors.at(-1)!.message}
              </button>
            ) : undefined
          }
        >
          <iframe
            key={url}
            ref={frame}
            title="Playtest"
            src={url}
            sandbox="allow-scripts allow-same-origin"
            style={{ width, height }}
            className="block border-0"
          />
        </DeviceFrame>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm" aria-label="Auto-play">
        <h2 className="font-medium">Auto-play</h2>
        <p className="text-xs text-ink-muted">A second model plays {persona.name.trim() || "you"} for a few turns, to stress-test the engine.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Turns" className={selectClass} value={turns} onChange={(e) => setTurns(Number(e.target.value))}>
            {[1, 3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "turn" : "turns"}
              </option>
            ))}
          </select>
          <TextInput aria-label="Focus" placeholder="Focus, e.g. spend all the money" className="min-w-0 flex-1" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <Button variant="primary" disabled={!ready || !!busy || !model} onClick={() => void autoPlay()}>
            Auto-play
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm" aria-label="Saved game states">
        <h2 className="font-medium">Saved game states</h2>
        <p className="text-xs text-ink-muted">Save the state as it is now ("day 3, broke, rival angry") and start a new chat from it later.</p>
        <div className="flex flex-wrap gap-2">
          <TextInput aria-label="Name for this state" placeholder="Name, e.g. Day 3, broke" className="min-w-0 flex-1" value={snapName} onChange={(e) => setSnapName(e.target.value)} />
          <Button disabled={state === undefined} onClick={saveSnapshot}>
            Save this state
          </Button>
        </div>
        {record.snapshots.length > 0 && (
          <ul className="flex flex-col gap-1">
            {record.snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <Button onClick={() => restart(s)}>Start from this</Button>
                <Button variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => keep({ ...record, snapshots: record.snapshots.filter((o) => o.id !== s.id) })}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm" aria-label="You in this playtest">
        <h2 className="font-medium">You in this playtest</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <TextInput aria-label="Your name" value={persona.name} onChange={(e) => keep({ ...record, persona: { ...persona, name: e.target.value } })} />
          <TextInput
            aria-label="About you"
            placeholder="About you, for the model (optional)"
            className="sm:col-span-2"
            value={persona.description}
            onChange={(e) => keep({ ...record, persona: { ...persona, description: e.target.value } })}
          />
        </div>
        <p className="text-xs text-ink-muted">A new name takes effect when the playtest restarts.</p>
      </section>

      <div role="tablist" aria-label="Playtest tools" className="flex rounded-lg border border-border p-0.5">
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
        <>
          <StatePane chat={chat} ready={ready} selected={selected} onSelect={setSelected} send={send} onReset={() => restart()} />
          {chat.length > 1 && (
            <Button
              className="self-start"
              onClick={() => {
                const id = selected !== undefined && selected < chat.length ? selected : chat.length - 1;
                setFlag({ id, reason: FLAGS[0], note: "" });
              }}
            >
              Flag this message for the UI engineer
            </Button>
          )}
        </>
      ) : pane === "actions" ? (
        <ActionsPane log={log} onClear={() => setLog([])} />
      ) : (
        <ErrorsPane problems={problems} onClear={() => setProblems([])} />
      )}

      <Dialog open={editing !== undefined} title="Edit the last message" onClose={() => setEditing(undefined)}>
        <div className="flex flex-col gap-3">
          <AutoTextarea aria-label="Message text" rows={8} value={editing ?? ""} className="font-mono text-xs" onChange={(e) => setEditing(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void call({ type: "edit", id: chat.length - 1, text: editing ?? "" });
                setEditing(undefined);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!flag} title={flag ? `Flag message #${flag.id}` : "Flag"} onClose={() => setFlag(undefined)}>
        {flag && (
          <div className="flex flex-col gap-3 text-sm">
            <div role="radiogroup" aria-label="What went wrong" className="flex flex-wrap gap-2">
              {FLAGS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={flag.reason === f}
                  onClick={() => setFlag({ ...flag, reason: f })}
                  className={`min-h-9 rounded-full border px-3 ${flag.reason === f ? "border-accent bg-accent/15 text-accent" : "border-border"}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <AutoTextarea aria-label="What you expected" placeholder="What you expected (optional)" rows={3} value={flag.note} onChange={(e) => setFlag({ ...flag, note: e.target.value })} />
            <p className="text-xs text-ink-muted">The UI engineer gets the reply as written, the player's message before it, and the state before and after.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFlag(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={sendFlag}>
                Send to the UI engineer
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
