import { useEffect, useRef, useState } from "react";
import { useUi } from "../../app/store";
import {
  ASK_QUESTIONS,
  readConflicts,
  readModule,
  readQuestions,
  REPORT_CONFLICTS,
  WRITE_MODULE,
  type Conflict,
} from "../../ai/interviewTools";
import { answersText, conflictCheckRequest, mechanicKickoff, moduleWriteRequest, systemPrompt } from "../../ai/prompts";
import type { InterviewRound, Question } from "../../ai/records";
import { resolveModel, useAiSettings } from "../../ai/settings";
import type { CardDataV3 } from "../../card";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { complete, gatherContext, isAbort, partsText } from "../../cowriter/engine";
import type { CardRecord } from "../../db/db";
import {
  activeText,
  applyMechanics,
  galleryImages,
  moduleText,
  moduleTips,
  modulesContext,
  newModule,
  readMechanics,
  setTips,
  toTag,
  type MechanicModule,
  type TrackedValue,
} from "../../editor/mechanics";
import { useEditor } from "../../editor/store";
import { readTracker, rulesText } from "../../editor/trackers";
import { estimateTokens } from "../../lib/tokens";
import { BrainstormDialog } from "../cowriter/BrainstormDialog";
import { QuestionCard } from "../cowriter/QuestionCard";
import { KeysInput } from "../lorebook/KeysInput";
import { SELECTIVE_LOGIC } from "../lorebook/EntryEditor";
import { fromLibrary, loadLibrary, removeFromLibrary, saveToLibrary } from "./library";

const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

const IDEAS = [
  "Mana that drains with spells and refills with rest",
  "A corruption meter that changes how {{user}} is treated",
  "Reputation with each faction",
  "Combat in short exchanges, with wounds that matter",
  "A class with a few signature abilities",
];

/** Runs one co-writer call at a time, with a status line, an error and a Stop button. */
function useRun() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(status: string, fn: (signal: AbortSignal) => Promise<void>) {
    setBusy(status);
    setError(undefined);
    controller.current = new AbortController();
    try {
      await fn(controller.current.signal);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }
  const status = (busy || error) && (
    <>
      {busy && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-ink-muted" aria-live="polite">
            {busy}
          </p>
          <Button variant="ghost" onClick={() => controller.current?.abort()}>
            Stop
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </>
  );
  return { busy, run, status };
}

const trackerText = (data: CardDataV3) => {
  const config = readTracker(data);
  return config ? rulesText(config) : undefined;
};

/** Asks the co-writer whether `candidate` (or, without it, the modules) contradicts anything. */
async function checkConflicts(
  record: CardRecord,
  modules: MechanicModule[],
  candidate: MechanicModule | undefined,
  signal: AbortSignal,
) {
  const data = record.card.data;
  const others = candidate ? modules.filter((m) => m.id !== candidate.id) : modules;
  const parts = await gatherContext(record);
  const result = await complete("mechanics", {
    system: systemPrompt("mechanics"),
    messages: [
      {
        role: "user",
        text: `${partsText(parts)}\n\n${conflictCheckRequest(
          modulesContext(others, trackerText(data)),
          candidate && modulesContext([candidate]),
        )}`,
      },
    ],
    tools: [REPORT_CONFLICTS],
    signal,
  });
  const call = result.toolCalls.find((c) => c.name === REPORT_CONFLICTS.name);
  if (!call) throw new Error("The co-writer didn't report on the rules. Try again.");
  return readConflicts(call);
}

/** Mechanics: game rules baked into the card, written with the Game Wizard. */
export function MechanicsPage() {
  const record = useEditor((s) => s.record)!;
  const replaceData = useEditor((s) => s.replaceData);
  const { settings: ai, load } = useAiSettings();
  const setSection = useUi((s) => s.setSection);
  const data = record.card.data;
  const modules = readMechanics(data);
  const [open, setOpen] = useState<string>();
  const [wizard, setWizard] = useState(false);
  const [library, setLibrary] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>();
  const { busy, run, status } = useRun();

  useEffect(() => void load(), [load]);

  const save = (next: MechanicModule[], coalesceKey?: string) =>
    replaceData(applyMechanics(useEditor.getState().record!.card.data, next), coalesceKey);
  const current = () => readMechanics(useEditor.getState().record!.card.data);
  const add = (m: MechanicModule) => {
    save([...current(), m]);
    setOpen(m.id);
    setConflicts(undefined);
  };

  const checkAll = () =>
    run("Checking the rules against each other…", async (signal) => {
      const found = await checkConflicts(record, modules, undefined, signal);
      setConflicts(found);
    });

  const ready = !!resolveModel(ai, "mechanics");
  const alwaysOn = modules
    .filter((m) => m.activation === "always")
    .reduce((n, m) => n + estimateTokens(moduleText(m, data)), 0);
  const tips = setTips(modules);
  const images = galleryImages(data);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">
        Game rules baked into the card, so they work in SillyTavern with no extension. Each mechanic is a lorebook entry
        with its own tag, placed in the chat where the model pays the most attention, and brought in only when it's
        needed. Values a mechanic tracks show up in the status tracker.
      </p>

      <div className="flex flex-wrap gap-2">
        {ready ? (
          <Button variant="primary" onClick={() => setWizard(true)}>
            ✦ Game Wizard
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setSection("settings")}>
            Set up a model for the Game Wizard
          </Button>
        )}
        <Button onClick={() => setLibrary(true)}>From my library</Button>
        <Button onClick={() => add(newModule({ name: "New mechanic", tag: "new_mechanic" }))}>Write one myself</Button>
      </div>

      {modules.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Modules">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Modules</h2>
            <span className="text-xs text-ink-muted">~{alwaysOn} always-on tokens</span>
          </div>
          {tips.map((t) => (
            <p key={t} className="rounded-lg border border-amber-500/40 p-2 text-sm text-amber-200">
              {t}
            </p>
          ))}
          <ul className="flex flex-col gap-2">
            {modules.map((m, i) => (
              <li key={m.id}>
                <ModuleCard
                  module={m}
                  data={data}
                  open={open === m.id}
                  onToggle={() => setOpen(open === m.id ? undefined : m.id)}
                  onChange={(next, key) =>
                    save(
                      modules.map((x, j) => (j === i ? next : x)),
                      `mechanic.${m.id}.${key}`,
                    )
                  }
                  onDelete={() => {
                    save(modules.filter((x) => x.id !== m.id));
                    toast(`Removed ${m.name || "the module"}. Undo with ↶ if that was a mistake.`);
                  }}
                />
              </li>
            ))}
          </ul>
          {ready && modules.length > 1 && (
            <Button className="self-start" disabled={!!busy} onClick={() => void checkAll()}>
              ✦ Check for contradictions
            </Button>
          )}
          {status}
          {conflicts && <ConflictList conflicts={conflicts} />}
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-muted">Images in mechanics</summary>
        <div className="mt-2 flex flex-col gap-2 text-ink-muted">
          <p>
            A mechanic can show the card's images (icons, scenes, mood art) in the narrator's replies. Add them on the
            Assets page as "Other". SillyTavern only unpacks them from a CHARX file, so export this card as CHARX;
            images inside a PNG card are ignored.
          </p>
          <p>
            The images live in a folder named after the card. Renaming the card in SillyTavern breaks the paths, so keep
            the name.
          </p>
          {images.length > 0 && (
            <ul className="flex flex-col gap-1">
              {images.map(({ asset, path }) => (
                <li key={asset.uri} className="break-all">
                  <span className="text-ink">{asset.name}</span>: {path}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {wizard && (
        <GameWizard
          record={record}
          modules={modules}
          onClose={() => setWizard(false)}
          onAdd={(m, keep) => {
            add(m);
            setWizard(false);
            if (keep) void saveToLibrary(m).then(() => toast(`${m.name} is in your library too.`));
          }}
        />
      )}
      {library && (
        <LibraryDialog
          onClose={() => setLibrary(false)}
          onUse={(m) => {
            add(fromLibrary(m));
            setLibrary(false);
          }}
        />
      )}
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length)
    return (
      <p role="status" className="rounded-lg border border-emerald-500/40 p-2 text-sm text-emerald-200">
        No contradictions: the rules fit together.
      </p>
    );
  return (
    <ul role="status" aria-label="Contradictions" className="flex flex-col gap-2">
      {conflicts.map((c, i) => (
        <li key={i} className="rounded-lg border border-amber-500/40 p-2 text-sm">
          <span className="font-medium text-amber-200">{c.modules.join(" and ") || "Rules"}:</span> {c.problem}
          {c.fix && <span className="block text-ink-muted">Fix: {c.fix}</span>}
        </li>
      ))}
    </ul>
  );
}

function ModuleCard({
  module: m,
  data,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  module: MechanicModule;
  data: CardDataV3;
  open: boolean;
  onToggle: () => void;
  onChange: (m: MechanicModule, key: string) => void;
  onDelete: () => void;
}) {
  const tokens = estimateTokens(moduleText(m, data));
  const tips = moduleTips(m, data);
  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-col gap-1 p-3 text-left"
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="font-medium">
            {m.name || "Unnamed"} <span className="text-xs text-ink-muted">&lt;{m.tag}&gt;</span>
          </span>
          <span className="shrink-0 text-xs text-ink-muted">~{tokens} tokens</span>
        </span>
        {m.summary && <span className="text-sm text-ink-muted">{m.summary}</span>}
        <span className="text-xs text-ink-muted">{activeText(m)}</span>
        {tips.length > 0 && !open && (
          <span className="text-xs text-amber-200">
            {tips.length} tip{tips.length > 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {tips.map((t) => (
            <p key={t} className="rounded-lg border border-amber-500/40 p-2 text-sm text-amber-200">
              {t}
            </p>
          ))}
          <ModuleEditor module={m} data={data} onChange={onChange} />
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted">What the model is told</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap">
              {moduleText(m, data)}
            </pre>
          </details>
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              disabled={!m.name.trim()}
              onClick={() => void saveToLibrary(m).then(() => toast(`Saved ${m.name} to your library.`))}
            >
              Save to my library
            </Button>
            <Button variant="danger" onClick={onDelete}>
              Delete module
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v)) || 0));

function ModuleEditor({
  module: m,
  data,
  onChange,
}: {
  module: MechanicModule;
  data: CardDataV3;
  onChange: (m: MechanicModule, key: string) => void;
}) {
  const set = (patch: Partial<MechanicModule>, key: string) => onChange({ ...m, ...patch }, key);
  const images = galleryImages(data);
  const setTracked = (i: number, patch: Partial<TrackedValue>, key: string) =>
    set({ tracked: m.tracked.map((t, j) => (j === i ? { ...t, ...patch } : t)) }, `tracked.${i}.${key}`);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <TextInput value={m.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tag
          <TextInput value={m.tag} onChange={(e) => set({ tag: toTag(e.target.value) }, "tag")} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        What it does
        <TextInput value={m.summary} onChange={(e) => set({ summary: e.target.value }, "summary")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Rules
        <AutoTextarea rows={3} value={m.rules} onChange={(e) => set({ rules: e.target.value }, "rules")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Example of correct output
        <TextInput value={m.example} onChange={(e) => set({ example: e.target.value }, "example")} />
      </label>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">When it's active</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Activation
            <select
              className={selectClass}
              value={m.activation}
              onChange={(e) => set({ activation: e.target.value as MechanicModule["activation"] }, "activation")}
            >
              <option value="keyed">When keys come up</option>
              <option value="always">Always on</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Depth
            <TextInput
              type="number"
              min={0}
              max={20}
              inputMode="numeric"
              value={m.depth}
              onChange={(e) => set({ depth: num(e.target.value, 0, 20) }, "depth")}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Priority (1-5)
            <TextInput
              type="number"
              min={1}
              max={5}
              inputMode="numeric"
              value={m.priority}
              onChange={(e) => set({ priority: num(e.target.value, 1, 5) }, "priority")}
            />
          </label>
          {m.activation === "keyed" && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Sticky (messages)
                <TextInput
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={m.sticky}
                  onChange={(e) => set({ sticky: num(e.target.value, 0, 50) }, "sticky")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Cooldown (messages)
                <TextInput
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={m.cooldown}
                  onChange={(e) => set({ cooldown: num(e.target.value, 0, 50) }, "cooldown")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Group
                <TextInput
                  value={m.group}
                  placeholder="e.g. mode"
                  onChange={(e) => set({ group: e.target.value }, "group")}
                />
              </label>
            </>
          )}
        </div>
        {m.activation === "keyed" && (
          <>
            <KeysInput label="Keys" keys={m.keys} onChange={(keys) => set({ keys }, "keys")} />
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Secondary keys must match
                <select
                  className={selectClass}
                  value={m.logic}
                  onChange={(e) => set({ logic: Number(e.target.value) }, "logic")}
                >
                  {SELECTIVE_LOGIC.map((l) => (
                    <option key={l.value} value={l.value}>
                      Keys {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <KeysInput
                label="Secondary keys"
                keys={m.secondaryKeys}
                onChange={(secondaryKeys) => set({ secondaryKeys }, "secondary")}
              />
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={m.excludeRecursion}
            onChange={(e) => set({ excludeRecursion: e.target.checked }, "exclude")}
          />
          Other entries can't bring it up
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={m.preventRecursion}
            onChange={(e) => set({ preventRecursion: e.target.checked }, "prevent")}
          />
          Its text doesn't bring up other entries
        </label>
        <p className="text-xs text-ink-muted">{activeText(m)}</p>
      </fieldset>

      <section className="flex flex-col gap-2" aria-label="Tracked values">
        <h3 className="text-sm font-medium">Tracked values</h3>
        <p className="text-xs text-ink-muted">
          These are added to the status tracker, so the rules and the status panel match.
        </p>
        {m.tracked.map((t, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-28 flex-1 flex-col gap-1 text-sm">
                Label
                <TextInput value={t.label} onChange={(e) => setTracked(i, { label: e.target.value }, "label")} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Kind
                <select
                  className={selectClass}
                  value={t.kind}
                  onChange={(e) => setTracked(i, { kind: e.target.value as TrackedValue["kind"] }, "kind")}
                >
                  <option value="bar">Bar</option>
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                  <option value="list">List</option>
                </select>
              </label>
              <label className="flex w-24 flex-col gap-1 text-sm">
                Start
                <TextInput value={t.start} onChange={(e) => setTracked(i, { start: e.target.value }, "start")} />
              </label>
              {t.kind === "bar" && (
                <label className="flex w-20 flex-col gap-1 text-sm">
                  Max
                  <TextInput
                    type="number"
                    min={1}
                    value={t.max ?? 100}
                    onChange={(e) => setTracked(i, { max: num(e.target.value, 1, 100000) }, "max")}
                  />
                </label>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              When it changes
              <TextInput value={t.rule} onChange={(e) => setTracked(i, { rule: e.target.value }, "rule")} />
            </label>
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => set({ tracked: m.tracked.filter((_, j) => j !== i) }, "tracked")}
            >
              Stop tracking {t.label || "it"}
            </Button>
          </div>
        ))}
        <Button
          className="self-start"
          onClick={() =>
            set({ tracked: [...m.tracked, { label: "", kind: "number", start: "0", rule: "" }] }, "tracked")
          }
        >
          Track a value
        </Button>
      </section>

      {images.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Images">
          <h3 className="text-sm font-medium">Images</h3>
          {images.map(({ asset }) => {
            const i = m.images.findIndex((img) => img.uri === asset.uri);
            return (
              <div key={asset.uri} className="flex flex-col gap-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={i !== -1}
                    onChange={(e) =>
                      set(
                        {
                          images: e.target.checked
                            ? [...m.images, { uri: asset.uri, when: "" }]
                            : m.images.filter((img) => img.uri !== asset.uri),
                        },
                        "images",
                      )
                    }
                  />
                  Show {asset.name}
                </label>
                {i !== -1 && (
                  <TextInput
                    aria-label={`When to show ${asset.name}`}
                    placeholder="When to show it"
                    value={m.images[i].when}
                    onChange={(e) =>
                      set(
                        { images: m.images.map((img, j) => (j === i ? { ...img, when: e.target.value } : img)) },
                        `images.${i}`,
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/** Describe a mechanic, answer a few questions, get a module with its trigger setup. */
function GameWizard({
  record,
  modules,
  onClose,
  onAdd,
}: {
  record: CardRecord;
  modules: MechanicModule[];
  onClose: () => void;
  onAdd: (m: MechanicModule, keepInLibrary: boolean) => void;
}) {
  const [description, setDescription] = useState("");
  const [round, setRound] = useState<InterviewRound>();
  const [module, setModule] = useState<MechanicModule>();
  const [conflicts, setConflicts] = useState<Conflict[]>();
  const [keep, setKeep] = useState(false);
  const [brainstorm, setBrainstorm] = useState<Question>();
  const { busy, run, status } = useRun();
  const data = record.card.data;
  const existing = modulesContext(modules, trackerText(data));

  const ask = () =>
    run("Preparing questions…", async (signal) => {
      const parts = await gatherContext(record);
      const result = await complete("mechanics", {
        system: systemPrompt("mechanics"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${mechanicKickoff(description, existing)}` }],
        tools: [ASK_QUESTIONS],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === ASK_QUESTIONS.name);
      const questions = call ? readQuestions(call) : [];
      if (!questions.length)
        throw new Error("The co-writer didn't ask any questions. Try again, or pick another model.");
      setRound({ callId: call!.id, questions, answers: {}, submitted: false });
    });

  const write = (previous?: Conflict[]) =>
    run(previous ? "Rewriting it to fit…" : "Writing the module…", async (signal) => {
      const parts = await gatherContext(record);
      const result = await complete("mechanics", {
        system: systemPrompt("mechanics"),
        messages: [
          {
            role: "user",
            text: `${partsText(parts)}\n\n${moduleWriteRequest({
              description,
              answers: round ? answersText(round) : "",
              existing,
              images: galleryImages(data).map(({ asset }) => asset.name),
              conflicts: previous?.map((c) => `- ${c.problem} ${c.fix}`).join("\n"),
            })}`,
          },
        ],
        tools: [WRITE_MODULE],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === WRITE_MODULE.name);
      if (!call) throw new Error("The co-writer didn't write the module. Try again.");
      const written = readModule(call, data.assets ?? []);
      if (!written.rules) throw new Error("The module came back without rules. Try again.");
      setModule(written);
      setConflicts(undefined);
      // New modules are checked against the existing ones right away.
      if (modules.length || readTracker(data)) setConflicts(await checkConflicts(record, modules, written, signal));
      else setConflicts([]);
    });

  return (
    <Dialog open title="Game Wizard" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {module ? (
          <>
            {conflicts ? (
              <ConflictList conflicts={conflicts} />
            ) : (
              busy && <p className="text-sm text-ink-muted">Checking it against the other rules…</p>
            )}
            <p className="text-sm">
              {module.summary}{" "}
              <span className="text-ink-muted">~{estimateTokens(moduleText(module, data))} tokens.</span>
            </p>
            {moduleTips(module, data).map((t) => (
              <p key={t} className="rounded-lg border border-amber-500/40 p-2 text-sm text-amber-200">
                {t}
              </p>
            ))}
            <ModuleEditor module={module} data={data} onChange={(m) => setModule(m)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Also save it to my library for other projects
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              {conflicts?.length ? (
                <Button disabled={!!busy} onClick={() => void write(conflicts)}>
                  ✦ Rewrite it to fit
                </Button>
              ) : (
                <Button variant="ghost" disabled={!!busy} onClick={() => void write()}>
                  Write it again
                </Button>
              )}
              <Button variant="primary" disabled={!module.name.trim() || !!busy} onClick={() => onAdd(module, keep)}>
                Add to the card
              </Button>
            </div>
          </>
        ) : round ? (
          <>
            {round.questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                answer={round.answers[q.id] ?? ""}
                onAnswer={(a) => setRound({ ...round, answers: { ...round.answers, [q.id]: a } })}
                onBrainstorm={() => setBrainstorm(q)}
              />
            ))}
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void write()}>
              Write the module
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Describe the mechanic in plain words. The wizard asks a few questions, then writes the rules and sets up
              when they come into play. No dice: the narrator decides from the rules and the story.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              The mechanic
              <AutoTextarea
                rows={3}
                value={description}
                placeholder="e.g. {{user}} has mana that drains with each spell and refills when they rest"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="rounded-full border border-border px-3 py-1 text-xs text-ink-muted hover:text-ink"
                  onClick={() => setDescription(idea)}
                >
                  {idea.replace("{{user}}", "you")}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!description.trim() || !!busy} onClick={() => void ask()}>
                Next
              </Button>
              <Button variant="ghost" disabled={!description.trim() || !!busy} onClick={() => void write()}>
                Skip the questions
              </Button>
            </div>
          </>
        )}
        {status}
      </div>
      {brainstorm && round && (
        <BrainstormDialog
          key={brainstorm.id}
          question={brainstorm}
          known={answersText({ ...round, questions: round.questions.filter((q) => round.answers[q.id]?.trim()) })}
          onUse={(a) => setRound({ ...round, answers: { ...round.answers, [brainstorm.id]: a } })}
          onClose={() => setBrainstorm(undefined)}
        />
      )}
    </Dialog>
  );
}

function LibraryDialog({ onClose, onUse }: { onClose: () => void; onUse: (m: MechanicModule) => void }) {
  const [list, setList] = useState<MechanicModule[]>();
  useEffect(() => void loadLibrary().then(setList), []);
  return (
    <Dialog open title="My mechanics library" onClose={onClose}>
      {!list ? null : list.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing saved yet. Open a module and press "Save to my library" to reuse it in other projects.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm">
              <span className="font-medium">{m.name}</span>
              {m.summary && <span className="text-ink-muted">{m.summary}</span>}
              <div className="mt-1 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  aria-label={`Delete ${m.name} from the library`}
                  onClick={() => void removeFromLibrary(m.id).then(setList)}
                >
                  Delete
                </Button>
                <Button variant="primary" aria-label={`Use ${m.name}`} onClick={() => onUse(m)}>
                  Use
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
