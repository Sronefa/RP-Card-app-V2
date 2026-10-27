/**
 * Local ComfyUI: workflows in API format, mapped once to the parts CardForge fills (prompts, seed,
 * size, checkpoint, LoRA, reference image), queued with /prompt and read back from /history and /view.
 */
import { getFetch } from "../ai/http";
import { newId } from "../lib/id";
import type { GeneratedImage, ImageModelInfo, ImageProviderConfig, ImageRequest, ImageResult, ImageTask } from "./providers";

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ComfyGraph = Record<string, ComfyNode>;

/** Where a value goes: a node and one of its inputs. */
export interface Slot {
  node: string;
  input: string;
}

export type SlotName = "positive" | "negative" | "seed" | "width" | "height" | "batch" | "checkpoint" | "lora" | "loraWeight" | "reference" | "denoise";

export const SLOT_LABELS: Record<SlotName, string> = {
  positive: "Prompt",
  negative: "Negative prompt",
  seed: "Seed",
  width: "Width",
  height: "Height",
  batch: "Images per run",
  checkpoint: "Checkpoint",
  lora: "LoRA",
  loraWeight: "LoRA weight",
  reference: "Reference image",
  denoise: "Denoise",
};

export interface ComfyWorkflow {
  id: string;
  name: string;
  graph: ComfyGraph;
  map: Partial<Record<SlotName, Slot>>;
}

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string";

/** Follows a conditioning link up to the text box that feeds it. */
function textSource(graph: ComfyGraph, link: unknown, depth = 0): Slot | undefined {
  if (!isLink(link) || depth > 6) return undefined;
  const node = graph[link[0]];
  if (!node) return undefined;
  if (typeof node.inputs.text === "string") return { node: link[0], input: "text" };
  for (const key of ["conditioning", "positive", "conditioning_1", "conditioning_to", "text"]) {
    const found = textSource(graph, node.inputs[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Finds the slots in a workflow, so a user's own workflow works without mapping it by hand. */
export function detectMap(graph: ComfyGraph): ComfyWorkflow["map"] {
  const map: ComfyWorkflow["map"] = {};
  const entries = Object.entries(graph);
  const find = (test: (n: ComfyNode) => boolean) => entries.find(([, n]) => test(n));
  const sampler = find((n) => /KSampler|SamplerCustom/i.test(n.class_type));
  if (sampler) {
    const [id, node] = sampler;
    const positive = textSource(graph, node.inputs.positive);
    const negative = textSource(graph, node.inputs.negative);
    if (positive) map.positive = positive;
    if (negative) map.negative = negative;
    const seed = ["seed", "noise_seed"].find((k) => typeof node.inputs[k] === "number");
    if (seed) map.seed = { node: id, input: seed };
    if (typeof node.inputs.denoise === "number") map.denoise = { node: id, input: "denoise" };
  }
  const latent = find((n) => typeof n.inputs.width === "number" && typeof n.inputs.height === "number");
  if (latent) {
    map.width = { node: latent[0], input: "width" };
    map.height = { node: latent[0], input: "height" };
    if (typeof latent[1].inputs.batch_size === "number") map.batch = { node: latent[0], input: "batch_size" };
  }
  const ckpt = find((n) => typeof n.inputs.ckpt_name === "string");
  if (ckpt) map.checkpoint = { node: ckpt[0], input: "ckpt_name" };
  const lora = find((n) => typeof n.inputs.lora_name === "string");
  if (lora) {
    map.lora = { node: lora[0], input: "lora_name" };
    if (typeof lora[1].inputs.strength_model === "number") map.loraWeight = { node: lora[0], input: "strength_model" };
  }
  const image = find((n) => n.class_type === "LoadImage");
  if (image) map.reference = { node: image[0], input: "image" };
  return map;
}

/** A workflow from an API-format export ("Save (API)" in ComfyUI). */
export function importWorkflow(name: string, json: string): ComfyWorkflow {
  let graph: unknown;
  try {
    graph = JSON.parse(json);
  } catch {
    throw new Error("That isn't JSON. Export the workflow with Save (API) in ComfyUI.");
  }
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new Error("That isn't a workflow.");
  if ("nodes" in graph && "links" in graph)
    throw new Error("This is the editor format. In ComfyUI, turn on the dev options and use Save (API) instead.");
  const nodes = Object.values(graph as Record<string, unknown>);
  if (!nodes.length || !nodes.every((n) => !!n && typeof n === "object" && typeof (n as ComfyNode).class_type === "string"))
    throw new Error("That isn't an API-format workflow.");
  const wf = graph as ComfyGraph;
  const map = detectMap(wf);
  if (!map.positive) throw new Error("Couldn't find the prompt box in this workflow.");
  return { id: newId(), name, graph: wf, map };
}

const ckpt = (id: string) => ({ class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "" }, _meta: { title: id } });
const text = (clip: string) => ({ class_type: "CLIPTextEncode", inputs: { text: "", clip: [clip, 1] } });
const sampler = (model: [string, number], latent: [string, number], denoise: number) => ({
  class_type: "KSampler",
  inputs: {
    seed: 0,
    steps: 28,
    cfg: 6,
    sampler_name: "euler_ancestral",
    scheduler: "normal",
    denoise,
    model,
    positive: ["6", 0],
    negative: ["7", 0],
    latent_image: latent,
  },
});
const tail = {
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "CardForge" } },
};

function starter(id: string, name: string, graph: ComfyGraph): ComfyWorkflow {
  return { id: `starter-${id}`, name, graph, map: detectMap(graph) };
}

/** The workflows CardForge ships: text to image, image to image, and a face reference with IP-Adapter. */
export const STARTER_WORKFLOWS: ComfyWorkflow[] = [
  starter("t2i", "Text to image", {
    "4": ckpt("Checkpoint"),
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
    "6": text("4"),
    "7": text("4"),
    "3": sampler(["4", 0], ["5", 0], 1),
    ...tail,
  }),
  starter("i2i", "Image to image", {
    "4": ckpt("Checkpoint"),
    "11": { class_type: "LoadImage", inputs: { image: "" } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["11", 0], vae: ["4", 2] } },
    "6": text("4"),
    "7": text("4"),
    "3": sampler(["4", 0], ["12", 0], 0.55),
    ...tail,
  }),
  starter("face", "Face reference (IP-Adapter)", {
    "4": ckpt("Checkpoint"),
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
    "11": { class_type: "LoadImage", inputs: { image: "" } },
    "13": { class_type: "IPAdapterUnifiedLoader", inputs: { model: ["4", 0], preset: "PLUS FACE (portraits)" } },
    "14": {
      class_type: "IPAdapter",
      inputs: { model: ["13", 0], ipadapter: ["13", 1], image: ["11", 0], weight: 0.8, start_at: 0, end_at: 1, weight_type: "standard" },
    },
    "6": text("4"),
    "7": text("4"),
    "3": sampler(["14", 0], ["5", 0], 1),
    ...tail,
  }),
];

/** The workflows a provider can use: its own, then the starters. */
export const workflowsOf = (p: ImageProviderConfig) => [...(p.workflows ?? []), ...STARTER_WORKFLOWS];

/** The workflow for a shot: the one picked for its task, else face reference with a reference, else text to image. */
export function workflowFor(p: ImageProviderConfig, task: ImageTask, withReference: boolean): ComfyWorkflow {
  const all = workflowsOf(p);
  const picked = all.find((w) => w.id === p.workflowFor?.[task]);
  if (picked) return picked;
  return all.find((w) => w.id === (withReference ? "starter-face" : "starter-t2i"))!;
}

/**
 * Wires a LoRA in after the checkpoint when the workflow has none: everything that read the
 * checkpoint's model and clip reads the LoRA's instead.
 */
export function injectLora(graph: ComfyGraph, map: ComfyWorkflow["map"], name: string, weight: number): ComfyGraph {
  const ckptId = map.checkpoint?.node;
  if (!ckptId) return graph;
  const id = "cardforge_lora";
  const out: ComfyGraph = {};
  for (const [k, n] of Object.entries(graph)) {
    const inputs = Object.fromEntries(
      Object.entries(n.inputs).map(([key, v]) => [key, isLink(v) && v[0] === ckptId && (v[1] === 0 || v[1] === 1) ? [id, v[1]] : v]),
    );
    out[k] = { ...n, inputs };
  }
  out[id] = { class_type: "LoraLoader", inputs: { model: [ckptId, 0], clip: [ckptId, 1], lora_name: name, strength_model: weight, strength_clip: weight } };
  return out;
}

/** The workflow with this request's values filled in. */
export function fillWorkflow(wf: ComfyWorkflow, req: ImageRequest, seed: number, reference?: string): ComfyGraph {
  let graph: ComfyGraph = structuredClone(wf.graph);
  const set = (slot: Slot | undefined, value: unknown) => {
    if (slot && graph[slot.node]) graph[slot.node].inputs[slot.input] = value;
  };
  set(wf.map.positive, req.prompt);
  set(wf.map.negative, req.negative);
  set(wf.map.seed, seed);
  set(wf.map.width, req.width);
  set(wf.map.height, req.height);
  set(wf.map.batch, req.n);
  if (req.model) set(wf.map.checkpoint, req.model);
  if (reference) set(wf.map.reference, reference);
  if (req.strength !== undefined && reference) set(wf.map.denoise, req.strength);
  if (req.lora?.name) {
    if (wf.map.lora) {
      set(wf.map.lora, req.lora.name);
      set(wf.map.loraWeight, req.lora.weight);
    } else graph = injectLora(graph, wf.map, req.lora.name, req.lora.weight);
  }
  return graph;
}

const base = (p: ImageProviderConfig) => p.baseUrl.trim().replace(/\/+$/, "");

export interface ComfyInfo {
  checkpoints: string[];
  loras: string[];
  nodes: Set<string>;
}

const choices = (info: Record<string, unknown>, node: string, input: string): string[] => {
  const n = info[node] as { input?: { required?: Record<string, unknown> } } | undefined;
  const spec = n?.input?.required?.[input];
  return Array.isArray(spec) && Array.isArray(spec[0]) ? spec[0].filter((x): x is string => typeof x === "string") : [];
};

/** The connect test: what the server has installed. */
export async function comfyInfo(p: ImageProviderConfig): Promise<ComfyInfo> {
  const f = await getFetch();
  const res = await f(`${base(p)}/object_info`);
  if (!res.ok) throw new Error(`ComfyUI answered ${res.status}. Check the address and that ComfyUI is running with --listen for other devices.`);
  const info = (await res.json()) as Record<string, unknown>;
  return {
    checkpoints: choices(info, "CheckpointLoaderSimple", "ckpt_name"),
    loras: choices(info, "LoraLoader", "lora_name"),
    nodes: new Set(Object.keys(info)),
  };
}

/** Node types a workflow needs that the server doesn't have. */
export const missingNodes = (wf: ComfyWorkflow, nodes: Set<string>) =>
  [...new Set(Object.values(wf.graph).map((n) => n.class_type))].filter((t) => !nodes.has(t));

export async function comfyModels(p: ImageProviderConfig): Promise<ImageModelInfo[]> {
  return (await comfyInfo(p)).checkpoints.map((c) => ({ id: c, name: c, imageToImage: true }));
}

async function upload(p: ImageProviderConfig, bytes: Uint8Array): Promise<string> {
  const f = await getFetch();
  const form = new FormData();
  form.append("image", new Blob([bytes as BlobPart], { type: "image/png" }), `cardforge-${newId()}.png`);
  form.append("overwrite", "true");
  const res = await f(`${base(p)}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Couldn't send the reference image to ComfyUI: ${res.status}`);
  const body = (await res.json()) as { name: string; subfolder?: string };
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/** Progress from ComfyUI's websocket, when the app may open one; generation works without it. */
function watchProgress(p: ImageProviderConfig, clientId: string, promptId: () => string | undefined, onProgress?: (f: number) => void) {
  if (!onProgress || typeof WebSocket === "undefined") return () => undefined;
  try {
    const ws = new WebSocket(`${base(p).replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data) as { type?: string; data?: { value?: number; max?: number; prompt_id?: string } };
        if (msg.type === "progress" && msg.data?.max && (!msg.data.prompt_id || msg.data.prompt_id === promptId()))
          onProgress((msg.data.value ?? 0) / msg.data.max);
      } catch {
        // Not for us.
      }
    };
    ws.onerror = () => ws.close();
    return () => ws.close();
  } catch {
    return () => undefined;
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export async function comfyGenerate(p: ImageProviderConfig, req: ImageRequest): Promise<ImageResult> {
  const f = await getFetch();
  const wf = workflowFor(p, req.task, !!req.reference);
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 32);
  const reference = req.reference && wf.map.reference ? await upload(p, req.reference) : undefined;
  const graph = fillWorkflow(wf, req, seed, reference);
  const clientId = newId();
  let promptId: string | undefined;
  const stop = watchProgress(p, clientId, () => promptId, req.onProgress);
  try {
    const res = await f(`${base(p)}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; node_errors?: Record<string, unknown> };
      const nodes = Object.keys(body.node_errors ?? {});
      throw new Error(`ComfyUI refused the workflow: ${body.error?.message ?? res.status}${nodes.length ? ` (nodes ${nodes.join(", ")})` : ""}`);
    }
    promptId = ((await res.json()) as { prompt_id: string }).prompt_id;
    const onAbort = () => void f(`${base(p)}/interrupt`, { method: "POST" }).catch(() => undefined);
    req.signal?.addEventListener("abort", onAbort);
    for (;;) {
      await wait(1000, req.signal);
      const h = await f(`${base(p)}/history/${promptId}`);
      if (!h.ok) continue;
      const entry = ((await h.json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>; status?: { status_str?: string; messages?: unknown[] } }>)[promptId];
      if (!entry) continue;
      if (entry.status?.status_str === "error") throw new Error("ComfyUI stopped with an error. Its console says why.");
      const files = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? []).filter((i) => i.type === "output");
      if (!files.length) continue;
      const images: GeneratedImage[] = [];
      for (const file of files) {
        const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
        const img = await f(`${base(p)}/view?${q}`);
        if (img.ok) images.push({ bytes: new Uint8Array(await img.arrayBuffer()), mime: img.headers.get("content-type") ?? "image/png", seed });
      }
      return { images };
    }
  } finally {
    stop();
  }
}
