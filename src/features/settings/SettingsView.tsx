import { useEffect, useState } from "react";
import { createProvider, modelKey, PROVIDER_TEMPLATES, useAiSettings, type PromptPreset } from "../../ai/settings";
import type { ModelChoice, ProviderConfig } from "../../ai/types";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { newId } from "../../lib/id";

export function SettingsView() {
  const { settings, loaded, load, update, addProvider } = useAiSettings();
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<PromptPreset>();

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
        <p className="text-sm text-ink-muted">The model the co-writer uses.</p>
        {settings.providers.length === 0 ? (
          <p className="text-sm text-ink-muted">Add a provider first.</p>
        ) : (
          <ModelPicker
            providers={settings.providers}
            models={models}
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
          onFocus={() => !list && provider.apiKey && onLoad(provider)}
          onChange={(e) => onChange({ providerId: provider.id, model: e.target.value.trim() })}
        />
        <datalist id={listId}>
          {list?.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>
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
