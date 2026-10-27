import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../../app/App";
import { DEFAULT_PREFS, usePrefs, type Prefs } from "../../app/prefs";
import { useUi } from "../../app/store";
import {
  APP_PRESETS,
  contrast,
  deriveTokens,
  dominantColor,
  isDaytime,
  presetById,
  readability,
  readableAccent,
  readThemeFile,
  themeFile,
} from "../../app/theme";
import { resolveTokens, themeClasses, themeStyle } from "../../app/useAppTheme";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { applyEngine, newEngine } from "../../engine/sheet";

const prefs = (patch: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...patch, drift: { ...DEFAULT_PREFS.drift, ...patch.drift } });
const ctx = { now: new Date(2026, 9, 27, 12), section: "library" };
const root = () => document.documentElement;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  usePrefs.setState(prefs());
  useUi.setState({ section: "settings" });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
});

describe("app themes", () => {
  it("ships readable presets, OLED black among them, and one light theme", () => {
    expect(APP_PRESETS.map((p) => p.name)).toEqual([
      "CardForge",
      "OLED Black",
      "Midnight Library",
      "Neon Noir",
      "Bloodmoon",
      "Forest Shrine",
      "Frostbite",
      "Sakura Night",
      "Phosphor",
      "Ember",
      "Parchment",
    ]);
    for (const p of APP_PRESETS) expect(readability(p.tokens).ok, p.name).toBe(true);
    expect(presetById("oled")!.tokens.surface).toBe("#000000");
    expect(presetById("parchment")!.tokens.mode).toBe("light");
  });

  it("derives a custom theme from a tint and an accent, checks it, and saves it as a file", () => {
    const dark = deriveTokens("#20304a", "#ffb347", "dark");
    expect(readability(dark).ok).toBe(true);
    const light = deriveTokens("#20304a", "#ffb347", "light");
    expect(light.mode).toBe("light");
    expect(readability(light).accent).toBeLessThan(3);
    expect(contrast(readableAccent("#ffb347", light.surface, "light"), light.surface)).toBeGreaterThanOrEqual(3);
    const file = themeFile({ id: "x", name: "Harbour", tint: "#20304a", accent: "#ffb347", mode: "dark" });
    expect(readThemeFile(file)).toEqual({ name: "Harbour", tint: "#20304a", accent: "#ffb347", mode: "dark" });
    expect(() => readThemeFile("{}")).toThrow(/isn't a CardForge theme/);
  });

  it("layers the clock, the accent, the open card and the section", () => {
    expect(resolveTokens(prefs({ followClock: true, theme: "neon" }), ctx).surface).toBe("#f4ecd8");
    expect(resolveTokens(prefs({ followClock: true }), { ...ctx, now: new Date(2026, 9, 27, 23) }).surface).toBe("#000000");
    expect(isDaytime(new Date(2026, 1, 1, 6, 59))).toBe(false);
    expect(resolveTokens(prefs({ theme: "oled", accent: "#00ff88" }), ctx).accent).toBe("#00ff88");
    // A dark accent on black is lifted until it reads.
    const lifted = resolveTokens(prefs({ theme: "oled", accent: "#200040" }), ctx).accent;
    expect(contrast(lifted, "#000000")).toBeGreaterThanOrEqual(3);
    const engine = { surface: "#101010", raised: "#202020", sunken: "#080808", border: "#333333", ink: "#ffffff", muted: "#aaaaaa", accent: "#ff0000", accentStrong: "#cc0000" };
    expect(resolveTokens(prefs({ cardColors: true }), { ...ctx, engine }).accent).toBe("#ff0000");
    expect(resolveTokens(prefs(), { ...ctx, engine }).accent).toBe("#c08cff");
    expect(resolveTokens(prefs({ cardColors: true }), { ...ctx, avatar: "#2e8b57" }).surface).not.toBe("#14121a");
    const lib = resolveTokens(prefs({ sectionHues: true }), ctx).accent;
    expect(resolveTokens(prefs({ sectionHues: true }), { ...ctx, section: "engine" }).accent).not.toBe(lib);
  });

  it("drifts the accent with the animated --rgb-angle, and sets size, density and classes", () => {
    const t = presetById("default")!.tokens;
    const style = themeStyle(t, prefs({ drift: { on: true, minutes: 2, saturation: 60, scope: "borders", batteryPause: true }, textSize: 110, density: "compact" }));
    expect(style["--color-accent"]).toMatch(/^hsl\(calc\(var\(--rgb-angle\) \+ \d+deg\) 60% \d+%\)$/);
    expect(style["--color-border"]).toContain("color-mix");
    expect(style["--drift-duration"]).toBe("120s");
    expect(style["font-size"]).toBe("110%");
    expect(style["--spacing"]).toBe("0.22rem");
    expect(themeClasses(prefs({ drift: { on: true, scope: "aurora" } as Prefs["drift"], texture: "stars", serif: true }), presetById("parchment")!.tokens, true)).toEqual([
      "theme-light",
      "drift",
      "drift-aurora",
      "drift-paused",
      "texture-stars",
      "serif-writing",
    ]);
  });

  it("finds an avatar's dominant vivid colour, ignoring greys", () => {
    const px = new Uint8ClampedArray([200, 30, 30, 255, 210, 40, 35, 255, 128, 128, 128, 255, 20, 200, 30, 255]);
    expect(dominantColor(px)).toBe("#cd2321");
    expect(dominantColor(new Uint8ClampedArray([128, 128, 128, 255]))).toBeUndefined();
  });
});

describe("the Look settings", () => {
  it("switches the theme, drifts, builds a custom theme and keeps it all on the device", async () => {
    render(<App />);
    const look = await screen.findByRole("region", { name: "Look" });
    fireEvent.click(within(look).getByRole("radio", { name: "OLED Black" }));
    expect(root().style.getPropertyValue("--color-surface")).toBe("#000000");
    expect(JSON.parse(localStorage.getItem("cardforge.prefs")!).theme).toBe("oled");

    fireEvent.click(within(look).getByRole("checkbox", { name: /RGB Drift/ }));
    expect(root().classList.contains("drift")).toBe(true);
    expect(root().style.getPropertyValue("--color-accent")).toContain("var(--rgb-angle)");
    fireEvent.change(within(look).getByRole("slider", { name: "Drift speed in minutes" }), { target: { value: "30" } });
    expect(root().style.getPropertyValue("--drift-duration")).toBe("1800s");
    fireEvent.click(within(look).getByRole("checkbox", { name: /RGB Drift/ }));
    expect(root().classList.contains("drift")).toBe(false);

    fireEvent.click(within(look).getByRole("button", { name: "Make a theme" }));
    const builder = within(screen.getByLabelText("Theme builder"));
    fireEvent.change(builder.getByRole("textbox"), { target: { value: "Harbour" } });
    fireEvent.change(builder.getByLabelText("Background tint"), { target: { value: "#20304a" } });
    expect(builder.getByRole("status").textContent).toMatch(/^Reads well/);
    fireEvent.change(builder.getByLabelText("Mode"), { target: { value: "light" } });
    fireEvent.change(builder.getByLabelText("Theme accent"), { target: { value: "#ffee88" } });
    expect(builder.getByRole("status").textContent).toMatch(/^Hard to read/);
    fireEvent.change(builder.getByLabelText("Theme accent"), { target: { value: "#8a2be2" } });
    fireEvent.click(builder.getByRole("button", { name: "Save and use it" }));
    expect(within(look).getByRole("radio", { name: "Harbour" })).toHaveAttribute("aria-checked", "true");
    expect(root().classList.contains("theme-light")).toBe(true);
    expect(root().style.getPropertyValue("color-scheme")).toBe("light");

    fireEvent.change(within(look).getByLabelText("Texture"), { target: { value: "paper" } });
    fireEvent.click(within(look).getByRole("checkbox", { name: /serif font/ }));
    expect(root().classList.contains("texture-paper")).toBe(true);
    expect(root().classList.contains("serif-writing")).toBe(true);
  });

  it("draws a project line and takes the open card's engine colours", async () => {
    const project = await createProject("P");
    const card = await createCard(project.id, "character");
    await useEditor.getState().open(card.id);
    usePrefs.getState().set({ projectLine: true, cardColors: true });
    render(<App />);
    expect(screen.getByTestId("project-line")).toBeInTheDocument();
    const before = root().style.getPropertyValue("--color-surface");
    act(() => useEditor.getState().replaceData(applyEngine(useEditor.getState().record!.card.data, newEngine())));
    expect(root().style.getPropertyValue("--color-surface")).not.toBe(before);
  });
});
