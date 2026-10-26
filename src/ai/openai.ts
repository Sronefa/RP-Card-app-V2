/**
 * Any OpenAI-compatible chat completions endpoint: NanoGPT, OpenRouter, DeepSeek, local servers…
 */
import { getFetch } from "./http";
import { extractJsonEdits, jsonEditInstructions, resultsAsText } from "./jsonEdits";
import {
  ToolsUnsupportedError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type Effort,
  type Provider,
  type ProviderConfig,
  type StopReason,
  type ToolCall,
} from "./types";

type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | WirePart[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const STOP: Record<string, StopReason> = { stop: "end", tool_calls: "tool_use", length: "max_tokens", content_filter: "refusal" };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300) || "no details"}`);
  }
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function openaiProvider(config: ProviderConfig): Provider {
  const base = trimSlash(config.baseUrl ?? "");
  const headers = {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  return {
    async listModels() {
      const fetch = await getFetch();
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      const json = (await res.json()) as { data?: { id: string }[] };
      return (json.data ?? []).map((m) => m.id).sort();
    },

    async complete(request) {
      const fetch = await getFetch();
      let reasoning = !!request.effort;
      for (;;) {
        try {
          return await completeOnce(fetch, request, reasoning);
        } catch (e) {
          // Endpoints that don't know reasoning_effort: ask again without it.
          if (reasoning && e instanceof HttpError && e.status >= 400 && e.status < 500 && /reason|effort/i.test(e.body)) {
            reasoning = false;
            continue;
          }
          throw e;
        }
      }
    },
  };

  async function completeOnce(fetch: typeof globalThis.fetch, request: CompletionRequest, reasoning: boolean): Promise<CompletionResult> {
    const body = {
      model: request.model,
      stream: true,
      messages: toWire(request),
      ...(reasoning && request.effort ? { reasoning_effort: REASONING[request.effort] } : {}),
      ...(request.useTools && request.tools.length
        ? {
            tools: request.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      if (request.useTools && res.status >= 400 && res.status < 500 && /tool|function/i.test(text)) throw new ToolsUnsupportedError(text);
      throw new HttpError(res.status, text);
    }
    const result = await readStream(res, request.onText);
    if (request.useTools) return result;
    const { text, toolCalls } = extractJsonEdits(result.text);
    return { ...result, text, toolCalls, raw: { kind: "openai", content: result.text } };
  }
}

/** OpenAI's reasoning levels stop at high. */
const REASONING: Record<Effort, string> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

/** Tool messages carry text only, so pictures from tool results follow as a user message. */
function imagesMessage(m: Extract<ChatMessage, { role: "tool" }>): WireMessage[] {
  const parts: WirePart[] = m.results.flatMap((r) =>
    (r.images ?? []).map((i): WirePart => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } })),
  );
  return parts.length ? [{ role: "user", content: [{ type: "text", text: "The pictures from those tool results:" }, ...parts] }] : [];
}

function toWire(request: CompletionRequest): WireMessage[] {
  const system = request.useTools || !request.tools.length ? request.system : `${request.system}\n\n${jsonEditInstructions(request.tools)}`;
  const out: WireMessage[] = [{ role: "system", content: system }];
  for (const m of request.messages) out.push(...wireMessage(m, request.useTools));
  return out;
}

function wireMessage(m: ChatMessage, useTools: boolean): WireMessage[] {
  if (m.role === "user") return [{ role: "user", content: m.text }];
  if (m.role === "tool") {
    if (!useTools) return [{ role: "user", content: resultsAsText(m) }, ...imagesMessage(m)];
    return [
      ...m.results.map((r): WireMessage => ({ role: "tool", tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content })),
      ...imagesMessage(m),
    ];
  }
  // The reply as the model wrote it, JSON edit block included.
  const text = m.raw?.kind === "openai" && typeof m.raw.content === "string" ? m.raw.content : m.text;
  if (!useTools || m.toolCalls.length === 0) {
    const edits = !useTools && m.toolCalls.length > 0 && text === m.text ? `\n\n${editsBlock(m.toolCalls)}` : "";
    return [{ role: "assistant", content: text + edits }];
  }
  return [
    {
      role: "assistant",
      content: text || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })),
    },
  ];
}

const editsBlock = (calls: ToolCall[]) =>
  "```json\n" + JSON.stringify({ edits: calls.map((c) => ({ tool: c.name, input: c.input })) }) + "\n```";

interface Delta {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

/** Reads a server-sent event stream of chat completion chunks. */
export async function readStream(res: Response, onText?: (delta: string) => void): Promise<CompletionResult> {
  if (!res.body) throw new Error("The endpoint sent no response body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let finish = "";
  const calls: { id: string; name: string; args: string }[] = [];

  const handle = (data: string) => {
    if (data === "[DONE]") return;
    let chunk: { choices?: { delta?: Delta; finish_reason?: string | null }[]; error?: { message?: string } };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) throw new Error(chunk.error.message ?? "The endpoint reported an error");
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta;
    if (delta?.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const call = (calls[tc.index] ??= { id: "", name: "", args: "" });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.args += tc.function.arguments;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) if (line.startsWith("data:")) handle(line.slice(5).trim());
    if (done) break;
  }

  const toolCalls: ToolCall[] = calls.filter(Boolean).map((c, i) => {
    let input: Record<string, unknown> = {};
    try {
      input = c.args ? JSON.parse(c.args) : {};
    } catch {
      input = { __invalid_json: c.args };
    }
    return { id: c.id || `call_${i}`, name: c.name, input };
  });
  return {
    text,
    toolCalls,
    stop: toolCalls.length > 0 ? "tool_use" : (STOP[finish] ?? "other"),
    raw: { kind: "openai", content: text },
  };
}
