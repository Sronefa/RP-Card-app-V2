import { useEffect, useRef, useState } from "react";
import { DEFAULT_ENGINEER, engineerSettings, modelInfo, resolveModel, useAiSettings } from "../../ai/settings";
import { formatTokens } from "../../ai/usage";
import { engineerSystemPrompt } from "../../engine/engineer/prompt";
import { contextBreakdown, screenshotTokens } from "../../engine/engineer/usage";
import { UsageMeter } from "../usage/UsageMeter";
import type { ChatMessage, Effort, ToolResult } from "../../ai/types";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { BUILT_IN_SKILLS, EMPTY_OVERRIDES, skillsWith, type SkillOverrides } from "../../engine/engineer/knowledge";
import { useEngineer, type EngineerProposal } from "../../engine/engineer/session";
import { useActivity } from "../../app/activity";
import type { WorkerRun } from "../../engine/engineer/worker";
import { WorkerLive, WorkerSteps } from "./WorkerSteps";
import { describeCall } from "../../engine/engineer/tools";
import type { FileChange } from "../../engine/engineer/workspace";
import { diffLines } from "../../lib/diff";
import { selectClass } from "./VarEditor";

const EFFORTS: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

const STARTERS = [
  "Build a phone app: texts from the characters, a contacts list and a photo gallery.",
  "Add a relationship panel for {{char}}: affection as a meter and the stage as a badge.",
  "Make the status panel look like it belongs in this card's world.",
  "Check every screen on a phone and fix what's wrong.",
];

const STATUS: Record<EngineerProposal["status"], string> = {
  pending: "",
  accepted: "Accepted",
  rejected: "Rejected",
  failed: "Couldn't apply",
  replaced: "Built on in a later proposal",
};

/** The UI engineer: a chat that builds and tests the engine's screens, one proposal per turn. */
export function EngineerPage() {
  const record = useEditor((s) => s.record);
  const { chat, busy: running, runningCardId, streaming, round, worker, error, draft, setDraft, load, send, stop, decide, clear } = useEngineer();
  const activity = useActivity((s) => s.items);
  const end = useRef<HTMLDivElement>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [zoom, setZoom] = useState<string>();

  useEffect(() => {
    if (record) void load(record.id);
  }, [record?.id, load]);

  const count = chat?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [count, streaming, running, chat?.proposals.length, worker?.steps.length]);

  if (!record) return null;
  // A turn on another card runs on in the background; this card's messages wait in line.
  const busy = running && runningCardId === record.id;
  const elsewhere = running && runningCardId !== record.id ? activity.find((i) => i.status === "running") : undefined;
  const queued = activity.filter((i) => i.status === "queued" && i.kind === "engineer" && i.cardId === record.id);

  const results = new Map<string, ToolResult>();
  for (const m of chat?.messages ?? []) if (m.role === "tool") for (const r of m.results) results.set(r.id, r);
  const proposalsAt = new Map<number, EngineerProposal[]>();
  for (const p of chat?.proposals ?? []) proposalsAt.set(p.at, [...(proposalsAt.get(p.at) ?? []), p]);

  function submit(text = draft) {
    const request = text.trim();
    if (!request) return;
    setDraft("");
    void send(request);
  }

  const proposalsAfter = (n: number) =>
    proposalsAt.get(n)?.map((p) => <ProposalView key={p.id} proposal={p} onDecide={(accept) => decide(p.id, accept)} />);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <EngineerControls onSkills={() => setSkillsOpen(true)} onClear={count && !busy ? () => void clear() : undefined} />
      {count === 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            Describe a screen and the UI engineer builds it: it writes the code, runs the card in a hidden sandbox, looks at screenshots on
            a phone, fixes what it sees, and hands you everything as one proposal you accept or reject.
          </p>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-muted hover:border-ink-muted hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {chat?.messages.map((m, i) => (
        <div key={i} className="contents">
          <MessageView message={m} results={results} runs={chat.workerRuns ?? {}} onZoom={setZoom} />
          {proposalsAfter(i + 1)}
        </div>
      ))}
      {busy && (
        <div className="flex flex-col gap-1 text-sm text-ink-muted" aria-live="polite">
          <span className="text-xs">{worker ? "The worker is building…" : `Planning, step ${round}…`}</span>
          {streaming && <span className="leading-relaxed whitespace-pre-wrap">{streaming}</span>}
          {worker && <WorkerLive worker={worker} />}
        </div>
      )}
      {queued.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Waiting in line">
          {queued.map((q) => (
            <li key={q.id} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-ink-muted">Waiting: {q.label}</span>
              <Button variant="ghost" aria-label={`Take "${q.label}" out of the queue`} onClick={() => useActivity.getState().cancel(q.id)}>
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
      {elsewhere && (
        <p className="text-xs text-ink-muted" aria-live="polite">
          The engineer is working on {elsewhere.cardName || "another card"} right now. Messages you send here wait in line and run after it.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <div ref={end} />

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-surface-sunken px-4 pt-3 pb-3">
        <EngineerMeter messages={chat?.messages ?? []} />
        <div className="flex items-end gap-2">
        <AutoTextarea
          aria-label="Message to the UI engineer"
          rows={1}
          value={draft}
          placeholder="Describe a screen or a change…"
          className="max-h-40 min-h-10 overflow-y-auto"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy && <Button onClick={stop}>Stop</Button>}
        {(!busy || draft.trim()) && (
          <Button variant="primary" disabled={!draft.trim()} onClick={() => submit()}>
            {running ? "Queue" : "Send"}
          </Button>
        )}
        </div>
      </div>
      <SkillsDialog open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <Dialog open={!!zoom} title="Screenshot" onClose={() => setZoom(undefined)}>
        {zoom && (
          <img src={zoom} alt="The engineer's screenshot of the preview" className="mx-auto max-h-[70vh] rounded-lg border border-border" />
        )}
      </Dialog>
    </div>
  );
}

/** The engineer's token meter, with what fills its context. */
function EngineerMeter({ messages }: { messages: ChatMessage[] }) {
  const settings = useAiSettings((s) => s.settings);
  const shots = screenshotTokens(messages);
  return (
    <UsageMeter
      scope="engineer"
      breakdown={() => contextBreakdown(engineerSystemPrompt(skillsWith(settings.engineerSkills)), messages)}
      extra={shots.count ? `Screenshots the model still sees: ${shots.count}, about ${formatTokens(shots.tokens)} tokens` : undefined}
    />
  );
}

function EngineerControls({ onSkills, onClear }: { onSkills: () => void; onClear?: () => void }) {
  const { settings, update } = useAiSettings();
  const { skipShots, setSkipShots } = useEngineer();
  const current = engineerSettings(settings);
  const set = (patch: Partial<typeof current>) => void update({ engineer: { ...settings.engineer, ...patch } });
  const model = resolveModel(settings, "engineer");
  const blind = model && modelInfo(settings, model.choice).vision === false;
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Thinking</span>
        <select className={selectClass} value={current.effort} onChange={(e) => set({ effort: e.target.value as Effort })}>
          {(Object.keys(EFFORTS) as Effort[]).map((e) => (
            <option key={e} value={e}>
              {EFFORTS[e]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Most steps per message</span>
        <TextInput
          type="number"
          min={5}
          max={200}
          className="w-24"
          value={current.maxRounds}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (n >= 1) set({ maxRounds: Math.min(200, n) });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">Stop and ask after (tokens)</span>
        <TextInput
          type="number"
          min={0}
          step={10000}
          className="w-32"
          aria-label="Stop and ask after this many tokens"
          placeholder="No limit"
          value={current.tokenLimit || ""}
          onChange={(e) => set({ tokenLimit: Math.max(0, Math.round(Number(e.target.value)) || 0) })}
        />
      </label>
      <Button onClick={onSkills}>Skills</Button>
      {onClear && (
        <Button variant="ghost" onClick={onClear}>
          Clear chat
        </Button>
      )}
      <label className="flex w-full items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={blind || skipShots}
          disabled={blind}
          onChange={(e) => setSkipShots(e.target.checked)}
        />
        <span>
          Skip screenshots this run
          <span className="text-xs text-ink-muted">
            {blind
              ? " (its model can't see images, set in Settings). It checks a text layout report instead."
              : ". It checks a text layout report instead, which costs fewer tokens. You can still open the preview."}
          </span>
        </span>
      </label>
      <span className="w-full text-xs text-ink-muted">
        A lead plans and checks, and a worker builds one task at a time in its own context. Pick their models under Settings, task
        models: UI engineer, and UI engineer worker (the lead's model unless you pick a cheaper one; it should see images). Max
        thinking and {DEFAULT_ENGINEER.maxRounds} steps are the defaults.
      </span>
    </div>
  );
}

function MessageView({
  message,
  results,
  runs,
  onZoom,
}: {
  message: ChatMessage;
  results: Map<string, ToolResult>;
  runs: Record<string, WorkerRun>;
  onZoom: (src: string) => void;
}) {
  if (message.role === "user")
    return (
      <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-sm whitespace-pre-wrap">
        {message.display ?? message.text}
      </div>
    );
  if (message.role === "tool") return null;
  return (
    <div className="flex flex-col gap-1.5">
      {message.text && <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</div>}
      {message.toolCalls.length > 0 && (
        <ul className="flex flex-col gap-1 border-l-2 border-border pl-2 text-xs text-ink-muted" aria-label="What the engineer did">
          {message.toolCalls.map((call) => {
            const result = results.get(call.id);
            const run = runs[call.id];
            if (run)
              return (
                <li key={call.id}>
                  <details>
                    <summary className={`cursor-pointer ${result?.isError ? "text-red-300" : ""}`}>
                      {describeCall(call)} ({run.steps.length} step{run.steps.length === 1 ? "" : "s"}
                      {run.status === "done" ? "" : run.status === "stopped" ? ", stopped" : ", didn't finish"})
                    </summary>
                    <div className="mt-1 pl-3">
                      <WorkerSteps steps={run.steps} />
                    </div>
                  </details>
                </li>
              );
            return (
              <li key={call.id} className="flex flex-col gap-1">
                <span className={result?.isError ? "text-red-300" : ""}>
                  {describeCall(call)}
                  {result?.isError ? `: ${result.content.split("\n")[0].slice(0, 160)}` : ""}
                </span>
                {result?.images?.map((img, n) => {
                  const src = `data:${img.mediaType};base64,${img.data}`;
                  return (
                    <button key={n} type="button" className="self-start" onClick={() => onZoom(src)} aria-label="Enlarge the screenshot">
                      <img src={src} alt="Screenshot of the preview" className="max-h-48 rounded border border-border" />
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProposalView({ proposal, onDecide }: { proposal: EngineerProposal; onDecide: (accept: boolean) => void }) {
  const pending = proposal.status === "pending";
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3 text-sm"
      aria-label={`Proposal ${proposal.number}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          Proposal {proposal.number}: {proposal.changes.length} file{proposal.changes.length === 1 ? "" : "s"} changed
        </span>
        {!pending && (
          <span className={`shrink-0 text-xs ${proposal.status === "accepted" ? "text-accent" : "text-ink-muted"}`}>
            {STATUS[proposal.status]}
          </span>
        )}
      </div>
      {proposal.error && <p className="text-xs text-red-300">{proposal.error}</p>}
      {pending && (
        <>
          <ul className="list-disc pl-5 text-xs text-ink-muted">
            {[...new Set(proposal.summaries)].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {(proposal.errors > 0 || proposal.warnings > 0) && (
            <p className="text-xs text-amber-300">
              The checks still find {proposal.errors} error{proposal.errors === 1 ? "" : "s"} and {proposal.warnings} warning
              {proposal.warnings === 1 ? "" : "s"}. Ask the engineer to fix them, or accept and look in the Modules tab.
            </p>
          )}
          <div className="flex flex-col gap-1">
            {proposal.changes.map((c) => (
              <FileDiff key={c.path} change={c} />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => onDecide(true)}>
              Accept
            </Button>
            <Button variant="ghost" onClick={() => onDecide(false)}>
              Reject
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function FileDiff({ change }: { change: FileChange }) {
  const lines = diffLines(change.before, change.after);
  const added = lines.filter((l) => l.type === "add").length;
  const removed = lines.filter((l) => l.type === "del").length;
  const label = !change.before ? "new" : !change.after ? "removed" : `+${added} −${removed}`;
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-2 px-2 font-mono text-xs">
        <span className="break-all">{change.path}</span>
        <span className="shrink-0 text-ink-muted">{label}</span>
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-border p-2 text-xs leading-snug">
        <div className="w-max min-w-full">
          {lines.map((l, i) => (
            <div
              key={i}
              className={
                l.type === "add"
                  ? "bg-green-500/10 text-green-300"
                  : l.type === "del"
                    ? "bg-red-500/10 text-red-300"
                    : l.type === "gap"
                      ? "text-ink-muted italic"
                      : "text-ink-muted"
              }
            >
              {l.type === "add" ? "+ " : l.type === "del" ? "− " : l.type === "gap" ? "⋯ " : "  "}
              {l.text}
            </div>
          ))}
        </div>
      </pre>
    </details>
  );
}

const skillTemplate = (id: string) =>
  `# ${id.replace(/-/g, " ")}\n\nWhen: the kind of request this is for.\n\n1. First step.\n2. Next step.\n`;

/** The engineer's skills: read, edit, add and remove. Built-in ones can be reset. */
function SkillsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useAiSettings();
  const overrides: SkillOverrides = settings.engineerSkills ?? EMPTY_OVERRIDES;
  const skills = skillsWith(overrides);
  const [editing, setEditing] = useState<{ id: string; text: string; isNew?: boolean }>();
  const [newId, setNewId] = useState("");
  const save = (next: SkillOverrides) => void update({ engineerSkills: next });
  const builtIn = (id: string) => BUILT_IN_SKILLS.find((s) => s.id === id);

  function commit() {
    if (!editing) return;
    const edited = { ...overrides.edited };
    if (builtIn(editing.id)?.text === editing.text.trim()) delete edited[editing.id];
    else edited[editing.id] = editing.text;
    save({ ...overrides, edited });
    setEditing(undefined);
  }

  function remove(id: string) {
    const edited = { ...overrides.edited };
    delete edited[id];
    save({ edited, removed: builtIn(id) ? [...overrides.removed, id] : overrides.removed });
    setEditing(undefined);
  }

  const idProblem = !/^[a-z0-9][a-z0-9-]*$/.test(newId)
    ? "Lowercase letters, digits and dashes."
    : skills.some((s) => s.id === newId) || builtIn(newId)
      ? "That id is taken."
      : "";

  return (
    <Dialog
      open={open}
      title={editing ? `Skill: ${editing.id}` : "UI engineer skills"}
      onClose={editing ? () => setEditing(undefined) : onClose}
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <AutoTextarea
            aria-label="Skill text"
            className="min-h-60 font-mono text-xs"
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {builtIn(editing.id) && overrides.edited[editing.id] !== undefined && (
              <Button variant="ghost" onClick={() => setEditing({ ...editing, text: builtIn(editing.id)!.text })}>
                Reset to built-in
              </Button>
            )}
            {!editing.isNew && (
              <Button variant="danger" onClick={() => remove(editing.id)}>
                Remove
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!editing.text.trim()} onClick={commit}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Playbooks the engineer loads for a job. Change them to teach it your way of building, or add your own.
          </p>
          <ul className="flex flex-col gap-1">
            {skills.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setEditing({ id: s.id, text: s.text })}
                  className="flex w-full flex-col rounded-lg border border-border px-3 py-2 text-left hover:border-ink-muted"
                >
                  <span className="text-sm font-medium">
                    {s.title}
                    {!s.builtIn ? (
                      <span className="ml-2 text-xs text-accent">yours</span>
                    ) : overrides.edited[s.id] !== undefined ? (
                      <span className="ml-2 text-xs text-accent">edited</span>
                    ) : null}
                  </span>
                  {s.when && <span className="text-xs text-ink-muted">{s.when}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-xs text-ink-muted">New skill id</span>
              <TextInput value={newId} placeholder="gacha-screen" onChange={(e) => setNewId(e.target.value.toLowerCase())} />
            </label>
            <Button
              disabled={!!idProblem}
              onClick={() => {
                setEditing({ id: newId, text: skillTemplate(newId), isNew: true });
                setNewId("");
              }}
            >
              Add
            </Button>
          </div>
          {newId && idProblem && <p className="text-xs text-red-300">{idProblem}</p>}
          {overrides.removed.length > 0 && (
            <Button variant="ghost" className="self-start" onClick={() => save({ ...overrides, removed: [] })}>
              Bring back {overrides.removed.length} removed built-in skill{overrides.removed.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
