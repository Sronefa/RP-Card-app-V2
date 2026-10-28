import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_SKILLS, readDoc, searchDocs } from "../../engine/engineer/knowledge";
import { EXAMPLES } from "../../engine/engineer/examples";
import { animatesLayout, lintConfig } from "../../engine/engineer/lint";
import { settingsAppModule } from "../../engine/modules/settingsApp";
import type { EngineModule } from "../../engine/modules/types";
import { scriptSource } from "../../engine/runtime";
import coreSource from "../../engine/runtime/core.js?raw";
import artSource from "../../engine/runtime/art.js?raw";
import sceneSource from "../../engine/runtime/scene.js?raw";
import fxSource from "../../engine/runtime/fx.js?raw";
import kitCss from "../../engine/runtime/kit.css?raw";
import { newEngine, settingsSource } from "../../engine/sheet";

let stored: Record<string, unknown> = {};

interface Core {
  cfUi: Record<string, (...args: never[]) => string>;
  cfFx: Record<string, (...args: never[]) => unknown>;
  cfFrame: (win: Window) => Record<string, (...args: never[]) => unknown>;
  cfStyle: (doc: Document) => void;
}

/** The engine core and effects kit, with the few Tavern Helper calls they make stubbed. */
function loadCore(): Core {
  const config = { version: "test", theme: { mode: "dark", dark: "--cf-bg: #111", light: "--cf-bg: #fff" }, kit: kitCss, modules: [] };
  return new Function(
    "CF_CONFIG",
    "getVariables",
    "updateVariablesWith",
    "eventOn",
    "eventRemoveListener",
    "eventEmit",
    `${fxSource}\n${artSource}\n${sceneSource}\n${coreSource}\nreturn { cfUi, cfFx, cfFrame, cfStyle };`,
  )(
    config,
    () => ({ cardforge: { settings: stored } }),
    async () => ({}),
    () => {},
    () => {},
    async () => {},
  ) as Core;
}

let core: Core;
const ui = () => core.cfUi as unknown as Record<string, (o?: unknown, p?: unknown) => string>;
const fx = () => core.cfFx as unknown as Record<string, (...a: unknown[]) => unknown>;
const mount = (html: string) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
};

beforeEach(() => {
  stored = { motion: "full" };
  core = loadCore();
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

describe("the new CF.ui pieces", () => {
  it("draws a progress ring as a meter", () => {
    const root = mount(ui().ring({ value: 5, max: 10, label: "Energy" }));
    const ring = root.querySelector(".cf-ring")!;
    expect(ring.getAttribute("role")).toBe("meter");
    expect(ring.getAttribute("aria-valuenow")).toBe("5");
    const fill = root.querySelector(".cf-ring-fill")!;
    const len = Number(fill.getAttribute("stroke-dasharray"));
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(len / 2, 1);
    expect(root.textContent).toContain("Energy");
  });

  it("makes a visual-novel box, escaping the text, with choices that act", () => {
    const html = ui().dialogue({ name: "Mina <3", text: "You <b>came</b> back.", portrait: "mina.png", side: "right", choices: [{ label: "Of course", send: "talk", payload: { say: "yes" } }] });
    const root = mount(html);
    expect(root.querySelector(".cf-vn.right .cf-vn-portrait")).not.toBeNull();
    expect(root.querySelector(".cf-vn-name")!.textContent).toBe("Mina <3");
    expect(root.querySelector(".cf-vn-text b")).toBeNull();
    expect(root.querySelector('.cf-vn-choices [data-cf-send="talk"]')!.getAttribute("data-cf-payload")).toBe('{"say":"yes"}');
    expect(mount(ui().dialogue({ text: "…" })).querySelector(".cf-vn.no-portrait")).not.toBeNull();
  });

  it("puts pins on a map, clamped, with the player's place marked and locked ones off", () => {
    const root = mount(
      ui().map({
        pins: [
          { label: "Harbor", x: 30, y: 60, here: true },
          { label: "Tower", x: 140, y: -5, send: "travel", payload: { to: "Tower" } },
          { label: "Cave", x: 10, y: 10, locked: true },
        ],
      }),
    );
    const pins = [...root.querySelectorAll<HTMLButtonElement>(".cf-pin")];
    expect(root.querySelector(".cf-map.plain")).not.toBeNull();
    expect(pins[0].getAttribute("aria-label")).toBe("Harbor, you are here");
    expect([pins[1].style.left, pins[1].style.top]).toEqual(["100%", "0%"]);
    expect(pins[1].getAttribute("data-cf-send")).toBe("travel");
    expect(pins[2].disabled).toBe(true);
  });

  it("lays out a timeline with done and current steps", () => {
    const root = mount(ui().timeline([{ title: "Met Mina", time: "Day 1", done: true }, { title: "Festival", current: true }]));
    const items = root.querySelectorAll(".cf-tl-item");
    expect(items[0].classList.contains("done")).toBe(true);
    expect(items[1].getAttribute("aria-current")).toBe("step");
  });

  it("flips cards and moves carousels by themselves in a frame", () => {
    const root = mount(ui().flip({ front: "?", back: "The Tower", label: "Fortune" }) + ui().carousel(["<p>A</p>", "<p>B</p>", "<p>C</p>"], { label: "Places" }));
    core.cfFrame(window);
    const card = root.querySelector<HTMLElement>("[data-cf-flip]")!;
    card.click();
    expect(card.classList.contains("flipped")).toBe(true);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    card.click();
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelectorAll(".cf-slide")).toHaveLength(3);
    root.querySelector<HTMLElement>('[data-cf-slide="1"]')!.click();
    expect(root.querySelector('[data-cf-slide-to="1"]')!.getAttribute("aria-current")).toBe("true");
    root.querySelector<HTMLElement>('[data-cf-slide-to="2"]')!.click();
    expect(root.querySelector('[data-cf-slide-to="0"]')!.hasAttribute("aria-current")).toBe(false);
    expect(root.querySelector('[data-cf-slide-to="2"]')!.getAttribute("aria-current")).toBe("true");
  });

  it("opens toasts, modals and drawers on the screen, closed by Escape, the backdrop or a close button", () => {
    const app = core.cfFrame(window) as unknown as Record<string, (...a: unknown[]) => HTMLElement & { close(): void }>;
    expect(app.toast("Saved", { kind: "good", icon: "check" }).className).toBe("cf-toast good");
    app.modal("<p>Sure?</p>", { title: "Leave town" });
    expect(document.querySelector('.cf-modal[aria-label="Leave town"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".cf-modal")).toBeNull();
    const drawer = app.drawer("<p>Bag</p>", { side: "bottom", title: "Bag" });
    expect(document.querySelector(".cf-drawer.bottom")).not.toBeNull();
    drawer.querySelector<HTMLElement>("[data-cf-close]")!.click();
    expect(document.querySelector(".cf-drawer")).toBeNull();
    const plain = app.modal("<p>x</p>");
    plain.click();
    expect(document.querySelector(".cf-modal")).toBeNull();
  });
});

describe("CF.fx", () => {
  it("puts particles over an element, by kind or by weather word, and stops them", () => {
    const root = mount("");
    const stop = fx().particles(root, "snow", { count: 12 }) as () => void;
    expect(root.querySelectorAll(".cf-fx-snow i")).toHaveLength(12);
    expect(root.querySelector(".cf-fx-layer")!.getAttribute("aria-hidden")).toBe("true");
    stop();
    expect(root.querySelector(".cf-fx-layer")).toBeNull();
    (fx().weather(root, "Heavy rain") as () => void);
    expect(root.querySelectorAll(".cf-fx-rain i").length).toBeGreaterThan(46);
    expect(typeof fx().weather(root, "clear skies")).toBe("function");
    expect(root.querySelectorAll(".cf-fx-layer")).toHaveLength(1);
    expect(fx().particles(root, "lasers")).toBeTypeOf("function");
  });

  it("types a line, pausing at sentence ends, and a tap shows the rest", async () => {
    vi.useFakeTimers();
    const el = mount("");
    const typed = fx().typewriter(el, "Hi. You", { speed: 10 }) as { done: Promise<void> };
    expect(el.textContent).toBe("H");
    vi.advanceTimersByTime(10);
    expect(el.textContent).toBe("Hi");
    vi.advanceTimersByTime(10);
    expect(el.textContent).toBe("Hi.");
    // A beat after the full stop.
    vi.advanceTimersByTime(50);
    expect(el.textContent).toBe("Hi.");
    el.click();
    expect(el.textContent).toBe("Hi. You");
    await typed.done;
    expect(el.classList.contains("cf-fx-typing")).toBe(false);
  });

  it("holds still when the player wants less motion", async () => {
    stored = { motion: "reduce" };
    const el = mount("<span>3</span>");
    expect(fx().reduced(el)).toBe(true);
    fx().particles(el, "embers");
    fx().parallax(el);
    expect(el.querySelector(".cf-fx-layer")).toBeNull();
    fx().typewriter(el, "All at once.");
    expect(el.textContent).toBe("All at once.");
    await fx().countUp(el, 120, { format: (n: number) => `${n} gold` });
    expect(el.textContent).toBe("120 gold");
    await fx().transition(el, "<b>next</b>", "left");
    expect(el.innerHTML).toBe("<b>next</b>");
    await fx().shake(el);
    core.cfStyle(document);
    expect(document.body.classList.contains("cf-reduce-motion")).toBe(true);
    stored = { motion: "full" };
    core.cfStyle(document);
    expect(document.body.classList.contains("cf-reduce-motion")).toBe(false);
  });

  it("glows and pulses until stopped", () => {
    const el = mount("<button>Go</button>").firstElementChild as HTMLElement;
    const off = fx().glow(el, { color: "gold" }) as () => void;
    const still = fx().pulse(el) as () => void;
    expect(el.className).toBe("cf-fx-glow cf-fx-pulse");
    off();
    still();
    expect(el.className).toBe("");
  });

  it("ships in the card script, which still parses", () => {
    const source = scriptSource(settingsSource(newEngine()));
    expect(source).toContain("var cfFx = {");
    expect(source).toContain("fx: cfFx,");
    expect(() => new Function(source)).not.toThrow();
  });
});

describe("motion in the lint, the settings app, the docs and the examples", () => {
  const withModule = (m: Partial<EngineModule>) => ({ ...newEngine(), modules: [{ ...EXAMPLES[2], id: "m", vars: [], rules: [], ...m } as EngineModule] });
  const motion = (m: Partial<EngineModule>) => lintConfig(withModule(m)).filter((f) => f.check === "motion").map((f) => f.message);

  it("flags layout animation and script animation that ignores less motion", () => {
    expect(animatesLayout(".a { transition: width .3s; }")).toBe(true);
    expect(animatesLayout("@keyframes slide { from { left: 0; } to { left: 100px; } }")).toBe(true);
    expect(animatesLayout("@keyframes in { from { opacity: 0; transform: translateY(4px); } } .a { transition: opacity .2s, transform .2s; }")).toBe(false);
    expect(motion({ css: ".bar { transition: height 1s; }" })[0]).toMatch(/animates layout/);
    expect(motion({ js: "root.firstChild.animate([{ opacity: 0 }, { opacity: 1 }], 300);" })[0]).toMatch(/CF.fx.reduced/);
    expect(motion({ js: "if (!CF.fx.reduced(root)) root.firstChild.animate([{ opacity: 0 }, { opacity: 1 }], 300);" })).toEqual([]);
  });

  it("lets the player pick less motion", () => {
    expect(settingsAppModule().js).toContain('data-setting="motion"');
  });

  it("documents every piece where the engineer searches, with examples that lint clean", () => {
    const doc = readDoc("core-api#effects-cf-fx")!;
    for (const name of ["particles", "weather", "shake", "flash", "glow", "pulse", "typewriter", "countUp", "transition", "parallax", "reduced"]) expect(doc).toContain(`CF.fx.${name}`);
    const kit = readDoc("core-api#ui-kit")!;
    for (const name of ["ring", "carousel", "dialogue", "map", "timeline", "flip"]) expect(kit).toContain(`CF.ui.${name}(`);
    for (const name of ["app.toast", "app.modal", "app.drawer"]) expect(kit).toContain(name);
    expect(searchDocs("typewriter dialogue")[0]?.id).toMatch(/^core-api/);
    for (const id of ["vn-scene", "journey-app"]) {
      const m = EXAMPLES.find((e) => e.id === id)!;
      expect(() => new Function("CF", "app", "root", "settings", m.js)).not.toThrow();
      const findings = lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.level !== "info");
      expect(findings).toEqual([]);
    }
    expect(BUILT_IN_SKILLS.length).toBeGreaterThan(0);
  });
});
