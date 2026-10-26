import { describe, expect, it } from "vitest";
import type { ToolCall } from "../../ai/types";
import { diffLines } from "../../lib/diff";
import { newEngine, newVar, type EngineConfig } from "../sheet";
import { BUILT_IN_SKILLS, readDoc, readExample, searchDocs, skillsWith, DOCS } from "./knowledge";
import { actionNames, lintConfig, screenFindings, statePaths } from "./lint";
import { engineerSystemPrompt } from "./prompt";
import { ENGINEER_TOOLS, runEngineerTool, type EngineerContext } from "./tools";
import { applyOp, configFiles, diffConfigs, replay } from "./workspace";

let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `c${++n}`, name, input });
const engine = (): EngineConfig => ({ ...newEngine(), vars: [newVar({ group: "Player", name: "Gold", start: "10", min: 0 })] });

describe("workspace", () => {
  it("creates a module, writes and patches its files, and diffs it as files", () => {
    const before = engine();
    const { config } = replay(before, [
      call("create_module", { id: "shop", name: "Shop", slot: "overlay", button: "🛒 Shop", js: "root.textContent = 'hi';" }),
      call("write_file", { module: "shop", file: "css", content: ".shop { color: var(--cf-text); }" }),
      call("patch_file", { module: "shop", file: "js", find: "'hi'", replace: "'Welcome'" }),
      call("set_value", { module: "shop", group: "Shop", name: "Stock", type: "counts", start: "rope: 2", rule: "Restock weekly." }),
    ]);
    const shop = config.modules!.find((m) => m.id === "shop")!;
    expect(shop.js).toBe("root.textContent = 'Welcome';");
    expect(shop.vars[0]).toMatchObject({ group: "Shop", name: "Stock", type: "counts", start: "rope: 2" });
    const changes = diffConfigs(before, config);
    expect(changes.map((c) => c.path)).toEqual([
      "modules/shop/css",
      "modules/shop/js",
      "modules/shop/manifest.json",
      "modules/shop/values.json",
    ]);
    expect(configFiles(config)["modules/shop/manifest.json"]).toContain('"button": "🛒 Shop"');
  });

  it("refuses unclear patches, code edits to core modules and depth 0 rules", () => {
    const { config } = replay(engine(), [call("create_module", { id: "a", name: "A", slot: "panel", js: "x(); x();" })]);
    expect(() => applyOp(config, call("patch_file", { module: "a", file: "js", find: "x();", replace: "y();" }))).toThrow(/more than once/);
    expect(() => applyOp(config, call("write_file", { module: "time", file: "js", content: "" }))).toThrow(/core module/);
    expect(() => applyOp(config, call("add_rule", { module: "a", name: "r", content: "c", depth: 0 }))).toThrow(/Depth 0/);
    expect(() => applyOp(config, call("set_theme", { tokens: { accent: "url(http://x)" } }))).toThrow(/aren't usable/);
  });

  it("changes a value in place by group and name", () => {
    const { config } = replay(engine(), [call("set_value", { group: "player", name: "gold", max: 999, readOnly: true })]);
    expect(config.vars).toHaveLength(1);
    expect(config.vars[0]).toMatchObject({ name: "Gold", max: 999, readOnly: true, start: "10" });
  });
});

describe("knowledge", () => {
  it("finds doc sections and reads one", () => {
    const found = searchDocs("app.send action");
    expect(found[0].doc).toBe("core-api");
    expect(readDoc(found[0].id)).toBeTruthy();
    expect(Object.keys(DOCS)).toEqual(
      expect.arrayContaining(["core-api", "design", "modules", "rp-guide", "st-rendering", "tavern-helper"]),
    );
  });

  it("applies the user's skill edits, removals and own skills", () => {
    const first = BUILT_IN_SKILLS[0];
    const skills = skillsWith({
      edited: { [first.id]: "# Mine\n\nWhen: always.", "my-skill": "# My skill\n\nWhen: gacha." },
      removed: [BUILT_IN_SKILLS[1].id],
    });
    expect(skills.find((s) => s.id === first.id)!.title).toBe("Mine");
    expect(skills.find((s) => s.id === "my-skill")).toMatchObject({ builtIn: false, when: "gacha." });
    expect(skills.some((s) => s.id === BUILT_IN_SKILLS[1].id)).toBe(false);
    expect(engineerSystemPrompt(skills)).toContain("my-skill: My skill. gacha.");
  });

  it("reads examples, the core modules among them", () => {
    expect(readExample("inventory-app")).toContain('<file name="js">');
    expect(readExample("time")).toBeTruthy();
    const phone = readExample("phone")!;
    expect(phone).toContain('<file name="settings.json">');
    expect(phone).not.toContain('"catalog"');
    expect(readExample("creator")).toContain('"points"');
  });

  it("adds a built-in screen with starting settings, once", () => {
    const { config } = replay(engine(), [call("add_built_in", { screen: "phone", settings: { apps: ["messages", "map"], button: "☎ Phone" } })]);
    const phone = config.modules!.find((m) => m.id === "phone")!;
    expect(phone.core).toBe("phone");
    expect(phone.button).toBe("☎ Phone");
    expect(phone.vars.map((v) => v.name)).toEqual(["Texts", "Read", "Location"]);
    expect(() => applyOp(config, call("add_built_in", { screen: "phone" }))).toThrow(/already has/);
    expect(() => applyOp(config, call("add_built_in", { screen: "radio" }))).toThrow(/must be/);
  });
});

describe("lint", () => {
  it("flags network use, broken code, unknown values and actions without rules", () => {
    const { config } = replay(engine(), [
      call("create_module", {
        id: "bad",
        name: "Bad",
        slot: "overlay",
        button: "Bad",
        css: ".x { color: #ff0000; }",
        js: "fetch('https://x.test/a'); app.state('Player.Gold'); app.state('Player.Mana'); app.send('bank', {}); if (",
      }),
    ]);
    const findings = lintConfig(config);
    const checks = findings.filter((f) => f.level !== "info").map((f) => f.check);
    expect(checks).toEqual(expect.arrayContaining(["network", "syntax", "values", "actions", "theme"]));
    expect(findings.find((f) => f.check === "values")!.message).toContain("Player.Mana");
    expect(findings.some((f) => f.message.includes("Player.Gold"))).toBe(false);
    expect(findings.find((f) => f.check === "tokens")!.message).toMatch(/about \d+ tokens/);
  });

  it("reads paths and action names from code", () => {
    expect(statePaths(`app.state("A.B"); CF.state.get('C'); app.set("D.E", 1)`)).toEqual(["A.B", "C", "D.E"]);
    expect(actionNames(`app.send("shop", x); CF.ui.button("Buy", { send: "bank" })`)).toEqual(["shop", "bank"]);
  });

  it("turns screen reports into findings", () => {
    const f = screenFindings(
      [
        {
          screen: "hub screen: Shop",
          width: 390,
          height: 700,
          overflow: ["div.row reaches 420px of 390px"],
          contrast: ['span "x" 2.1:1'],
          smallTargets: [],
          outline: [],
        },
      ],
      "phone",
    );
    expect(f.map((x) => x.check)).toEqual(["overflow", "contrast"]);
  });
});

describe("engineer tools", () => {
  const ctx = (): EngineerContext => ({
    data: { name: "Mina" } as EngineerContext["data"],
    draft: engine(),
    ops: [],
    skills: BUILT_IN_SKILLS,
  });

  it("defines every tool once, with valid schemas", () => {
    const names = ENGINEER_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ENGINEER_TOOLS) expect(t.parameters.required.every((r) => r in t.parameters.properties)).toBe(true);
  });

  it("writes go to the draft and the ops; mistakes come back as errors", async () => {
    const c = ctx();
    const ok = await runEngineerTool(c, call("create_module", { id: "p", name: "P", slot: "panel", js: "if (" }));
    expect(ok.isError).toBeUndefined();
    expect(ok.content).toContain("doesn't parse");
    expect(c.ops).toHaveLength(1);
    const bad = await runEngineerTool(c, call("write_file", { module: "nope", file: "js", content: "" }));
    expect(bad).toMatchObject({ isError: true });
    expect(c.ops).toHaveLength(1);
    const values = await runEngineerTool(c, call("read_values", {}));
    expect(values.content).toContain("Player.Gold (number");
  });

  it("says so when there's no preview to render", async () => {
    const result = await runEngineerTool(ctx(), call("render_preview", {}));
    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("can't run here");
  });

  it("keeps sample state for the next render", async () => {
    const c = ctx();
    const result = await runEngineerTool(c, call("set_sample_state", { state: { Player: { Gold: 0 } } }));
    expect(result.isError).toBeUndefined();
    expect(c.sample).toEqual({ state: { Player: { Gold: 0 } } });
    expect(c.sampleDirty).toBe(true);
  });
});

describe("diffLines", () => {
  it("keeps context around changes and folds the rest", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const lines = diffLines(before, after, 2);
    expect(lines.filter((l) => l.type === "del").map((l) => l.text)).toEqual(["line 10"]);
    expect(lines.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["line ten"]);
    expect(lines[0]).toEqual({ type: "gap", text: "8 unchanged lines" });
    expect(lines.at(-1)).toEqual({ type: "gap", text: "7 unchanged lines" });
  });
});
