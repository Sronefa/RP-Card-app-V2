/**
 * Claude through the official Anthropic SDK.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getFetch } from "./http";
import type { ChatMessage, CompletionRequest, CompletionResult, Provider, ProviderConfig, StopReason, ToolCall } from "./types";

type Block = Anthropic.Beta.BetaContentBlock;
type BlockParam = Anthropic.Beta.BetaContentBlockParam;

const MAX_TOKENS = 32000;
/** Used when a model's output limit is lower than MAX_TOKENS (older models). */
const SMALL_MAX_TOKENS = 8192;

/**
 * Models that accept the server-side fallback: when a model declines a request, the API
 * re-runs it on another Claude model in the same call instead of stopping.
 */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

export function anthropicProvider(config: ProviderConfig): Provider {
  let client: Anthropic | undefined;
  async function getClient() {
    client ??= new Anthropic({
      apiKey: config.apiKey,
      // The key belongs to the user and stays on their device; the app talks to the API directly.
      dangerouslyAllowBrowser: true,
      fetch: await getFetch(),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    return client;
  }

  return {
    async listModels() {
      const c = await getClient();
      const ids: string[] = [];
      for await (const model of c.models.list()) ids.push(model.id);
      return ids;
    },

    async complete(request) {
      const c = await getClient();
      let maxTokens = MAX_TOKENS;
      for (let attempt = 0; ; attempt++) {
        try {
          return await streamOnce(c, request, maxTokens);
        } catch (e) {
          if (e instanceof Anthropic.APIError) {
            if (e instanceof Anthropic.BadRequestError && /max_tokens/i.test(e.message) && maxTokens > SMALL_MAX_TOKENS) {
              maxTokens = SMALL_MAX_TOKENS;
              continue;
            }
            throw e;
          }
          // A tool input that couldn't be parsed at all: re-issue the turn, at most twice.
          if (e instanceof Anthropic.AnthropicError && attempt < 2) continue;
          throw e;
        }
      }
    },
  };
}

async function streamOnce(client: Anthropic, request: CompletionRequest, maxTokens: number): Promise<CompletionResult> {
  const fallback = FALLBACK_MODELS.has(request.model);
  const stream = client.beta.messages.stream(
    {
      model: request.model,
      max_tokens: maxTokens,
      // The system prompt doesn't change during a chat, so it is cached.
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropic(request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
              eager_input_streaming: true,
            })),
          }
        : {}),
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal: request.signal },
  );
  if (request.onText) stream.on("text", request.onText);
  const message = await stream.finalMessage();
  const content = message.content;
  const usable = afterFallback(content);
  const text = usable
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls: ToolCall[] = usable
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  return {
    text,
    toolCalls,
    stop: STOP[message.stop_reason ?? ""] ?? "other",
    raw: { kind: "anthropic", content: echoContent(content) },
  };
}

/** Blocks from the model that finished the turn: everything after the last fallback marker. */
function afterFallback(content: Block[]): Block[] {
  const last = content.map((b) => b.type as string).lastIndexOf("fallback");
  return last < 0 ? content : content.slice(last + 1);
}

/**
 * Content to send back on the next request. After a mid-output fallback, thinking and tool-use
 * blocks from before the last fallback marker are left out; text blocks stay.
 */
function echoContent(content: Block[]): Block[] {
  const last = content.map((b) => b.type as string).lastIndexOf("fallback");
  if (last < 0) return content;
  const dropped = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i > last || !dropped.has(b.type as string));
}

function toAnthropic(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const param of messages.map(toParam)) {
    // A user message can follow tool results (e.g. interview answers then a new request); one turn holds both.
    const last = out.at(-1);
    if (last?.role === "user" && param.role === "user") last.content = [...blocks(last.content), ...blocks(param.content)];
    else out.push(param);
  }
  return out;
}

const blocks = (content: Anthropic.Beta.BetaMessageParam["content"]): BlockParam[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : ((content ?? []) as BlockParam[]);

function toParam(m: ChatMessage): Anthropic.Beta.BetaMessageParam {
  if (m.role === "user") return { role: "user", content: m.text };
  if (m.role === "tool")
    return {
      role: "user",
      content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError })),
    };
  if (m.raw?.kind === "anthropic") return { role: "assistant", content: m.raw.content as BlockParam[] };
  // Turn written by another provider earlier in the chat.
  const content: BlockParam[] = [];
  if (m.text) content.push({ type: "text", text: m.text });
  for (const call of m.toolCalls) content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
  return { role: "assistant", content: content.length ? content : [{ type: "text", text: "…" }] };
}
