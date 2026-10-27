/**
 * Image providers, separate from the text ones: NanoGPT, any OpenAI-compatible images endpoint, and
 * a local ComfyUI. The UI is built from each provider's model list, never from a hardcoded one.
 */
import { getFetch } from "../ai/http";
import { newId } from "../lib/id";
import { base64Decode as base64ToBytes, base64Encode as bytesToBase64 } from "../card/bytes";
import { comfyGenerate, comfyModels, type ComfyWorkflow } from "./comfy";

export type ImageProviderKind = "nanogpt" | "openai" | "comfyui";

export interface ImageProviderConfig {
  id: string;
  kind: ImageProviderKind;
  name: string;
  /** NanoGPT and OpenAI: the API base ending in /v1. ComfyUI: its address, like http://127.0.0.1:8188. */
  baseUrl: string;
  apiKey: string;
  /** ComfyUI workflows, imported in API format and mapped once. */
  workflows?: ComfyWorkflow[];
  /** ComfyUI: the workflow for each kind of shot, by workflow id. */
  workflowFor?: Partial<Record<ImageTask, string>>;
  /** The model list, as last read from the provider. */
  models?: ImageModelInfo[];
}

export const IMAGE_PROVIDER_KINDS: Record<ImageProviderKind, { label: string; baseUrl: string; key: boolean }> = {
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", key: true },
  openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", key: true },
  comfyui: { label: "Local ComfyUI", baseUrl: "http://127.0.0.1:8188", key: false },
};

export const newImageProvider = (kind: ImageProviderKind): ImageProviderConfig => ({
  id: newId(),
  kind,
  name: IMAGE_PROVIDER_KINDS[kind].label,
  baseUrl: IMAGE_PROVIDER_KINDS[kind].baseUrl,
  apiKey: "",
});

/** The kinds of work a model can be picked for: cheap for icons, strong for character art. */
export type ImageTask = "character" | "emotion" | "background" | "scene" | "icon";
export const IMAGE_TASKS: Record<ImageTask, string> = {
  character: "Character art",
  emotion: "Emotions",
  background: "Backgrounds",
  scene: "Scenes and engine art",
  icon: "Icons",
};

export interface ImageModelChoice {
  providerId: string;
  model: string;
}

export interface ImageModelInfo {
  id: string;
  name: string;
  /** Per image, in USD, when the provider says. */
  price?: number;
  imageToImage?: boolean;
  inpainting?: boolean;
  nsfw?: boolean;
  /** Parameters the model takes beyond the prompt, like seed or strength. */
  params?: string[];
  resolutions?: string[];
}

export interface ImageRequest {
  model: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  n: number;
  seed?: number;
  /** A reference image for image-to-image (PNG or WebP bytes). */
  reference?: Uint8Array;
  /** How far to move from the reference, 0 to 1. */
  strength?: number;
  /** ComfyUI: the LoRA and its weight. */
  lora?: { name: string; weight: number };
  /** The kind of work, which picks the ComfyUI workflow. */
  task: ImageTask;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
  seed?: number;
}

export interface ImageResult {
  images: GeneratedImage[];
  /** What the provider charged, in USD, when it says. */
  cost?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** One model from a provider's list, whatever shape the provider uses. */
export function readImageModel(raw: unknown, key?: string): ImageModelInfo | undefined {
  if (typeof raw === "string") return { id: raw, name: raw };
  if (!isObject(raw)) return undefined;
  const id = String(raw.id ?? raw.model ?? key ?? "");
  if (!id) return undefined;
  const caps = isObject(raw.capabilities) ? raw.capabilities : {};
  const pricing = isObject(raw.pricing) ? raw.pricing : isObject(raw.cost) ? raw.cost : {};
  const price =
    num(raw.price) ??
    num(raw.cost) ??
    num(pricing.per_image) ??
    num(pricing.image) ??
    num(pricing.default) ??
    num(Object.values(pricing).find((v) => num(v) !== undefined));
  const params = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((p): p is string => typeof p === "string")
    : isObject(raw.supported_parameters)
      ? Object.keys(raw.supported_parameters)
      : undefined;
  const resolutions = Array.isArray(raw.resolutions)
    ? raw.resolutions.map((r) => (isObject(r) ? String(r.value ?? r.id ?? "") : String(r))).filter(Boolean)
    : undefined;
  return {
    id,
    name: String(raw.name ?? id),
    ...(price !== undefined ? { price } : {}),
    ...(caps.image_to_image !== undefined || raw.image_to_image !== undefined
      ? { imageToImage: !!(caps.image_to_image ?? raw.image_to_image) }
      : {}),
    ...(caps.inpainting !== undefined ? { inpainting: !!caps.inpainting } : {}),
    ...(caps.nsfw !== undefined ? { nsfw: !!caps.nsfw } : {}),
    ...(params ? { params } : {}),
    ...(resolutions?.length ? { resolutions } : {}),
  };
}

/** A provider's model list: an array under data or models, or an object keyed by id. */
export function readImageModels(body: unknown): ImageModelInfo[] {
  const list = Array.isArray(body) ? body : isObject(body) ? (body.data ?? body.models ?? body) : [];
  const entries: [string | undefined, unknown][] = Array.isArray(list)
    ? list.map((m) => [undefined, m])
    : isObject(list)
      ? Object.entries(list)
      : [];
  return entries.map(([k, m]) => readImageModel(m, k)).filter((m): m is ImageModelInfo => !!m);
}

const trimSlash = (url: string) => url.trim().replace(/\/+$/, "");
const headers = (p: ImageProviderConfig) => ({
  "Content-Type": "application/json",
  ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}`, "x-api-key": p.apiKey } : {}),
});

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const message = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message);
    if (message) return `${res.status}: ${message}`;
  } catch {
    // Not JSON.
  }
  return `${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

export async function listImageModels(p: ImageProviderConfig): Promise<ImageModelInfo[]> {
  if (p.kind === "comfyui") return comfyModels(p);
  const f = await getFetch();
  const base = trimSlash(p.baseUrl);
  // NanoGPT has a detailed image model list; elsewhere the plain one.
  const urls = p.kind === "nanogpt" ? [`${base}/images/models`, `${base}/image-models`, `${base}/models`] : [`${base}/models`];
  let last = "";
  for (const url of urls) {
    const res = await f(url, { headers: headers(p) });
    if (!res.ok) {
      last = await readError(res);
      continue;
    }
    const models = readImageModels(await res.json());
    if (models.length) return models;
  }
  if (last) throw new Error(`Couldn't list models: ${last}`);
  return [];
}

/** Bytes from a b64_json or a short-lived URL, in that order. */
async function fetchImage(item: Record<string, unknown>): Promise<GeneratedImage | undefined> {
  const b64 = item.b64_json ?? item.b64 ?? item.base64;
  if (typeof b64 === "string") {
    const [, mime, data] = /^data:([^;]+);base64,(.*)$/s.exec(b64) ?? [undefined, "image/png", b64];
    return { bytes: base64ToBytes(data), mime, seed: num(item.seed) };
  }
  if (typeof item.url === "string") {
    const f = await getFetch();
    const res = await f(item.url);
    if (!res.ok) throw new Error(`Couldn't download the image: ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/png", seed: num(item.seed) };
  }
  return undefined;
}

/** The size as OpenAI writes it, and as an aspect ratio for providers that take one. */
const sizeOf = (w: number, h: number) => `${w}x${h}`;
function aspect(w: number, h: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

export async function generateImages(p: ImageProviderConfig, req: ImageRequest): Promise<ImageResult> {
  if (p.kind === "comfyui") return comfyGenerate(p, req);
  const f = await getFetch();
  const info = p.models?.find((m) => m.id === req.model);
  const takes = (param: string) => !info?.params || info.params.includes(param);
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    n: req.n,
    size: sizeOf(req.width, req.height),
    response_format: "b64_json",
  };
  if (p.kind === "nanogpt") {
    body.resolution = sizeOf(req.width, req.height);
    body.aspect_ratio = aspect(req.width, req.height);
    if (req.negative.trim() && takes("negative_prompt")) body.negative_prompt = req.negative;
    if (req.seed !== undefined && takes("seed")) body.seed = req.seed;
    if (req.reference && info?.imageToImage !== false) {
      const url = `data:image/png;base64,${bytesToBase64(req.reference)}`;
      body.imageDataUrl = url;
      body.input_references = [url];
      if (req.strength !== undefined && takes("strength")) body.strength = req.strength;
    }
  }
  const res = await f(`${trimSlash(p.baseUrl)}/images/generations`, {
    method: "POST",
    headers: headers(p),
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as Record<string, unknown>;
  const data = Array.isArray(json.data) ? json.data : Array.isArray(json.images) ? json.images : [];
  const images = (await Promise.all(data.filter(isObject).map(fetchImage))).filter((i): i is GeneratedImage => !!i);
  if (!images.length) throw new Error("The provider sent no image.");
  const cost = num(json.cost) ?? (isObject(json.usage) ? num(json.usage.cost) : undefined);
  return { images, ...(cost !== undefined ? { cost } : {}) };
}

/** Width and height for a framing, at about a megapixel. */
export function sizeFor(framing: string): { width: number; height: number } {
  switch (framing) {
    case "landscape":
    case "scene":
      return { width: 1344, height: 768 };
    case "icon":
    case "square":
      return { width: 1024, height: 1024 };
    case "refsheet":
      return { width: 1344, height: 768 };
    default:
      return { width: 832, height: 1216 };
  }
}
