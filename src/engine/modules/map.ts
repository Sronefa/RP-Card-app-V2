/**
 * Kit part (Fantasy RPG, Dark fantasy, Isekai): the world map. Places joined by roads, drawn as a
 * map the player taps; where {{user}} is now; places discovered as {{user}} travels (the rest stay in
 * the fog); and travel along the roads, with the hours it takes and the danger on the way. The
 * engine keeps the discovered places and what's nearby up to date; the model plays the journey.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface MapPlace {
  name: string;
  region: string;
  description: string;
  /** 0 safe, 1 some risk, 2 dangerous, 3 deadly. */
  danger: number;
  /** Places a road joins it to, comma-separated. */
  links: string;
  /** Where it's drawn, 0 to 100 across and down; -1 to place it by itself. */
  x: number;
  y: number;
}

export interface MapSettings {
  title: string;
  button: string;
  /** A card image under the map; empty for the theme's own. */
  art: string;
  places: MapPlace[];
  /** Where {{user}} starts; empty for the first place. */
  start: string;
  /** In-game hours a road between two places takes. */
  hours: number;
  /** Places stay hidden until {{user}} reaches one next to them. */
  fog: boolean;
  /** The travel button's word: "Travel", or "Jump" on a star chart. */
  verb: string;
  /** What {{user}} says on setting out, with {place}. */
  go: string;
}

export const DANGER = ["Safe", "Some risk", "Dangerous", "Deadly"];

export const defaultMapSettings = (): MapSettings => ({
  title: "Map",
  button: "🗺️ Map",
  art: "",
  places: [
    { name: "Oakvale", region: "The Vale", description: "A farming village with a guild hall and a loud tavern.", danger: 0, links: "Old Mill, Whispering Woods, King's Road", x: 30, y: 62 },
    { name: "Old Mill", region: "The Vale", description: "A creaking watermill; wolves have been seen at night.", danger: 1, links: "Oakvale", x: 12, y: 80 },
    { name: "Whispering Woods", region: "The Vale", description: "Old trees that talk in the wind. Paths shift.", danger: 2, links: "Oakvale, Ruined Keep", x: 22, y: 30 },
    { name: "Ruined Keep", region: "The Wilds", description: "A broken fortress. Something nests in the cellars.", danger: 3, links: "Whispering Woods", x: 12, y: 8 },
    { name: "King's Road", region: "The Crownlands", description: "A paved road with a toll fort halfway.", danger: 1, links: "Oakvale, Highcrown", x: 58, y: 52 },
    { name: "Highcrown", region: "The Crownlands", description: "The capital: markets, temples and intrigue.", danger: 0, links: "King's Road", x: 84, y: 30 },
  ],
  start: "",
  hours: 3,
  fog: true,
  verb: "Travel",
  go: "I set out for {place}.",
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

export function mapSettings(raw: Record<string, unknown> | undefined): MapSettings {
  const base = defaultMapSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    art: str(raw.art),
    places: Array.isArray(raw.places)
      ? rows(raw.places).map((p) => ({
          name: str(p.name),
          region: str(p.region),
          description: str(p.description),
          danger: Math.max(0, Math.min(3, Math.round(num(p.danger, 0)))),
          links: str(p.links),
          x: Math.max(-1, Math.min(100, num(p.x, -1))),
          y: Math.max(-1, Math.min(100, num(p.y, -1))),
        }))
      : base.places,
    start: str(raw.start),
    hours: Math.max(0, Math.min(240, num(raw.hours, base.hours))),
    fog: raw.fog !== false,
    verb: str(raw.verb, base.verb).trim() || base.verb,
    go: str(raw.go, base.go).trim() || base.go,
  };
}

/** Named places with both-way roads and a spot on the map each (on a ring when not set). */
function usable(s: MapSettings) {
  const places = s.places.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim() }));
  const names = new Set(places.map((p) => p.name));
  const roads = new Map(places.map((p) => [p.name, new Set<string>()]));
  for (const p of places)
    for (const to of p.links.split(",").map((x) => x.trim()))
      if (names.has(to) && to !== p.name) {
        roads.get(p.name)!.add(to);
        roads.get(to)!.add(p.name);
      }
  const placed = places.map((p, i) => {
    if (p.x >= 0 && p.y >= 0) return p;
    const a = (i / Math.max(1, places.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: Math.round(50 + 38 * Math.cos(a)), y: Math.round(50 + 40 * Math.sin(a)) };
  });
  const start = names.has(s.start.trim()) ? s.start.trim() : (places[0]?.name ?? "");
  return { ...s, start, places: placed.map((p) => ({ ...p, roads: [...roads.get(p.name)!] })) };
}
type Live = ReturnType<typeof usable>;

function mapVars(s: Live): EngineVar[] {
  const first = s.places.find((p) => p.name === s.start);
  const seen = s.fog ? [s.start, ...(first?.roads ?? [])].filter(Boolean) : s.places.map((p) => p.name);
  return [
    newVar({ id: "map-location", group: "Map", name: "Location", type: "text", start: s.start, rule: "Where {{user}} is, by the map's place names. Set it when {{user}} arrives somewhere; use a short new name for a place off the map." }),
    newVar({ id: "map-discovered", group: "Map", name: "Discovered", type: "list", start: seen.join(", "), pinned: false, rule: "Places {{user}} knows of. The engine adds where {{user}} goes and the roads from there; insert one when {{user}} hears of it." }),
    newVar({ id: "map-nearby", group: "Map", name: "Nearby", type: "list", start: "", readOnly: true, pinned: false, rule: "Places a road leads to from here, set by the engine." }),
  ];
}

function mapRules(s: Live): ModuleRule[] {
  const dangers = s.places.filter((p) => p.danger > 0).map((p) => `${p.name}: ${DANGER[p.danger].toLowerCase()}`);
  return [
    {
      comment: "Travel",
      content: [
        `<action app="map"> {"travel":P,"via":[…],"hours":H} is {{user}} setting out for P along the roads${s.hours ? ", about H in-game hours" : ""}.`,
        "Play the journey in a few beats: the road, the weather, who or what is met. Danger rises with the places passed through (0 safe to 3 deadly); a dangerous road can be interrupted by a fight, and the trip stops there.",
        "Move the clock by the time it took and set /Map/Location to where {{user}} ends up.",
        dangers.length ? `Danger: ${dangers.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      constant: false,
      keys: ['app="map"'],
      depth: 2,
      order: 100,
    },
  ];
}

const SCRIPT = String.raw`
var S = settings.live || settings;
function place(n) { return S.places.filter(function (p) { return p.name === n; })[0] || null; }
hooks.afterUpdate(function (stat, before, info) {
  var M = stat && stat.Map;
  if (!M || typeof M !== "object") return stat;
  var here = String(M.Location || "").trim();
  var seen = Array.isArray(M.Discovered) ? M.Discovered.slice() : [];
  var p = place(here);
  if (here && seen.indexOf(here) < 0) seen.push(here);
  if (p) p.roads.forEach(function (r) { if (seen.indexOf(r) < 0) seen.push(r); });
  M.Discovered = seen;
  M._Nearby = p ? p.roads.map(function (r) { return r + (S.hours ? " (" + S.hours + "h)" : ""); }) : [];
  var was = before && before.Map && before.Map.Location;
  if (before && info && info.latest && here && was && here !== was)
    setTimeout(function () { CF.bus.emit("notify", { title: "Arrived", text: here + (p && p.region ? ", " + p.region : ""), icon: "map", open: "map" }); }, 400);
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var picked = "";
function place(n) { return S.places.filter(function (p) { return p.name === n; })[0] || null; }
function here() { return String(app.state("Map.Location") || ""); }
function seen() { var v = app.state("Map.Discovered"); return Array.isArray(v) ? v : []; }
function shown(p) { return !S.fog || seen().indexOf(p.name) >= 0 || p.name === here(); }
// The shortest road from here, as the places after this one.
function route(to) {
  var from = here();
  if (!place(from) || from === to) return null;
  var prev = {}, queue = [from];
  prev[from] = "";
  while (queue.length) {
    var n = queue.shift();
    if (n === to) break;
    place(n).roads.forEach(function (r) { if (!(r in prev) && shown(place(r))) { prev[r] = n; queue.push(r); } });
  }
  if (!(to in prev)) return null;
  var path = [];
  for (var at = to; at && at !== from; at = prev[at]) path.unshift(at);
  return path;
}
function pips(d) {
  var out = "";
  for (var i = 0; i < 3; i++) out += '<i class="' + (i < d ? "on" : "") + '"></i>';
  return '<span class="mp-pips d' + d + '" aria-label="' + esc(["Safe", "Some risk", "Dangerous", "Deadly"][d]) + '">' + out + "</span>";
}
function svg() {
  var at = here();
  var lines = [], dots = [];
  S.places.forEach(function (p) {
    if (!shown(p)) return;
    p.roads.forEach(function (r) {
      var q = place(r);
      if (q && shown(q) && p.name < q.name) lines.push('<line x1="' + p.x + '" y1="' + p.y * 0.7 + '" x2="' + q.x + '" y2="' + q.y * 0.7 + '"/>');
    });
  });
  S.places.forEach(function (p) {
    if (!shown(p)) return;
    var cls = "mp-node d" + p.danger + (p.name === at ? " here" : "") + (p.name === picked ? " picked" : "");
    var anchor = p.x > 80 ? "end" : p.x < 20 ? "start" : "middle";
    dots.push('<g class="' + cls + '" data-place="' + esc(p.name) + '" role="button" tabindex="0" aria-label="' + esc(p.name) + '">' +
      (p.name === at ? '<circle class="mp-ring" cx="' + p.x + '" cy="' + p.y * 0.7 + '" r="4.2"/>' : "") +
      '<circle class="mp-dot" cx="' + p.x + '" cy="' + p.y * 0.7 + '" r="2.4"/><circle class="mp-hit" cx="' + p.x + '" cy="' + p.y * 0.7 + '" r="6"/>' +
      '<text x="' + p.x + '" y="' + (p.y * 0.7 + (p.y > 85 ? -4 : 6)) + '" text-anchor="' + anchor + '">' + esc(p.name) + "</text></g>");
  });
  return '<svg class="mp-svg" viewBox="-2 -4 104 78" preserveAspectRatio="xMidYMid meet"><g class="mp-roads">' + lines.join("") + "</g>" + dots.join("") + "</svg>";
}
function panel() {
  var name = picked || here();
  var p = place(name);
  if (!p) return name ? '<div class="cf-card"><span class="cf-label">You are at</span><b>' + esc(name) + "</b></div>" : "";
  var at = name === here();
  var path = at ? null : route(name);
  var hours = path ? path.length * S.hours : 0;
  var worst = path ? Math.max.apply(null, path.map(function (n) { return place(n).danger; })) : 0;
  return '<div class="cf-card mp-panel"><div class="cf-spread"><div><span class="cf-label">' + esc(p.region || (at ? "You are here" : "")) + "</span><h2>" + esc(p.name) + "</h2></div>" + pips(p.danger) + "</div>" +
    (p.description ? "<p>" + esc(p.description) + "</p>" : "") +
    (at ? '<p class="cf-small mp-here">' + ui.icon("compass") + " You are here</p>"
      : path ? '<button type="button" class="cf-btn primary mp-go" data-travel="' + esc(p.name) + '">' + ui.icon("map") + esc(S.verb) + (hours ? " · about " + hours + "h" : "") + (path.length > 1 ? " · via " + esc(path.slice(0, -1).join(", ")) : "") + "</button>" +
        (worst >= 2 ? '<p class="cf-small mp-warn">' + ui.icon("skull") + " The way is " + (worst > 2 ? "deadly" : "dangerous") + ".</p>" : "")
      : '<p class="cf-small cf-muted">No known road from here.</p>') + "</div>";
}
function draw() {
  var list = S.places.filter(shown);
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody cf-stack">' +
    '<div class="mp-board">' + (S.art ? '<img class="mp-art" alt="" src="' + esc(app.asset(S.art)) + '" onerror="this.remove()">' : "") + svg() + "</div>" +
    panel() +
    '<div class="mp-chips">' + list.map(function (p) { return '<button type="button" class="cf-chip' + (p.name === (picked || here()) ? " on" : "") + '" data-place="' + esc(p.name) + '">' + esc(p.name) + "</button>"; }).join("") + "</div>" +
    (S.fog && list.length < S.places.length ? '<p class="cf-small cf-muted">' + (S.places.length - list.length) + " places still in the fog.</p>" : "") + "</div>";
}
function pick(n) { picked = n === here() ? "" : n; draw(); }
root.addEventListener("click", function (e) {
  var b;
  if ((b = e.target.closest("[data-place]"))) return pick(b.getAttribute("data-place"));
  if ((b = e.target.closest("[data-travel]"))) {
    var to = b.getAttribute("data-travel"), path = route(to) || [to];
    app.send("map", { travel: to, via: path.slice(0, -1), hours: path.length * S.hours }, S.go.split("{place}").join(to)).then(function () { app.toast("In your message box: send it when you're ready"); });
  }
});
root.addEventListener("keydown", function (e) {
  var b = e.target.closest("g[data-place]");
  if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(b.getAttribute("data-place")); }
});
draw();
app.onState(function () { if (picked === here()) picked = ""; draw(); });
`;

const CSS = String.raw`
.mp-board { position: relative; border-radius: var(--cf-radius); overflow: hidden; border: 1px solid var(--cf-border);
  background: radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--cf-accent2) 18%, var(--cf-surface2)), var(--cf-surface2) 70%), var(--cf-texture); }
.mp-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .55; }
.mp-svg { position: relative; display: block; width: 100%; height: auto; }
.mp-roads line { stroke: var(--cf-muted); stroke-width: .6; stroke-dasharray: 1.6 1.2; opacity: .8; }
.mp-node { cursor: pointer; outline: none; }
.mp-dot { fill: var(--cf-surface); stroke: var(--cf-text); stroke-width: .6; transition: r .15s; }
.mp-node.d1 .mp-dot { fill: color-mix(in srgb, var(--cf-accent2) 60%, var(--cf-surface)); }
.mp-node.d2 .mp-dot { fill: color-mix(in srgb, var(--cf-bad) 55%, var(--cf-surface)); }
.mp-node.d3 .mp-dot { fill: var(--cf-bad); }
.mp-hit { fill: transparent; }
.mp-node text { font-size: 3.3px; fill: var(--cf-text); paint-order: stroke; stroke: var(--cf-surface2); stroke-width: .8px; font-family: var(--cf-heading); }
.mp-node.here .mp-dot { fill: var(--cf-accent); stroke: var(--cf-accent); }
.mp-node.here text { font-weight: 700; }
.mp-node.picked .mp-dot, .mp-node:focus-visible .mp-dot { stroke: var(--cf-accent); stroke-width: 1.2; }
.mp-ring { fill: none; stroke: var(--cf-accent); stroke-width: .5; transform-box: fill-box; transform-origin: center; animation: mp-ring 2s ease-out infinite; }
@keyframes mp-ring { from { transform: scale(.6); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
.mp-panel h2 { font-family: var(--cf-heading); font-size: 1.2em; }
.mp-panel p { margin-top: 6px; line-height: 1.45; }
.mp-go { margin-top: 10px; width: 100%; justify-content: center; min-height: 44px; }
.mp-here, .mp-warn { display: flex; align-items: center; gap: 6px; }
.mp-here .cf-icon, .mp-warn .cf-icon { width: 16px; height: 16px; }
.mp-here { color: var(--cf-accent); }
.mp-warn { color: var(--cf-bad); }
.mp-pips { display: flex; gap: 3px; }
.mp-pips i { width: 8px; height: 8px; border-radius: 50%; background: var(--cf-surface2); border: 1px solid var(--cf-border); }
.mp-pips.d1 i.on { background: var(--cf-accent2); }
.mp-pips.d2 i.on, .mp-pips.d3 i.on { background: var(--cf-bad); }
.mp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mp-chips .cf-chip { cursor: pointer; font: inherit; font-size: .85em; color: var(--cf-text); border: 1px solid var(--cf-border); min-height: 32px; }
.mp-chips .cf-chip.on { background: var(--cf-accent); border-color: var(--cf-accent); color: #fff; }
@media (prefers-reduced-motion: reduce) { .mp-ring { animation: none; } }
`;

export function mapModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = mapSettings(raw);
  const live = usable(settings);
  return {
    id: "map",
    name: "World map",
    version: "1.0.0",
    description: "Places joined by roads, drawn as a map: where you are, what's discovered, and travel with its hours and danger.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "map", "travel", "fantasy"],
    requires: [],
    core: "map",
    enabled,
    vars: mapVars(live),
    rules: mapRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
