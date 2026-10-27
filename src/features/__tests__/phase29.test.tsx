import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readModelInfo } from "../../ai/openai";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { callCost, EMPTY_USAGE, meterOf, useUsage } from "../../ai/usage";
import { createCard, createProject, getSetting, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { engineerHooks, useEngineer } from "../../engine/engineer/session";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { contextBreakdown } from "../../engine/engineer/usage";
import { screenFindings } from "../../engine/engineer/lint";
import { complete } from "../../cowriter/engine";
import { pngSize } from "../../lib/tokens";
import { newCard } from "../../card";
import { newEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";
import { SettingsView } from "../settings/SettingsView";

const script = vi.hoisted(() => ({
  replies: [] as CompletionResult[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => ["vis", "blind"],
    modelDetails: async () => ({ vis: { vision: true, context: 64000, inPrice: 1, outPrice: 4 }, blind: { vision: false } }),
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      return next;
    },
  }),
}));

const used = (input: number, output: number, extra: Partial<CompletionResult["usage"]> = {}) => ({
  usage: { input, output, cacheRead: 0, cacheWrite: 0, ...extra },
});
const reply = (text: string, calls: [string, Record<string, unknown>][] = [], usage = used(1000, 100)): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.replies.length}-${i}-${name}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
  ...usage,
});

let projectId = "";
beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  engineerHooks.preview = () => undefined;
  useUsage.setState({ meters: {}, totals: {}, totalsLoaded: false });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useEngineer.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "", skipShots: false });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k", models: ["vis"] }],
      defaultModel: { providerId: "p", model: "vis" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
      modelInfo: { "p/vis": { context: 10000, inPrice: 2, outPrice: 10 } },
    },
  });
  const project = await createProject("Port Noir");
  projectId = project.id;
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mina");
});

describe("usage from providers", () => {
  it("reads model details in OpenRouter's and NanoGPT's shapes", () => {
    expect(
      readModelInfo({
        id: "a",
        context_length: 200000,
        architecture: { input_modalities: ["text", "image"] },
        pricing: { prompt: "0.000003", completion: "0.000015" },
      }),
    ).toEqual({ vision: true, context: 200000, inPrice: 3, outPrice: 15 });
    expect(readModelInfo({ id: "b", capabilities: { vision: false }, context_length: 32768, pricing: { prompt: 0.15, completion: 0.6, unit: "per_million_tokens" } })).toEqual({
      vision: false,
      context: 32768,
      inPrice: 0.15,
      outPrice: 0.6,
    });
    expect(readModelInfo({ id: "c" })).toEqual({});
  });

  it("works out a call's cost from reported cost or prices", () => {
    expect(callCost({ input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.5 }, {})).toBe(0.5);
    expect(callCost({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, { inPrice: 2, outPrice: 10 })).toBeCloseTo(12.2);
    expect(callCost({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, { inPrice: 2 })).toBeUndefined();
  });

  it("records every call: per part of the app, per message, and per project on the device", async () => {
    script.replies.push(reply("a", [], used(800, 200, { cacheRead: 7000 })), reply("b", [], used(100, 50)));
    await complete("refine", { system: "s", messages: [{ role: "user", text: "hi" }], tools: [] });
    useUsage.getState().startTurn("cowriter");
    await complete("lore", { system: "s", messages: [{ role: "user", text: "hi" }], tools: [] });
    const meter = meterOf(useUsage.getState(), "cowriter");
    expect(meter.turn).toMatchObject({ input: 100, output: 50, calls: 1 });
    expect(meter.session).toMatchObject({ input: 900, output: 250, cacheRead: 7000, calls: 2 });
    expect(meter.last).toMatchObject({ prompt: 100, contextMax: 10000, guessed: false });
    expect(meterOf(useUsage.getState(), "engineer").session).toEqual(EMPTY_USAGE);
    await waitFor(async () => expect((await getSetting<Record<string, { calls: number }>>("usage"))?.[projectId]?.calls).toBe(2));

    render(<SettingsView />);
    const totals = await screen.findByRole("list", { name: "Token use by project" });
    expect(await within(totals).findByText("Port Noir")).toBeInTheDocument();
    expect(within(totals).getByText(/8.2k tokens .*2 calls · \$0\.00/)).toBeInTheDocument();
  });
});

describe("model details in Settings", () => {
  it("are filled from the provider and editable, including whether a model sees images", async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Test and load models" }));
    await waitFor(() => expect(useAiSettings.getState().settings.modelInfo?.["p/vis"]).toMatchObject({ vision: true, context: 10000, inPrice: 2 }));
    // Adding a model the provider described takes its details.
    fireEvent.change(screen.getByRole("combobox", { name: "Add a model to Nano" }), { target: { value: "blind" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useAiSettings.getState().settings.modelInfo?.["p/blind"]).toEqual({ vision: false });
    fireEvent.click(screen.getByRole("button", { name: "Details of vis" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Can see images/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Context window of vis" }), { target: { value: "" } });
    expect(useAiSettings.getState().settings.modelInfo?.["p/vis"]).toEqual({ vision: false, inPrice: 2, outPrice: 10 });
  });
});

describe("the engineer without screenshots", () => {
  const report = {
    screen: "chat",
    width: 390,
    height: 900,
    overflow: [],
    contrast: [],
    smallTargets: [],
    outline: ['button.buy "Buy" 120×40 at 10,20'],
    smallText: ['span.fine "small print" 9.0px'],
    overlaps: ["span.a and button.buy overlap by 40×20px"],
    emptyImages: ["img.avatar has no src"],
    hiddenButtons: ['button.go "Go" is covered by div.veil'],
  };
  const fakePreview = () => {
    const capture = vi.fn(async () => ({ image: "iVBORw0KGgoAAAANSUhEUgAAAYYAAAL4", width: 390, height: 760 }));
    return {
      capture,
      preview: {
        loaded: true,
        size: { width: 390, height: 760 },
        load: async () => true,
        close: async () => undefined,
        capture,
        inspect: async () => [report],
        take: () => ({ problems: [], logs: [] }),
      },
    };
  };
  const ctx = (shots: boolean, preview: unknown): EngineerContext =>
    ({ data: newCard("Mina").data, draft: newEngine(), ops: [], skills: [], shots, preview, libs: async () => ({}) }) as unknown as EngineerContext;

  it("sends a text layout report instead of a picture", async () => {
    const { preview, capture } = fakePreview();
    const result = await runEngineerTool(ctx(false, preview), { id: "r", name: "render_preview", input: {} });
    expect(capture).not.toHaveBeenCalled();
    expect(result.images).toBeUndefined();
    expect(result.content).toContain("No screenshot: a layout report of the phone (390×760)");
    expect(result.content).toContain('button.buy "Buy" 120×40 at 10,20');
    expect(result.content).toContain("too small to read");
    expect(result.content).toContain("overlap by 40×20px");
    expect(result.content).toContain("img.avatar has no src");
    expect(result.content).toContain("is covered by div.veil");

    const seen = await runEngineerTool(ctx(true, fakePreview().preview), { id: "s", name: "render_preview", input: {} });
    expect(seen.images).toHaveLength(1);
    expect(screenFindings([report], "phone").map((f) => f.check)).toEqual(["text size", "overlap", "images", "hidden"]);
  });

  it("is chosen per model or per run, and the engineer is told", async () => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engineer" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Skip screenshots this run/ }));
    script.replies.push(reply("Hello."));
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Look" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Hello.");
    const sent = script.requests[0].messages.at(-1)!;
    expect(sent.role === "user" && sent.text).toContain("No screenshots this turn (the user turned them off)");
  });
});

describe("the engineer's token meter", () => {
  beforeEach(() => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engineer" }));
  });

  it("shows the message, the session, the context fill and a breakdown", async () => {
    script.replies.push(reply("Reading.", [["read_doc", { id: "core-api" }]], used(5000, 300)), reply("Done.", [], used(8500, 100)));
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Look" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Done.");
    const meter = screen.getByRole("button", { name: "Token use" });
    expect(meter.textContent).toContain("This message: 14k in · 400 out · $0.03");
    expect(screen.getByText(/8\.5k \/ 10k context: nearly full/)).toBeInTheDocument();
    fireEvent.click(meter);
    const rows = within(screen.getByRole("list", { name: "Context breakdown" }));
    expect(rows.getByText("Docs")).toBeInTheDocument();
    expect(rows.getByText("System prompt")).toBeInTheDocument();
  });

  it("stops and asks before going over the limit", async () => {
    fireEvent.change(screen.getByRole("spinbutton", { name: "Stop and ask after this many tokens" }), { target: { value: "3000" } });
    script.replies.push(reply("Reading.", [["list_modules", {}]], used(5000, 300)), reply("never sent"));
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Look" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain("paused at 5.3k tokens, your limit for one message");
    expect(script.requests).toHaveLength(1);
  });
});

describe("token helpers", () => {
  it("reads a PNG's size and estimates the context by source", () => {
    expect(pngSize("iVBORw0KGgoAAAANSUhEUgAAAYYAAAL4")).toEqual({ width: 390, height: 760 });
    const rows = contextBreakdown("system prompt text", [
      { role: "user", text: "hello there" },
      { role: "assistant", text: "", toolCalls: [{ id: "a", name: "read_module", input: { module: "x" } }] },
      { role: "tool", results: [{ id: "a", content: "x".repeat(400) }] },
    ]);
    expect(rows.find((r) => r.label === "Module files")!.tokens).toBe(100);
  });
});
