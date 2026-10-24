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
}

/** How long a model call may take when the provider doesn't say otherwise. */
export const DEFAULT_TIMEOUT_SEC = 600;

export interface ModelChoice {
  providerId: string;
  model: string;
}

/** Co-writer modes. Each has its own system prompt and can use its own model. */
export type ModeId = "refine" | "interview" | "gap" | "draft" | "suggest" | "lore" | "critic" | "image" | "planner";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
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
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

export interface CompletionResult {
  /** Text shown to the user (a JSON edit block, when tools are off, is removed). */
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  raw?: { kind: ProviderKind; content: unknown };
}

export interface Provider {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<string[]>;
}

/** Thrown when an endpoint rejects a request because the model can't use tools. */
export class ToolsUnsupportedError extends Error {}
