import { useEffect, useState } from "react";
import { withCowriterDefaults, type CowriterSettings, type DarkLevel, type ProseSettings, type UnhingedLevel, type InterviewDepth, type SuggestionLevel } from "../../ai/records";
import { useAiSettings } from "../../ai/settings";
import { Button, Dialog, TextInput } from "../../components/ui";
import { getProject, saveProject } from "../../db/db";
import { useEditor } from "../../editor/store";
import { cardSampleIds, matchedPacks, packsWith, writeCardSamples } from "../../cowriter/style";

const DARK_LEVELS: { value: Exclude<DarkLevel, "off">; label: string; help: string }[] = [
  { value: "dark", label: "Dark", help: "Violence, cruelty, moral rot and bleak outcomes written in where they fit." },
  { value: "horror", label: "Horror", help: "Fear is the engine: dread, the unseen, escalating threat, body and psychological horror." },
  { value: "deaddove", label: "Dead dove", help: "Disturbing and taboo themes written straight, with no rescue or redemption. Exports add a content warning." },
];

const UNHINGED_LEVELS: { value: Exclude<UnhingedLevel, "off">; label: string; help: string }[] = [
  { value: "normal", label: "Unhinged", help: "Explicit NSFW written into every relevant field." },
  {
    value: "absolute",
    label: "Absolutely unhinged",
    help: "Sex pushed into every field it can reach, kink-forward. The interview asks for your kinks and hard limits first.",
  },
];

/** A choice per prose setting; "" leaves it to the co-writer. */
const PROSE_OPTIONS: { key: keyof ProseSettings; label: string; options: { value: string; label: string }[] }[] = [
  { key: "pov", label: "Point of view", options: [{ value: "second", label: "Second (you)" }, { value: "third", label: "Third" }] },
  { key: "tense", label: "Tense", options: [{ value: "past", label: "Past" }, { value: "present", label: "Present" }] },
  { key: "length", label: "Reply length", options: [{ value: "short", label: "Short" }, { value: "medium", label: "Medium" }, { value: "long", label: "Long" }] },
  { key: "dialogue", label: "Dialogue", options: [{ value: "light", label: "Light" }, { value: "balanced", label: "Balanced" }, { value: "heavy", label: "Heavy" }] },
  {
    key: "register",
    label: "Register",
    options: [
      { value: "plain", label: "Plain" },
      { value: "literary", label: "Literary" },
      { value: "pulpy", label: "Pulpy" },
      { value: "poetic", label: "Poetic" },
    ],
  },
  { key: "rhythm", label: "Sentence rhythm", options: [{ value: "varied", label: "Varied" }, { value: "punchy", label: "Punchy" }, { value: "flowing", label: "Flowing" }] },
  {
    key: "format",
    label: "Formatting",
    options: [
      { value: "asterisks", label: "*Actions*" },
      { value: "quotes", label: "Quotes only" },
      { value: "plain", label: "Plain prose" },
    ],
  },
  {
    key: "explicitness",
    label: "Explicitness",
    options: [
      { value: "suggestive", label: "Suggestive" },
      { value: "explicit", label: "Explicit" },
      { value: "graphic", label: "Graphic" },
    ],
  },
];

const TONES = ["cozy", "comedic", "romantic", "slow-burn", "tense", "grim", "epic", "absurd"];
const GENRES = ["fantasy", "sci-fi", "modern", "historical", "horror", "post-apocalyptic"];

const DEPTHS: { value: InterviewDepth; label: string }[] = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
];

const SUGGESTIONS: { value: SuggestionLevel; label: string }[] = [
  { value: "quiet", label: "Quiet" },
  { value: "balanced", label: "Balanced" },
  { value: "lots", label: "Pitches a lot" },
];

let saving = Promise.resolve();

/** The project's co-writer settings: how dark, what tone and genre, how proactive. */
export function ProjectStyleDialog({ projectId, open, onClose }: { projectId?: string; open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<CowriterSettings>();
  const allPresets = useAiSettings((s) => s.settings.presets);
  const presets = allPresets.filter((p) => p.kind !== "jailbreak");
  const loadAi = useAiSettings((s) => s.load);

  useEffect(() => {
    if (!open || !projectId) return;
    void loadAi();
    void getProject(projectId).then((p) => setSettings(withCowriterDefaults(p?.cowriter)));
  }, [open, projectId, loadAi]);

  function change(patch: Partial<CowriterSettings>) {
    if (!projectId || !settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    // Saves run one after another, so fast typing can't save an older value last.
    saving = saving.then(async () => {
      const project = await getProject(projectId);
      if (project) await saveProject({ ...project, cowriter: next });
    });
  }

  return (
    <Dialog open={open && !!settings} title="Co-writer settings for this project" onClose={onClose}>
      {settings && (
        <div className="flex flex-col gap-5">
          <Content settings={settings} change={change} />

          <label className="flex items-start gap-3 rounded-xl border border-border p-3">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={!!settings.engineMode}
              onChange={(e) => change({ engineMode: e.target.checked })}
            />
            <span className="flex flex-col">
              <span className="font-medium">Built for the Immersive Engine</span>
              <span className="text-xs text-ink-muted">
                The co-writer writes an engine card from the start: it plans the variables and their tiers first, keeps numbers
                out of the prose, and gives every greeting its starting state. Its guide is the "Write an engine card" skill,
                which you can edit with the UI engineer's skills.
              </span>
            </span>
          </label>

          <ChoiceText label="Tone" options={TONES} value={settings.tone} onChange={(tone) => change({ tone })} />
          <ChoiceText label="Setting and genre" options={GENRES} value={settings.genre} onChange={(genre) => change({ genre })} />

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer font-medium">Prose</summary>
            <p className="mt-1 text-xs text-ink-muted">How the card's writing reads. Anything left on "Any" is the co-writer's choice.</p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={!!settings.autoPolish}
                  onChange={(e) => change({ autoPolish: e.target.checked || undefined })}
                />
                <span>
                  Polish every draft
                  <span className="block text-xs text-ink-muted">
                    The prose editor goes over each drafted field line by line before you see it. One extra call per field.
                  </span>
                </span>
              </label>
              {PROSE_OPTIONS.filter((o) => o.key !== "explicitness" || settings.unhinged !== "off").map((o) => (
                <Segmented
                  key={o.key}
                  label={o.label}
                  help=""
                  options={[{ value: "", label: "Any" }, ...o.options]}
                  value={settings.prose?.[o.key] ?? ""}
                  onChange={(v) => change({ prose: { ...settings.prose, [o.key]: v || undefined } })}
                />
              ))}
            </div>
          </details>

          <StyleAnchors projectId={projectId!} settings={settings} change={change} />

          <Segmented
            label="Interview depth"
            help="How many rounds of questions the interview asks before drafting."
            options={DEPTHS}
            value={settings.depth}
            onChange={(depth) => change({ depth })}
          />
          <Segmented
            label="Suggestions"
            help="How often the co-writer pitches its own ideas."
            options={SUGGESTIONS}
            value={settings.suggestions}
            onChange={(suggestions) => change({ suggestions })}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Presets from your prompt library</legend>
            {presets.length === 0 && <p className="text-sm text-ink-muted">You can add presets in Settings.</p>}
            {presets.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={settings.presetIds.includes(p.id)}
                  onChange={(e) =>
                    change({
                      presetIds: e.target.checked ? [...settings.presetIds, p.id] : settings.presetIds.filter((id) => id !== p.id),
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </fieldset>

          <Button className="self-end" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** Style samples for the project and the open card, craft packs, and the reference examples. */
function StyleAnchors({ projectId, settings, change }: { projectId: string; settings: CowriterSettings; change: (patch: Partial<CowriterSettings>) => void }) {
  const ai = useAiSettings((s) => s.settings);
  const record = useEditor((s) => s.record);
  const card = record?.projectId === projectId ? record : undefined;
  const samples = ai.styleSamples ?? [];
  const packs = packsWith(ai.craftPacks);
  const matched = new Set(matchedPacks(settings, packs).map((p) => p.id));
  const projectIds = settings.styleSampleIds ?? [];
  const cardIds = card ? cardSampleIds(card.card.data) : [];
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  return (
    <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer font-medium">Style samples and craft packs</summary>
      <div className="mt-3 flex flex-col gap-4 text-sm">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-medium">Style samples</legend>
          {samples.length === 0 && <p className="text-ink-muted">Add passages you love in Settings → Style samples.</p>}
          {samples.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`${s.label} for this project`}
                  checked={projectIds.includes(s.id)}
                  onChange={(e) => change({ styleSampleIds: toggle(projectIds, s.id, e.target.checked) })}
                />
                Project
              </label>
              {card && (
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={`${s.label} for this card`}
                    checked={cardIds.includes(s.id)}
                    onChange={(e) => useEditor.getState().replaceData(writeCardSamples(card.card.data, toggle(cardIds, s.id, e.target.checked)))}
                  />
                  This card
                </label>
              )}
            </div>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-medium">Craft packs</legend>
          {packs.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                disabled={matched.has(p.id)}
                checked={matched.has(p.id) || (settings.craftPackIds ?? []).includes(p.id)}
                onChange={(e) => change({ craftPackIds: toggle(settings.craftPackIds ?? [], p.id, e.target.checked) })}
              />
              {p.name}
              {matched.has(p.id) && <span className="text-xs text-ink-muted">from the genre or tone</span>}
            </label>
          ))}
        </fieldset>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={settings.referenceExamples !== false}
            onChange={(e) => change({ referenceExamples: e.target.checked ? undefined : false })}
          />
          <span>
            Show the co-writer reference examples
            <span className="block text-xs text-ink-muted">A strong greeting, description and example dialogue as the quality target (about 400 tokens per chat).</span>
          </span>
        </label>
      </div>
    </details>
  );
}

/** Normal, or Dark and Unhinged, each with its level; the two combine. */
function Content({ settings, change }: { settings: CowriterSettings; change: (patch: Partial<CowriterSettings>) => void }) {
  const box = (on: boolean) => `flex flex-col gap-2 rounded-xl border p-3 ${on ? "border-accent bg-accent/10" : "border-border"}`;
  const normal = settings.dark === "off" && settings.unhinged === "off";
  const levels = <T extends string>(name: string, list: { value: T; label: string; help: string }[], value: T, set: (v: T) => void) => (
    <div role="radiogroup" aria-label={name} className="ml-7 flex flex-col gap-1.5">
      {list.map((l) => (
        <label key={l.value} className="flex cursor-pointer gap-2 text-sm">
          <input type="radio" name={name} className="mt-0.5 size-4" checked={value === l.value} onChange={() => set(l.value)} />
          <span className="flex flex-col">
            <span>{l.label}</span>
            <span className="text-xs text-ink-muted">{l.help}</span>
          </span>
        </label>
      ))}
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">Content</legend>
      <label className={`${box(normal)} cursor-pointer`}>
        <span className="flex gap-3">
          <input type="checkbox" className="mt-1 size-4" checked={normal} onChange={() => change({ dark: "off", unhinged: "off" })} />
          <span className="flex flex-col">
            <span className="font-medium">Normal</span>
            <span className="text-xs text-ink-muted">Follows your premise, nothing forced.</span>
          </span>
        </span>
      </label>
      <div className={box(settings.dark !== "off")}>
        <label className="flex cursor-pointer gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={settings.dark !== "off"}
            onChange={(e) => change({ dark: e.target.checked ? "dark" : "off" })}
          />
          <span className="flex flex-col">
            <span className="font-medium">Dark</span>
            <span className="text-xs text-ink-muted">Darker writing actively pushed in. Combines with Unhinged.</span>
          </span>
        </label>
        {settings.dark !== "off" && levels("Dark level", DARK_LEVELS, settings.dark, (dark) => change({ dark }))}
      </div>
      <div className={box(settings.unhinged !== "off")}>
        <label className="flex cursor-pointer gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={settings.unhinged !== "off"}
            onChange={(e) => change({ unhinged: e.target.checked ? "normal" : "off" })}
          />
          <span className="flex flex-col">
            <span className="font-medium">Unhinged</span>
            <span className="text-xs text-ink-muted">Explicit NSFW. Characters are always adults, with ages stated.</span>
          </span>
        </label>
        {settings.unhinged !== "off" && levels("Unhinged level", UNHINGED_LEVELS, settings.unhinged, (unhinged) => change({ unhinged }))}
      </div>
    </fieldset>
  );
}

/** Pick from common options, or type your own. */
function ChoiceText({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(value === o ? "" : o)}
            className={`rounded-full border px-3 py-1 text-sm ${
              value === o ? "border-accent bg-accent/15 text-accent" : "border-border text-ink-muted hover:text-ink"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <TextInput aria-label={label} placeholder="Or describe your own" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  help,
  options,
  value,
  onChange,
}: {
  label: string;
  help: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      {help && <span className="text-xs text-ink-muted">{help}</span>}
      <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`min-h-9 flex-1 rounded-md px-2 text-sm ${value === o.value ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
