import { describe, expect, it, vi } from "vitest";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc, searchDocs } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { scriptSource } from "../../engine/runtime";
import artSource from "../../engine/runtime/art.js?raw";
import gameSource from "../../engine/runtime/game.js?raw";
import liveSource from "../../engine/runtime/live.js?raw";
import moodSource from "../../engine/runtime/mood.js?raw";
import sceneSource from "../../engine/runtime/scene.js?raw";
import coreSource from "../../engine/runtime/core.js?raw";
import fxSource from "../../engine/runtime/fx.js?raw";
import { readFileSync } from "node:fs";
import { newEngine, settingsSource } from "../../engine/sheet";

const kitCss = readFileSync("src/engine/runtime/kit.css", "utf8");

interface Art {
  rng(seed: unknown): () => number;
  noise(seed: unknown): ((x: number, y?: number) => number) & { fbm(x: number, y?: number, o?: number): number };
  chart(kind: string, data: unknown[], o?: Record<string, unknown>): string;
  gauge(o: Record<string, unknown>): string;
  frame(html: string, o?: unknown): string;
  divider(kind?: string): string;
  sigil(seed: string, o?: Record<string, unknown>): string;
  mapImage(o?: Record<string, unknown>): string;
  pattern(kind: string, o?: Record<string, unknown>): string;
  noiseTexture(o?: Record<string, unknown>): string;
  sky(time: string): string;
  noiseImage(o?: Record<string, unknown>): string;
  canvas(el: Element, o?: Record<string, unknown>): unknown;
  url(svg: string): string;
  themeColor(name: string, el?: Element): string;
}

/** The art kit with the engine core's escaping, as the card script has them. */
const art = new Function(
  "CF_CONFIG",
  "getVariables",
  "updateVariablesWith",
  "eventOn",
  "eventRemoveListener",
  "eventEmit",
  `${fxSource}\n${artSource}\n${sceneSource}\n${moodSource}\n${gameSource}\n${liveSource}\n${coreSource}\nreturn { cfArt, api: CardForgeApi };`,
)({ version: "t", theme: { mode: "dark", dark: "", light: "" }, kit: kitCss, modules: [] }, () => ({}), async () => ({}), () => {}, () => {}, async () => {}) as {
  cfArt: Art;
  api: Record<string, unknown>;
};
const A = art.cfArt;

const parse = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};
/** The SVG inside a data URL, parsed as XML: it must be well-formed to show as an image. */
const svgOf = (url: string) => {
  const text = decodeURIComponent(url.replace(/^url\('/, "").replace(/'\)$/, "").replace(/^data:image\/svg\+xml,/, ""));
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc.documentElement;
};

describe("seeds and noise", () => {
  it("gives the same numbers for the same seed, and different ones for another", () => {
    const a = A.rng("Saltreach");
    const b = A.rng("Saltreach");
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    expect(A.rng("Other")()).not.toBe(seq[0]);
    for (const n of seq) expect(n >= 0 && n < 1).toBe(true);
    const noise = A.noise(7);
    expect(noise(1.5, 2.25)).toBe(A.noise(7)(1.5, 2.25));
    const samples = Array.from({ length: 50 }, (_, i) => noise.fbm(i * 0.13, i * 0.07, 4));
    for (const v of samples) expect(v >= 0 && v <= 1).toBe(true);
    // Smooth: neighbours are close.
    expect(Math.abs(noise(3.0, 1) - noise(3.01, 1))).toBeLessThan(0.05);
  });
});

describe("charts and gauges", () => {
  it("draws bars that fit a phone, escaping labels, with values read aloud", () => {
    const root = parse(A.chart("bar", [{ label: "<b>Str</b>", value: 15 }, { label: "Dex", value: 5 }], { max: 20, title: "Stats" }));
    const bars = root.querySelectorAll(".cf-art-bar");
    expect(bars).toHaveLength(2);
    expect(root.querySelector("b b")).toBeNull();
    expect((bars[0].querySelector(".cf-art-bar-track i") as HTMLElement).style.width).toBe("75%");
    expect(root.firstElementChild!.getAttribute("aria-label")).toBe("Stats: <b>Str</b> 15, Dex 5");
    expect(parse(A.chart("bar", [])).textContent).toBe("No data yet");
  });

  it("draws lines, sparks, donuts and radars as SVG", () => {
    const line = parse(A.chart("line", [3, 7, 5]));
    expect(line.querySelector("polyline.cf-art-stroke")!.getAttribute("points")!.split(" ")).toHaveLength(3);
    expect(parse(A.chart("spark", [1, 2, 3])).querySelector("svg.cf-art-spark polyline")).not.toBeNull();
    const donut = parse(A.chart("donut", [{ label: "Rope", value: 1 }, { label: "Bread", value: 3 }], { center: "4" }));
    const segs = donut.querySelectorAll(".cf-art-seg");
    expect([...segs].map((s) => s.getAttribute("stroke-dasharray"))).toEqual(["25 75", "75 25"]);
    expect(donut.querySelector(".cf-art-legend")!.textContent).toContain("Bread 3");
    const radar = parse(A.chart("radar", [{ label: "STR", value: 20 }, { label: "DEX", value: 10 }, { label: "INT", value: 0 }], { max: 20 }));
    expect(radar.querySelectorAll(".cf-art-grid")).toHaveLength(4);
    // STR at full reach straight up: 100 - 70.
    expect(radar.querySelector(".cf-art-shape")!.getAttribute("points")!.split(" ")[0]).toBe("100,30");
  });

  it("draws a dial that turns to danger when low", () => {
    const g = parse(A.gauge({ value: 10, max: 100, label: "Fuel", unit: "%", danger: 0.25 })).firstElementChild!;
    expect(g.getAttribute("role")).toBe("meter");
    expect(g.classList.contains("low")).toBe(true);
    expect(g.querySelector(".cf-art-gauge-danger")).not.toBeNull();
    expect(g.textContent).toContain("10 %");
    expect(parse(A.gauge({ value: 90, danger: 0.25 })).firstElementChild!.classList.contains("low")).toBe(false);
  });
});

describe("frames, dividers and emblems", () => {
  it("frames content with four drawn corners and a title", () => {
    const f = parse(A.frame("<p>Hi</p>", { kind: "tech", title: "Status" })).firstElementChild!;
    expect(f.className).toBe("cf-art-frame tech");
    expect(f.querySelectorAll(".cf-art-corner")).toHaveLength(4);
    expect(f.querySelector(".cf-art-frame-title")!.textContent).toBe("Status");
    expect(f.querySelector(".cf-art-frame-body p")!.textContent).toBe("Hi");
    expect(parse(A.frame("x", "nope")).firstElementChild!.className).toBe("cf-art-frame ornate");
    expect(parse(A.divider("circuit")).querySelector("svg")!.getAttribute("role")).toBe("separator");
  });

  it("draws the same crest for the same name", () => {
    expect(A.sigil("House Varn")).toBe(A.sigil("House Varn"));
    expect(A.sigil("House Varn")).not.toBe(A.sigil("Tide Guild"));
    const svg = parse(A.sigil("Order of Ash", { size: 40, color: "#e0a33a" })).querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Emblem of Order of Ash");
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.querySelectorAll(".cf-art-sigil-arms g").length).toBeGreaterThanOrEqual(3);
  });
});

describe("pictures: maps, patterns, noise and skies", () => {
  it("draws island, dungeon and city maps as well-formed SVG, the same for the same seed", () => {
    const places = [{ x: 20, y: 60 }, { x: 50, y: 45 }, { x: 75, y: 25 }];
    for (const kind of ["island", "dungeon", "city"]) {
      const url = A.mapImage({ kind, seed: "Saltreach", places });
      expect(url).toMatch(/^data:image\/svg\+xml,/);
      expect(url).not.toMatch(/['"()]/);
      expect(url).toBe(A.mapImage({ kind, seed: "Saltreach", places }));
      expect(url).not.toBe(A.mapImage({ kind, seed: "Elsewhere", places }));
      expect(svgOf(url).getAttribute("viewBox")).toBe("0 0 400 300");
    }
    // The dungeon has a room at each place.
    const rooms = svgOf(A.mapImage({ kind: "dungeon", seed: "crypt", places })).querySelectorAll('rect[stroke-width="1.5"]');
    expect(rooms.length).toBe(places.length + 4);
    // A palette, or colours of the author's own (escaped).
    expect(decodeURIComponent(A.mapImage({ palette: "neon" }))).toContain("#07070f");
    expect(svgOf(A.mapImage({ colors: { sea: '"><script>' } })).querySelector("script")).toBeNull();
  });

  it("makes CSS backgrounds that fit in a style attribute", () => {
    for (const kind of ["dots", "grid", "stripes", "checks", "diamonds", "waves", "crosshatch", "hex", "nope"]) {
      const bg = A.pattern(kind, { size: 20, color: "rgba(0,0,0,.2)" });
      expect(bg).toMatch(/^url\('data:image\/svg\+xml,[^'"()]+'\)$/);
      svgOf(bg);
    }
    expect(svgOf(A.pattern("hex", { size: 20 })).getAttribute("width")).toBe("30");
    const el = document.createElement("div");
    el.setAttribute("style", `background: ${A.noiseTexture({ scale: 0.05, seed: "fog" })}`);
    expect(el.getAttribute("style")).toContain("feTurbulence");
    expect(A.noiseTexture({ seed: "a" })).not.toBe(A.noiseTexture({ seed: "b" }));
  });

  it("gives a sky for each part of the day", () => {
    expect(A.sky("Night")).toContain("radial-gradient");
    expect(A.sky("23:10")).toBe(A.sky("night"));
    expect(A.sky("Morning")).toContain("#b06a8f");
    expect(A.sky("14:00")).toBe(A.sky("Afternoon"));
    expect(A.sky("Evening")).toContain("#c0504d");
    expect(A.sky("")).toBe(A.sky("noon"));
  });

  it("falls back quietly where there is no canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(A.noiseImage({ seed: 1 })).toBe("");
    expect(A.canvas(document.createElement("div"))).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("wiring, docs and examples", () => {
  it("ships in the card script and reaches screens as CF.art and app.art", () => {
    const source = scriptSource(settingsSource(newEngine()));
    expect(source.indexOf("var cfArt = {")).toBeGreaterThan(source.indexOf("var cfFx = {"));
    expect(source.indexOf("var cfArt = {")).toBeLessThan(source.indexOf("var CardForgeApi = {"));
    expect(art.api.art).toBe(A);
    expect(coreSource).toMatch(/fx: cfFx,\n\s+art: cfArt,/);
    expect(artSource).not.toMatch(/<\/script/i);
    expect(kitCss).toContain(".cf-art-frame");
  });

  it("is documented where the engineer searches, with a skill and examples that lint clean and run", () => {
    const doc = readDoc("core-api#procedural-art-cf-art")!;
    for (const name of ["chart", "gauge", "frame", "divider", "sigil", "mapImage", "pattern", "noiseTexture", "sky", "noiseImage", "canvas", "rng", "noise", "themeColor"])
      expect(doc, name).toContain(`CF.art.${name}`);
    expect(readDoc("core-api")).toContain("interface Art {");
    expect(searchDocs("procedural map island")[0]?.id).toBe("core-api#procedural-art-cf-art");
    expect(BUILT_IN_SKILLS.find((s) => s.id === "procedural-art")?.text).toMatch(/Seed with something stable/);
    for (const id of ["world-map", "stat-chart"]) {
      const m = EXAMPLES.find((e) => e.id === id)!;
      expect(lintConfig({ ...newEngine(), modules: [m] }).filter((f) => f.level !== "info"), id).toEqual([]);
      const root = document.createElement("div");
      const state: Record<string, unknown> = {
        World: { Location: "Old Harbor", PartOfDay: "Night" },
        Stats: { Attributes: { STR: 12, DEX: 15, INT: 9 }, Stamina: 15, GoldLog: ["40", "55", "30"] },
      };
      const CF = {
        art: A,
        ui: { esc: (s: unknown) => String(s ?? ""), map: (o: { pins: { label: string; here?: boolean }[]; image: string }) => `<div class="cf-map" data-image="${o.image.slice(0, 30)}">${o.pins.map((p) => `<button${p.here ? ' class="here"' : ""}>${p.label}</button>`).join("")}</div>` },
      };
      const app = { state: (path: string) => state[path], onState: () => {} };
      new Function("CF", "app", "root", "settings", m.js)(CF, app, root, {});
      if (id === "world-map") {
        expect(root.querySelector(".cf-map")!.getAttribute("data-image")).toMatch(/^data:image\/svg/);
        expect(root.querySelector(".here")!.textContent).toBe("Old Harbor");
        expect(root.querySelectorAll(".cf-art-sigil")).toHaveLength(3);
        expect((root.querySelector(".wm-sky") as HTMLElement).getAttribute("style")).toContain("radial-gradient");
      } else {
        expect(root.querySelector(".cf-art-radar")).not.toBeNull();
        expect(root.querySelector(".cf-art-gauge.low")).not.toBeNull();
        expect(root.querySelector(".cf-art-spark")).not.toBeNull();
        expect(root.textContent).toContain("30");
      }
    }
  });
});
