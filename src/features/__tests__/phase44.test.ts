import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_STYLES, jailbreakFor, resolveModel, type AiSettings } from "../../ai/settings";
import { newCard } from "../../card";
import { BUILT_IN_SKILLS } from "../../engine/engineer/knowledge";
import { contextBreakdown } from "../../engine/engineer/usage";
import { briefText, LEAD_TOOLS, outsideBrief, readBrief, WORKER_TOOLS } from "../../engine/engineer/worker";
import { newEngine } from "../../engine/sheet";

const settings = (patch: Partial<AiSettings> = {}): AiSettings => ({
  providers: [{ id: "p", kind: "anthropic", name: "Claude", apiKey: "k", models: ["base", "strong", "cheap"] }],
  defaultModel: { providerId: "p", model: "base" },
  modeModels: {},
  noToolModels: [],
  imageStyles: DEFAULT_IMAGE_STYLES,
  presets: [{ id: "j", name: "JB", text: "Go.", kind: "jailbreak", active: true }],
  ...patch,
});

describe("the engineer's worker", () => {
  it("runs on the engineer's model unless it has its own, and gets no jailbreak", () => {
    expect(resolveModel(settings(), "worker")!.choice.model).toBe("base");
    const withEngineer = settings({ modeModels: { engineer: { providerId: "p", model: "strong" } } });
    expect(resolveModel(withEngineer, "worker")!.choice.model).toBe("strong");
    const own = settings({ modeModels: { engineer: { providerId: "p", model: "strong" }, worker: { providerId: "p", model: "cheap" } } });
    expect(resolveModel(own, "worker")!.choice.model).toBe("cheap");
    expect(jailbreakFor(settings(), "worker")).toBe("");
    expect(jailbreakFor(settings({ engineerJailbreak: true }), "worker")).toBe("Go.");
  });

  it("splits the tools: the lead plans and checks, the worker builds", () => {
    const lead = LEAD_TOOLS.map((t) => t.name);
    expect(lead).toEqual(expect.arrayContaining(["run_worker", "read_values", "list_lore", "read_lore", "search_docs", "lint", "convert_light_card"]));
    expect(lead).not.toEqual(expect.arrayContaining(["write_file"]));
    expect(lead.some((n) => ["create_module", "render_preview", "read_doc", "load_skill"].includes(n))).toBe(false);
    const worker = WORKER_TOOLS.map((t) => t.name);
    expect(worker).toEqual(expect.arrayContaining(["create_module", "render_preview", "read_doc", "read_lore"]));
    expect(worker).not.toContain("convert_light_card");
    expect(worker).not.toContain("run_worker");
  });

  it("writes a brief with everything attached, says what's missing, and keeps writes inside it", () => {
    const brief = readBrief({ task: "Build a shop", modules: ["shop", "sheet"], skills: ["hub-app", "nope"], docs: ["core-api"], lore: ["c9"] });
    const ctx = { data: newCard("Mina").data, draft: newEngine(), ops: [], skills: BUILT_IN_SKILLS };
    const text = briefText(ctx, brief, BUILT_IN_SKILLS, ["No screenshots this turn."]);
    expect(text).toContain("<task>\nBuild a shop\n</task>");
    expect(text).toContain('<skill id="hub-app">');
    expect(text).toContain('<doc id="core-api">');
    expect(text).toContain("- No screenshots this turn.");
    expect(text).toMatch(/Not found, so not attached: skill "nope", lore c9/);
    const call = (name: string, input: Record<string, unknown>) => ({ id: "x", name, input });
    expect(outsideBrief(brief, call("write_file", { module: "shop", file: "js", content: "" }))).toBeUndefined();
    expect(outsideBrief(brief, call("set_value", { group: "Player", name: "Gold" }))).toBeUndefined();
    expect(outsideBrief(brief, call("write_file", { module: "phone", file: "js", content: "" }))).toMatch(/isn't in your brief/);
    expect(outsideBrief(brief, call("create_module", { id: "bank", name: "Bank", slot: "panel" }))).toMatch(/isn't in your brief/);
    expect(outsideBrief(brief, call("read_module", { module: "phone" }))).toBeUndefined();
    expect(outsideBrief(readBrief({ task: "Anything" }), call("write_file", { module: "phone" }))).toBeUndefined();
    expect(() => readBrief({ task: " " })).toThrow(/Say what the worker should build/);
  });

  it("counts worker reports on their own in the token breakdown", () => {
    const rows = contextBreakdown("s", [
      { role: "assistant", text: "", toolCalls: [{ id: "a", name: "run_worker", input: { task: "t" } }] },
      { role: "tool", results: [{ id: "a", content: "x".repeat(400) }] },
    ]);
    expect(rows.find((r) => r.label === "Worker reports")!.tokens).toBe(100);
  });
});
