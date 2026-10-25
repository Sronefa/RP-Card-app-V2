import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_STYLES, defaultChoice, resolveModel, useAiSettings, type AiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { complete, withJailbreak } from "../../cowriter/engine";
import { resetDbForTests } from "../../db/db";
import { SettingsView } from "../settings/SettingsView";

const script = vi.hoisted(() => ({ requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest): Promise<CompletionResult> => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      return { text: "ok", toolCalls: [], stop: "end" };
    },
  }),
}));

const base = (patch: Partial<AiSettings> = {}): AiSettings => ({
  providers: [
    { id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k", models: ["alpha", "beta"] },
    { id: "q", kind: "openai", name: "Other", baseUrl: "https://y/v1", apiKey: "k", models: ["gamma"] },
  ],
  modeModels: {},
  noToolModels: [],
  presets: [],
  imageStyles: DEFAULT_IMAGE_STYLES,
  ...patch,
});

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.requests = [];
  useAiSettings.setState({ loaded: true, settings: base() });
});

describe("models", () => {
  it("uses the first saved model until a default is picked", () => {
    expect(defaultChoice(base())).toEqual({ providerId: "p", model: "alpha" });
    expect(defaultChoice(base({ defaultModel: { providerId: "gone", model: "x" } }))).toEqual({ providerId: "p", model: "alpha" });
    const s = base({ defaultModel: { providerId: "q", model: "gamma" }, modeModels: { critic: { providerId: "p", model: "beta" } } });
    expect(resolveModel(s, "refine")!.choice).toEqual({ providerId: "q", model: "gamma" });
    expect(resolveModel(s, "critic")!.choice).toEqual({ providerId: "p", model: "beta" });
    expect(resolveModel(base({ providers: [] }), "refine")).toBeUndefined();
  });

  it("picks the default from the provider's models and a task's model from the same list", () => {
    render(<SettingsView />);
    // The old separate model picker is gone.
    expect(screen.queryByRole("heading", { name: "Model" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Use alpha by default" })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: "Use gamma by default" }));
    expect(useAiSettings.getState().settings.defaultModel).toEqual({ providerId: "q", model: "gamma" });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "No tools" })[1]);
    expect(useAiSettings.getState().settings.noToolModels).toEqual(["p/beta"]);

    const critic = screen.getByRole("combobox", { name: "Critic model" });
    expect(within(critic).getAllByRole("option").map((o) => o.textContent)).toEqual(["Default model", "alpha", "beta", "gamma"]);
    fireEvent.change(critic, { target: { value: "p/beta" } });
    expect(useAiSettings.getState().settings.modeModels.critic).toEqual({ providerId: "p", model: "beta" });
    fireEvent.change(critic, { target: { value: "" } });
    expect(useAiSettings.getState().settings.modeModels.critic).toBeUndefined();
  });

  it("makes the first model saved on a new provider the default", () => {
    useAiSettings.setState({
      settings: base({ providers: [{ id: "n", kind: "openai", name: "New", baseUrl: "https://z/v1", apiKey: "k" }] }),
    });
    render(<SettingsView />);
    fireEvent.change(screen.getByRole("combobox", { name: "Add a model to New" }), { target: { value: "delta" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useAiSettings.getState().settings.defaultModel).toEqual({ providerId: "n", model: "delta" });
  });
});

describe("jailbreak", () => {
  it("goes after the last message of every request while it's on", async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Add jailbreak" }));
    const dialog = screen.getByRole("dialog", { name: "Jailbreak" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Jailbreak/ }), { target: { value: "Stay in role." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(useAiSettings.getState().settings.presets).toMatchObject([{ kind: "jailbreak", active: true, text: "Stay in role." }]);

    await complete("refine", { system: "s", messages: [{ role: "user", text: "Hello" }], tools: [] });
    expect((script.requests[0].messages[0] as { text: string }).text).toBe("Hello\n\n<jailbreak>\nStay in role.\n</jailbreak>");

    fireEvent.click(screen.getByRole("checkbox", { name: "Use Jailbreak" }));
    await complete("refine", { system: "s", messages: [{ role: "user", text: "Hello" }], tools: [] });
    expect((script.requests[1].messages[0] as { text: string }).text).toBe("Hello");
  });

  it("joins the last tool result when the chat ends on one, and leaves earlier messages alone", () => {
    const messages = withJailbreak(
      [
        { role: "user", text: "Hi" },
        { role: "assistant", text: "", toolCalls: [{ id: "a", name: "x", input: {} }] },
        { role: "tool", results: [{ id: "a", content: "done" }] },
      ],
      "JB",
    );
    expect(messages[0]).toEqual({ role: "user", text: "Hi" });
    expect(messages[2]).toEqual({ role: "tool", results: [{ id: "a", content: "done\n\n<jailbreak>\nJB\n</jailbreak>" }] });
  });
});
