import { useEffect, useState } from "react";
import {
  createProvider,
  modelKey,
  PROVIDER_TEMPLATES,
  useAiSettings,
  type ImageStyle,
  type PromptPreset,
} from "../../ai/settings";
import { DEFAULT_TIMEOUT_SEC, type ModeId, type ModelChoice, type ProviderConfig } from "../../ai/types";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { DEFAULT_SLOP_PHRASES } from "../../editor/slop";
import { newId } from "../../lib/id";

const MODE_LABELS: { mode: ModeId; label: string; help: string }[] = [
  { mode: "refine", label: "Chat", help: "Edits the card with you in the co-writer chat." },
  { mode: "interview", label: "Interview", help: "Asks the questions and writes the story bible." },
  { mode: "suggest", label: "Answer brainstorm", help: "Pitches answers to one interview question." },
  { mode: "gap", label: "Gap analysis", help: "Checks the interview for gaps. A cheaper model works well." },
  { mode: "draft", label: "Drafting", help: "Writes the card from the story bible. Use your best prose model." },
  { mode: "lore", label: "Lorebook brainstorm", help: "Pitches lorebook entries." },
  { mode: "critic", label: "Critic", help: "Reads the card as the roleplay model would and flags weak spots." },
  { mode: "image", label: "Image prompts", help: "Writes prompts for image generators." },
];

export function SettingsView() {
  const { settings, loaded, load, update, addProvider } = useAiSettings();
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<PromptPreset>();
  const [imageStyle, setImageStyle] = useState<ImageStyle>();

  useEffect(() => void load(), [load]);
  if (!loaded) return null;

  const setProvider = (p: ProviderConfig) =>
    void update({ providers: settings.providers.map((x) => (x.id === p.id ? p : x)) });

  async function loadModels(p: ProviderConfig) {
    try {
      const list = await createProvider(p).listModels();
      setModels((m) => ({ ...m, [p.id]: list }));
      toast(`${p.name}: ${list.length} models found`);
    } catch (e) {
      toast(`Couldn't reach ${p.name}: ${(e as Error).message}`, "error");
    }
  }

  function removeProvider(p: ProviderConfig) {
    const clear = (c?: ModelChoice) => (c?.providerId === p.id ? undefined : c);
    void update({
      providers: settings.providers.filter((x) => x.id !== p.id),
      defaultModel: clear(settings.defaultModel),
      modeModels: Object.fromEntries(Object.entries(settings.modeModels).filter(([, c]) => c?.providerId !== p.id)),
    });
  }

  // Model suggestions: the provider's saved models, then whatever it reported.
  const lists = Object.fromEntries(
    settings.providers.map((p) => [p.id, [...new Set([...(p.models ?? []), ...(models[p.id] ?? [])])]]),
  );
  const choice = settings.defaultModel;
  const noTools = choice ? settings.noToolModels.includes(modelKey(choice)) : false;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">AI providers</h2>
        <p className="text-sm text-ink-muted">
          The co-writer runs on your own API key, with Claude or any OpenAI-compatible service. Keys are stored only on
          this device and sent only to the provider.
        </p>
        {settings.providers.map((p) => (
          <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-ink-muted">{p.kind === "anthropic" ? "Claude API" : "OpenAI-compatible"}</span>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <TextInput value={p.name} onChange={(e) => setProvider({ ...p, name: e.target.value })} />
            </label>
            {p.kind === "openai" && (
              <label className="flex flex-col gap-1 text-sm">
                Base URL
                <TextInput
                  value={p.baseUrl ?? ""}
                  placeholder="https://example.com/v1"
                  inputMode="url"
                  onChange={(e) => setProvider({ ...p, baseUrl: e.target.value.trim() })}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              API key
              <TextInput
                type="password"
                autoComplete="off"
                value={p.apiKey}
                placeholder={p.kind === "anthropic" ? "sk-ant-…" : "Leave empty for local servers"}
                onChange={(e) => setProvider({ ...p, apiKey: e.target.value.trim() })}
              />
            </label>
            <SavedModels
              provider={p}
              available={models[p.id]}
              onLoad={() => void loadModels(p)}
              onChange={(list) => setProvider({ ...p, models: list })}
            />
            <label className="flex flex-col gap-1 text-sm">
              Give up after (seconds)
              <span className="text-xs text-ink-muted">How long to wait for a reply before stopping with an error.</span>
              <TextInput
                type="number"
                min={10}
                inputMode="numeric"
                className="max-w-32"
                value={p.timeoutSec ?? DEFAULT_TIMEOUT_SEC}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  setProvider({ ...p, timeoutSec: n > 0 ? n : undefined });
                }}
              />
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              <Button onClick={() => void loadModels(p)}>Test and load models</Button>
              <Button variant="danger" onClick={() => removeProvider(p)}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button className="self-start" variant={settings.providers.length ? "secondary" : "primary"} onClick={() => setAdding(true)}>
          Add provider
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Model</h2>
        <p className="text-sm text-ink-muted">The model the co-writer uses for every task.</p>
        {settings.providers.length === 0 ? (
          <p className="text-sm text-ink-muted">Add a provider first.</p>
        ) : (
          <ModelPicker
            providers={settings.providers}
            models={lists}
            value={choice}
            onLoad={(p) => void loadModels(p)}
            onChange={(defaultModel) => void update({ defaultModel })}
          />
        )}
        {choice?.model && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={noTools}
              onChange={(e) =>
                void update({
                  noToolModels: e.target.checked
                    ? [...settings.noToolModels, modelKey(choice)]
                    : settings.noToolModels.filter((k) => k !== modelKey(choice)),
                })
              }
            />
            This model can't use tools (edits are sent as JSON instead). Detected automatically.
          </label>
        )}
      </section>

      {settings.providers.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer font-medium">Model for each task (optional)</summary>
          <p className="mt-2 mb-3 text-sm text-ink-muted">
            Every task uses the model above unless you pick another one here, for example a cheap model for checks and a
            strong one for writing.
          </p>
          <div className="flex flex-col gap-3">
            {MODE_LABELS.map(({ mode, label, help }) => (
              <ModeModelRow
                key={mode}
                label={label}
                help={help}
                providers={settings.providers}
                models={lists}
                value={settings.modeModels[mode]}
                onLoad={(p) => void loadModels(p)}
                onChange={(choice) => {
                  const modeModels = { ...settings.modeModels };
                  if (choice) modeModels[mode] = choice;
                  else delete modeModels[mode];
                  void update({ modeModels });
                }}
              />
            ))}
          </div>
        </details>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Prompt library</h2>
        <p className="text-sm text-ink-muted">
          Your own instructions, such as a house style or favourite tropes. Turn them on per project in its co-writer
          settings; they are added on top of the co-writer's own prompt.
        </p>
        {settings.presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p)}
            className="flex flex-col rounded-xl border border-border bg-surface-raised p-3 text-left hover:border-ink-muted"
          >
            <span className="font-medium">{p.name}</span>
            <span className="line-clamp-2 text-xs text-ink-muted">{p.text || "Empty"}</span>
          </button>
        ))}
        <Button className="self-start" onClick={() => setPreset({ id: newId(), name: "New preset", text: "" })}>
          Add preset
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Image styles</h2>
        <p className="text-sm text-ink-muted">
          Used by the image prompt writer (Basics or Assets → ✦ Image prompt): the art style, the prompt format your
          image generator wants, and tags that always go in.
        </p>
        {settings.imageStyles.map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => setImageStyle(st)}
            className="flex flex-col rounded-xl border border-border bg-surface-raised p-3 text-left hover:border-ink-muted"
          >
            <span className="font-medium">{st.name}</span>
            <span className="line-clamp-2 text-xs text-ink-muted">
              {st.format === "tags" ? "Tags" : "Sentences"} · {st.style || "No style set"}
            </span>
          </button>
        ))}
        <Button
          className="self-start"
          onClick={() =>
            setImageStyle({ id: newId(), name: "New style", format: "tags", style: "", prefix: "", negative: "", notes: "" })
          }
        >
          Add style
        </Button>
      </section>

      <SlopPhrases
        phrases={settings.slopPhrases ?? DEFAULT_SLOP_PHRASES}
        custom={!!settings.slopPhrases}
        onChange={(slopPhrases) => void update({ slopPhrases })}
      />

      <Dialog open={!!imageStyle} title="Image style" onClose={() => setImageStyle(undefined)}>
        {imageStyle && (
          <ImageStyleForm
            key={imageStyle.id}
            style={imageStyle}
            onSave={(st) => {
              const exists = settings.imageStyles.some((x) => x.id === st.id);
              void update({
                imageStyles: exists ? settings.imageStyles.map((x) => (x.id === st.id ? st : x)) : [...settings.imageStyles, st],
              });
              setImageStyle(undefined);
            }}
            onDelete={() => {
              void update({ imageStyles: settings.imageStyles.filter((x) => x.id !== imageStyle.id) });
              setImageStyle(undefined);
            }}
          />
        )}
      </Dialog>
      <Dialog open={adding} title="Add provider" onClose={() => setAdding(false)}>
        <div className="flex flex-col gap-2">
          {PROVIDER_TEMPLATES.map((t) => (
            <Button
              key={t.name}
              onClick={() => {
                void addProvider(t);
                setAdding(false);
              }}
            >
              {t.name}
            </Button>
          ))}
        </div>
      </Dialog>
      <Dialog open={!!preset} title="Preset" onClose={() => setPreset(undefined)}>
        {preset && (
          <PresetForm
            key={preset.id}
            preset={preset}
            onSave={(p) => {
              const exists = settings.presets.some((x) => x.id === p.id);
              void update({ presets: exists ? settings.presets.map((x) => (x.id === p.id ? p : x)) : [...settings.presets, p] });
              setPreset(undefined);
            }}
            onDelete={() => {
              void update({ presets: settings.presets.filter((x) => x.id !== preset.id) });
              setPreset(undefined);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function ModelPicker({
  providers,
  models,
  value,
  onLoad,
  onChange,
}: {
  providers: ProviderConfig[];
  models: Record<string, string[]>;
  value?: ModelChoice;
  onLoad: (p: ProviderConfig) => void;
  onChange: (choice: ModelChoice) => void;
}) {
  const providerId = value?.providerId ?? providers[0].id;
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const list = models[provider.id];
  const listId = `models-${provider.id}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        Provider
        <select
          className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2"
          value={provider.id}
          onChange={(e) => onChange({ providerId: e.target.value, model: "" })}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Model
        <TextInput
          list={listId}
          value={value?.providerId === provider.id ? value.model : ""}
          placeholder={provider.kind === "anthropic" ? "claude-opus-5-5" : "Model name"}
          onFocus={() => !list?.length && provider.apiKey && onLoad(provider)}
          onChange={(e) => onChange({ providerId: provider.id, model: e.target.value.trim() })}
        />
        <datalist id={listId}>
          {list?.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
    </div>
  );
}

/** The models kept at hand for a provider, to switch between from the co-writer. */
function SavedModels({
  provider,
  available,
  onLoad,
  onChange,
}: {
  provider: ProviderConfig;
  /** Models the provider reported, offered as suggestions. */
  available?: string[];
  onLoad: () => void;
  onChange: (models: string[]) => void;
}) {
  const [name, setName] = useState("");
  const saved = provider.models ?? [];
  const listId = `available-${provider.id}`;
  function add() {
    const model = name.trim();
    if (model && !saved.includes(model)) onChange([...saved, model]);
    setName("");
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span>Your models</span>
      <span className="text-xs text-ink-muted">Switch between them from the co-writer without coming back here.</span>
      {saved.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {saved.map((m) => (
            <li key={m} className="flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3">
              {m}
              <button
                type="button"
                aria-label={`Remove ${m}`}
                className="rounded-full px-1.5 text-ink-muted hover:text-ink"
                onClick={() => onChange(saved.filter((x) => x !== m))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <TextInput
          aria-label={`Add a model to ${provider.name}`}
          list={listId}
          value={name}
          placeholder="Model name"
          onFocus={() => !available && provider.apiKey && onLoad()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <datalist id={listId}>
          {available?.filter((m) => !saved.includes(m)).map((m) => <option key={m} value={m} />)}
        </datalist>
        <Button disabled={!name.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

function ModeModelRow({
  label,
  help,
  providers,
  models,
  value,
  onLoad,
  onChange,
}: {
  label: string;
  help: string;
  providers: ProviderConfig[];
  models: Record<string, string[]>;
  value?: ModelChoice;
  onLoad: (p: ProviderConfig) => void;
  onChange: (choice: ModelChoice | undefined) => void;
}) {
  const provider = value && providers.find((p) => p.id === value.providerId);
  const listId = provider && `models-${provider.id}-${label.replace(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-ink-muted">{help}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label={`${label} provider`}
          className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm"
          value={provider?.id ?? ""}
          onChange={(e) => onChange(e.target.value ? { providerId: e.target.value, model: "" } : undefined)}
        >
          <option value="">Default model</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {provider && (
          <>
            <TextInput
              aria-label={`${label} model`}
              list={listId}
              value={value!.model}
              placeholder="Model name"
              onFocus={() => !models[provider.id]?.length && provider.apiKey && onLoad(provider)}
              onChange={(e) => onChange({ providerId: provider.id, model: e.target.value.trim() })}
            />
            <datalist id={listId}>
              {models[provider.id]?.map((m) => <option key={m} value={m} />)}
            </datalist>
          </>
        )}
      </div>
    </div>
  );
}

function PresetForm({ preset, onSave, onDelete }: { preset: PromptPreset; onSave: (p: PromptPreset) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(preset);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Instructions
        <AutoTextarea
          className="min-h-32"
          value={draft.text}
          placeholder="e.g. Write in present tense. Favour slow-burn romance and morally grey characters."
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
      </label>
      <div className="flex justify-between gap-2">
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="primary" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ImageStyleForm({
  style,
  onSave,
  onDelete,
}: {
  style: ImageStyle;
  onSave: (s: ImageStyle) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(style);
  const field = (key: "style" | "prefix" | "negative" | "notes", label: string, help: string, placeholder: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <span className="text-xs text-ink-muted">{help}</span>
      <AutoTextarea rows={2} value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Prompt format</legend>
        {(
          [
            ["tags", "Tags, for Stable Diffusion, NovelAI and similar"],
            ["prose", "Sentences, for Flux, DALL-E, Midjourney and similar"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" className="size-4" checked={draft.format === value} onChange={() => setDraft({ ...draft, format: value })} />
            {label}
          </label>
        ))}
      </fieldset>
      {field("style", "Art style", "How it should look.", "e.g. anime, cel shading, soft pastel colours")}
      {field("prefix", "Always start with", "Put at the very start of every prompt, e.g. quality tags or a LoRA trigger.", "e.g. masterpiece, best quality")}
      {field("negative", "Negative prompt", "Always in the negative prompt.", "e.g. lowres, bad hands, text, watermark")}
      {field("notes", "Other rules", "Anything else the prompt writer should follow.", "e.g. always a dark background")}
      <div className="flex justify-between gap-2">
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="primary" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** The overused phrases the card checker flags, one per line. */
function SlopPhrases({
  phrases,
  custom,
  onChange,
}: {
  phrases: string[];
  custom: boolean;
  onChange: (phrases: string[] | undefined) => void;
}) {
  const [text, setText] = useState(phrases.join("\n"));
  useEffect(() => setText(phrases.join("\n")), [phrases]);
  const save = () => {
    const next = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (next.join("\n") !== phrases.join("\n")) onChange(next);
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">Overused phrases</h2>
      <p className="text-sm text-ink-muted">
        The card checker flags these and offers to rewrite the line. One phrase per line. * inside a word stands for any
        letters and * on its own for up to three words, so "shiver* * down * spine" also catches "a shiver ran down his
        spine".
      </p>
      <AutoTextarea
        aria-label="Overused phrases"
        value={text}
        className="min-h-40 text-sm"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      {custom && (
        <Button variant="ghost" className="self-start" onClick={() => onChange(undefined)}>
          Go back to the built-in list
        </Button>
      )}
    </section>
  );
}
