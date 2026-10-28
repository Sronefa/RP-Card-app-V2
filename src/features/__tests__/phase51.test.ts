import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc, searchDocs } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import type { EngineModule } from "../../engine/modules/types";
import { sceneCheck, scriptSource } from "../../engine/runtime";
import artSource from "../../engine/runtime/art.js?raw";
import coreSource from "../../engine/runtime/core.js?raw";
import fxSource from "../../engine/runtime/fx.js?raw";
import sceneSource from "../../engine/runtime/scene.js?raw";
import { newEngine, settingsSource } from "../../engine/sheet";

const kitCss = readFileSync("src/engine/runtime/kit.css", "utf8");

interface Played {
  done: Promise<{ skipped: boolean; stopped: boolean; seen: boolean; choice: { index: number; label: string; value: unknown } | null; choices: unknown[] }>;
  skip(): void;
  stop(): void;
}
interface Scene {
  play(el: Element, steps: unknown[], o?: Record<string, unknown>): Played;
  check(steps: unknown): string[];
  seen(key?: string): boolean | string[];
}

let chat: Record<string, unknown> = {};
let motion = "full";

/** The scene director with the effects kit, the art kit and the engine core, as the card script has them. */
function load() {
  return new Function(
    "CF_CONFIG",
    "getVariables",
    "updateVariablesWith",
    "eventOn",
    "eventRemoveListener",
    "eventEmit",
    `${fxSource}\n${artSource}\n${sceneSource}\n${coreSource}\nreturn { cfScene, api: CardForgeApi };`,
  )(
    { version: "t", theme: { mode: "dark", dark: "", light: "" }, kit: kitCss, modules: [], assets: [] },
    () => ({ ...chat, cardforge: { ...(chat.cardforge as object), settings: { motion } } }),
    async (fn: (v: Record<string, unknown>) => Record<string, unknown>) => {
      chat = fn(structuredClone(chat));
    },
    () => {},
    () => {},
    async () => {},
  ) as { cfScene: Scene; api: Record<string, unknown> };
}

let S: Scene;
let root: HTMLElement;
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const tapScene = () => root.querySelector<HTMLElement>(".cf-scene")!.click();

beforeEach(() => {
  vi.useFakeTimers();
  chat = {};
  motion = "full";
  S = load().cfScene;
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById("root")!;
});
afterEach(() => vi.useRealTimers());

const STEPS = [
  { bg: "", time: "Night" },
  { title: "Chapter II", sub: "The Drowned Crown", hold: 500 },
  { show: "Mina", side: "left" },
  { say: "You came back.", who: "Mina" },
  { choice: [{ label: "Of course", value: "yes" }, "Leave"] },
  { say: "Good.", who: "Mina", auto: 100 },
];

describe("checking a scene", () => {
  it("names each step that can't play", () => {
    expect(S.check(STEPS)).toEqual([]);
    expect(S.check("nope")).toEqual(["A scene is a list of steps."]);
    expect(S.check([{ dance: 1 }, { say: " " }, { show: "" }, { choice: [] }, { fx: "explode" }, { wait: "soon" }])).toEqual([
      "Step 1 does nothing: give it one of bg, show, hide, say, title, fx, wait, choice, clear.",
      "Step 2 has nothing to say.",
      "Step 3 doesn't name who to show.",
      "Step 4 has no choices.",
      'Step 5 has an unknown effect "explode": use shake, flash, weather, particles.',
      'Step 6 waits for "soon": give ms or "tap".',
    ]);
    expect(sceneCheck([{ wait: 200 }, { wait: "tap" }])).toEqual([]);
  });

  it("won't play a broken scene, and says why in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await S.play(root, [{ nope: 1 }]).done;
    expect(r.choice).toBeNull();
    expect(root.querySelector(".cf-scene")).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/^CF.scene: Step 1 does nothing/);
    warn.mockRestore();
  });
});

describe("playing a scene", () => {
  it("stages the background, the title, a character and a typed line, then waits for taps and a choice", async () => {
    const played = S.play(root, STEPS, { label: "Prologue" });
    const box = root.querySelector(".cf-scene")!;
    expect(box.getAttribute("aria-label")).toBe("Prologue");
    expect((box.querySelector(".cf-scene-bg:nth-child(2)") as HTMLElement).style.background).toContain("radial-gradient");
    await flush(100);
    expect(box.querySelector(".cf-scene-title h1")!.textContent).toBe("Chapter II");
    // Step until the line starts typing, so it is caught part way.
    for (let i = 0; i < 300 && !box.querySelector(".cf-vn-text")?.textContent; i++) await flush(20);
    const mina = box.querySelector('.cf-scene-actor[data-name="Mina"]')!;
    expect(mina.className).toBe("cf-scene-actor left letter");
    expect(mina.textContent).toBe("M");
    // The line types out; a tap shows the rest at once.
    const text = () => box.querySelector(".cf-vn-text")!.textContent;
    expect(box.querySelector(".cf-vn-name")!.textContent).toBe("Mina");
    expect(text()!.length).toBeLessThan("You came back.".length);
    tapScene();
    await flush();
    expect(text()).toBe("You came back.");
    expect(box.querySelector(".cf-vn-more")).not.toBeNull();
    tapScene();
    await flush();
    const choices = box.querySelectorAll<HTMLButtonElement>("[data-cf-scene-choice]");
    expect([...choices].map((b) => b.textContent)).toEqual(["Of course", "Leave"]);
    // Tapping the stage doesn't pass a choice.
    tapScene();
    await flush(500);
    expect(box.querySelectorAll("[data-cf-scene-choice]")).toHaveLength(2);
    choices[0].click();
    await flush(2000);
    const r = await played.done;
    expect(r.choice).toEqual({ index: 0, label: "Of course", value: "yes" });
    expect(r.skipped).toBe(false);
    expect(root.querySelector(".cf-scene")).toBeNull();
  });

  it("skips to the next choice, then to the end, keeping the last frame when asked", async () => {
    const played = S.play(root, STEPS, { keep: true });
    root.querySelector<HTMLButtonElement>(".cf-scene-skip")!.click();
    await flush();
    // Everything up to the choice is placed at once.
    expect(root.querySelector(".cf-scene-actor")).not.toBeNull();
    expect(root.querySelector(".cf-vn-text")!.textContent).toBe("You came back.");
    root.querySelectorAll<HTMLButtonElement>("[data-cf-scene-choice]")[1].click();
    await flush();
    root.querySelector<HTMLButtonElement>(".cf-scene-skip")!.click();
    await flush(500);
    const r = await played.done;
    expect(r).toMatchObject({ skipped: true, choice: { index: 1, label: "Leave", value: "Leave" } });
    expect(root.querySelector(".cf-scene .cf-vn-text")!.textContent).toBe("Good.");
  });

  it("plays a scene with `once` a single time per chat", async () => {
    const first = S.play(root, [{ title: "Intro", hold: 10 }], { once: "intro" });
    await flush(2000);
    expect((await first.done).seen).toBe(false);
    await flush();
    expect(S.seen("intro")).toBe(true);
    expect(S.seen()).toEqual(["intro"]);
    const again = await S.play(root, [{ title: "Intro" }], { once: "intro" }).done;
    expect(again.seen).toBe(true);
    expect(root.querySelector(".cf-scene")).toBeNull();
  });

  it("stops at once, and with less motion shows each step without waiting on animations", async () => {
    const played = S.play(root, [{ say: "Wait for me", who: "Mina" }, { wait: 5000 }]);
    played.stop();
    expect((await played.done).stopped).toBe(true);
    expect(root.querySelector(".cf-scene")).toBeNull();

    motion = "reduce";
    S = load().cfScene;
    const calm = S.play(root, [{ show: "Mina" }, { say: "Hello.", who: "Mina", auto: 0 }, { fx: "shake" }], { keep: true });
    await flush();
    expect(root.querySelector(".cf-vn-text")!.textContent).toBe("Hello.");
    expect((await calm.done).skipped).toBe(false);
  });

  it("fills its screen when asked, and moves on with Enter or skips with Escape", async () => {
    root.style.position = "static";
    const played = S.play(root, [{ say: "One" }, { say: "Two" }], { fill: true });
    const box = root.querySelector<HTMLElement>(".cf-scene")!;
    expect(box.classList.contains("fill")).toBe(true);
    expect(root.style.position).toBe("relative");
    await flush(1000);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(box.querySelector(".cf-vn-text")!.textContent).toMatch(/^T/);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush(500);
    expect((await played.done).skipped).toBe(true);
  });
});

describe("wiring, lint, docs and examples", () => {
  it("ships in the card script and reaches screens as CF.scene and app.scene", () => {
    const source = scriptSource(settingsSource(newEngine()));
    expect(source.indexOf("var cfScene = {")).toBeGreaterThan(source.indexOf("var cfArt = {"));
    expect(source.indexOf("var cfScene = {")).toBeLessThan(source.indexOf("var CardForgeApi = {"));
    expect(load().api.scene).toBeDefined();
    expect(coreSource).toMatch(/art: cfArt,\n\s+scene: cfScene,/);
    expect(sceneSource).not.toMatch(/<\/script/i);
    expect(kitCss).toContain(".cf-scene-actor");
  });

  it("lints scenes kept in a module's settings", () => {
    const m = { ...EXAMPLES.find((e) => e.id === "prologue")!, id: "p2" } as EngineModule;
    expect(lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.check === "scene")).toEqual([]);
    const broken = { ...m, settings: { scenes: { intro: [{ say: "" }], outro: "x" } } };
    expect(lintConfig({ ...newEngine(), modules: [broken] }).filter((f) => f.check === "scene").map((f) => f.message)).toEqual([
      'p2 scene "intro": Step 1 has nothing to say.',
      'p2 scene "outro": A scene is a list of steps.',
    ]);
  });

  it("is documented where the engineer searches, with a skill and examples that lint clean and play", async () => {
    const doc = readDoc("core-api#cutscenes-cf-scene")!;
    for (const word of ["CF.scene.play", "once", "fill", "keep", "Skip", "CF.scene.check", "settings.scenes"]) expect(doc, word).toContain(word);
    expect(readDoc("core-api")).toContain("interface Scene {");
    expect(searchDocs("cutscene chapter card")[0]?.id).toBe("core-api#cutscenes-cf-scene");
    expect(BUILT_IN_SKILLS.find((s) => s.id === "cutscenes")?.text).toMatch(/Write it as data/);

    for (const id of ["prologue", "chapter-card"]) {
      const m = EXAMPLES.find((e) => e.id === id)!;
      expect(lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.level !== "info"), id).toEqual([]);
    }
    // The prologue plays its intro on first open, then shows its menu.
    const prologue = EXAMPLES.find((e) => e.id === "prologue")!;
    const toast = vi.fn();
    const CF = { scene: S, ui: { button: (l: string) => `<button>${l}</button>`, esc: String } };
    const app = { toast, write: vi.fn() };
    new Function("CF", "app", "root", "settings", prologue.js)(CF, app, root, prologue.settings);
    expect(root.querySelector(".cf-scene.fill")).not.toBeNull();
    root.querySelector<HTMLButtonElement>(".cf-scene-skip")!.click();
    await flush();
    root.querySelector<HTMLButtonElement>("[data-cf-scene-choice]")!.click();
    await flush(1000);
    expect(root.textContent).toContain("You've seen the prologue.");
    expect(toast).toHaveBeenCalled();

    // The chapter card plays only where the chapter changed, then stays as a still banner.
    const card = EXAMPLES.find((e) => e.id === "chapter-card")!;
    const state: Record<string, unknown> = { "Story.Chapter": 2, "Story.ChapterTitle": "Into the Fog" };
    const run = (delta: Record<string, unknown>) => {
      const el = document.createElement("div");
      new Function("CF", "app", "root", "settings", card.js)({ scene: S, ui: { esc: String } }, { state: (p: string) => state[p], delta: () => delta }, el, {});
      return el;
    };
    expect(run({}).innerHTML).toBe("");
    const first = run({ "Story.Chapter": [1, 2] });
    expect(first.querySelector(".cf-scene")).not.toBeNull();
    await flush(5000);
    expect(first.querySelector(".cc-still h2")!.textContent).toBe("Into the Fog");
    expect(run({ "Story.Chapter": [1, 2] }).querySelector(".cf-scene")).toBeNull();
  });
});
