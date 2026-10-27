import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { complete } from "../../cowriter/engine";
import { resetDbForTests } from "../../db/db";
import { SamplingSettings } from "../settings/SamplingSettings";

const script = vi.hoisted(() => ({ requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest): Promise<CompletionResult> => {
      script.requests.push({ ...req, signal: undefined });
      return { text: "ok", toolCalls: [], stop: "end" };
    },
  }),
}));

const ask = (mode: Parameters<typeof complete>[0]) => complete(mode, { system: "Base.", messages: [{ role: "user", text: "hi" }], tools: [] });

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.requests = [];
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://nano.test/v1", apiKey: "", models: ["deepseek-chat"] }],
      defaultModel: { providerId: "p", model: "deepseek-chat" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
    },
  });
});

describe("sampling and model settings per task", () => {
  it("sends warmer sampling, thinking and the model's tip for writing, and cooler sampling for checks", async () => {
    await ask("draft");
    expect(script.requests[0]).toMatchObject({ sampling: { temperature: 1, minP: 0.05 }, effort: "medium" });
    expect(script.requests[0].system).toMatch(/^Base\.\n\nYour fiction tends to front-load context/);
    await ask("gap");
    expect(script.requests[1]).toMatchObject({ sampling: { temperature: 0.3 }, system: "Base." });
    expect(script.requests[1].effort).toBeUndefined();
  });

  it("follows the user's settings", async () => {
    render(<SamplingSettings modes={[{ mode: "draft", label: "Drafting" }]} />);
    fireEvent.click(screen.getByText("Sampling and thinking (optional)"));
    expect(screen.getByRole("link", { name: "EQ-Bench creative writing leaderboard" })).toHaveAttribute("href", "https://eqbench.com/creative_writing.html");
    expect(screen.getByText(/front-load context/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Drafting temperature" }), { target: { value: "1.3" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Thinking for writing tasks" }), { target: { value: "off" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Add a tip about the model's habits/ }));
    await waitFor(() => expect(useAiSettings.getState().settings.modelTips).toBe(false));
    await ask("draft");
    expect(script.requests[0]).toMatchObject({ sampling: { temperature: 1.3, minP: 0.05 }, system: "Base." });
    expect(script.requests[0].effort).toBeUndefined();

    fireEvent.click(screen.getByRole("checkbox", { name: "Send sampling settings" }));
    await waitFor(() => expect(useAiSettings.getState().settings.sampling?.off).toBe(true));
    await ask("draft");
    expect(script.requests[1].sampling).toBeUndefined();
  });
});
