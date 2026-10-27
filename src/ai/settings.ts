/**
 * App-wide co-writer settings: providers with their API keys, which model each mode uses,
 * and the prompt library. Stored on the device only.
 */
import type { CraftPack, StyleSample } from "../cowriter/style";
import { create } from "zustand";
import { getSetting, putSetting } from "../db/db";
import { newId } from "../lib/id";
import type { ImageModelChoice, ImageProviderConfig, ImageTask } from "../images/providers";
import { openaiProvider } from "./openai";
import type { SamplingSettings } from "./sampling";
import type { Effort, ModeId, ModelChoice, ModelInfo, Provider, ProviderConfig } from "./types";

export interface PromptPreset {
  id: string;
  name: string;
  text: string;
  /**
   * A jailbreak goes at the very end of every request, after the chat, where it has the most
   * weight; other presets join the project's settings and are turned on per project.
   */
  kind?: "jailbreak";
  /** For a jailbreak: whether it's sent. */
  active?: boolean;
}

/** The active jailbreaks' text, to put after everything else in a request. */
export const jailbreakText = (settings: AiSettings) =>
  settings.presets
    .filter((p) => p.kind === "jailbreak" && p.active && p.text.trim())
    .map((p) => p.text.trim())
    .join("\n\n");

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
  /** What's known about each saved model, by `providerId/model`: images, context window, prices. */
  modelInfo?: Record<string, ModelInfo>;
  presets: PromptPreset[];
  imageStyles: ImageStyle[];
  /** Overused phrases the card checker flags; the built-in list until the user edits it. */
  slopPhrases?: string[];
  /** How hard the UI engineer works; the defaults until the user changes them. */
  engineer?: Partial<EngineerSettings>;
  /** The user's changes to the UI engineer's skills. */
  engineerSkills?: { edited: Record<string, string>; removed: string[] };
  /** Rewrite overused phrases in proposals before they reach the user; on unless turned off. */
  slopRewrite?: boolean;
  /** Sampling per task: the defaults unless the user changes them. */
  sampling?: SamplingSettings;
  /** How hard writing tasks think first; medium unless changed. */
  writingEffort?: Effort | "off";
  /** Add a short tip about the model's known fiction habits to writing prompts; on unless turned off. */
  modelTips?: boolean;
  /** Standing preferences the co-writer reads in everything it writes, learned from the user's feedback and edits. */
  styleNotes?: string[];
  /** How often each kind of feedback was given, and which were already offered as style notes. */
  feedback?: { counts: Record<string, number>; offered: string[] };
  /** Passages the user loves, for the co-writer to imitate. */
  styleSamples?: StyleSample[];
  /** The user's craft packs, and their edits to the built-in ones (same id). */
  craftPacks?: CraftPack[];
  /** Image providers, separate from the text ones. */
  imageProviders?: ImageProviderConfig[];
  /** The image model for each kind of work; character art's is the fallback. */
  imageModels?: Partial<Record<ImageTask, ImageModelChoice>>;
  /** How big a card may get with its images, in MB. */
  cardBudgetMb?: number;
}

export interface EngineerSettings {
  effort: Effort;
  /** Most model calls in one turn. */
  maxRounds: number;
  /** The longest single reply. */
  maxTokens: number;
  /** The engineer stops and asks before one message's work goes over this many tokens; 0 for no limit. */
  tokenLimit: number;
}

export const DEFAULT_ENGINEER: EngineerSettings = { effort: "max", maxRounds: 40, maxTokens: 64000, tokenLimit: 0 };

export const engineerSettings = (settings: AiSettings): EngineerSettings => ({ ...DEFAULT_ENGINEER, ...settings.engineer });

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

const usable = (settings: AiSettings, c?: ModelChoice): c is ModelChoice =>
  !!c?.model && settings.providers.some((p) => p.id === c.providerId);

/** The model every task uses unless it has its own: the chosen default, else the first model saved on a provider. */
export function defaultChoice(settings: AiSettings): ModelChoice | undefined {
  if (usable(settings, settings.defaultModel)) return settings.defaultModel;
  const first = settings.providers.find((p) => p.models?.length);
  return first && { providerId: first.id, model: first.models![0] };
}

/** The provider and model a mode runs on, or undefined when none is set up. */
export function resolveModel(settings: AiSettings, mode: ModeId) {
  const own = settings.modeModels[mode];
  const choice = usable(settings, own) ? own : defaultChoice(settings);
  const config = choice && settings.providers.find((p) => p.id === choice.providerId);
  if (!choice || !config || !choice.model) return undefined;
  return { choice, config, useTools: !settings.noToolModels.includes(modelKey(choice)) };
}

/** A model's info with sensible guesses filled in; `guessed` says which numbers are guesses. */
export function modelInfo(settings: AiSettings, choice: ModelChoice): ModelInfo & { context: number; guessed: boolean } {
  const info = settings.modelInfo?.[modelKey(choice)] ?? {};
  const claude = settings.providers.find((p) => p.id === choice.providerId)?.kind === "anthropic";
  return {
    ...info,
    vision: info.vision ?? (claude ? true : undefined),
    context: info.context ?? (claude ? 200_000 : 128_000),
    guessed: !info.context,
  };
}
