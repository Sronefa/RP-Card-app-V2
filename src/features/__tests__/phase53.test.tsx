import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { MINIGAME_TEMPLATES } from "../../engine/engineer/minigames";
import { settingsAppModule } from "../../engine/modules/settingsApp";
import type { EngineModule } from "../../engine/modules/types";
import { newEngine, newVar, tavernHelperScript, type EngineConfig } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";

interface Result {
  outcome: string;
  score: number;
  line: string;
  title: string;
  game: string;
  [k: string]: unknown;
}
interface Game {
  el: HTMLElement;
  stage: HTMLElement;
  hud: HTMLElement;
  state: string;
  score: number;
  difficulty: number;
  done: Promise<Result>;
  start(): Promise<Game>;
  pause(): void;
  resume(): void;
  end(r?: Record<string, unknown>): Promise<Result>;
  time(): number;
  tune(a: number, b: number): number;
  rand(): number;
  shuffle<T>(l: T[]): T[];
  loop(fn: (dt: number, t: number) => void): () => void;
  after(ms: number, fn: () => void): () => void;
  every(ms: number, fn: () => void): () => void;
  timer(ms: number, o?: { onEnd?: () => void }): { left(): number; add(ms: number): void; stop(): void };
  addScore(n: number): number;
  combo(): { count: number; best: number; hit(): number; miss(): void; mult(): number };
  tap(t: Element, s: string | ((el: Element) => void), fn?: (el: Element) => void): void;
  hold(t: Element, h: Record<string, unknown>): void;
  swipe(t: Element, fn: (d: string) => void): void;
  keys(map: Record<string, () => void>): void;
  drag(d: { items: string; slots: string; drop(i: Element, s: Element): void }): void;
  grid(b: Record<string, unknown>): { el: HTMLElement; cell(x: number, y: number): HTMLButtonElement; set(x: number, y: number, h: string, l?: string): void; onTap(fn: (x: number, y: number) => void): void };
  sprite(s: Record<string, unknown>): { x: number; y: number; w: number; h: number; vx: number; el: HTMLElement; step(dt: number): unknown; hits(o: object): boolean };
}
interface Kit {
  game: { create(el: Element, o?: Record<string, unknown>): Game; difficulty(spec: unknown): number; hit(a: object, b: object): boolean };
  frame(w: Window, o?: object): { game(el: Element, o?: Record<string, unknown>): Game } & Record<string, unknown>;
}

const VARS = [
  newVar({ id: "lock", group: "Player", name: "Lockpicking", type: "number", start: "8", min: 0, max: 10, rule: "" }),
  newVar({ id: "coins", group: "Player", name: "Coins", type: "number", start: "50", min: 0, rule: "" }),
];

let tavern: ReturnType<typeof fakeTavern>;
const input = () => (document.getElementById("send_textarea") as HTMLTextAreaElement).value;

/** The card script in a fake chat, with fake timers once it has started. */
async function boot(settings: Record<string, unknown> = {}, modules: EngineModule[] = []): Promise<Kit> {
  const config: EngineConfig = { ...newEngine(), vars: VARS, modules };
  tavern = fakeTavern([{ role: "assistant", message: "Hi." }]);
  tavern.scopes.chat = { cardforge: { settings: { motion: "full", ...settings } } };
  await runScript(tavernHelperScript(config, "Mina").content, tavern);
  vi.useFakeTimers();
  return tavern.globals.CardForge as Kit;
}

const frames = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const press = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const pointer = (el: Element, type: string, x: number, y: number) => el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '<textarea id="send_textarea"></textarea><div id="root"></div>';
});
afterEach(() => {
  vi.useRealTimers();
});
const root = () => document.getElementById("root")!;

describe("a game's life", () => {
  it("reads its difficulty from the story", async () => {
    const CF = await boot();
    expect(CF.game.difficulty(0.3)).toBe(0.3);
    expect(CF.game.difficulty(4)).toBe(1);
    expect(CF.game.difficulty({ path: "Player.Lockpicking", min: 0, max: 10, invert: true })).toBeCloseTo(0.2);
    expect(CF.game.difficulty({ path: "Player.Nothing", fallback: 0.9 })).toBe(0.9);
    expect(CF.game.difficulty("Player.Nothing")).toBe(0.5);
    const g = CF.game.create(root(), { difficulty: { path: "Player.Lockpicking", min: 0, max: 10, invert: true } });
    expect(g.tune(3, 8)).toBeCloseTo(4);
    expect(g.el.querySelector(".cf-game-title")!.textContent).toBe("Minigame");
  });

  it("runs its loop and timers on game time, pausing and hiding hold it, and the end stops everything", async () => {
    const CF = await boot();
    const g = CF.game.create(root(), { title: "Test", seed: "s" });
    const ticks: number[] = [];
    g.loop((dt) => ticks.push(dt));
    const fired: number[] = [];
    g.after(500, () => fired.push(g.time()));
    g.every(200, () => fired.push(-1));
    await g.start();
    expect(g.state).toBe("playing");
    await frames(300);
    expect(ticks.length).toBeGreaterThan(5);
    expect(fired).toEqual([-1]);
    g.pause();
    const at = g.time();
    await frames(1000);
    expect(g.time()).toBe(at);
    g.resume();
    await frames(250);
    expect(fired[1]).toBe(-1);
    expect(fired.some((t) => t >= 500)).toBe(true);

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(g.state).toBe("paused");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(g.state).toBe("playing");

    void g.end({ outcome: "win" });
    const n = ticks.length;
    await frames(200);
    expect(ticks.length).toBe(n);
    expect(g.state).toBe("over");
    // The same seed, the same shuffle.
    expect(CF.game.create(root(), { seed: "s" }).shuffle([1, 2, 3, 4, 5])).toEqual(g.shuffle.call(CF.game.create(root(), { seed: "s" }), [1, 2, 3, 4, 5]));
  });

  it("writes the result into the state and the input box, and shows a result card", async () => {
    const CF = await boot();
    tavern.vars[0] = { stat_data: { Player: { Lockpicking: 8, Coins: 50 } }, delta_data: {} };
    const app = CF.frame(window);
    const g = app.game(root(), {
      title: "High or low",
      name: "card-game",
      close: true,
      outcomes: { win: { line: "{{user}} won {bet} coins.", set: { "Player.Coins": 60 } } },
    });
    await g.start();
    g.addScore(30);
    const r = await g.end({ outcome: "win", bet: 10 });
    expect(r).toMatchObject({ outcome: "win", score: 30, line: "{{user}} won 10 coins.", title: "Success", game: "card-game" });
    expect((tavern.vars[0].stat_data as { Player: { Coins: number } }).Player.Coins).toBe(60);
    expect(input()).toBe('<action app="minigame">{"game":"card-game","outcome":"win","score":30}</action>\n{{user}} won 10 coins.');
    const card = g.el.querySelector(".cf-game-result")!;
    expect(card.className).toBe("cf-game-result win");
    expect(card.textContent).toContain("You won 10 coins.");
    expect(card.querySelector("[data-cf-game-done]")!.hasAttribute("data-cf-close")).toBe(true);
  });

  it("can always be skipped: the button, or the player's setting before it starts", async () => {
    let CF = await boot();
    let g = CF.game.create(root(), { title: "Breach", result: false });
    await g.start();
    g.el.querySelector<HTMLButtonElement>(".cf-game-skip")!.click();
    const r = await g.done;
    expect(r).toMatchObject({ outcome: "skip", line: "{{user}} skipped Breach; the story decides how it goes." });
    expect(g.el.querySelector(".cf-game-result")).toBeNull();
    vi.useRealTimers();

    document.body.innerHTML = '<textarea id="send_textarea"></textarea><div id="root"></div>';
    CF = await boot({ minigames: "skip" });
    const loop = vi.fn();
    g = CF.game.create(root(), { title: "Breach", auto: (game: Game) => ({ outcome: game.difficulty > 0.4 ? "loss" : "win" }), outcomes: { loss: { line: "Locked out." } } });
    g.loop(loop);
    await g.start();
    await frames(100);
    expect(loop).not.toHaveBeenCalled();
    expect(await g.done).toMatchObject({ outcome: "loss", auto: true, line: "Locked out." });
    expect(g.el.querySelector(".cf-game-result h2")!.textContent).toBe("Failed");
  });

  it("counts down in the bar and ends as a loss at zero", async () => {
    const CF = await boot();
    const g = CF.game.create(root(), { result: false, report: "none" });
    await g.start();
    const t = g.timer(3000);
    expect(g.hud.querySelector(".cf-game-timer b")!.textContent).toBe("3s");
    await frames(1000);
    t.add(-1500);
    await frames(100);
    expect(g.hud.querySelector(".cf-game-timer")!.classList.contains("low")).toBe(true);
    await frames(500);
    expect(await g.done).toMatchObject({ outcome: "loss", reason: "time" });
    expect(input()).toBe("");
  });
});

describe("input and blocks", () => {
  it("taps, keys, swipes and holds only while the game is played", async () => {
    const CF = await boot();
    const g = CF.game.create(root());
    g.stage.innerHTML = '<button class="a">A</button><div class="pad"></div>';
    const got: string[] = [];
    g.tap(g.stage, ".a", () => got.push("tap"));
    g.keys({ " ": () => got.push("space") });
    g.swipe(g.stage.querySelector(".pad")!, (d) => got.push(d));
    g.stage.querySelector<HTMLButtonElement>(".a")!.click();
    expect(got).toEqual([]);
    await g.start();
    g.stage.querySelector<HTMLButtonElement>(".a")!.click();
    press(" ");
    press("ArrowLeft");
    const pad = g.stage.querySelector(".pad")!;
    pointer(pad, "pointerdown", 100, 100);
    pointer(pad, "pointerup", 100, 160);
    pointer(pad, "pointerdown", 100, 100);
    pointer(pad, "pointerup", 110, 105);
    expect(got).toEqual(["tap", "space", "left", "down"]);

    const done = vi.fn();
    const cancel = vi.fn();
    const target = g.stage.querySelector(".a")!;
    g.hold(target, { ms: 500, done, cancel });
    pointer(target, "pointerdown", 0, 0);
    expect(target.classList.contains("holding")).toBe(true);
    await frames(200);
    pointer(target, "pointerup", 0, 0);
    expect(cancel).toHaveBeenCalledTimes(1);
    pointer(target, "pointerdown", 0, 0);
    await frames(600);
    expect(done).toHaveBeenCalledTimes(1);
    void g.end();
    press(" ");
    expect(got.filter((x) => x === "space")).toHaveLength(1);
  });

  it("drops an item on a slot by tapping one and then the other", async () => {
    const CF = await boot();
    const g = CF.game.create(root());
    g.stage.innerHTML = '<button class="item" data-id="key">Key</button><div class="slot" data-id="lock">Lock</div>';
    const drops: string[] = [];
    g.drag({ items: ".item", slots: ".slot", drop: (i, s) => drops.push(`${i.getAttribute("data-id")}→${s.getAttribute("data-id")}`) });
    await g.start();
    const item = g.stage.querySelector<HTMLElement>(".item")!;
    item.click();
    expect(item.getAttribute("aria-pressed")).toBe("true");
    g.stage.querySelector<HTMLElement>(".slot")!.click();
    expect(drops).toEqual(["key→lock"]);
    expect(item.getAttribute("aria-pressed")).toBe("false");
  });

  it("builds boards of labelled buttons, and moves sprites that collide", async () => {
    const CF = await boot();
    const g = CF.game.create(root());
    const grid = g.grid({ cols: 3, rows: 2, label: "Board", cell: (x: number, y: number) => (x === 1 && y === 1 ? { html: "★", label: "Star" } : "") });
    expect(grid.el.querySelectorAll("button.cf-game-cell")).toHaveLength(6);
    expect(grid.el.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.cell(1, 1).getAttribute("aria-label")).toBe("Star");
    expect(grid.cell(0, 0).getAttribute("aria-label")).toBe("Row 1, column 1");
    const taps: string[] = [];
    grid.onTap((x, y) => taps.push(`${x},${y}`));
    await g.start();
    grid.cell(2, 1).click();
    grid.set(2, 1, "x", "Crossed");
    expect(taps).toEqual(["2,1"]);
    expect(grid.cell(2, 1).getAttribute("aria-label")).toBe("Crossed");

    const a = g.sprite({ x: 0, y: 0, w: 10, h: 10, vx: 100 });
    const b = g.sprite({ x: 30, y: 0, w: 10, h: 10 });
    expect(a.hits(b)).toBe(false);
    a.step(250);
    expect(a.x).toBe(25);
    expect(a.el.style.transform).toBe("translate(25.0px,0.0px)");
    expect(a.hits(b)).toBe(true);
    expect(CF.game.hit({ x: 0, y: 0, w: 5, h: 5 }, { x: 6, y: 0, w: 5, h: 5 })).toBe(false);

    const combo = g.combo();
    for (let i = 0; i < 5; i++) combo.hit();
    combo.miss();
    combo.hit();
    expect([combo.count, combo.best, combo.mult()]).toEqual([1, 5, 1]);
    expect(g.addScore(15)).toBe(15);
    expect(g.hud.querySelector(".cf-game-score")!.textContent).toBe("15");
  });
});

describe("templates", () => {
  const app = async (m: EngineModule) => {
    const CF = await boot({}, []);
    tavern.vars[0] = { stat_data: { Player: { Lockpicking: 3, Hacking: 3, Coins: 50, Gambling: 2, Wits: 3, Reflexes: 3 }, Story: { Tension: 30 } }, delta_data: {} };
    const a = CF.frame(window);
    new Function("CF", "app", "root", "settings", m.js)(CF, a, root(), structuredClone(m.settings));
    await frames(50);
    return root().querySelector<HTMLElement>(".cf-game")!;
  };
  const template = (id: string) => MINIGAME_TEMPLATES.find((t) => t.id === id)!;

  it("each one starts on its own, with its difficulty value, a result rule and its words in settings", async () => {
    expect(MINIGAME_TEMPLATES.map((t) => t.id)).toEqual(["lockpicking", "hacking", "card-game", "matching", "timed-choice", "quick-time"]);
    for (const t of MINIGAME_TEMPLATES) {
      document.body.innerHTML = '<textarea id="send_textarea"></textarea><div id="root"></div>';
      const game = await app(t);
      expect(game.classList.contains("playing"), t.id).toBe(true);
      expect(t.rules[0].keys).toEqual(['app="minigame"']);
      expect(t.vars.length).toBeGreaterThan(0);
      expect(EXAMPLES).toContain(t);
      const c: EngineConfig = { ...newEngine(), modules: [{ ...t, tags: [] }] };
      expect(lintConfig(c).filter((f) => f.level !== "info"), t.id).toEqual([]);
      vi.useRealTimers();
    }
  });

  it("the breach can be won by tapping the sequence, and its result reaches the story", async () => {
    const game = await app(template("hacking"));
    const seq = [...game.querySelectorAll(".hk-seq span")].map((s) => s.textContent);
    for (const code of seq) {
      const cell = [...game.querySelectorAll<HTMLButtonElement>(".cf-game-cell")].find((c) => c.textContent === code && !c.disabled)!;
      cell.click();
    }
    await frames(10);
    expect(game.querySelector(".cf-game-result h2")!.textContent).toBe("Success");
    expect(input()).toMatch(/^<action app="minigame">\{"game":"hacking","outcome":"win","score":\d+\}<\/action>\n\{\{user\}\} breached the system/);
  });

  it("a timed choice sends the chosen line, and hesitating sends the timeout", async () => {
    let game = await app(template("timed-choice"));
    game.querySelectorAll<HTMLButtonElement>("[data-i]")[1].click();
    await frames(10);
    expect(input()).toContain("{{user}} went back for Mina");
    expect(game.querySelector(".cf-game-result h2")!.textContent).toBe("Reach for Mina");
    vi.useRealTimers();
    document.body.innerHTML = '<textarea id="send_textarea"></textarea><div id="root"></div>';
    game = await app(template("timed-choice"));
    await frames(10000);
    expect(game.querySelector(".cf-game-result h2")!.textContent).toBe("Too slow");
    expect(input()).toContain("{{user}} froze");
  });
});

describe("the engineer and the player", () => {
  it("the lint catches a game that never starts or ends, or keeps its own loop and luck", () => {
    const m: EngineModule = {
      ...MINIGAME_TEMPLATES[0],
      id: "bad-game",
      js: "var g = app.game(root, {}); requestAnimationFrame(function(){}); if (Math.random() > 0.5) setTimeout(function(){}, 10);",
    };
    const found = lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.check === "game").map((f) => [f.level, f.message]);
    expect(found).toEqual([
      ["error", "bad-game: the game is made but never started: call g.start()."],
      ["warn", "bad-game: the game never calls g.end(), so its result never reaches the story (a timer that runs out ends it as a loss)."],
      ["warn", "bad-game: runs its own requestAnimationFrame loop; use g.loop, which stops while the game is paused or the screen is hidden."],
      ["warn", "bad-game: uses Math.random; use g.rand, g.int, g.pick or g.shuffle, which follow the game's seed."],
      ["warn", "bad-game: uses setTimeout or setInterval; use g.after or g.every, which keep game time and pause with the game."],
    ]);
  });

  it("has docs, a skill, and the skip choice in the player's settings app", () => {
    const doc = readDoc("core-api#minigames-cf-game");
    expect(doc).toContain("g.tune(easy, hard)");
    expect(doc).toContain('<action app="minigame">');
    expect(readDoc("core-api#types-d-ts")).toContain('minigames: "play" | "skip"');
    expect(BUILT_IN_SKILLS.find((s) => s.id === "build-a-minigame")!.title).toBe("Build a minigame");
    expect(settingsAppModule().js).toContain('data-setting="minigames"');
  });
});
