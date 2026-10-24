/**
 * App-wide co-writer settings: providers with their API keys, which model each mode uses,
 * and the prompt library. Stored on the device only.
 */
import { create } from "zustand";
import { getSetting, putSetting } from "../db/db";
import { newId } from "../lib/id";
import { openaiProvider } from "./openai";
import type { ModeId, ModelChoice, Provider, ProviderConfig } from "./types";

export interface PromptPreset {
  id: string;
  name: string;
  text: string;
}

/** A reusable look for image prompts. */
export interface ImageStyle {
  id: string;
  name: string;
  /** Booru-style tag list (Stable Diffusion, NovelAI) or plain sentences (Flux, DALL-E, Midjourney). */
  format: "tags" | "prose";
  /** The art style, e.g. "anime, cel shading, vibrant colours". */
  style: string;
  /** Put at the start of every prompt, e.g. quality tags. */
  prefix: string;
  /** Always in the negative prompt. */
  negative: string;
  /** Anything else the prompt should follow. */
  notes: string;
}

export const DEFAULT_IMAGE_STYLES: ImageStyle[] = [
  {
    id: "anime",
    name: "Anime",
    format: "tags",
    style: "anime style, cel shading, clean lineart, vibrant colours",
    prefix: "masterpiece, best quality, very aesthetic",
    negative: "lowres, bad anatomy, bad hands, extra fingers, missing fingers, text, watermark, signature, blurry",
    notes: "",
  },
  {
    id: "realistic",
    name: "Realistic photo",
    format: "prose",
    style: "photorealistic, natural light, shallow depth of field, 85mm lens",
    prefix: "",
    negative: "cartoon, illustration, 3d render, deformed hands, text, watermark",
    notes: "",
  },
  {
    id: "painterly",
    name: "Painterly fantasy",
    format: "prose",
    style: "digital painting, painterly brushwork, dramatic lighting, rich colour, fantasy concept art",
    prefix: "",
    negative: "photo, text, watermark, blurry",
    notes: "",
  },
];

export interface AiSettings {
  providers: ProviderConfig[];
  /** Model used by every mode without its own choice. */
  defaultModel?: ModelChoice;
  modeModels: Partial<Record<ModeId, ModelChoice>>;
  /** `providerId/model` of models that can't call tools; they write edits as JSON instead. */
  noToolModels: string[];
  presets: PromptPreset[];
  imageStyles: ImageStyle[];
}

const KEY = "ai";

export const EMPTY_SETTINGS: AiSettings = {
  providers: [],
  modeModels: {},
  noToolModels: [],
  presets: [],
  imageStyles: DEFAULT_IMAGE_STYLES,
};

/** Ready-made providers the user can add with just an API key. */
export const PROVIDER_TEMPLATES: Omit<ProviderConfig, "id" | "apiKey">[] = [
  { kind: "anthropic", name: "Claude" },
  { kind: "openai", name: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1" },
  { kind: "openai", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { kind: "openai", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { kind: "openai", name: "Custom endpoint", baseUrl: "" },
];

export const modelKey = (choice: ModelChoice) => `${choice.providerId}/${choice.model}`;

interface SettingsState {
  settings: AiSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AiSettings>) => Promise<void>;
  addProvider: (template: Omit<ProviderConfig, "id" | "apiKey">) => Promise<ProviderConfig>;
}

export const useAiSettings = create<SettingsState>((set, get) => ({
  settings: EMPTY_SETTINGS,
  loaded: false,
  async load() {
    if (get().loaded) return;
    const stored = await getSetting<AiSettings>(KEY);
    set({ settings: { ...EMPTY_SETTINGS, ...stored }, loaded: true });
  },
  async update(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await putSetting(KEY, settings);
  },
  async addProvider(template) {
    const provider: ProviderConfig = { ...template, id: newId(), apiKey: "" };
    await get().update({ providers: [...get().settings.providers, provider] });
    return provider;
  },
}));

export function createProvider(config: ProviderConfig): Provider {
  if (config.kind === "openai") return openaiProvider(config);
  // The Anthropic SDK is loaded only when Claude is used.
  const claude = import("./anthropic").then((m) => m.anthropicProvider(config));
  return {
    listModels: async () => (await claude).listModels(),
    complete: async (request) => (await claude).complete(request),
  };
}

/** The provider and model a mode runs on, or undefined when none is set up. */
export function resolveModel(settings: AiSettings, mode: ModeId) {
  const own = settings.modeModels[mode];
  // A mode without a finished choice of its own uses the default model.
  const choice = own?.model && settings.providers.some((p) => p.id === own.providerId) ? own : settings.defaultModel;
  const config = choice && settings.providers.find((p) => p.id === choice.providerId);
  if (!choice || !config || !choice.model) return undefined;
  return { choice, config, useTools: !settings.noToolModels.includes(modelKey(choice)) };
}
