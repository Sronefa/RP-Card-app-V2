import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../ai/types";
import { newCard } from "../../card";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc, searchDocs } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { applyOp } from "../../engine/engineer/workspace";
import { applyEngine, newEngine, newVar, settingsSource, tavernHelperScript, type EngineConfig } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";
import { cleanMoods, cleanPortraits, livingTheme, newTheme, TEXTURES, themeVars, type CardTheme } from "../../engine/theme";
import type { ManifestEntry } from "../../images/manifest";
import { artSlots, requestedShot } from "../../images/engineArt";
import { LookPage } from "../engine/LookPage";

const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ id: name, name, input });

const VARS = [
  newVar({ id: "w-danger", group: "World", name: "Danger", type: "number", start: "10", min: 0, max: 100, rule: "" }),
  newVar({ id: "w-time", group: "Time", name: "PartOfDay", type: "choice", options: ["Day", "Night"], start: "Day", rule: "" }),
  newVar({ id: "m-mood", group: "Mina", name: "Mood", type: "choice", options: ["neutral", "joy", "sadness"], start: "neutral", rule: "" }),
  newVar({ id: "m-outfit", group: "Mina", name: "Outfit", type: "choice", options: ["Casual", "Armor"], start: "Casual", rule: "" }),
  newVar({ id: "m-hp", group: "Mina", name: "Health", type: "number", start: "100", min: 0, max: 100, rule: "" }),
];

const THEME: CardTheme = {
  ...newTheme(),
  moods: [
    { id: "night", name: "Night", path: "Time.PartOfDay", is: ["night"], tokens: { bg: "#0b1020" }, tint: { color: "#0a1440", strength: 0.12 } },
    { id: "", name: "Danger", path: "World.Danger", min: 70, tokens: { accent: "#e0313f", texture: TEXTURES.Vignette }, tint: { color: "#400", strength: 0.9 }, ambience: "embers" },
  ],
  portraits: [{ name: "Mina", emotion: "Mina.Mood", outfit: "Mina.Outfit", hurt: { path: "Mina.Health", below: 30, emotion: "hurt" } }],
};

const engine = (theme: CardTheme = THEME): EngineConfig => ({ ...newEngine(), vars: VARS, theme });

const ART: ManifestEntry[] = [
  { s: "Mina", k: "portrait", f: "mina.webp", u: "/c/mina.webp" },
  { s: "Mina", k: "emotion", v: "joy", f: "joy.webp", u: "/c/joy.webp" },
  { s: "Mina", k: "emotion", v: "sadness", f: "sad.webp", u: "/c/sad.webp" },
  { s: "Mina", k: "emotion", v: "hurt", f: "hurt.webp", u: "/c/hurt.webp" },
  { s: "Mina", k: "emotion", v: "joy armor", f: "joy-armor.webp", u: "/c/joy-armor.webp" },
  { s: "Mina", k: "outfit", v: "Armor", f: "armor.webp", u: "/c/armor.webp" },
];

interface Living {
  active(id?: number | "latest"): { id: string; name: string }[];
  is(x: string, id?: number | "latest"): boolean;
  look(name: string, id?: number | "latest"): { emotion: string; outfit: string };
}
type App = { portrait(name: string, o?: object): string; mood: { active(): { id: string }[]; is(x: string): boolean } };

const STATE = { World: { Danger: 10 }, Time: { PartOfDay: "Day" }, Mina: { Mood: "joy", Outfit: "Casual", Health: 100 } };

/** The card script running in a fake chat of two replies, with the given state on the latest. */
async function boot(theme: CardTheme = THEME, motion = "full") {
  const config = engine(theme);
  const tavern = fakeTavern([
    { role: "assistant", message: "One." },
    { role: "assistant", message: "Two." },
  ]);
  tavern.scopes.chat = { cardforge: { settings: { motion } } };
  await runScript(tavernHelperScript(config, "Mina", ART).content, tavern);
  vi.useFakeTimers();
  const CF = tavern.globals.CardForge as { frame(w: Window, o?: object): App; mood: Living; ui: { portrait(n: string, o?: object): string } };
  const setState = async (patch: Record<string, Record<string, unknown>>, id = 1) => {
    const stat = structuredClone(STATE) as Record<string, Record<string, unknown>>;
    for (const [g, v] of Object.entries(patch)) stat[g] = { ...stat[g], ...v };
    tavern.vars[id] = { stat_data: stat, delta_data: {} };
    await tavern.api.eventEmit("cf:state", id);
    await vi.advanceTimersByTimeAsync(10);
  };
  return { CF, tavern, setState };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.removeAttribute("data-cf-mood");
  delete (document as unknown as Record<string, unknown>).cfMoodState;
  delete (document as unknown as Record<string, unknown>).cfPortraitsShown;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("moods and portraits in the theme", () => {
  it("keeps only complete, safe moods and bindings, and hands the core their CSS", () => {
    const moods = cleanMoods([
      ...THEME.moods!,
      { name: "No path", path: "", tokens: { bg: "#000" } },
      { name: "Night", path: "X", tokens: { accent: "url(http://x)" }, ambience: "lava" },
      "nope",
    ]);
    expect(moods.map((m) => [m.id, m.name])).toEqual([
      ["night", "Night"],
      ["danger", "Danger"],
      ["night-2", "Night"],
    ]);
    expect(moods[1].tint).toEqual({ color: "#400", strength: 0.6 });
    expect(moods[2]).toEqual({ id: "night-2", name: "Night", path: "X", tokens: {} });
    expect(cleanPortraits([{ name: "Mina", emotion: "Mina.Mood", hurt: { path: "Mina.Health", below: "30" } }, { name: "mina", emotion: "x" }, { name: "Holt" }])).toEqual([
      { name: "Mina", emotion: "Mina.Mood", hurt: { path: "Mina.Health", below: 30, emotion: "hurt" } },
    ]);
    expect(themeVars({ accent: "#e0313f", radius: 4 })).toBe("--cf-accent: #e0313f; --cf-radius: 4px");
    const living = livingTheme(THEME);
    expect(living.moods[1]).toMatchObject({ id: "danger", min: 70, vars: `--cf-accent: #e0313f; --cf-texture: ${TEXTURES.Vignette}`, ambience: "embers" });
    expect(settingsSource(engine())).toContain('"portraits":[{"name":"Mina"');
  });
});

describe("moods on screens", () => {
  it("shifts the theme, tints the screen and adds weather while a value matches, and fades back", async () => {
    const { CF, setState } = await boot();
    await setState({});
    const app = CF.frame(window, { messageId: "latest" });
    expect(document.getElementById("cf-mood")).toBeNull();
    expect(app.mood.active()).toEqual([]);

    await setState({ World: { Danger: 80 }, Time: { PartOfDay: "Night" } });
    const style = document.getElementById("cf-mood")!.textContent!;
    expect(style).toContain(":root { --cf-bg: #0b1020; --cf-accent: #e0313f;");
    expect(style).toContain("transition: --cf-bg .9s ease");
    expect(document.body.getAttribute("data-cf-mood")).toBe("night danger");
    const tint = document.querySelector<HTMLElement>(".cf-mood-tint")!;
    expect(tint.style.opacity).toBe("0.6");
    expect(document.querySelectorAll(".cf-mood-ambience.cf-fx-embers")).toHaveLength(1);
    expect(app.mood.is("Danger")).toBe(true);
    expect(CF.mood.active().map((m) => m.name)).toEqual(["Night", "Danger"]);

    await setState({ World: { Danger: 20 }, Time: { PartOfDay: "Night" } });
    expect(document.body.getAttribute("data-cf-mood")).toBe("night");
    expect(tint.style.opacity).toBe("0.12");
    expect(document.querySelector(".cf-mood-ambience")).toBeNull();

    await setState({});
    expect(document.body.hasAttribute("data-cf-mood")).toBe(false);
    expect(tint.style.opacity).toBe("0");
    expect(document.getElementById("cf-mood")!.textContent).not.toContain("--cf-bg:");
  });

  it("holds still with less motion, and an older panel keeps its own mood without weather", async () => {
    const { CF, tavern, setState } = await boot(THEME, "reduce");
    await setState({ World: { Danger: 90 } });
    CF.frame(window, { messageId: "latest" });
    expect(document.body.getAttribute("data-cf-mood")).toBe("danger");
    expect(document.querySelector(".cf-mood-ambience")).toBeNull();

    document.body.innerHTML = "";
    delete (document as unknown as Record<string, unknown>).cfMoodState;
    tavern.scopes.chat = { cardforge: { settings: { motion: "full" } } };
    await setState({ World: { Danger: 95 } }, 0);
    await setState({ World: { Danger: 5 } }, 1);
    CF.frame(window, { messageId: 0 });
    expect(document.body.getAttribute("data-cf-mood")).toBe("danger");
    expect(document.querySelector(".cf-mood-ambience")).toBeNull();
    expect(CF.mood.is("danger", 0)).toBe(true);
    expect(CF.mood.is("danger")).toBe(false);
  });
});

describe("expressive portraits", () => {
  it("shows the emotion and outfit the values name, the closest picture, and the hurt look", async () => {
    const { CF, setState } = await boot();
    await setState({});
    const box = document.createElement("div");
    box.innerHTML = CF.ui.portrait("Mina", { size: "l", shape: "tall" });
    const el = box.firstElementChild!;
    expect(el.className).toBe("cf-portrait l tall");
    expect(el.getAttribute("aria-label")).toBe("Mina, joy");
    expect(el.getAttribute("data-cf-url")).toBe("/c/joy.webp");
    expect(el.hasAttribute("data-cf-live")).toBe(true);

    const url = (o?: object) => {
      box.innerHTML = CF.ui.portrait("Mina", o);
      return box.firstElementChild!.getAttribute("data-cf-url");
    };
    // Joy in armor has its own picture; amusement falls back to joy; the outfit alone, then the portrait.
    expect(url({ emotion: "joy", outfit: "Armor" })).toBe("/c/joy-armor.webp");
    expect(url({ emotion: "amusement" })).toBe("/c/joy.webp");
    expect(url({ emotion: "fear", outfit: "Armor" })).toBe("/c/armor.webp");
    expect(url({ emotion: "fear" })).toBe("/c/mina.webp");
    expect(box.firstElementChild!.hasAttribute("data-cf-live")).toBe(false);
    box.innerHTML = CF.ui.portrait("Holt");
    expect(box.firstElementChild!.className).toBe("cf-portrait m letter");
    expect(box.textContent).toBe("H");

    await setState({ Mina: { Mood: "sadness", Health: 12 } });
    expect(CF.mood.look("Mina")).toEqual({ emotion: "hurt", outfit: "Casual" });
    expect(url()).toBe("/c/hurt.webp");
  });

  it("crossfades a live portrait when the state changes, and a redrawn one from the picture shown before", async () => {
    let finish = () => {};
    const animate = vi.fn(() => ({ finished: new Promise<void>((r) => (finish = r)) }));
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    const { CF, setState } = await boot();
    await setState({});
    const app = CF.frame(window, { messageId: "latest" });
    document.body.innerHTML = `<div id="root">${app.portrait("Mina")}</div>`;
    await vi.advanceTimersByTimeAsync(10);

    await setState({ Mina: { Mood: "sadness" } });
    const el = document.querySelector("[data-cf-portrait]")!;
    expect(el.getAttribute("data-cf-url")).toBe("/c/sad.webp");
    expect(el.getAttribute("aria-label")).toBe("Mina, sadness");
    const old = el.querySelector<HTMLElement>(".cf-portrait-img.old")!;
    expect(old.style.backgroundImage).toContain("/c/joy.webp");
    finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(el.querySelector(".old")).toBeNull();

    // A redraw with another look: the new element fades from the sad picture.
    document.getElementById("root")!.innerHTML = app.portrait("Mina", { emotion: "joy", outfit: "Armor" });
    await vi.advanceTimersByTimeAsync(10);
    const next = document.querySelector("[data-cf-portrait]")!;
    expect(next.querySelector<HTMLElement>(".old")!.style.backgroundImage).toContain("/c/sad.webp");
    expect(next.getAttribute("data-cf-url")).toBe("/c/joy-armor.webp");
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  it("swaps at once with less motion", async () => {
    const { CF, setState } = await boot(THEME, "reduce");
    await setState({});
    const app = CF.frame(window, { messageId: "latest" });
    document.body.innerHTML = app.portrait("Mina");
    await setState({ Mina: { Mood: "sadness" } });
    const el = document.querySelector("[data-cf-portrait]")!;
    expect(el.getAttribute("data-cf-url")).toBe("/c/sad.webp");
    expect(el.querySelectorAll(".cf-portrait-img")).toHaveLength(1);
  });
});

describe("missing portrait art", () => {
  it("lists every emotion and outfit a binding can name as art slots, and makes their shots", () => {
    const data = applyEngine(newCard("Mina").data, engine());
    const slots = artSlots(data).filter((s) => s.part === "Expressive portraits");
    expect(slots.map((s) => s.label)).toEqual(["Mina, neutral", "Mina, joy", "Mina, sadness", "Mina, hurt", "Mina in Casual", "Mina in Armor"]);
    expect(slots.every((s) => !s.filled)).toBe(true);
    expect(slots[5].shot()).toMatchObject({ kind: "outfit", group: "character", label: "Mina: Armor", outfit: "Armor", subject: "card" });
    expect(requestedShot(data, { kind: "emotion", subject: "Mina", variant: "hurt" })).toMatchObject({ kind: "emotion", emotion: "hurt" });
  });
});

describe("the engineer", () => {
  it("adds, changes and removes moods and portrait bindings, and keeps them through set_theme", () => {
    let c: EngineConfig = { ...newEngine(), vars: VARS };
    c = applyOp(c, call("set_mood", { name: "Danger", path: "World.Danger", min: 70, tokens: { accent: "#e0313f", texture: "Vignette" }, ambience: "embers" })).config;
    c = applyOp(c, call("set_mood", { name: "danger", tint: { color: "#400", strength: 0.2 } })).config;
    expect(c.theme!.moods).toEqual([
      { id: "danger", name: "danger", path: "World.Danger", min: 70, tokens: { accent: "#e0313f", texture: TEXTURES.Vignette }, tint: { color: "#400", strength: 0.2 }, ambience: "embers" },
    ]);
    expect(() => applyOp(c, call("set_mood", { name: "Calm", path: "World.Danger" }))).toThrow(/changes nothing/);
    expect(() => applyOp(c, call("set_mood", { name: "Calm", tokens: { bg: "#000" } }))).toThrow(/"path" is required/);
    expect(() => applyOp(c, call("set_mood", { name: "Calm", path: "X", ambience: "lava" }))).toThrow(/ambience/);
    expect(() => applyOp(c, call("set_mood", { name: "Calm", path: "X", tint: { color: "red" } }))).toThrow(/tint/);

    c = applyOp(c, call("set_portrait", { name: "Mina", emotion: "Mina.Mood", hurt: { path: "Mina.Health", below: 30, emotion: "hurt" } })).config;
    c = applyOp(c, call("set_portrait", { name: "mina", outfit: "Mina.Outfit" })).config;
    expect(c.theme!.portraits).toEqual([{ name: "mina", emotion: "Mina.Mood", outfit: "Mina.Outfit", hurt: { path: "Mina.Health", below: 30, emotion: "hurt" } }]);
    expect(() => applyOp(c, call("set_portrait", { name: "Holt" }))).toThrow(/at least one/);

    c = applyOp(c, call("set_theme", { preset: "dread" })).config;
    expect(c.theme!.moods).toHaveLength(1);
    expect(c.theme!.portraits).toHaveLength(1);
    c = applyOp(c, call("set_mood", { name: "Danger", remove: true })).config;
    c = applyOp(c, call("set_portrait", { name: "Mina", remove: true })).config;
    expect([c.theme!.moods, c.theme!.portraits]).toEqual([[], []]);
  });

  it("reads moods, bindings and missing art in read_theme, and the lint checks their values", async () => {
    const ctx: EngineerContext = { data: newCard("Mina").data, draft: engine(), ops: [], skills: BUILT_IN_SKILLS };
    const read = (await runEngineerTool(ctx, call("read_theme"))).content as string;
    expect(read).toContain("name: Danger");
    expect(read).toContain("texture: Vignette");
    expect(read).toMatch(/portrait_art_missing:\n\s+- Mina, neutral/);
    expect(lintConfig(engine()).filter((f) => f.check === "values")).toEqual([]);
    const broken = engine({ ...THEME, moods: [{ id: "x", name: "Rain", path: "Weather.Now", is: ["rain"], tokens: { bg: "#000" } }], portraits: [{ name: "Holt", emotion: "Holt.Mood" }] });
    expect(lintConfig(broken).filter((f) => f.check === "values").map((f) => f.message)).toEqual([
      'The Rain mood follows "Weather.Now", but the sheet and modules have no such value. Add it with set_value, or fix the path.',
      'Holt\'s portrait follows "Holt.Mood", but the sheet and modules have no such value. Add it with set_value, or fix the path.',
    ]);
  });

  it("has docs, a skill and two examples that pass the lint", () => {
    const doc = readDoc("core-api#moods-and-portraits-cf-mood-cf-ui-portrait");
    expect(doc).toContain("set_mood");
    expect(doc).toContain("app.portrait");
    expect(searchDocs("mood tint ambience").length).toBeGreaterThan(0);
    expect(BUILT_IN_SKILLS.find((s) => s.id === "moods-and-portraits")!.title).toBe("Make the look follow the story");
    for (const id of ["companion-card", "danger-meter"]) {
      const m = EXAMPLES.find((e) => e.id === id)!;
      const c: EngineConfig = { ...newEngine(), modules: [{ ...m, tags: [] }] };
      const bad = lintConfig(c).filter((f) => f.level !== "info");
      expect(bad).toEqual([]);
      expect(() => new Function("CF", "app", "root", "settings", m.js)).not.toThrow();
    }
  });
});

describe("the Look tab", () => {
  it("adds a mood that follows a value, previews it, and binds a portrait", () => {
    let config = engine({ ...newTheme() });
    const save = vi.fn((c: EngineConfig) => {
      config = c;
      view.rerender(<LookPage config={config} save={save} />);
    });
    const view = render(<LookPage config={config} save={save} />);
    const moods = screen.getByRole("region", { name: "Moods" });
    fireEvent.click(within(moods).getByRole("button", { name: "Add a mood" }));
    const mood = within(moods).getByRole("group", { name: "Mood 1" });
    fireEvent.change(within(mood).getByLabelText("Name"), { target: { value: "Danger" } });
    fireEvent.change(within(mood).getByLabelText("Follows"), { target: { value: "World.Danger" } });
    fireEvent.change(within(mood).getByLabelText("Danger from"), { target: { value: "70" } });
    fireEvent.change(within(mood).getByLabelText("Danger Accent"), { target: { value: "#e0313f" } });
    fireEvent.change(within(mood).getByLabelText("Weather"), { target: { value: "embers" } });
    expect(config.theme!.moods![0]).toMatchObject({ name: "Danger", path: "World.Danger", min: 70, tokens: { accent: "#e0313f" }, ambience: "embers" });
    fireEvent.click(within(mood).getByRole("button", { name: "Preview" }));
    expect(screen.getByText("With the Danger mood on.")).toBeInTheDocument();
    expect(screen.getByTitle("Theme preview").getAttribute("srcdoc")).toContain("--cf-accent: #e0313f");

    fireEvent.change(within(mood).getByLabelText("Follows"), { target: { value: "Time.PartOfDay" } });
    fireEvent.click(within(mood).getByRole("checkbox", { name: "Night" }));
    expect(config.theme!.moods![0]).toMatchObject({ path: "Time.PartOfDay", is: ["Night"] });
    expect(config.theme!.moods![0].min).toBeUndefined();

    const portraits = screen.getByRole("region", { name: "Expressive portraits" });
    fireEvent.click(within(portraits).getByRole("button", { name: "Add a character" }));
    const p = within(portraits).getByRole("group", { name: "Portrait 1" });
    fireEvent.change(within(p).getByLabelText("Character"), { target: { value: "Mina" } });
    fireEvent.change(within(p).getByLabelText("Emotion from"), { target: { value: "Mina.Mood" } });
    fireEvent.change(within(p).getByLabelText("Looks hurt when"), { target: { value: "Mina.Health" } });
    expect(config.theme!.portraits).toEqual([{ name: "Mina", emotion: "Mina.Mood", hurt: { path: "Mina.Health", below: 30, emotion: "hurt" } }]);
  });
});
