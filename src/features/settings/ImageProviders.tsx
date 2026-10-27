import { useState } from "react";
import { useAiSettings } from "../../ai/settings";
import { toast } from "../../components/toast";
import { testImageProvider } from "../../ai/connection";
import { ConnectionTest } from "./ConnectionTest";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import {
  comfyInfo,
  importWorkflow,
  missingNodes,
  SLOT_LABELS,
  workflowsOf,
  type ComfyInfo,
  type ComfyWorkflow,
  type SlotName,
} from "../../images/comfy";
import {
  IMAGE_PROVIDER_KINDS,
  IMAGE_TASKS,
  listImageModels,
  newImageProvider,
  type ImageProviderConfig,
  type ImageProviderKind,
  type ImageTask,
} from "../../images/providers";

const select = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";

/** Image providers, a model per kind of work, and ComfyUI workflows. */
export function ImageProviders() {
  const { settings, update } = useAiSettings();
  const providers = settings.imageProviders ?? [];
  const save = (next: ImageProviderConfig[]) => void update({ imageProviders: next });
  const setProvider = (p: ImageProviderConfig) => save(providers.map((x) => (x.id === p.id ? p : x)));
  const [adding, setAdding] = useState<ImageProviderKind>("nanogpt");

  const choices = providers.flatMap((p) => (p.models ?? []).map((m) => ({ key: `${p.id}/${m.id}`, p, m })));
  const taskValue = (t: ImageTask) => {
    const c = settings.imageModels?.[t];
    return c ? `${c.providerId}/${c.model}` : "";
  };
  const setTask = (t: ImageTask, key: string) => {
    const hit = choices.find((c) => c.key === key);
    const next = { ...settings.imageModels };
    if (hit) next[t] = { providerId: hit.p.id, model: hit.m.id };
    else delete next[t];
    void update({ imageModels: next });
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Image providers">
      <h2 className="font-medium">Image providers</h2>
      <p className="text-sm text-ink-muted">
        The Image Studio makes pictures with these, apart from the text providers. Keys stay on this device. ComfyUI runs on your
        own computer; on a phone, use the computer's address on your network.
      </p>
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} onChange={setProvider} onRemove={() => save(providers.filter((x) => x.id !== p.id))} />
      ))}
      <div className="flex gap-2">
        <select aria-label="Image provider kind" className={select} value={adding} onChange={(e) => setAdding(e.target.value as ImageProviderKind)}>
          {(Object.keys(IMAGE_PROVIDER_KINDS) as ImageProviderKind[]).map((k) => (
            <option key={k} value={k}>
              {IMAGE_PROVIDER_KINDS[k].label}
            </option>
          ))}
        </select>
        <Button onClick={() => save([...providers, newImageProvider(adding)])}>Add image provider</Button>
      </div>

      {choices.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Model for each kind of image</legend>
          <span className="text-xs text-ink-muted">A cheap model for icons and a strong one for character art. Empty uses character art's.</span>
          {(Object.keys(IMAGE_TASKS) as ImageTask[]).map((t) => (
            <label key={t} className="flex flex-col gap-1 text-sm">
              {IMAGE_TASKS[t]}
              <select className={select} value={taskValue(t)} onChange={(e) => setTask(t, e.target.value)}>
                <option value="">{t === "character" ? "The first model listed" : "Same as character art"}</option>
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.p.name}: {c.m.name}
                    {c.m.price !== undefined ? ` ($${c.m.price} per image)` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Card size budget (MB)
        <TextInput
          type="number"
          min={1}
          inputMode="numeric"
          value={settings.cardBudgetMb ?? 30}
          onChange={(e) => void update({ cardBudgetMb: Math.max(1, Number(e.target.value) || 30) })}
        />
      </label>
    </section>
  );
}

function ProviderCard({
  provider: p,
  onChange,
  onRemove,
}: {
  provider: ImageProviderConfig;
  onChange: (p: ImageProviderConfig) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<ComfyInfo>();
  const kind = IMAGE_PROVIDER_KINDS[p.kind];

  async function loadModels() {
    setBusy(true);
    try {
      const models = await listImageModels(p);
      onChange({ ...p, models });
      if (p.kind === "comfyui") setInfo(await comfyInfo(p));
      toast(models.length ? `Found ${models.length} ${p.kind === "comfyui" ? "checkpoints" : "models"}` : "The provider listed no image models", models.length ? undefined : "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3" aria-label={`Image provider ${p.name}`} role="group">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{p.name}</span>
        <span className="text-xs text-ink-muted">{kind.label}</span>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {p.kind === "comfyui" ? "Address" : "Base URL"}
        <TextInput inputMode="url" value={p.baseUrl} placeholder={kind.baseUrl} onChange={(e) => onChange({ ...p, baseUrl: e.target.value.trim() })} />
      </label>
      {kind.key && (
        <label className="flex flex-col gap-1 text-sm">
          API key
          <TextInput type="password" autoComplete="off" value={p.apiKey} onChange={(e) => onChange({ ...p, apiKey: e.target.value.trim() })} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !p.baseUrl} onClick={() => void loadModels()}>
          {busy ? "Checking…" : p.kind === "comfyui" ? "Load checkpoints" : "Load models"}
        </Button>
        <ConnectionTest name={p.name} disabled={!p.baseUrl} run={() => testImageProvider(p)} />
        <span className="text-xs text-ink-muted">
          {p.models?.length ? `${p.models.length} ${p.kind === "comfyui" ? "checkpoints" : "models"}` : "No models loaded yet"}
          {info && ` · ${info.loras.length} LoRAs · ${info.nodes.size} node types`}
        </span>
        <Button variant="ghost" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {p.models && p.kind !== "comfyui" && p.models.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-xs text-ink-muted" aria-label={`Models of ${p.name}`}>
          {p.models.map((m) => (
            <li key={m.id}>
              {m.name}
              {m.price !== undefined && ` · $${m.price}`}
              {m.imageToImage && " · image to image"}
              {m.inpainting && " · inpainting"}
              {m.nsfw && " · NSFW"}
            </li>
          ))}
        </ul>
      )}
      {p.kind === "comfyui" && <Workflows provider={p} info={info} onChange={onChange} />}
    </div>
  );
}

function Workflows({ provider: p, info, onChange }: { provider: ImageProviderConfig; info?: ComfyInfo; onChange: (p: ImageProviderConfig) => void }) {
  const [json, setJson] = useState("");
  const [name, setName] = useState("");
  const all = workflowsOf(p);
  const setWorkflow = (wf: ComfyWorkflow) => onChange({ ...p, workflows: (p.workflows ?? []).map((w) => (w.id === wf.id ? wf : w)) });

  function add() {
    try {
      const wf = importWorkflow(name.trim() || "My workflow", json);
      onChange({ ...p, workflows: [...(p.workflows ?? []), wf] });
      setJson("");
      setName("");
      toast(`Imported "${wf.name}" with ${Object.keys(wf.map).length} parts found`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Workflows</h3>
      <ul className="flex flex-col gap-2">
        {all.map((wf) => {
          const missing = info ? missingNodes(wf, info.nodes) : [];
          const own = (p.workflows ?? []).includes(wf);
          return (
            <li key={wf.id} className="rounded-lg border border-border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {wf.name}
                  {!own && <span className="text-ink-muted"> · built in</span>}
                </span>
                {own && (
                  <button
                    type="button"
                    aria-label={`Remove the workflow ${wf.name}`}
                    className="px-1 text-ink-muted"
                    onClick={() => onChange({ ...p, workflows: (p.workflows ?? []).filter((w) => w !== wf) })}
                  >
                    ✕
                  </button>
                )}
              </div>
              {missing.length > 0 && <p className="text-xs text-amber-300">This server is missing: {missing.join(", ")}</p>}
              {own && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-ink-muted">Mapped parts</summary>
                  <div className="mt-1 grid gap-1">
                    {(Object.keys(SLOT_LABELS) as SlotName[]).map((slot) => (
                      <label key={slot} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0">{SLOT_LABELS[slot]}</span>
                        <select
                          aria-label={`${SLOT_LABELS[slot]} in ${wf.name}`}
                          className={`${select} min-h-8 flex-1`}
                          value={wf.map[slot] ? `${wf.map[slot]!.node}.${wf.map[slot]!.input}` : ""}
                          onChange={(e) => {
                            const [node, ...rest] = e.target.value.split(".");
                            const map = { ...wf.map };
                            if (node) map[slot] = { node, input: rest.join(".") };
                            else delete map[slot];
                            setWorkflow({ ...wf, map });
                          }}
                        >
                          <option value="">Not used</option>
                          {Object.entries(wf.graph).flatMap(([id, n]) =>
                            Object.entries(n.inputs)
                              .filter(([, v]) => !Array.isArray(v))
                              .map(([input]) => (
                                <option key={`${id}.${input}`} value={`${id}.${input}`}>
                                  {n._meta?.title ?? n.class_type} #{id}: {input}
                                </option>
                              )),
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">Automatic uses text to image, and the face reference once a character has a reference image.</p>
      {(Object.keys(IMAGE_TASKS) as ImageTask[]).map((t) => (
        <label key={t} className="flex flex-col gap-1 text-sm">
          Workflow for {IMAGE_TASKS[t].toLowerCase()}
          <select
            className={select}
            value={p.workflowFor?.[t] ?? ""}
            onChange={(e) => onChange({ ...p, workflowFor: { ...p.workflowFor, [t]: e.target.value || undefined } })}
          >
            <option value="">Automatic</option>
            {all.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex flex-col gap-2">
        <TextInput aria-label="Workflow name" placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} />
        <AutoTextarea
          aria-label="Workflow JSON"
          placeholder="Paste a workflow exported with Save (API) in ComfyUI"
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
        <Button className="self-start" disabled={!json.trim()} onClick={add}>
          Import workflow
        </Button>
      </div>
    </div>
  );
}
