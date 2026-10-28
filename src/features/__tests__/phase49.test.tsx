import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../ai/types";
import { newCard } from "../../card";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc, searchDocs } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { changedScreens, selfReviewText } from "../../engine/engineer/worker";
import { coreModules } from "../../engine/modules/compile";
import { timeModule } from "../../engine/modules/time";
import type { EngineModule } from "../../engine/modules/types";
import coreSource from "../../engine/runtime/core.js?raw";
import artSource from "../../engine/runtime/art.js?raw";
import moodSource from "../../engine/runtime/mood.js?raw";
import sceneSource from "../../engine/runtime/scene.js?raw";
import fxSource from "../../engine/runtime/fx.js?raw";
import hostSource from "../../engine/sandbox/host.js?raw";
import { sampleStates } from "../../engine/scrubber";
import { cardFonts, newEngine, newVar, settingsSource, type EngineConfig } from "../../engine/sheet";
import { cleanOverrides, FONTS, fontFaces, TEXTURES, themeBundle, usedFonts } from "../../engine/theme";
import { LookPage } from "../engine/LookPage";

let n = 0;
const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ id: `p${++n}`, name, input });

const withVars = (more: Partial<EngineConfig> = {}): EngineConfig => ({
  ...newEngine(),
  vars: [
    newVar({ group: "Player", name: "Health", type: "number", start: "80", min: 0, max: 100 }),
    newVar({ group: "Player", name: "Gold", type: "number", start: "25", min: 0 }),
    newVar({ group: "Player", name: "Items", type: "list", start: "rope" }),
    newVar({ group: "Player", name: "Mood", type: "choice", options: ["calm", "tense", "furious"], start: "tense" }),
  ],
  modules: [],
  ...more,
});

describe("bundled fonts and textures", () => {
  it("offers the bundled fonts as theme fonts, and embeds only the ones a card uses", () => {
    for (const name of ["Cinzel", "Pirata One", "Orbitron", "Share Tech Mono", "Playfair Display", "Patrick Hand"]) expect(FONTS[name]).toContain(`"${name}"`);
    expect(cleanOverrides({ heading: FONTS.Cinzel }).heading).toBe(FONTS.Cinzel);
    expect(usedFonts([FONTS.Serif, FONTS.Orbitron])).toEqual(["Orbitron"]);
    expect(fontFaces(["Orbitron"])).toMatch(/^@font-face \{ font-family: "Orbitron"; src: url\(data:font\/woff2;base64,d09GMg/);

    const plain = settingsSource(newEngine());
    expect(plain).not.toContain("@font-face");
    const themed = { ...newEngine(), theme: { preset: "grimdark" as const, overrides: { heading: FONTS.Cinzel } } };
    expect(themeBundle(themed.theme).fonts).toEqual(["Cinzel"]);
    // A screen that names a bundled font in its CSS gets it too.
    const screenFont = { ...coreModules()[0], id: "hud", core: undefined, name: "HUD", tags: [], css: '.t { font-family: "Orbitron", sans-serif; }', js: "", html: "" } as EngineModule;
    const both = { ...themed, modules: [...coreModules(), screenFont] };
    expect(cardFonts(both)).toEqual(["Cinzel", "Orbitron"]);
    const source = settingsSource(both);
    expect(source.match(/@font-face/g)).toHaveLength(2);
    expect(source).not.toContain('font-family: \\"Patrick Hand\\"');
  });

  it("lets the texture set use inline pictures, but no url() of the author's own", () => {
    expect(cleanOverrides({ texture: TEXTURES.Grain }).texture).toBe(TEXTURES.Grain);
    expect(TEXTURES.Grain).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(TEXTURES.Grain).not.toMatch(/[<>#;{}]/);
    expect(cleanOverrides({ texture: "url(https://example.com/x.png)" }).texture).toBeUndefined();
    expect(cleanOverrides({ texture: "linear-gradient(red, blue)" }).texture).toBe("linear-gradient(red, blue)");
  });

  it("puts the card's fonts first in every screen's styles", () => {
    const config = { version: "t", theme: { mode: "dark", dark: "--cf-bg: #111", light: "--cf-bg: #fff", fonts: '@font-face { font-family: "Cinzel"; }' }, kit: "", modules: [] };
    const core = new Function(
      "CF_CONFIG",
      "getVariables",
      "updateVariablesWith",
      "eventOn",
      "eventRemoveListener",
      "eventEmit",
      `${fxSource}\n${artSource}\n${sceneSource}\n${moodSource}\n${coreSource}\nreturn { cfThemeCss };`,
    )(config, () => ({}), async () => ({}), () => {}, () => {}, async () => {}) as { cfThemeCss: () => string };
    expect(core.cfThemeCss()).toMatch(/^@font-face \{ font-family: "Cinzel"; \}\n:root \{ --cf-bg: #111/);
  });

  it("lets the engineer set fonts and textures by name, and read them back by name", async () => {
    const ctx: EngineerContext = { data: newCard("Mina").data, draft: newEngine(), ops: [], skills: BUILT_IN_SKILLS };
    const set = await runEngineerTool(ctx, call("set_theme", { tokens: { heading: "Cinzel", texture: "Grain" } }));
    expect(set.isError).toBeFalsy();
    expect(ctx.draft.theme!.overrides).toMatchObject({ heading: FONTS.Cinzel, texture: TEXTURES.Grain });
    const read = await runEngineerTool(ctx, call("read_theme"));
    expect(read.content).toContain("texture: Grain");
    expect(read.content).not.toContain("data:image");
    expect(read.content).toMatch(/embedded_fonts:\n {2}- Cinzel/);
    expect(read.content).toContain("- Patrick Hand");
  });
});

describe("sample states", () => {
  it("builds the start, low and empty, and high and full from the card's own values", () => {
    const [start, low, high, ...rest] = sampleStates(withVars());
    expect(start.state.Player).toEqual({ Health: 80, Gold: 25, Items: ["rope"], Mood: "tense" });
    expect(low).toMatchObject({ label: "Low and empty", state: { Player: { Health: 10, Gold: 0, Items: [], Mood: "calm" } } });
    expect(high.label).toBe("High and full");
    const p = high.state.Player as Record<string, unknown>;
    expect([p.Health, p.Gold, p.Mood]).toEqual([100, 99999, "furious"]);
    expect(p.Items).toHaveLength(8);
    expect(rest).toEqual([]);
  });

  it("adds morning and night when the card keeps time", () => {
    const states = sampleStates({ ...withVars(), modules: [...coreModules(), timeModule()] });
    const night = states.find((s) => s.id === "night")!;
    expect(night.state.Time).toMatchObject({ Clock: "23:30", PartOfDay: "Night" });
    expect(states.find((s) => s.id === "morning")!.state.Time).toMatchObject({ PartOfDay: "Morning" });
  });
});

/** A stand-in for the hidden sandbox page that records what the tools asked of it. */
function fakePreview() {
  const seen = { frames: [] as unknown[][], settings: [] as unknown[], samples: [] as unknown[], opened: [] as string[], captures: 0 };
  const preview = {
    loaded: true,
    size: { width: 390, height: 760 },
    load: async () => false,
    close: async () => undefined,
    open: async (id: string) => void seen.opened.push(id),
    capture: async () => {
      seen.captures++;
      return { image: "iVBORw0KGgo", width: 390, height: 760 };
    },
    inspect: async () => [],
    take: () => ({ problems: [], logs: [] }),
    setSample: async (state: unknown) => void seen.samples.push(state),
    settings: async (s: unknown) => void seen.settings.push(s),
    frames: async (at: number[], trigger: unknown, images: boolean) => {
      seen.frames.push([at, trigger, images]);
      return {
        width: 390,
        height: 760,
        frames: at.map((t) => ({ at: t, moving: t < 500 ? ["div.hs-in hs-rise 40% · opacity 0.4 · transform matrix(1, 0, 0, 1, 0, 5)"] : [], ...(images ? { image: "QUJD" } : {}) })),
      };
    },
  };
  return { seen, preview };
}

const testCtx = (preview: unknown, shots = true, draft = withVars()): EngineerContext =>
  ({ data: newCard("Mina").data, draft, ops: [], skills: BUILT_IN_SKILLS, shots, preview, libs: async () => ({}) }) as unknown as EngineerContext;

describe("the frame strip", () => {
  it("takes pictures at the asked times after the trigger, with what is moving at each", async () => {
    const { seen, preview } = fakePreview();
    const ctx = testCtx(preview);
    const result = await runEngineerTool(ctx, call("render_preview", { frames: [900, 0, 250, 250], click: "Use" }));
    expect(result.isError).toBeFalsy();
    expect(seen.frames[0]).toEqual([[0, 250, 900], { click: { text: "Use" } }, true]);
    expect(result.images).toHaveLength(3);
    expect(result.content).toContain('after tapping "Use": 3 pictures attached, in order');
    expect(result.content).toContain("1. At 0ms, moving:\n   - div.hs-in hs-rise 40%");
    expect(result.content).toContain("3. At 900ms: nothing moving.");
  });

  it("opens a screen as the trigger, or sets values for this render only, or redraws the newest message", async () => {
    const { seen, preview } = fakePreview();
    const draft = { ...withVars(), modules: [...coreModules(), EXAMPLES.find((e) => e.id === "hero-sheet")!] };
    const ctx = testCtx(preview, false, draft);
    await runEngineerTool(ctx, call("render_preview", { frames: [0, 300], open: "hero-sheet" }));
    expect(seen.frames[0]).toEqual([[0, 300], { open: "hero-sheet" }, false]);
    // Opening is the trigger, so the screen isn't opened first.
    expect(seen.opened).toEqual([]);
    const values = await runEngineerTool(ctx, call("render_preview", { frames: [0], values: { Player: { Health: 5 } } }));
    expect(seen.frames[1][1]).toEqual({ values: { Player: { Health: 5 } } });
    expect(values.images).toBeUndefined();
    expect(ctx.sampleDirty).toBe(true);
    await runEngineerTool(ctx, call("render_preview", { frames: [0] }));
    expect(seen.frames[2][1]).toEqual({ values: {} });
    const bad = await runEngineerTool(ctx, call("render_preview", { frames: [0, 9000] }));
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/0 to 4000/);
  });

  it("is drawn by the sandbox page with animations held still", () => {
    expect(hostSource).toContain('case "frames":');
    expect(hostSource).toContain('case "settings":');
    expect(hostSource).toContain("animation: none !important");
    expect(hostSource).toContain("a.pause()");
  });
});

describe("preview_states", () => {
  it("renders the card's sample states across devices and modes, at most six, then puts things back", async () => {
    const { seen, preview } = fakePreview();
    const ctx = testCtx(preview);
    const result = await runEngineerTool(ctx, call("preview_states", { devices: ["phone", "desktop"], modes: ["light", "dark"] }));
    expect(result.isError).toBeFalsy();
    expect(result.images).toHaveLength(6);
    expect(result.content).toContain("Rendered 6 states (6 more left out");
    expect(result.content).toContain("1. Starting values · phone · light (picture attached): no problems.");
    expect(result.content).toContain("4. Starting values · phone · dark");
    expect(seen.samples).toHaveLength(6);
    expect(seen.settings).toEqual([{ mode: "light" }, { mode: "dark" }, { mode: "auto" }]);
    expect(ctx.sampleDirty).toBe(true);
  });

  it("takes the engineer's own states over the starting values, and reports without pictures when shots are off", async () => {
    const { seen, preview } = fakePreview();
    const result = await runEngineerTool(testCtx(preview, false), call("preview_states", { states: [{ label: "Broke", values: { Player: { Gold: 0 } } }] }));
    expect(result.images).toBeUndefined();
    expect(seen.captures).toBe(0);
    expect(seen.samples[0]).toMatchObject({ Player: { Health: 80, Gold: 0 } });
    expect(result.content).toContain("1. Broke · phone · light: no problems.");
    const bad = await runEngineerTool(testCtx(preview), call("preview_states", { states: [{ label: "x" }] }));
    expect(bad.isError).toBe(true);
  });
});

describe("the style and motion skill, docs and self-review", () => {
  it("teaches design, motion, images, fonts, genre recipes and taste where the engineer searches", () => {
    const skill = BUILT_IN_SKILLS.find((s) => s.id === "style-and-motion")!;
    expect(skill.when).toMatch(/premium/);
    for (const id of ["design-basics", "premium-feel", "motion-craft", "images-and-backgrounds", "fonts-and-textures", "taste-rules", "seeing-your-work"])
      expect(readDoc(`style#${id}`), id).toBeTruthy();
    for (const genre of ["dark-fantasy", "cyberpunk-hud", "cozy-slice-of-life", "horror", "sci-fi-ship-console", "modern-phone", "visual-novel"])
      expect(readDoc(`style#recipe-${genre}`), genre).toBeTruthy();
    expect(readDoc("style#design-basics")).toContain("Before:");
    expect(searchDocs("cyberpunk recipe")[0]?.id).toBe("style#recipe-cyberpunk-hud");
    expect(readDoc("design#theme-tokens-set-theme")).toContain("Cinzel (bundled)");
  });

  it("reviews built screens against the skill's checklist", () => {
    const text = selfReviewText(BUILT_IN_SKILLS);
    expect(text).toContain("Before you report");
    expect(text).toContain("**Motion:**");
    expect(selfReviewText([])).toContain("One focal point");
    const before = newEngine();
    expect(changedScreens(before, { ...before, vars: withVars().vars })).toBe(false);
    expect(changedScreens(before, { ...before, modules: [...coreModules(), EXAMPLES[0]] })).toBe(true);
    expect(changedScreens(before, { ...before, theme: { preset: "grimdark", overrides: {} } })).toBe(true);
  });

  it("ships a hero sheet example that lints clean, enters once and saves its glow for a level up", () => {
    const m = EXAMPLES.find((e) => e.id === "hero-sheet")!;
    expect(lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.level !== "info")).toEqual([]);
    expect(cardFonts({ ...newEngine(), modules: [m] })).toEqual(["Cinzel"]);
    let state: Record<string, unknown> = { Hero: { Name: "Aldric", Level: 3, Health: 42, Gold: 120, Place: "Ashford", Traits: [] } };
    let redraw = () => {};
    const glow = vi.fn(() => () => {});
    const toast = vi.fn();
    const root = document.createElement("div");
    const CF = {
      ui: { esc: (s: unknown) => String(s ?? ""), meter: () => '<div class="cf-meter"></div>', chip: (t: string) => `<span>${t}</span>` },
      assets: { background: () => null, portrait: () => null },
      fx: { countUp: vi.fn(), glow },
    };
    const app = {
      state: (path: string) => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], state),
      delta: () => ({}),
      onState: (fn: () => void) => (redraw = fn),
      toast,
    };
    new Function("CF", "app", "root", "settings", m.js)(CF, app, root, {});
    expect(root.querySelector(".hs.first .hs-in")).not.toBeNull();
    expect(root.querySelector(".hs-portrait")!.textContent).toBe("A");
    expect(root.textContent).toContain("No traits yet");
    state = { Hero: { ...(state.Hero as object), Level: 4 } };
    redraw();
    expect(root.querySelector(".hs.first")).toBeNull();
    expect(glow).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Level 4!", { icon: "star" });
  });
});

describe("the Look tab", () => {
  it("shows the panel at several states, modes and widths at once", () => {
    let config = withVars();
    const save = vi.fn((c: EngineConfig) => (config = c));
    const { rerender } = render(<LookPage config={config} save={save} />);
    const scrubber = screen.getByRole("region", { name: "State preview" });
    expect(within(scrubber).getAllByTitle("Status panel preview")).toHaveLength(3);
    expect(within(scrubber).getByRole("figure", { name: "Low and empty · Phone · Light" })).toBeInTheDocument();
    fireEvent.click(within(scrubber).getByRole("button", { name: "Dark" }));
    fireEvent.click(within(scrubber).getByRole("button", { name: "Desktop" }));
    fireEvent.click(within(scrubber).getByRole("button", { name: "Starting values" }));
    // Two states, two modes, two widths.
    expect(within(scrubber).getAllByTitle("Status panel preview")).toHaveLength(8);
    expect(within(scrubber).getByRole("figure", { name: "High and full · Desktop · Dark" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Texture"), { target: { value: "Grain" } });
    expect(config.theme!.overrides.texture).toBe(TEXTURES.Grain);
    fireEvent.change(screen.getByLabelText("Heading font"), { target: { value: "Cinzel" } });
    expect(config.theme!.overrides.heading).toBe(FONTS.Cinzel);
    rerender(<LookPage config={config} save={save} />);
    expect((screen.getByTitle("Theme preview") as HTMLIFrameElement).srcdoc).toContain('@font-face { font-family: "Cinzel"');
  });
});
