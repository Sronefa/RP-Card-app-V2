import { useState } from "react";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { useEditor } from "../../editor/store";
import {
  addAddon,
  ADDONS,
  applyTracker,
  hasAddon,
  newScript,
  newTracker,
  previewReply,
  readTracker,
  regexScripts,
  removeAddon,
  rulesText,
  blockText,
  stageRanges,
  type AddonId,
  type FieldKind,
  type SillyTavernRegex,
  type Stage,
  type TrackerConfig,
  type TrackerField,
} from "../../editor/trackers";
import { readMechanics } from "../../editor/mechanics";
import { isKind, worldMeta } from "../../editor/world";
import { newId } from "../../lib/id";
import { estimateTokens } from "../../lib/tokens";
import { CardBar } from "../editor/CardBar";
import { NoCard } from "../editor/NoCard";
import { MechanicsPage } from "../mechanics/MechanicsPage";

const KIND_LABELS: Record<FieldKind, string> = { bar: "Bar", number: "Number", text: "Text", list: "List" };
const TABS = { tracker: "Status tracker", regex: "Regex scripts", mechanics: "Mechanics" } as const;
type Tab = keyof typeof TABS;

/** Status trackers, relationship stages and the card's regex scripts. Nothing is added until the user adds it. */
export function TrackersView() {
  const record = useEditor((s) => s.record);
  const [tab, setTab] = useState<Tab>("tracker");
  if (!record) return <NoCard />;
  const scripts = regexScripts(record.card.data);
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 pb-3 backdrop-blur">
        <CardBar detail={`${scripts.length} regex script${scripts.length === 1 ? "" : "s"}`} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <h1 className="sr-only">Trackers, regex and mechanics</h1>
        <div role="tablist" aria-label="Trackers, regex and mechanics" className="flex rounded-lg border border-border p-0.5">
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
        {tab === "tracker" ? <TrackerPage /> : tab === "regex" ? <RegexPage /> : <MechanicsPage />}
      </div>
    </div>
  );
}

function useTracker() {
  const data = useEditor((s) => s.record!.card.data);
  const replaceData = useEditor((s) => s.replaceData);
  const config = readTracker(data);
  const save = (next: TrackerConfig | undefined, coalesceKey?: string) =>
    replaceData(applyTracker(useEditor.getState().record!.card.data, next), coalesceKey);
  return { data, config, save };
}

function TrackerPage() {
  const { data, config, save } = useTracker();
  const currency = data.character_book?.entries.find((e) => isKind(e, "currency"));
  const currencyName = currency ? worldMeta(currency)?.fields.name : undefined;
  const toggle = (addon: AddonId) => {
    const base = config ?? newTracker();
    save(hasAddon(base, addon) ? removeAddon(base, addon) : addAddon(base, addon, currencyName));
  };
  const rules = data.character_book?.entries.find((e) => e.comment === "Status block rules" && config);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">
        A status block the model writes at the end of every reply, shown as a panel in SillyTavern by a regex script
        bundled in the card. Add only what this card needs; a card with nothing added stays as it is.
      </p>
      <section className="flex flex-col gap-2" aria-label="Add-ons">
        <h2 className="font-medium">Add-ons</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(ADDONS) as AddonId[]).map((id) => {
            const on = hasAddon(config, id);
            return (
              <li key={id} className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{ADDONS[id].label}</span>
                  <span className="text-sm text-ink-muted">{ADDONS[id].help}</span>
                </div>
                <Button
                  variant={on ? "ghost" : "secondary"}
                  aria-label={`${on ? "Remove" : "Add"} ${ADDONS[id].label}`}
                  onClick={() => toggle(id)}
                >
                  {on ? "Remove" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      {config && config.fields.length > 0 && (
        <>
          <Fields config={config} onChange={save} />
          {hasAddon(config, "relationship") && config.stages && (
            <Stages stages={config.stages} onChange={(stages, key) => save({ ...config, stages }, key)} />
          )}
          <section className="flex flex-col gap-2" aria-label="Look">
            <h2 className="font-medium">Look</h2>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Accent colour
                <input
                  type="color"
                  value={config.accent}
                  className="h-10 w-16 rounded-lg border border-border bg-surface-sunken"
                  onChange={(e) => save({ ...config, accent: e.target.value }, "tracker.accent")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Block tag
                <TextInput
                  value={config.tag}
                  className="w-32"
                  onChange={(e) =>
                    save({ ...config, tag: e.target.value.replace(/[^\w-]/g, "") || "status" }, "tracker.tag")
                  }
                />
              </label>
            </div>
          </section>
          <Preview config={config} scripts={regexScripts(data)} />
          <details className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              What the model is told{rules && ` (~${estimateTokens(rules.content)} tokens, always on near the end of the prompt)`}
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap">{rulesText(config)}</pre>
          </details>
          <Button variant="danger" className="self-start" onClick={() => save(undefined)}>
            Remove the tracker
          </Button>
        </>
      )}
    </div>
  );
}

function Fields({ config, onChange }: { config: TrackerConfig; onChange: (c: TrackerConfig, key?: string) => void }) {
  const modules = readMechanics(useEditor.getState().record!.card.data);
  const mechanicName = (id?: string) => modules.find((m) => m.id === id)?.name ?? "a";
  const set = (id: string, patch: Partial<TrackerField>, key: string) =>
    onChange({ ...config, fields: config.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }, `tracker.${id}.${key}`);
  return (
    <section className="flex flex-col gap-2" aria-label="Fields">
      <h2 className="font-medium">Fields</h2>
      <ul className="flex flex-col gap-2">
        {config.fields.map((f) => {
          const stage = f.addon === "relationship" && f.label === "Stage";
          if (f.addon === "mechanic")
            return (
              <li key={f.id} className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-3 text-sm">
                <span>
                  <span className="font-medium">{f.label}</span>{" "}
                  <span className="text-ink-muted">
                    ({KIND_LABELS[f.kind].toLowerCase()}, starts at {f.kind === "bar" ? `${f.start}/${f.max ?? 100}` : f.start || "nothing"})
                  </span>
                </span>
                {f.rule && <span className="text-ink-muted">{f.rule}</span>}
                <span className="text-xs text-ink-muted">
                  Tracked for the {mechanicName(f.module)} mechanic. Change it on the Mechanics tab.
                </span>
              </li>
            );
          return (
            <li key={f.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-32 flex-1 flex-col gap-1 text-sm">
                  Name
                  <TextInput value={f.label} disabled={stage} onChange={(e) => set(f.id, { label: e.target.value }, "label")} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Kind
                  <select
                    className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm"
                    value={f.kind}
                    disabled={stage}
                    onChange={(e) => set(f.id, { kind: e.target.value as FieldKind }, "kind")}
                  >
                    {Object.entries(KIND_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-sm">
                  Start
                  <TextInput value={f.start} onChange={(e) => set(f.id, { start: e.target.value }, "start")} />
                </label>
                {f.kind === "bar" && (
                  <label className="flex w-20 flex-col gap-1 text-sm">
                    Max
                    <TextInput
                      type="number"
                      min={1}
                      value={f.max ?? 100}
                      onChange={(e) => set(f.id, { max: Math.max(1, Number(e.target.value) || 1) }, "max")}
                    />
                  </label>
                )}
              </div>
              {!stage && (
                <label className="flex flex-col gap-1 text-sm">
                  When it changes
                  <AutoTextarea rows={1} value={f.rule} onChange={(e) => set(f.id, { rule: e.target.value }, "rule")} />
                </label>
              )}
              {stage && <p className="text-xs text-ink-muted">Set from affection by the stages below.</p>}
              {!stage && (
                <Button
                  variant="ghost"
                  className="self-end"
                  aria-label={`Remove field ${f.label}`}
                  onClick={() => onChange({ ...config, fields: config.fields.filter((x) => x.id !== f.id) })}
                >
                  Remove field
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        className="self-start"
        onClick={() =>
          onChange({
            ...config,
            fields: [...config.fields, { id: newId(), label: "New field", kind: "text", start: "", rule: "", addon: "custom" }],
          })
        }
      >
        Add field
      </Button>
    </section>
  );
}

function Stages({ stages, onChange }: { stages: Stage[]; onChange: (stages: Stage[], key?: string) => void }) {
  const ranges = stageRanges(stages);
  const set = (i: number, patch: Partial<Stage>, key: string) =>
    onChange(
      stages.map((s, j) => (j === i ? { ...s, ...patch } : s)),
      `stages.${i}.${key}`,
    );
  return (
    <section className="flex flex-col gap-2" aria-label="Relationship stages">
      <h2 className="font-medium">Relationship stages</h2>
      <p className="text-sm text-ink-muted">
        Each stage is a lorebook entry that switches on when the status block shows it, so {"{{char}}"} acts the way that
        stage says. The model moves between stages as affection rises and falls.
      </p>
      <ul className="flex flex-col gap-2">
        {stages.map((s, i) => {
          const range = ranges.find((r) => r.name === s.name && r.from === s.from);
          return (
            <li key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-32 flex-1 flex-col gap-1 text-sm">
                  Stage
                  <TextInput value={s.name} onChange={(e) => set(i, { name: e.target.value }, "name")} />
                </label>
                <label className="flex w-24 flex-col gap-1 text-sm">
                  From
                  <TextInput
                    type="number"
                    min={0}
                    max={100}
                    value={s.from}
                    onChange={(e) => set(i, { from: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }, "from")}
                  />
                </label>
                <span className="pb-2 text-xs text-ink-muted">{range && `affection ${range.from}–${range.to}`}</span>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                How {"{{char}}"} treats {"{{user}}"}
                <AutoTextarea rows={2} value={s.attitude} onChange={(e) => set(i, { attitude: e.target.value }, "attitude")} />
              </label>
              {stages.length > 1 && (
                <Button
                  variant="ghost"
                  className="self-end"
                  aria-label={`Remove stage ${s.name}`}
                  onClick={() => onChange(stages.filter((_, j) => j !== i))}
                >
                  Remove stage
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        className="self-start"
        onClick={() => onChange([...stages, { name: "Rivals", from: 0, attitude: "{{char}} competes with {{user}} at every turn, with grudging respect." }])}
      >
        Add stage
      </Button>
    </section>
  );
}

const SAMPLE_REPLY = "*{{char}} glances over, a half-smile tugging at their mouth.* \"Took you long enough.\"";

/** The reply as SillyTavern shows it after the regex scripts run, with sample values. */
function Preview({ config, scripts }: { config: TrackerConfig; scripts: SillyTavernRegex[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reply, setReply] = useState(SAMPLE_REPLY);
  const sample = Object.fromEntries(config.fields.map((f) => [f.id, values[f.id] ?? f.start]));
  const raw = `${reply}\n\n${blockText(config, sample)}`;
  return (
    <section className="flex flex-col gap-2" aria-label="Preview">
      <h2 className="font-medium">Preview</h2>
      <p className="text-sm text-ink-muted">How a reply looks in the chat. Change the sample values below to try it.</p>
      <RenderedMessage html={previewReply(scripts, raw)} title="Preview of the reply in SillyTavern" />
      <div className="grid gap-2 sm:grid-cols-2">
        {config.fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1 text-sm">
            Sample {f.label}
            <TextInput value={sample[f.id]} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Sample reply
        <AutoTextarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
      </label>
    </section>
  );
}

/** Shows a message's HTML in a sandbox, roughly as SillyTavern renders it. */
function RenderedMessage({ html, title }: { html: string; title: string }) {
  const body = html
    .split(/(<[^>]+>)/)
    .map((part) => (part.startsWith("<") ? part : part.replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>")))
    .join("");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:12px;font:15px/1.5 system-ui,sans-serif;color:#e7e5ee;background:#1b1a22}
em{color:#bdb8cc}
</style></head><body>${body}</body></html>`;
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={doc}
      className="h-80 w-full rounded-xl border border-border bg-[#1b1a22]"
    />
  );
}

function RegexPage() {
  const data = useEditor((s) => s.record!.card.data);
  const replaceData = useEditor((s) => s.replaceData);
  const tracker = readTracker(data);
  const ours = new Set(tracker?.scriptIds ?? []);
  const scripts = regexScripts(data);
  const [sample, setSample] = useState("");
  const setScripts = (next: SillyTavernRegex[], key?: string) => {
    const current = useEditor.getState().record!.card.data;
    const extensions = { ...current.extensions };
    if (next.length) extensions.regex_scripts = next;
    else delete extensions.regex_scripts;
    replaceData({ ...current, extensions }, key);
  };
  const set = (id: string, patch: Partial<SillyTavernRegex>, key: string) =>
    setScripts(
      scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      `regex.${id}.${key}`,
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Regex scripts travel inside the card; SillyTavern asks to turn them on when the card is imported. Scripts made by
        the status tracker update by themselves.
      </p>
      <ul className="flex flex-col gap-2">
        {scripts.map((s) => {
          const locked = ours.has(s.id);
          return (
            <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3 text-sm">
              {locked ? (
                <>
                  <span className="font-medium">{s.scriptName}</span>
                  <span className="text-xs text-ink-muted">Made by the status tracker. Change the tracker to change it.</span>
                  <details>
                    <summary className="cursor-pointer text-xs text-ink-muted">Show the script</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap break-all">
                      {s.findRegex}
                      {"\n\n"}
                      {s.replaceString || "(removed)"}
                    </pre>
                  </details>
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    Name
                    <TextInput value={s.scriptName} onChange={(e) => set(s.id, { scriptName: e.target.value }, "name")} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Find (regex)
                    <TextInput
                      value={s.findRegex}
                      className="font-mono text-xs"
                      placeholder="/<mood>(.*?)<\/mood>/g"
                      onChange={(e) => set(s.id, { findRegex: e.target.value }, "find")}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Replace with
                    <AutoTextarea
                      rows={2}
                      value={s.replaceString}
                      className="font-mono text-xs"
                      placeholder="<b>Mood: $1</b>"
                      onChange={(e) => set(s.id, { replaceString: e.target.value }, "replace")}
                    />
                  </label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {(
                      [
                        ["AI replies", 2],
                        ["User messages", 1],
                      ] as const
                    ).map(([label, p]) => (
                      <label key={p} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={s.placement.includes(p)}
                          onChange={(e) =>
                            set(
                              s.id,
                              { placement: e.target.checked ? [...s.placement, p] : s.placement.filter((x) => x !== p) },
                              "placement",
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`mode-${s.id}`}
                        className="size-4"
                        checked={s.markdownOnly && !s.promptOnly}
                        onChange={() => set(s.id, { markdownOnly: true, promptOnly: false }, "mode")}
                      />
                      Display only
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`mode-${s.id}`}
                        className="size-4"
                        checked={s.promptOnly && !s.markdownOnly}
                        onChange={() => set(s.id, { markdownOnly: false, promptOnly: true }, "mode")}
                      />
                      Prompt only
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`mode-${s.id}`}
                        className="size-4"
                        checked={!s.markdownOnly && !s.promptOnly}
                        onChange={() => set(s.id, { markdownOnly: false, promptOnly: false }, "mode")}
                      />
                      Edits the message
                    </label>
                  </div>
                  <Button
                    variant="ghost"
                    className="self-end"
                    onClick={() => setScripts(scripts.filter((x) => x.id !== s.id))}
                  >
                    Delete script
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {scripts.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-ink-muted">
          No regex scripts. Add the status tracker, or write your own.
        </p>
      )}
      <Button className="self-start" onClick={() => setScripts([...scripts, newScript()])}>
        Add regex script
      </Button>
      {scripts.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Try the scripts">
          <h2 className="font-medium">Try the scripts</h2>
          <label className="flex flex-col gap-1 text-sm">
            An AI reply
            <AutoTextarea
              rows={3}
              value={sample}
              placeholder="Paste or write a reply to run the scripts on"
              onChange={(e) => setSample(e.target.value)}
            />
          </label>
          {sample.trim() && <RenderedMessage html={previewReply(scripts, sample)} title="The reply after the scripts" />}
        </section>
      )}
    </div>
  );
}
