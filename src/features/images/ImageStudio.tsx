import { useEffect, useRef, useState } from "react";
import { useAiSettings } from "../../ai/settings";
import { withCowriterDefaults } from "../../ai/records";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { isAbort } from "../../cowriter/engine";
import { getProject, saveProject, type CardRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { fillSheet } from "../../images/fill";
import { writePrompt } from "../../images/prompt";
import { useImageQueue } from "../../images/queue";
import { GeneratePanel } from "./GeneratePanel";
import { FromLibrary, SaveToLibrary } from "../library/LibraryButtons";
import { shotsFor, type Payloads } from "../../lib/libraries";
import {
  customShot,
  duplicateWith,
  emotionsOf,
  loadStudio,
  mergeShots,
  proposeShots,
  updateStudio,
  SHOT_GROUPS,
  ST_EXPRESSIONS,
  type EmotionSet,
  type Shot,
  type ShotGroup,
  type StudioRecord,
} from "../../images/shots";
import {
  gapsOf,
  lockFromStyle,
  mergeSheet,
  newOutfit,
  newStyleLock,
  OUTFIT_NAMES,
  PROMPT_BUDGET,
  SHEET_FIELDS,
  sheetOf,
  subjectsOf,
  writeSheet,
  type ModelFamily,
  type Outfit,
  type StyleLock,
  type Subject,
  type VisualSheet,
} from "../../images/visual";

const TABS = {
  bible: "Visual bible",
  shots: "Shot list",
  generate: "Generate",
  style: "Style lock",
} as const;
type Tab = keyof typeof TABS;
const select = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

/** The project's style lock, loaded and saved with the project's co-writer settings. */
function useStyleLock(projectId: string) {
  const [lock, setLock] = useState<StyleLock>();
  useEffect(() => {
    void getProject(projectId).then((p) => setLock(p?.cowriter?.styleLock ?? newStyleLock()));
  }, [projectId]);
  const save = (next: StyleLock) => {
    setLock(next);
    void getProject(projectId).then(
      (p) =>
        p &&
        saveProject({
          ...p,
          cowriter: { ...withCowriterDefaults(p.cowriter), styleLock: next },
        }),
    );
  };
  return { lock, save };
}

/** Plans the card's images: the look of everyone and everywhere, the shots, and their prompts. */
export function ImageStudio({ record }: { record: CardRecord }) {
  const [tab, setTab] = useState<Tab>("bible");
  const { lock, save: saveLock } = useStyleLock(record.projectId);
  const [studio, setStudio] = useState<StudioRecord>();

  useEffect(() => {
    void loadStudio(record.id).then(setStudio);
  }, [record.id]);
  const version = useImageQueue((q) => q.version);
  // New candidates from the queue.
  useEffect(() => {
    if (version) void loadStudio(record.id).then(setStudio);
  }, [version, record.id]);
  const writes = useRef(0);
  const change = (fn: (s: StudioRecord) => StudioRecord) => {
    setStudio((s) => s && fn(s));
    const n = ++writes.current;
    // Only the last write's result is shown; earlier ones would undo later optimistic changes.
    void updateStudio(record.id, fn).then((saved) => n === writes.current && setStudio(saved));
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Image Studio">
      <div role="tablist" aria-label="Image Studio" className="flex rounded-lg border border-border p-0.5">
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
      {tab === "bible" ? (
        <VisualBible record={record} />
      ) : tab === "shots" ? (
        studio && lock ? (
          <ShotList record={record} studio={studio} lock={lock} change={change} />
        ) : null
      ) : tab === "generate" ? (
        studio ? (
          <GeneratePanel record={record} studio={studio} change={change} />
        ) : null
      ) : lock ? (
        <StyleLockEditor lock={lock} save={saveLock} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- visual bible

function VisualBible({ record }: { record: CardRecord }) {
  const data = record.card.data;
  const subjects = subjectsOf(data, record.kind);
  const [key, setKey] = useState(subjects[0]?.key);
  const subject = subjects.find((s) => s.key === key) ?? subjects[0];
  if (!subject)
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
        Nothing to draw yet. Add NPCs, places or items on the world pages and they get a sheet here.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Every prompt is built from these sheets, so a character looks the same in every image. Lock a field to keep the co-writer
        from changing it.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Sheet
        <select className={select} value={subject.key} onChange={(e) => setKey(e.target.value)}>
          {subjects.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name} ({SHEET_FIELDS[s.kind].label.toLowerCase()})
            </option>
          ))}
        </select>
      </label>
      <SheetEditor key={subject.key} subject={subject} />
    </div>
  );
}

function SheetEditor({ subject }: { subject: Subject }) {
  const data = useEditor((s) => s.record!.card.data);
  const sheet = sheetOf(data, subject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);

  const save = (next: VisualSheet, coalesceKey?: string) => {
    const current = useEditor.getState().record!.card.data;
    useEditor
      .getState()
      .replaceData(writeSheet(current, subject.key, next), coalesceKey && `visual.${subject.key}.${coalesceKey}`);
  };
  const isLocked = (k: string) => sheet.locked.includes(k);
  const toggleLock = (k: string) =>
    save({
      ...sheet,
      locked: isLocked(k) ? sheet.locked.filter((x) => x !== k) : [...sheet.locked, k],
    });

  async function fill() {
    setBusy(true);
    setError(undefined);
    controller.current = new AbortController();
    try {
      const d = useEditor.getState().record!.card.data;
      const context = [d.name, d.description, d.scenario].filter((t) => t.trim()).join("\n\n");
      const answered = questions.map((q, i) => ({ question: q, answer: answers[i]?.trim() ?? "" })).filter((a) => a.answer);
      const result = await fillSheet(subject, sheetOf(d, subject), context, answered, controller.current.signal);
      save(mergeSheet(sheetOf(useEditor.getState().record!.card.data, subject), result));
      setQuestions(result.questions);
      setAnswers({});
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const lockButton = (k: string, label: string) => (
    <button
      type="button"
      aria-pressed={isLocked(k)}
      aria-label={`${isLocked(k) ? "Unlock" : "Lock"} ${label}`}
      title={isLocked(k) ? "Locked: the co-writer leaves it" : "Lock it"}
      onClick={() => toggleLock(k)}
      className={`shrink-0 px-2 text-sm ${isLocked(k) ? "text-accent" : "text-ink-muted"}`}
    >
      {isLocked(k) ? "🔒" : "🔓"}
    </button>
  );
  const gaps = gapsOf(sheet).length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void fill()}>
          {busy ? "Filling…" : questions.length ? "✦ Answer and fill" : "✦ Fill from the card"}
        </Button>
        <span className="flex-1 text-xs text-ink-muted">{gaps ? `${gaps} empty fields` : "Every field is filled"}</span>
        <SaveToLibrary
          kind="sheet"
          name={subject.name}
          payload={() => {
            const { reference: _r, referenceSeed: _s, ...rest } = sheetOf(useEditor.getState().record!.card.data, subject);
            return rest;
          }}
        />
        <FromLibrary
          kind="sheet"
          onUse={(item) => {
            if (item.payload.kind !== sheet.kind) return toast(`${item.name} is a ${item.payload.kind} sheet; this one is a ${sheet.kind}.`);
            save({ ...structuredClone(item.payload), reference: sheet.reference, referenceSeed: sheet.referenceSeed });
            toast(`${subject.name} has the look of ${item.name} now`);
          }}
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {questions.length > 0 && (
        <section aria-label="Questions" className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-2">
          <span className="text-xs text-ink-muted">The card leaves these open. Answer what you like, then fill again.</span>
          {questions.map((q, i) => (
            <label key={i} className="flex flex-col gap-1 text-sm">
              {q}
              <TextInput value={answers[i] ?? ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} />
            </label>
          ))}
        </section>
      )}

      {SHEET_FIELDS[sheet.kind].groups.map((g) => (
        <fieldset key={g.label} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{g.label}</legend>
          {g.fields.map((f) => (
            <div key={f.key} className="flex items-end gap-1">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {f.label}
                <TextInput
                  placeholder={f.hint}
                  value={sheet.fields[f.key] ?? ""}
                  onChange={(e) =>
                    save(
                      {
                        ...sheet,
                        fields: { ...sheet.fields, [f.key]: e.target.value },
                      },
                      f.key,
                    )
                  }
                />
              </label>
              {lockButton(f.key, f.label)}
            </div>
          ))}
        </fieldset>
      ))}

      {sheet.kind === "character" && <Outfits sheet={sheet} save={save} lockButton={lockButton} />}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
          Signature details {lockButton("signature", "signature details")}
        </legend>
        <span className="text-xs text-ink-muted">Three or four traits in every image. Prompts never trim these.</span>
        {[0, 1, 2, 3].map((i) => (
          <TextInput
            key={i}
            aria-label={`Signature detail ${i + 1}`}
            value={sheet.signature[i] ?? ""}
            onChange={(e) => {
              const next = [...sheet.signature];
              next[i] = e.target.value;
              save({ ...sheet, signature: next.map((s) => s ?? "") }, `signature.${i}`);
            }}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">LoRA for local ComfyUI</legend>
        <div className="grid grid-cols-2 gap-2">
          <TextInput
            aria-label="LoRA file"
            placeholder="LoRA file"
            value={sheet.lora?.name ?? ""}
            onChange={(e) =>
              save(
                {
                  ...sheet,
                  lora: { trigger: "", ...sheet.lora, name: e.target.value },
                },
                "lora",
              )
            }
          />
          <TextInput
            aria-label="Trigger word"
            placeholder="Trigger word"
            value={sheet.lora?.trigger ?? ""}
            onChange={(e) =>
              save(
                {
                  ...sheet,
                  lora: { name: "", ...sheet.lora, trigger: e.target.value },
                },
                "trigger",
              )
            }
          />
        </div>
      </fieldset>
    </div>
  );
}

function Outfits({
  sheet,
  save,
  lockButton,
}: {
  sheet: VisualSheet;
  save: (next: VisualSheet, coalesceKey?: string) => void;
  lockButton: (k: string, label: string) => React.ReactNode;
}) {
  const [adding, setAdding] = useState("");
  const set = (i: number, patch: Partial<Outfit>, key: string) =>
    save(
      {
        ...sheet,
        outfits: sheet.outfits.map((o, j) => (j === i ? { ...o, ...patch } : o)),
      },
      `outfit.${i}.${key}`,
    );
  const free = OUTFIT_NAMES.filter((n) => !sheet.outfits.some((o) => o.name === n));
  const parts: { key: keyof Outfit; label: string }[] = [
    { key: "garments", label: "Garments" },
    { key: "colors", label: "Colours" },
    { key: "materials", label: "Materials" },
    { key: "accessories", label: "Accessories" },
    { key: "footwear", label: "Footwear" },
    { key: "item", label: "Economy item" },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Wardrobe</legend>
      {sheet.outfits.map((o, i) => (
        <details key={i} className="rounded-lg border border-border p-2" open={i === 0}>
          <summary className="flex cursor-pointer items-center justify-between text-sm">
            <span className="capitalize">{o.name}</span>
            <span className="flex items-center">
              {lockButton(`outfit:${o.name.toLowerCase()}`, `the ${o.name} outfit`)}
              {o.name !== "default" && (
                <button
                  type="button"
                  aria-label={`Remove the ${o.name} outfit`}
                  className="px-2 text-ink-muted"
                  onClick={() =>
                    save({
                      ...sheet,
                      outfits: sheet.outfits.filter((_, j) => j !== i),
                    })
                  }
                >
                  ✕
                </button>
              )}
            </span>
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {parts.map((p) => (
              <label key={p.key} className="flex flex-col gap-1 text-xs">
                {p.label}
                <TextInput value={o[p.key] ?? ""} onChange={(e) => set(i, { [p.key]: e.target.value }, p.key)} />
              </label>
            ))}
          </div>
        </details>
      ))}
      <div className="flex gap-2">
        <TextInput
          aria-label="New outfit"
          list="outfit-names"
          placeholder={free[0] ? `e.g. ${free[0]}` : "Outfit name"}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <datalist id="outfit-names">
          {free.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Button
          disabled={!adding.trim() || sheet.outfits.some((o) => o.name.toLowerCase() === adding.trim().toLowerCase())}
          onClick={() => {
            save({
              ...sheet,
              outfits: [...sheet.outfits, newOutfit(adding.trim().toLowerCase())],
            });
            setAdding("");
          }}
        >
          Add outfit
        </Button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- shot list

function ShotList({
  record,
  studio,
  lock,
  change,
}: {
  record: CardRecord;
  studio: StudioRecord;
  lock: StyleLock;
  change: (fn: (s: StudioRecord) => StudioRecord) => void;
}) {
  const data = record.card.data;
  const [custom, setCustom] = useState("");
  const [labels, setLabels] = useState(studio.customEmotions.join(", "));
  const [open, setOpen] = useState<string>();
  const shots = studio.shots;
  const setShots = (next: Shot[]) => change((s) => ({ ...s, shots: next }));
  const setShot = (id: string, patch: Partial<Shot>) => setShots(shots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const planned = shots.filter((s) => !s.skip).length;

  /** A saved setup: its shots for this card's subjects, its emotion set, and its ComfyUI workflows on the first ComfyUI provider. */
  function applySetup(setup: Payloads["image"]) {
    const subjects = new Set(subjectsOf(data, record.kind).map((x) => x.key));
    change((s) => ({
      ...s,
      shots: mergeShots(s.shots, shotsFor(setup.shots, subjects)),
      emotionSet: setup.emotionSet,
      customEmotions: setup.customEmotions,
    }));
    setLabels(setup.customEmotions.join(", "));
    const ai = useAiSettings.getState();
    const providers = ai.settings.imageProviders ?? [];
    const comfy = providers.find((p) => p.kind === "comfyui");
    if (comfy && setup.workflows.length) {
      const ids = new Set((comfy.workflows ?? []).map((w) => w.id));
      const added = setup.workflows.filter((w) => !ids.has(w.id));
      if (added.length)
        void ai.update({ imageProviders: providers.map((p) => (p === comfy ? { ...p, workflows: [...(p.workflows ?? []), ...added] } : p)) });
    }
    toast(`Added the setup's shots`);
  }

  function propose() {
    const next = mergeShots(shots, proposeShots(data, record.kind, { emotions: emotionsOf(studio) }));
    toast(next.length > shots.length ? `Added ${next.length - shots.length} shots` : "The list already has every suggested shot");
    setShots(next);
  }

  const groups = (Object.keys(SHOT_GROUPS) as ShotGroup[]).filter((g) => shots.some((s) => s.group === g));

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Emotion set</legend>
        <div role="radiogroup" aria-label="Emotion set" className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ["full", `Full SillyTavern set (${ST_EXPRESSIONS.length})`],
              ["core", "8 core moods"],
              ["custom", "My own labels"],
            ] as [EmotionSet, string][]
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1">
              <input
                type="radio"
                name="emotion-set"
                checked={studio.emotionSet === v}
                onChange={() => change((s) => ({ ...s, emotionSet: v }))}
              />
              {label}
            </label>
          ))}
        </div>
        {studio.emotionSet === "custom" && (
          <TextInput
            aria-label="Emotion labels"
            placeholder="joy, smug, flustered"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            onBlur={() =>
              change((s) => ({
                ...s,
                customEmotions: labels
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              }))
            }
          />
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={propose}>
          ✦ Suggest shots from the card
        </Button>
        <SaveToLibrary
          kind="image"
          name={`${data.name || "Card"} shots`}
          label="Save as a setup"
          payload={() => ({
            shots,
            emotionSet: studio.emotionSet,
            customEmotions: studio.customEmotions,
            workflows: (useAiSettings.getState().settings.imageProviders ?? []).flatMap((p) => p.workflows ?? []),
          })}
        />
        <FromLibrary kind="image" label="Use a setup" onUse={(item) => applySetup(item.payload)} />
        <span className="text-sm text-ink-muted" aria-live="polite">
          {planned} {planned === 1 ? "image" : "images"} planned · cost shows once an image provider is set up
        </span>
      </div>

      <div className="flex gap-2">
        <TextInput
          aria-label="Describe a shot"
          placeholder="A shot in your own words"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <Button
          disabled={!custom.trim()}
          onClick={() => {
            setShots([...shots, customShot(custom, subjectsOf(data, record.kind)[0])]);
            setCustom("");
          }}
        >
          Add shot
        </Button>
      </div>

      {groups.map((g) => {
        const list = shots.filter((s) => s.group === g);
        return (
          <section key={g} aria-label={SHOT_GROUPS[g]} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {SHOT_GROUPS[g]} <span className="text-ink-muted">({list.filter((s) => !s.skip).length})</span>
              </h3>
              <Button
                variant="ghost"
                onClick={() => setShots(shots.map((s) => (s.group === g ? { ...s, skip: !list.every((x) => x.skip) } : s)))}
              >
                {list.every((s) => s.skip) ? "Include all" : "Skip all"}
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {list.map((s) => (
                <li key={s.id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 p-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Include ${s.label}`}
                      checked={!s.skip}
                      onChange={(e) => setShot(s.id, { skip: !e.target.checked })}
                    />
                    <button
                      type="button"
                      className={`flex-1 text-left ${s.skip ? "text-ink-muted line-through" : ""}`}
                      onClick={() => setOpen(open === s.id ? undefined : s.id)}
                    >
                      {s.label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${s.label}`}
                      className="px-1 text-ink-muted"
                      onClick={() => setShots(shots.filter((x) => x.id !== s.id))}
                    >
                      ✕
                    </button>
                  </div>
                  {open === s.id && (
                    <ShotPrompt
                      shot={s}
                      record={record}
                      lock={lock}
                      onEdit={(prompt) => setShot(s.id, { prompt })}
                      onDuplicate={(change) => {
                        const i = shots.findIndex((x) => x.id === s.id);
                        setShots([...shots.slice(0, i + 1), duplicateWith(s, change), ...shots.slice(i + 1)]);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ShotPrompt({
  shot,
  record,
  lock,
  onEdit,
  onDuplicate,
}: {
  shot: Shot;
  record: CardRecord;
  lock: StyleLock;
  onEdit: (prompt: Shot["prompt"]) => void;
  onDuplicate: (change: string) => void;
}) {
  const written = writePrompt(record.card.data, record.kind, shot, lock);
  const [change, setChange] = useState("");
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast("Copied"),
      () => toast("Couldn't copy", "error"),
    );
  return (
    <div className="flex flex-col gap-2 border-t border-border p-2">
      <label className="flex flex-col gap-1 text-xs">
        Prompt
        <AutoTextarea
          aria-label={`Prompt for ${shot.label}`}
          value={written.positive}
          onChange={(e) => onEdit({ positive: e.target.value, negative: written.negative })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Negative prompt
        <AutoTextarea
          value={written.negative}
          onChange={(e) => onEdit({ positive: written.positive, negative: e.target.value })}
        />
      </label>
      <p className="text-xs text-ink-muted">
        ~{written.tokens} of {written.budget} tokens for {PROMPT_BUDGET[lock.family].label}
        {written.trimmed.length > 0 && ` · left out to fit: ${written.trimmed.join(", ")}`}
        {shot.prompt && " · edited by you"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => copy(written.positive)}>
          Copy prompt
        </Button>
        <Button variant="ghost" onClick={() => copy(written.negative)}>
          Copy negative
        </Button>
        {shot.prompt && (
          <Button variant="ghost" onClick={() => onEdit(undefined)}>
            Rewrite from the sheets
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <TextInput
          aria-label="Change for a copy"
          placeholder="Same, but… (at night, in the rain)"
          value={change}
          onChange={(e) => setChange(e.target.value)}
        />
        <Button
          disabled={!change.trim()}
          onClick={() => {
            onDuplicate(change);
            setChange("");
          }}
        >
          Duplicate
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- style lock

function StyleLockEditor({ lock, save }: { lock: StyleLock; save: (next: StyleLock) => void }) {
  const styles = useAiSettings((s) => s.settings.imageStyles);
  const set = (patch: Partial<StyleLock>) => save({ ...lock, ...patch });
  const text = (key: "style" | "medium" | "palette" | "lineWeight" | "fixedTags" | "negative", label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <TextInput placeholder={hint} value={lock[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        The project's art direction. Every prompt in every card of this project starts from it.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Start from a saved style
        <select
          className={select}
          value={lock.styleId ?? ""}
          onChange={(e) => {
            const style = styles.find((s) => s.id === e.target.value);
            if (style)
              save({
                ...lockFromStyle(style),
                medium: lock.medium,
                palette: lock.palette,
                lineWeight: lock.lineWeight,
              });
          }}
        >
          <option value="">Choose…</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="Prompt format" className="flex gap-4 text-sm">
        {(
          [
            ["tags", "Tags"],
            ["prose", "Sentences"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-1">
            <input type="radio" name="prompt-format" checked={lock.format === v} onChange={() => set({ format: v })} />
            {label}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Image model
        <select className={select} value={lock.family} onChange={(e) => set({ family: e.target.value as ModelFamily })}>
          {(Object.keys(PROMPT_BUDGET) as ModelFamily[]).map((f) => (
            <option key={f} value={f}>
              {PROMPT_BUDGET[f].label} (about {PROMPT_BUDGET[f].tokens} tokens)
            </option>
          ))}
        </select>
      </label>
      {text("style", "Art style", "anime, cel shading")}
      {text("medium", "Medium", "digital painting, watercolour")}
      {text("palette", "Palette", "muted teal and amber")}
      {text("lineWeight", "Line weight", "thin clean lineart")}
      {text("fixedTags", "Fixed tags", "masterpiece, best quality")}
      {text("negative", "Negative prompt", "lowres, text, watermark")}
    </div>
  );
}
