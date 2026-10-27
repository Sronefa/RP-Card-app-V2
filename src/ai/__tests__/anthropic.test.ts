import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "../anthropic";
import { CARD_TOOLS } from "../tools";
import { sseResponse } from "./sse";

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../http", () => ({ getFetch: async () => fetchMock.fn }));
afterEach(() => fetchMock.fn.mockReset());

function claudeStream(model: string, blocks: object[], deltas: object[], stopReason: string) {
  return sseResponse(
    [
      {
        type: "message_start",
        message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } },
      },
      ...blocks.flatMap((block, index) => [
        { type: "content_block_start", index, content_block: block },
        ...deltas.filter((d) => (d as { index: number }).index === index).map((d) => ({ type: "content_block_delta", ...d })),
        { type: "content_block_stop", index },
      ]),
      { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 20 } },
      { type: "message_stop" },
    ],
    true,
  );
}

const provider = anthropicProvider({ id: "c", kind: "anthropic", name: "Claude", apiKey: "sk-ant-test" });

describe("Claude provider", () => {
  it("streams text, collects tool calls and keeps the raw content to echo back", async () => {
    fetchMock.fn.mockResolvedValue(
      claudeStream(
        "claude-opus-5-5",
        [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "" },
          { type: "tool_use", id: "toolu_1", name: "set_field", input: {} },
        ],
        [
          { index: 1, delta: { type: "text_delta", text: "Rewriting." } },
          { index: 2, delta: { type: "input_json_delta", partial_json: '{"field":"scenario",' } },
          { index: 2, delta: { type: "input_json_delta", partial_json: '"text":"A storm."}' } },
        ],
        "tool_use",
      ),
    );
    const deltas: string[] = [];
    const result = await provider.complete({
      model: "claude-opus-5-5",
      system: "sys",
      messages: [{ role: "user", text: "hi" }],
      tools: CARD_TOOLS,
      useTools: true,
      onText: (d) => deltas.push(d),
    });
    expect(deltas.join("")).toBe("Rewriting.");
    expect(result.text).toBe("Rewriting.");
    expect(result.stop).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "toolu_1", name: "set_field", input: { field: "scenario", text: "A storm." } }]);
    expect((result.raw!.content as { type: string }[]).map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);

    const [url, init] = fetchMock.fn.mock.calls[0];
    expect(String(url)).toContain("/v1/messages");
    const body = JSON.parse(init.body);
    expect(body.system[0]).toMatchObject({ text: "sys", cache_control: { type: "ephemeral" } });
    expect(body.tools[0]).toMatchObject({ name: "set_field", eager_input_streaming: true });
    expect(body.fallbacks).toBe("default");
    expect(new Headers(init.headers).get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.temperature).toBeUndefined();
  });

  it("sends the history back with raw content and tool results", async () => {
    fetchMock.fn.mockResolvedValue(claudeStream("claude-haiku-5-5", [{ type: "text", text: "" }], [{ index: 0, delta: { type: "text_delta", text: "ok" } }], "end_turn"));
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "pitch", input: { title: "t", idea: "i" } }];
    await provider.complete({
      model: "claude-haiku-5-5",
      system: "s",
      useTools: true,
      tools: CARD_TOOLS,
      messages: [
        { role: "user", text: "go" },
        { role: "assistant", text: "", toolCalls: [{ id: "toolu_1", name: "pitch", input: {} }], raw: { kind: "anthropic", content: raw } },
        { role: "tool", results: [{ id: "toolu_1", content: "shown", isError: false }] },
        { role: "user", text: "next" },
      ],
    });
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect(body.fallbacks).toBeUndefined();
    expect(body.messages[1]).toEqual({ role: "assistant", content: raw });
    // Tool results and the user's next message share one turn.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "shown", is_error: false },
        // The end of the conversation is cached for the next call.
        { type: "text", text: "next", cache_control: { type: "ephemeral" } },
      ],
    });
  });

  it("sends screenshots with tool results and asks for thinking at the chosen effort", async () => {
    fetchMock.fn.mockResolvedValue(claudeStream("claude-opus-5-5", [{ type: "text", text: "" }], [{ index: 0, delta: { type: "text_delta", text: "ok" } }], "end_turn"));
    await provider.complete({
      model: "claude-opus-5-5",
      system: "s",
      useTools: true,
      tools: CARD_TOOLS,
      effort: "max",
      maxTokens: 64000,
      messages: [
        { role: "user", text: "go" },
        { role: "assistant", text: "", toolCalls: [{ id: "toolu_1", name: "render", input: {} }] },
        { role: "tool", results: [{ id: "toolu_1", content: "Rendered.", images: [{ mediaType: "image/png", data: "AAAA" }] }] },
      ],
    });
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "max" });
    expect(body.max_tokens).toBe(64000);
    expect(body.messages[2].content[0].content).toEqual([
      { type: "text", text: "Rendered." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("asks again without thinking when the model doesn't take it", async () => {
    fetchMock.fn
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "output_config.effort is not supported on this model" } }), { status: 400, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(claudeStream("claude-haiku-4-5", [{ type: "text", text: "" }], [{ index: 0, delta: { type: "text_delta", text: "ok" } }], "end_turn"));
    const result = await provider.complete({ model: "claude-haiku-4-5", system: "s", useTools: true, tools: [], effort: "high", messages: [{ role: "user", text: "hi" }] });
    expect(result.text).toBe("ok");
    const retry = JSON.parse(fetchMock.fn.mock.calls[1][1].body);
    expect(retry.thinking).toBeUndefined();
    expect(retry.output_config).toBeUndefined();
  });

  it("sends temperature only without thinking, and drops it when the model refuses it", async () => {
    const stream = () => claudeStream("claude-haiku-4-5", [{ type: "text", text: "" }], [{ index: 0, delta: { type: "text_delta", text: "ok" } }], "end_turn");
    const req = { model: "claude-haiku-4-5", system: "s", useTools: true, tools: [], messages: [{ role: "user" as const, text: "hi" }], sampling: { temperature: 1.3, minP: 0.05 } };
    fetchMock.fn.mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream());
    await provider.complete(req);
    await provider.complete({ ...req, effort: "medium" });
    const [plain, thinking] = fetchMock.fn.mock.calls.map((c) => JSON.parse(c[1].body));
    expect([plain.temperature, plain.min_p, plain.top_p]).toEqual([1, undefined, undefined]);
    expect(thinking.temperature).toBeUndefined();

    fetchMock.fn.mockReset();
    fetchMock.fn
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "temperature is not supported for this model" } }), { status: 400, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(stream());
    expect((await provider.complete(req)).text).toBe("ok");
    expect(JSON.parse(fetchMock.fn.mock.calls[1][1].body).temperature).toBeUndefined();
  });

  it("leaves out the tool list for calls without tools", async () => {
    fetchMock.fn.mockResolvedValue(claudeStream("claude-haiku-5-5", [{ type: "text", text: "" }], [{ index: 0, delta: { type: "text_delta", text: "ok" } }], "end_turn"));
    await provider.complete({ model: "claude-haiku-5-5", system: "s", useTools: true, tools: [], messages: [{ role: "user", text: "review" }] });
    expect(JSON.parse(fetchMock.fn.mock.calls[0][1].body).tools).toBeUndefined();
  });

  it("uses only the content after a mid-output fallback", async () => {
    fetchMock.fn.mockResolvedValue(
      claudeStream(
        "claude-opus-4-8",
        [
          { type: "text", text: "" },
          { type: "tool_use", id: "toolu_old", name: "pitch", input: {} },
          { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
          { type: "text", text: "" },
        ],
        [
          { index: 0, delta: { type: "text_delta", text: "Partial " } },
          { index: 1, delta: { type: "input_json_delta", partial_json: '{"title":"x","idea":"y"}' } },
          { index: 3, delta: { type: "text_delta", text: "Continued." } },
        ],
        "end_turn",
      ),
    );
    const result = await provider.complete({ model: "claude-opus-5-5", system: "s", messages: [], tools: CARD_TOOLS, useTools: true });
    expect(result.text).toBe("Continued.");
    expect(result.toolCalls).toEqual([]);
    expect((result.raw!.content as { type: string }[]).map((b) => b.type)).toEqual(["text", "fallback", "text"]);
  });
});
