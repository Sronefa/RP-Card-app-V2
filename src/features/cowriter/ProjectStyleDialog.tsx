import { useEffect, useState } from "react";
import { DEFAULT_COWRITER, type ContentMode, type CowriterSettings, type InterviewDepth, type SuggestionLevel } from "../../ai/records";
import { useAiSettings } from "../../ai/settings";
import { Button, Dialog, TextInput } from "../../components/ui";
import { getProject, saveProject } from "../../db/db";

const MODES: { value: ContentMode; label: string; help: string }[] = [
  { value: "normal", label: "Normal", help: "Follows your premise, nothing forced." },
  { value: "dark", label: "Dark", help: "Violence, horror, cruelty and bleak outcomes actively written in." },
  {
    value: "unhinged",
    label: "Unhinged",
    help: "Explicit NSFW actively written into every relevant field. Characters are always adults, with ages stated.",
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
    void getProject(projectId).then((p) => setSettings({ ...DEFAULT_COWRITER, ...p?.cowriter }));
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">Content mode</legend>
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                  settings.contentMode === m.value ? "border-accent bg-accent/10" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="content-mode"
                  className="mt-1 size-4"
                  checked={settings.contentMode === m.value}
                  onChange={() => change({ contentMode: m.value })}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-ink-muted">{m.help}</span>
                </span>
              </label>
            ))}
          </fieldset>

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
      <span className="text-xs text-ink-muted">{help}</span>
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
