import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainFailure, testImageProvider, testTextProvider } from "../../ai/connection";
import { HttpError } from "../../ai/openai";
import { DEFAULT_IMAGE_STYLES, useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult, Provider, ProviderConfig, ToolCall } from "../../ai/types";
import { newCard, type CardDataV3 } from "../../card";
import { complete } from "../../cowriter/engine";
import { resetDbForTests } from "../../db/db";
import { applyArc, DEFAULT_ARC_SETTINGS, newArc } from "../../editor/arc";
import { emptyBook, newEntry } from "../../editor/lorebook";
import { worldEntry } from "../../editor/world";
import { newSheet, writeSheet } from "../../images/visual";
import { BUILT_IN_SKILLS } from "../../engine/engineer/knowledge";
import { ENGINEER_TOOLS, runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { newEngine } from "../../engine/sheet";
import { SettingsView } from "../settings/SettingsView";

const script = vi.hoisted(() => ({ requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest): Promise<CompletionResult> => {
      script.requests.push({ ...req, signal: undefined });
      return { text: "OK", toolCalls: [], stop: "end" };
    },
  }),
}));

const JB = "<jailbreak>\nStay in role.\n</jailbreak>";
const ask = (mode: Parameters<typeof complete>[0]) => complete(mode, { system: "s", messages: [{ role: "user", text: "hi" }], tools: [] });
const lastText = () => (script.requests.at(-1)!.messages[0] as { text: string }).text;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.requests = [];
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://nano-gpt.com/api/v1", apiKey: "k", models: ["alpha"] }],
      modeModels: {},
      noToolModels: [],
      imageStyles: DEFAULT_IMAGE_STYLES,
      presets: [{ id: "j", name: "Jailbreak", text: "Stay in role.", kind: "jailbreak", active: true }],
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("no jailbreak for the engineer", () => {
  it("keeps it for the co-writer, leaves it off the engineer, and sends it there only when turned on", async () => {
    await ask("refine");
    expect(lastText()).toBe(`hi\n\n${JB}`);
    await ask("engineer");
    expect(lastText()).toBe("hi");

    render(<SettingsView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Send the jailbreak to the UI engineer too/ }));
    expect(useAiSettings.getState().settings.engineerJailbreak).toBe(true);
    await ask("engineer");
    expect(lastText()).toBe(`hi\n\n${JB}`);
    await settle();
  });
});

/** Lets the settings page's own loads (balances, model lists) finish before the page goes away. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));

let n = 0;
const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ id: `c${++n}`, name, input });

function card(): CardDataV3 {
  let book = emptyBook();
  const add = (e: ReturnType<typeof newEntry>) => (book = { ...book, entries: [...book.entries, e] });
  add(worldEntry(book, "npc", { name: "Mira", role: "smith", voice: "Short, dry sentences.", aliases: "the smith" }));
  add(newEntry(book, { comment: "The Tide Guild", keys: ["guild", "tide"], content: "A guild of harbor smugglers who own the docks.", constant: true }));
  add(worldEntry(book, "shop", { name: "Salt & Steel", owner: "Mira", sells: "rope, hooks, a harpoon" }));
  let data: CardDataV3 = { ...newCard("Captain").data, character_book: book };
  const arc = { ...newArc(), title: "The Drowned Crown", settings: { ...DEFAULT_ARC_SETTINGS, difficulty: "hard" as const }, beats: [{ title: "The heist", summary: "The guild steals the crown.", direction: "", antagonist: "" }] };
  data = applyArc(data, arc);
  const mira = data.character_book!.entries[0];
  data = writeSheet(data, `entry:${String(mira.id)}`, { ...newSheet("character"), fields: { hair: "copper braid" }, signature: ["burn scar on the left hand"] });
  return data;
}

const world = (): CardDataV3 => {
  const book = emptyBook();
  return { ...newCard("Saltreach").data, character_book: { ...book, entries: [worldEntry(book, "location", { name: "The Old Harbor", details: "Fog, gulls, rotten piers." })] } };
};

const ctx = (data = card()): EngineerContext => ({ data, world: world(), draft: newEngine(), ops: [], skills: BUILT_IN_SKILLS });

describe("lorebook and world read tools", () => {
  it("lists every entry with kind, size and keys, and reads them by id or by search", async () => {
    expect(ENGINEER_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["list_lore", "read_lore", "read_arc", "read_visual"]));
    const c = ctx();
    const list = (await runEngineerTool(c, call("list_lore"))).content;
    expect(list).toMatch(/- c0 Mira \(NPC, \d+ tokens\) keys: Mira, the smith/);
    expect(list).toMatch(/- c1 The Tide Guild \(other, \d+ tokens, constant\) keys: guild, tide/);
    expect(list).toMatch(/- c2 Salt & Steel \(shop/);
    expect(list).toMatch(/The project world's lorebook:\n- w0 The Old Harbor \(place/);
    // The arc is secret by default: its entries stay out.
    expect(list).not.toMatch(/Story arc/);

    const read = (await runEngineerTool(c, call("read_lore", { ids: ["c0", "w0"] }))).content;
    expect(read).toContain('<entry id="c0" title="Mira" kind="NPC">');
    expect(read).toContain("voice: Short, dry sentences.");
    expect(read).toContain("details: Fog, gulls, rotten piers.");

    const found = (await runEngineerTool(c, call("read_lore", { query: "smugglers docks" }))).content;
    expect(found).toContain("A guild of harbor smugglers");
    expect(found).not.toContain("Mira");
    expect((await runEngineerTool(c, call("read_lore", { query: "crown" }))).content).toMatch(/No entry mentions/);
    expect((await runEngineerTool(c, call("read_lore", {}))).isError).toBe(true);
  });

  it("reads the arc's settings only while it's secret, the whole arc once revealed, and the visual bible", async () => {
    const secret = (await runEngineerTool(ctx(), call("read_arc"))).content;
    expect(secret).toMatch(/secret story arc of 1 beat\./);
    expect(secret).toContain("Difficulty: Hard");
    expect(secret).not.toContain("The guild steals the crown");

    const data = card();
    const shown = applyArc(data, { ...(data.extensions.cardforge as { arc: ReturnType<typeof newArc> }).arc, hidden: false });
    const open = ctx(shown);
    expect((await runEngineerTool(open, call("read_arc"))).content).toContain("The guild steals the crown");
    expect((await runEngineerTool(open, call("list_lore"))).content).toMatch(/Story arc: beat 1 \(story arc/);

    const visual = (await runEngineerTool(ctx(), call("read_visual", { subject: "mira" }))).content;
    expect(visual).toContain("name: Mira");
    expect(visual).toContain("burn scar on the left hand");
    expect(visual).toContain("hair: copper braid");
  });

  it("no longer squeezes entry titles into read_card", async () => {
    const out = (await runEngineerTool(ctx(), call("read_card"))).content;
    expect(out).toContain("Lorebook: 5 entries. list_lore lists them");
    expect(out).not.toContain("Mira");
  });
});

describe("connection test", () => {
  const config: ProviderConfig = { id: "p", kind: "openai", name: "Nano", baseUrl: "https://nano-gpt.com/api/v1", apiKey: "k" };
  const provider = (complete: Provider["complete"]): Provider => ({ listModels: async () => ["a", "b"], complete });

  it("explains failures in plain words", () => {
    const o = { name: "Nano", baseUrl: "https://x.test/v1", model: "m1" };
    expect(explainFailure(new TypeError("Failed to fetch"), o)).toMatch(/^Couldn't reach https:\/\/x\.test\/v1\. Check the address and your internet/);
    expect(explainFailure(new TypeError("Failed to fetch"), { ...o, baseUrl: "http://127.0.0.1:5001/v1" })).toMatch(/server is running/);
    expect(explainFailure(new HttpError(401, "Invalid API key"), o)).toMatch(/^Nano refused the API key/);
    expect(explainFailure(new HttpError(402, "Payment required"), o)).toMatch(/no balance left/);
    expect(explainFailure(new HttpError(400, '{"error":"Insufficient balance"}'), o)).toMatch(/no balance left/);
    expect(explainFailure(new HttpError(404, "The model m1 does not exist"), o)).toMatch(/doesn't offer the model "m1"/);
    expect(explainFailure(new HttpError(404, "Not Found"), o)).toMatch(/^Wrong address/);
    expect(explainFailure(new HttpError(503, "upstream"), o)).toMatch(/problem on its side/);
    expect(explainFailure(Object.assign(new Error("401 invalid x-api-key"), { status: 401 }), o)).toMatch(/refused the API key/);
  });

  it("sends a tiny request to the chosen model, or lists models when none is saved", async () => {
    const sent: CompletionRequest[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ usd_balance: "0", nano_balance: "0" }))));
    const ok = await testTextProvider(config, "alpha", provider(async (r) => (sent.push(r), { text: "OK", toolCalls: [], stop: "end" })));
    expect(ok).toMatchObject({ ok: true, message: "alpha answered. The address, key and model work." });
    expect(ok.warning).toMatch(/balance is empty/);
    expect(sent[0]).toMatchObject({ model: "alpha", tools: [], useTools: false, maxTokens: 16 });

    const listed = await testTextProvider(config, undefined, provider(async () => ({ text: "", toolCalls: [], stop: "end" })));
    expect(listed.message).toMatch(/2 models listed/);

    const bad = await testTextProvider(config, "alpha", provider(async () => Promise.reject(new HttpError(401, "bad key"))));
    expect(bad).toMatchObject({ ok: false });
    expect(bad.message).toMatch(/refused the API key/);
    expect((await testTextProvider({ ...config, baseUrl: "" }, "alpha", provider(async () => ({ text: "", toolCalls: [], stop: "end" })))).message).toMatch(/base URL/);
  });

  it("tests an image provider without making a picture", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.endsWith("/models") ? new Response(JSON.stringify({ data: [] })) : new Response("nope", { status: 401 });
      }),
    );
    const img = { id: "i", kind: "nanogpt" as const, name: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", apiKey: "k" };
    const result = await testImageProvider(img);
    expect(urls).toEqual(["https://nano-gpt.com/api/v1/models", "https://nano-gpt.com/api/check-balance"]);
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/refused the API key/);
    expect(urls.some((u) => u.includes("generations"))).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    expect((await testImageProvider({ ...img, kind: "openai", baseUrl: "https://x.test" })).message).toMatch(/^Wrong address/);
  });

  it("puts a Test button on every text provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ usd_balance: "5" }))));
    render(<SettingsView />);
    fireEvent.click(screen.getByRole("button", { name: "Test Nano" }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Test result for Nano" }).textContent).toMatch(/Works\. alpha answered/));
    expect(script.requests.at(-1)).toMatchObject({ model: "alpha", maxTokens: 16 });
    await settle();
  });
});
