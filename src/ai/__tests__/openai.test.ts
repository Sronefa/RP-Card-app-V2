import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJsonEdits } from "../jsonEdits";
import { openaiProvider } from "../openai";
import { CARD_TOOLS } from "../tools";
import { ToolsUnsupportedError } from "../types";
import { sseResponse } from "./sse";

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../http", () => ({ getFetch: async () => fetchMock.fn }));
afterEach(() => fetchMock.fn.mockReset());

const provider = openaiProvider({ id: "p", kind: "openai", name: "Nano", baseUrl: "https://nano.test/v1/", apiKey: "k" });
const chunk = (delta: object, finish: string | null = null) => ({ choices: [{ delta, finish_reason: finish }] });

describe("OpenAI-compatible provider", () => {
  it("streams text and assembles tool calls from deltas", async () => {
    fetchMock.fn.mockResolvedValue(
      sseResponse([
        chunk({ content: "Tightening " }),
        chunk({ content: "it." }),
        chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "patch_field", arguments: '{"field":"desc' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'ription","find":"a","replace":"b"}' } }] }),
        chunk({}, "tool_calls"),
        "[DONE]",
      ]),
    );
    const deltas: string[] = [];
    const result = await provider.complete({
      model: "m",
      system: "sys",
      messages: [{ role: "user", text: "hi" }],
      tools: CARD_TOOLS,
      useTools: true,
      onText: (d) => deltas.push(d),
    });
    expect(deltas.join("")).toBe("Tightening it.");
    expect(result).toMatchObject({
      text: "Tightening it.",
      stop: "tool_use",
      toolCalls: [{ id: "call_1", name: "patch_field", input: { field: "description", find: "a", replace: "b" } }],
    });
    const [url, init] = fetchMock.fn.mock.calls[0];
    expect(url).toBe("https://nano.test/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.tools[0].function.name).toBe("set_field");
  });

  it("sends earlier tool calls and results in OpenAI's shape", async () => {
    fetchMock.fn.mockResolvedValue(sseResponse([chunk({ content: "Done." }, "stop")]));
    await provider.complete({
      model: "m",
      system: "s",
      useTools: true,
      tools: CARD_TOOLS,
      messages: [
        { role: "user", text: "go" },
        { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "pitch", input: { title: "t", idea: "i" } }] },
        { role: "tool", results: [{ id: "c1", content: "shown" }] },
      ],
    });
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect(body.messages.slice(2)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "pitch", arguments: '{"title":"t","idea":"i"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "shown" },
    ]);
  });

  it("sends tool pictures as a user message and asks for reasoning", async () => {
    fetchMock.fn.mockResolvedValue(sseResponse([chunk({ content: "ok" }, "stop"), "[DONE]"]));
    await provider.complete({
      model: "m",
      system: "s",
      tools: CARD_TOOLS,
      useTools: true,
      effort: "max",
      messages: [
        { role: "user", text: "go" },
        { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "render", input: {} }] },
        { role: "tool", results: [{ id: "c1", content: "Rendered.", images: [{ mediaType: "image/png", data: "AAAA" }] }] },
      ],
    });
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("high");
    expect(body.messages.at(-2)).toEqual({ role: "tool", tool_call_id: "c1", content: "Rendered." });
    expect(body.messages.at(-1).content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });

  it("asks again without reasoning when the endpoint doesn't know it", async () => {
    fetchMock.fn
      .mockResolvedValueOnce(new Response("unknown parameter: reasoning_effort", { status: 400 }))
      .mockResolvedValueOnce(sseResponse([chunk({ content: "ok" }, "stop"), "[DONE]"]));
    const result = await provider.complete({ model: "m", system: "s", tools: [], useTools: true, effort: "high", messages: [{ role: "user", text: "hi" }] });
    expect(result.text).toBe("ok");
    expect(JSON.parse(fetchMock.fn.mock.calls[1][1].body).reasoning_effort).toBeUndefined();
  });

  it("reports models that reject tools", async () => {
    fetchMock.fn.mockResolvedValue(new Response('{"error":"tools are not supported for this model"}', { status: 400 }));
    await expect(
      provider.complete({ model: "m", system: "s", messages: [], tools: CARD_TOOLS, useTools: true }),
    ).rejects.toBeInstanceOf(ToolsUnsupportedError);
  });

  it("reads JSON edits from the text when tools are off", async () => {
    fetchMock.fn.mockResolvedValue(
      sseResponse([chunk({ content: 'Here you go.\n\n```json\n{"edits":[{"tool":"set_field","input":{"field":"scenario","text":"A storm."}}]}\n```' }, "stop")]),
    );
    const result = await provider.complete({ model: "m", system: "s", messages: [], tools: CARD_TOOLS, useTools: false });
    expect(result.text).toBe("Here you go.");
    expect(result.toolCalls).toMatchObject([{ name: "set_field", input: { field: "scenario", text: "A storm." } }]);
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain('{"edits"');
  });

  it("lists models", async () => {
    fetchMock.fn.mockResolvedValue(Response.json({ data: [{ id: "b" }, { id: "a" }] }));
    expect(await provider.listModels()).toEqual(["a", "b"]);
  });
});

describe("extractJsonEdits", () => {
  it("leaves text without a block alone", () => {
    expect(extractJsonEdits("Just text.")).toEqual({ text: "Just text.", toolCalls: [] });
  });
  it("ignores a broken block", () => {
    expect(extractJsonEdits('x\n```json\n{"edits": [}\n```').toolCalls).toEqual([]);
  });
});
