import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import { applyEngine, hubButtons, newEngine, newVar, readEngine, settingsSource, type EngineConfig } from "../sheet";
import { cleanOverrides, PRESET_IDS, PRESETS, themeTokens, themeVars } from "../theme";
import { coreModules, effectiveVars, inlineDoc, moduleConflicts, moduleRegex, newModule } from "./compile";
import { addModules, modulePack, readPack } from "./pack";
import { timeModule } from "./time";

const engine = (fields: Partial<EngineConfig> = {}): EngineConfig => ({ ...newEngine(), ...fields });

describe("the card theme", () => {
  it("has light and dark tokens for every preset", () => {
    expect(PRESET_IDS).toEqual(["parchment", "cyberpunk", "novel", "dating", "phone", "academy", "grimdark", "system", "starship", "dread"]);
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].light.accent).toMatch(/^#/);
      expect(PRESETS[id].dark.accent).toMatch(/^#/);
    }
  });

  it("puts the author's changes on top and keeps out anything unsafe", () => {
    const t = themeTokens({ preset: "novel", overrides: { accent: "#ff0000", radius: 99 } }, "dark");
    expect(t.accent).toBe("#ff0000");
    expect(t.radius).toBe(40);
    expect(cleanOverrides({ accent: "red; background: url(x)", texture: "url(https://x)", font: "Comic" } as never)).toEqual({});
    expect(themeVars(t)).toContain("--cf-accent: #ff0000");
  });
});

describe("modules", () => {
  it("adds the core modules' values and the player edit log", () => {
    const paths = effectiveVars(engine()).map((v) => [v.group, v.name]);
    expect(paths).toContainEqual(["Time", "Clock"]);
    expect(paths.at(-1)).toEqual(["", "PlayerEdits"]);
    const off = engine({ modules: coreModules().map((m) => ({ ...m, enabled: false })) });
    expect(effectiveVars(off).map((v) => v.name)).toEqual(["PlayerEdits"]);
  });

  it("finds clashes between modules", () => {
    const shop = { ...newModule("Shop"), requires: ["bank"], button: "⚙ Settings" };
    const twin = { ...newModule("Shop"), button: "" };
    const config = engine({
      vars: [newVar({ group: "Time", name: "Clock", type: "text" })],
      modules: [...coreModules(), shop, twin, { ...newModule("Bad"), id: "Bad id" }],
    });
    const messages = moduleConflicts(config).map((c) => c.message);
    expect(messages).toContain("Both define the value Time.Clock.");
    expect(messages).toContain('Both use the hub button "⚙ Settings".');
    expect(messages).toContain('Both use the id "shop".');
    expect(messages).toContain('Needs the "bank" module, which isn\'t installed and on.');
    expect(messages).toContain("This hub screen has no button label, so players can't open it.");
    expect(messages.some((m) => m.includes("isn't a usable id"))).toBe(true);
    expect(moduleConflicts(engine())).toEqual([]);
  });

  it("brings its own regex, inline blocks and the actions", () => {
    const block = { ...newModule("Map"), slot: "message" as const, regex: [{ name: "x", find: "/x/g", replace: "y", ai: true, user: false, only: "both" as const }] };
    const ids = moduleRegex(engine({ modules: [...coreModules(), block] })).map((r) => r.id);
    expect(ids).toEqual(["cf-map-0", "cf-map-show", "cf-map-out", "cf-action-show", "cf-action-old"]);
    // It goes into a regex replacement.
    expect(inlineDoc("map")).not.toMatch(/\$\d|\$<|\{\{|&[a-z]+;/i);
  });

  it("puts hub buttons and screens in the card's script", () => {
    const data = applyEngine(newCard().data, engine({ modules: [...coreModules(), newModule("Phone")] }));
    const script = (data.extensions.tavern_helper as { scripts: { button: { buttons: { name: string }[] }; content: string }[] }).scripts[0];
    expect(script.button.buttons.map((b) => b.name)).toEqual(["📊 Status", "⚙ Settings", "✦ Phone"]);
    expect(hubButtons(readEngine(data)!)).toHaveLength(3);
    expect(script.content).not.toContain("</script");
    expect(settingsSource(readEngine(data)!)).toContain('"id":"phone"');
  });
});

describe("module packs", () => {
  it("round-trips, and core modules keep this app's code", () => {
    const time = timeModule({ startClock: "21:00" });
    const custom = newModule("Phone");
    const text = JSON.stringify(modulePack([{ ...time, script: "evil()" }, custom]));
    const [t, c] = readPack(text);
    expect(t.script).toBe(time.script);
    expect(t.settings.startClock).toBe("21:00");
    expect(c).toEqual(custom);
  });

  it("refuses what isn't a pack and cleans odd fields", () => {
    expect(() => readPack("nope")).toThrow("isn't JSON");
    expect(() => readPack("{}")).toThrow("isn't a CardForge module pack");
    const [m] = readPack(JSON.stringify({ name: "Odd", slot: "everywhere", vars: [{ name: "X", type: "weird", start: 5 }], regex: [{ find: "" }] }));
    expect(m.slot).toBe("overlay");
    expect(m.vars[0]).toMatchObject({ name: "X", type: "text", start: "" });
    expect(m.regex).toEqual([]);
  });

  it("gives an added module a free id and replaces a core one", () => {
    const current = [...coreModules(), newModule("Phone")];
    const next = addModules(current, [newModule("Phone"), timeModule({ startDay: 5 })]);
    expect(next.map((m) => m.id)).toEqual(["time", "settings", "phone", "phone-2"]);
    expect(next[0].settings.startDay).toBe(5);
  });
});
