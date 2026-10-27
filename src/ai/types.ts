/**
 * Provider-neutral types for talking to language models. Each provider adapter converts
 * these to and from its own wire format.
 */

export type ProviderKind = "anthropic" | "openai";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** Shown in the UI, e.g. "Claude" or "NanoGPT". */
  name: string;
  /** OpenAI-compatible base URL, ending before /chat/completions (e.g. https://nano-gpt.com/api/v1). */
  baseUrl?: string;
  apiKey: string;
  /** Models the user keeps at hand for this provider, to switch between quickly. */
  models?: string[];
  /** Seconds to wait for a reply before giving up. */
  timeoutSec?: number;
  /** A local backend that bans phrases while generating (KoboldCpp): the slop list goes with each request. */
  banPhrases?: boolean;
}

/** How long a model call may take when the provider doesn't say otherwise. */
export const DEFAULT_TIMEOUT_SEC = 600;

export interface ModelChoice {
  providerId: string;
  model: string;
}

/** Co-writer modes. Each has its own system prompt and can use its own model. */
export type ModeId = "refine" | "interview" | "gap" | "draft" | "suggest" | "lore" | "critic" | "editor" | "rewrite" | "judge" | "image" | "planner" | "world" | "arc" | "mechanics" | "engineer" | "playtest" | "player" | "sidecall";

/** How hard a model thinks before it answers, where the provider supports it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
  /** Pictures that go with the result, like a screenshot, for models that can see. */
  images?: ToolImage[];
}

export interface ToolImage {
  mediaType: "image/png" | "image/jpeg";
  /** Base64, without the data: prefix. */
  data: string;
}

/**
 * One entry of a conversation. `raw` keeps the provider's own content for assistant turns
 * so it can be sent back unchanged (Claude's thinking blocks must be echoed exactly).
 */
export type ChatMessage =
  /** `text` is what the model receives; `display`, when set, is what the user typed. */
  | { role: "user"; text: string; display?: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: { kind: ProviderKind; content: unknown } }
  | { role: "tool"; results: ToolResult[] };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  parameters: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface CompletionRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  /** False for models that can't call tools: edits come back as a JSON block in the text instead. */
  useTools: boolean;
  /** Thinking effort; left out, the model's own default. */
  effort?: Effort;
  /** The longest reply allowed; left out, the provider's default. */
  maxTokens?: number;
  /** Phrases a local backend bans while generating. */
  bannedPhrases?: string[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

/** Tokens one call used, as the provider reported them. */
export interface CallUsage {
  /** Prompt tokens read fresh (not from the cache). */
  input: number;
  output: number;
  /** Prompt tokens read from the cache. */
  cacheRead: number;
  /** Prompt tokens written to the cache. */
  cacheWrite: number;
  /** What the provider charged, in USD, when it says. */
  cost?: number;
}

export interface CompletionResult {
  /** Text shown to the user (a JSON edit block, when tools are off, is removed). */
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  raw?: { kind: ProviderKind; content: unknown };
  /** Left out when the endpoint doesn't report usage. */
  usage?: CallUsage;
}

/** What CardForge knows about a model, from the provider's model list or from the user. */
export interface ModelInfo {
  /** Takes images (screenshots). Unknown means yes. */
  vision?: boolean;
  /** Context window in tokens. */
  context?: number;
  /** USD per million input and output tokens. */
  inPrice?: number;
  outPrice?: number;
}

export interface Provider {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<string[]>;
  /** Details for the models the provider lists, where it says. */
  modelDetails?(): Promise<Record<string, ModelInfo>>;
}

/** Thrown when an endpoint rejects a request because the model can't use tools. */
export class ToolsUnsupportedError extends Error {}
