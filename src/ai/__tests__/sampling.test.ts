import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiProvider } from "../openai";
import { effortFor, modelTip, samplingFor } from "../sampling";
import { sseResponse } from "./sse";

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../http", () => ({ getFetch: async () => fetchMock.fn }));
afterEach(() => fetchMock.fn.mockReset());

const provider = openaiProvider({ id: "p", kind: "openai", name: "Local", baseUrl: "http://localhost:5001/v1", apiKey: "" });
const ok = () => sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, "[DONE]"]);

describe("sampling per task", () => {
  it("runs writing warmer than checks, with the user's values on top", () => {
    expect(samplingFor(undefined, "draft")).toEqual({ temperature: 1, minP: 0.05 });
    expect(samplingFor(undefined, "gap")).toEqual({ temperature: 0.3 });
    expect(samplingFor({ modes: { draft: { temperature: 1.2, topP: 0.9 } } }, "draft")).toEqual({ temperature: 1.2, topP: 0.9, minP: 0.05 });
    expect(samplingFor({ off: true }, "draft")).toBeUndefined();
    expect(effortFor(undefined, "draft")).toBe("medium");
    expect(effortFor("off", "draft")).toBeUndefined();
    expect(effortFor("high", "gap")).toBeUndefined();
    expect(modelTip("anthropic/claude-sonnet-4.5")?.family).toBe("Claude");
    expect(modelTip("deepseek-chat")?.family).toBe("DeepSeek");
    expect(modelTip("mistral-large")).toBeUndefined();
  });

  it("sends temperature, top-p and min-p, and asks again without them when refused", async () => {
    fetchMock.fn.mockResolvedValueOnce(ok());
    const req = { model: "m", system: "s", tools: [], useTools: true, messages: [{ role: "user" as const, text: "hi" }] };
    await provider.complete({ ...req, sampling: { temperature: 0.9, topP: 0.95, minP: 0.05 } });
    const body = JSON.parse(fetchMock.fn.mock.calls[0][1].body);
    expect([body.temperature, body.top_p, body.min_p]).toEqual([0.9, 0.95, 0.05]);

    fetchMock.fn.mockReset();
    fetchMock.fn.mockResolvedValueOnce(new Response("Unrecognized request argument supplied: min_p", { status: 400 })).mockResolvedValueOnce(ok());
    expect((await provider.complete({ ...req, sampling: { temperature: 0.9, minP: 0.05 } })).text).toBe("ok");
    const retry = JSON.parse(fetchMock.fn.mock.calls[1][1].body);
    expect([retry.temperature, retry.min_p]).toEqual([undefined, undefined]);
  });
});
