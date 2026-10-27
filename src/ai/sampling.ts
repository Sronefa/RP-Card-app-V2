/**
 * Sampling and thinking per task: creative tasks run warmer, structured ones (JSON, scans, sorting)
 * cooler, and writing tasks think first where the model can. Short tips for a model's known habits
 * go into the system prompt of writing tasks.
 */
import type { Effort, ModeId } from "./types";

export interface Sampling {
  temperature?: number;
  topP?: number;
  minP?: number;
}

export interface SamplingSettings {
  /** Send no sampling settings at all: every provider uses its own defaults. */
  off?: boolean;
  /** The user's values per task, over the defaults. */
  modes?: Partial<Record<ModeId, Sampling>>;
}

/** Tasks that check, sort or fill in structure rather than write prose. */
export const STRUCTURED: ModeId[] = ["gap", "critic", "judge", "planner", "mechanics", "engineer", "sidecall"];

/** Tasks that write card prose, which think first when the model can. */
export const WRITING: ModeId[] = ["refine", "interview", "draft", "lore", "editor", "rewrite", "world", "arc"];

export const CREATIVE_SAMPLING: Sampling = { temperature: 1, minP: 0.05 };
export const STRUCTURED_SAMPLING: Sampling = { temperature: 0.3 };

export const defaultSampling = (mode: ModeId): Sampling => (STRUCTURED.includes(mode) ? STRUCTURED_SAMPLING : CREATIVE_SAMPLING);

/** What a task sends, or nothing when sampling is off. A value the user cleared falls back to the default. */
export function samplingFor(settings: SamplingSettings | undefined, mode: ModeId): Sampling | undefined {
  if (settings?.off) return undefined;
  const mine = settings?.modes?.[mode] ?? {};
  const out: Sampling = { ...defaultSampling(mode) };
  for (const key of ["temperature", "topP", "minP"] as const) if (typeof mine[key] === "number") out[key] = mine[key];
  return out;
}

/** The default thinking effort for writing tasks. */
export const DEFAULT_WRITING_EFFORT: Effort = "medium";

/** How hard a task thinks, or nothing for the model's own default. */
export function effortFor(setting: Effort | "off" | undefined, mode: ModeId): Effort | undefined {
  if (!WRITING.includes(mode)) return undefined;
  const effort = setting ?? DEFAULT_WRITING_EFFORT;
  return effort === "off" ? undefined : effort;
}

export const EQ_BENCH_URL = "https://eqbench.com/creative_writing.html";

/** Habits StoryScope found in each model family's fiction, with what to do instead. */
export const MODEL_TIPS: { family: string; match: RegExp; tip: string }[] = [
  {
    family: "Claude",
    match: /claude|opus|sonnet|haiku/i,
    tip: "Your fiction tends toward restrained escalation and quiet endings. When a scene calls for it, escalate fully and let endings land hard or stay open.",
  },
  {
    family: "GPT",
    match: /gpt|\bo[134](-|$)|chatgpt/i,
    tip: "Your fiction tends to move plots through gossip and rumor. Let characters learn things through action, evidence and what they see for themselves.",
  },
  {
    family: "Gemini",
    match: /gemini|gemma/i,
    tip: "Your fiction tends toward bleak settings and tidy endings. Vary the mood of places, and leave threads open for the roleplay to pick up.",
  },
  {
    family: "DeepSeek",
    match: /deepseek/i,
    tip: "Your fiction tends to front-load context. Open in the moment and let background come out later, a piece at a time.",
  },
];

/** The tip for a model, by its id. */
export const modelTip = (model: string) => MODEL_TIPS.find((t) => t.match.test(model));
