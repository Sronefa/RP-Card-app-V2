/**
 * Reference modules the UI engineer reads and copies patterns from: one per slot, small, and built
 * only on the engine core and the kit. The core modules (time, settings app) are examples too.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "../modules/types";
import { MINIGAME_TEMPLATES } from "./minigames";

const base = (): Pick<EngineModule, "version" | "tags" | "requires" | "enabled" | "settings"> => ({
  version: "1.0.0",
  tags: ["example"],
  requires: [],
  enabled: true,
  settings: {},
});

const relationshipPanel: EngineModule = {
  ...base(),
  id: "relationship-panel",
  name: "Relationship meter",
  description: "A panel section: affection as a meter with its change, and the relationship stage as a chip.",
  slot: "panel",
  vars: [
    newVar({
      id: "ex-aff",
      group: "Mina",
      name: "Affection",
      type: "number",
      start: "20",
      min: 0,
      max: 100,
      rule: "+1 to +3 when {{user}} is kind or remembers something about her; −3 to −5 when {{user}} mocks or ignores her.",
    }),
    newVar({
      id: "ex-stage",
      group: "Mina",
      name: "Stage",
      type: "choice",
      options: ["Strangers", "Friends", "Close", "Lovers"],
      start: "Strangers",
      rule: "Move up one stage when Affection passes 30, 60 and 85, and only when the scene earns it.",
    }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: ".rel-head { display: flex; align-items: center; gap: 8px; } .rel-head .cf-meter { flex: 1; min-width: 0; }",
  js: `var who = "Mina";
function draw() {
  var s = app.state(who) || {};
  var d = app.delta()[who + ".Affection"];
  root.innerHTML =
    '<div class="rel-head">' +
    CF.ui.avatar(null, who) +
    CF.ui.meter({ label: who, value: Number(s.Affection) || 0, max: 100, delta: d ? d[1] - d[0] : 0 }) +
    CF.ui.chip(s.Stage || "Strangers") +
    "</div>";
}
draw();
app.onState(draw);`,
  script: "",
};

const inventoryApp: EngineModule = {
  ...base(),
  id: "inventory-app",
  name: "Inventory",
  description: "A hub app: items with counts, a detail page per item, and Use/Drop actions the model narrates.",
  slot: "overlay",
  button: "🎒 Bag",
  vars: [
    newVar({
      id: "ex-items",
      group: "Player",
      name: "Items",
      type: "counts",
      start: "rope: 1, torch: 2, bread: 3",
      rule: "insert or delta an item when {{user}} gets one; delta −1 when one is used up; remove it at 0.",
    }),
    newVar({
      id: "ex-gold",
      group: "Player",
      name: "Gold",
      type: "number",
      start: "25",
      min: 0,
      rule: "delta when {{user}} pays or is paid.",
    }),
  ],
  rules: [
    {
      comment: "Inventory actions",
      content:
        '<action app="inventory">{"use":"<item>"}</action> means {{user}} uses one of the item now: narrate it, then delta /Player/Items/<item> by -1. {"drop":"<item>"} means {{user}} leaves it behind: remove /Player/Items/<item>.',
      constant: false,
      keys: ['app="inventory"'],
      depth: 2,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  css: ".inv-count { font-variant-numeric: tabular-nums; color: var(--cf-muted); } .inv-item { width: 100%; text-align: left; justify-content: space-between; }",
  js: `var esc = CF.ui.esc;
function items() {
  var bag = app.state("Player.Items") || {};
  return Object.keys(bag).filter(function (k) { return Number(bag[k]) > 0; }).map(function (k) { return { name: k, count: Number(bag[k]) }; });
}
var nav = app.router(root, {
  home: function () {
    var list = items();
    var gold = app.state("Player.Gold");
    return '<div class="cf-app">' + CF.ui.appBar("Inventory") + '<div class="cf-appbody">' +
      CF.ui.grid([{ label: "Gold", value: gold == null ? 0 : gold }, { label: "Items", value: list.length }]) +
      (list.length
        ? '<div class="cf-stack">' + list.map(function (i) {
            return '<button type="button" class="cf-btn inv-item" data-item="' + esc(i.name) + '"><span>' + esc(i.name) + '</span><span class="inv-count">×' + i.count + "</span></button>";
          }).join("") + "</div>"
        : '<p class="cf-muted">The bag is empty.</p>') +
      "</div></div>";
  },
  item: function (p) {
    return '<div class="cf-app">' + CF.ui.appBar(p.name, { back: true }) + '<div class="cf-appbody">' +
      '<div class="cf-card cf-stack"><span class="cf-label">In the bag</span><b>×' + p.count + "</b></div>" +
      '<div class="cf-row">' +
      CF.ui.button("Use one", { primary: true, send: "inventory", payload: { use: p.name }, text: "I use the " + p.name + "." }) +
      CF.ui.button("Drop", { send: "inventory", payload: { drop: p.name }, text: "I leave the " + p.name + " behind." }) +
      "</div></div></div>";
  },
}, "home");
root.addEventListener("click", function (e) {
  var b = e.target.closest("[data-item]");
  if (!b) return;
  var name = b.getAttribute("data-item");
  var found = items().find(function (i) { return i.name === name; });
  if (found) nav.go("item", found);
});
root.addEventListener("click", function (e) {
  if (e.target.closest("[data-cf-send]")) app.toast("Written in the input box: send it when you're ready");
});
app.onState(function () { nav.go("home"); });`,
  script: "",
};

const letterBlock: EngineModule = {
  ...base(),
  id: "letter",
  name: "Letter",
  description: "An inline block: a letter the model writes into the state, shown as paper inside the message.",
  slot: "message",
  vars: [
    newVar({
      id: "ex-letter-from",
      group: "Letter",
      name: "From",
      type: "text",
      start: "",
      rule: "Who wrote the latest letter {{user}} received.",
    }),
    newVar({
      id: "ex-letter-body",
      group: "Letter",
      name: "Body",
      type: "text",
      start: "",
      pinned: false,
      rule: "The full text of the latest letter, written in the sender's voice.",
    }),
  ],
  rules: [
    {
      comment: "Letters",
      content:
        'When {{user}} receives a letter, put <cf-module id="letter"/> on its own line where it is opened, and in the same reply\'s update block replace /Letter/From and /Letter/Body with the sender and the full letter.',
      constant: true,
      keys: [],
      depth: 3,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  css: ".letter { background: var(--cf-surface); background-image: var(--cf-texture); border: 1px solid var(--cf-border); border-radius: var(--cf-radius); padding: 14px 16px; font-family: var(--cf-heading); line-height: 1.6; white-space: pre-wrap; box-shadow: var(--cf-shadow); } .letter-from { text-align: right; font-style: italic; margin-top: 8px; color: var(--cf-muted); }",
  js: `var l = app.state("Letter") || {};
root.innerHTML = l.Body
  ? '<div class="letter">' + CF.ui.esc(l.Body) + '<div class="letter-from">' + CF.ui.esc(l.From ? "— " + l.From : "") + "</div></div>"
  : '<p class="cf-muted cf-small">(An unopened letter.)</p>';`,
  script: "",
};

const vnScene: EngineModule = {
  ...base(),
  id: "vn-scene",
  name: "Visual-novel scene",
  description: "An inline block in the style of a visual novel: the speaker's portrait by their mood, a typed line, weather over the scene, and a shake when the scene hits hard. Uses CF.ui.dialogue and CF.fx.",
  slot: "message",
  vars: [
    newVar({ id: "ex-vn-who", group: "Scene", name: "Speaker", type: "text", start: "Mina", rule: "Who speaks the scene's key line, by name." }),
    newVar({ id: "ex-vn-line", group: "Scene", name: "Line", type: "text", start: "", rule: "The scene's key line, as the speaker says it, one or two sentences." }),
    newVar({ id: "ex-vn-mood", group: "Scene", name: "Mood", type: "choice", options: ["neutral", "happy", "sad", "angry", "surprised"], start: "neutral", rule: "The speaker's mood as they say it." }),
    newVar({ id: "ex-vn-place", group: "Scene", name: "Place", type: "text", start: "", rule: "Where the scene happens, as a place name from the card." }),
    newVar({ id: "ex-vn-weather", group: "Scene", name: "Weather", type: "text", start: "clear", rule: "The weather in the scene, a word or two." }),
    newVar({ id: "ex-vn-impact", group: "Scene", name: "Impact", type: "toggle", start: "no", rule: "yes for a line that lands like a blow (a shock, a slap, an explosion); no otherwise." }),
  ],
  rules: [
    {
      comment: "Scene block",
      content: 'At a turning point, put <cf-module id="vn-scene"/> on its own line after the narration, with the Scene values set for it.',
      constant: true,
      keys: [],
      depth: 4,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  css: ".vn-stage { position: relative; min-height: 220px; display: flex; align-items: flex-end; padding: 10px; border-radius: var(--cf-radius); overflow: hidden; background: linear-gradient(180deg, var(--cf-surface2), var(--cf-bg)); background-size: cover; background-position: center; }",
  js: `var s = app.state("Scene") || {};
var who = s.Speaker || "Mina";
var place = CF.assets.background(s.Place || "", "");
root.innerHTML =
  '<div class="vn-stage"' + (place ? ' style="background-image:url(\\'' + CF.ui.esc(place) + '\\')"' : "") + ">" +
  CF.ui.dialogue({ name: who, text: "", portrait: CF.assets.portrait(who, { emotion: s.Mood || "neutral" }), more: true }) +
  "</div>";
var stage = root.querySelector(".vn-stage");
CF.fx.weather(stage, s.Weather || "");
CF.fx.typewriter(root.querySelector(".cf-vn-text"), s.Line || "…").done.then(function () {
  if (s.Impact && app.delta()["Scene.Line"]) CF.fx.shake(stage);
});`,
  script: "",
};

const journeyApp: EngineModule = {
  ...base(),
  id: "journey-app",
  name: "Journey",
  description: "A hub app that shows the new kit pieces together: a map with pins, a carousel of places, a timeline, a progress ring, flip cards, a drawer, a toast, a count-up and page transitions.",
  slot: "overlay",
  button: "🧭 Journey",
  vars: [
    newVar({ id: "ex-j-where", group: "Journey", name: "Location", type: "choice", options: ["Harbor", "Market", "Tower"], start: "Harbor", rule: "Where {{user}} is now." }),
    newVar({ id: "ex-j-days", group: "Journey", name: "Log", type: "list", start: "", rule: "Insert one short line per notable event, as 'Day N — what happened'." }),
    newVar({ id: "ex-j-energy", group: "Journey", name: "Energy", type: "number", start: "8", min: 0, max: 10, rule: "−1 per hard task, +3 after a night's rest." }),
    newVar({ id: "ex-j-gold", group: "Journey", name: "Gold", type: "number", start: "40", min: 0, rule: "delta when {{user}} pays or is paid." }),
  ],
  rules: [
    {
      comment: "Journey actions",
      content: '<action app="journey">{"travel":P}</action> means {{user}} sets off for P: narrate the way there and set /Journey/Location to P on arrival.',
      constant: false,
      keys: ['app="journey"'],
      depth: 2,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  css: ".jr-body { min-height: 0; } .jr-place { padding: 14px; min-height: 110px; display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; background: var(--cf-surface2); } .jr-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; } .jr-gold { font-variant-numeric: tabular-nums; }",
  js: `var PLACES = [
  { name: "Harbor", x: 22, y: 70, about: "Gulls, tar and the morning ferry." },
  { name: "Market", x: 52, y: 48, about: "Spice stalls and a fortune teller." },
  { name: "Tower", x: 78, y: 20, about: "Locked at night. Someone lives at the top." },
];
var tab = "map";
var lastGold = null;
function bar() {
  return CF.ui.appBar("Journey") + '<div class="cf-row" style="padding:6px 10px">' +
    ["map", "places", "log"].map(function (t) { return CF.ui.button(t === "map" ? "Map" : t === "places" ? "Places" : "Log", { ghost: t !== tab }).replace("<button", '<button data-tab="' + t + '"'); }).join("") +
    '<span style="flex:1"></span>' + CF.ui.button("Bag", { icon: "bag" }).replace("<button", "<button data-bag") + "</div>";
}
function page() {
  var s = app.state("Journey") || {};
  if (tab === "map")
    return '<div class="cf-stack">' + CF.ui.map({ image: CF.assets.scene("map"), label: "Island", pins: PLACES.map(function (p) {
      return p.name === s.Location ? { label: p.name, x: p.x, y: p.y, here: true } : { label: p.name, x: p.x, y: p.y, send: "journey", payload: { travel: p.name }, text: "I head for the " + p.name + "." };
    }) }) + '<div class="cf-spread">' + CF.ui.ring({ value: Number(s.Energy) || 0, max: 10, label: "Energy" }) + '<span class="cf-label">Gold <b class="jr-gold">' + (Number(s.Gold) || 0) + "</b></span></div></div>";
  if (tab === "places")
    return CF.ui.carousel(PLACES.map(function (p) { return '<div class="jr-place"><h2>' + CF.ui.esc(p.name) + '</h2><p class="cf-muted">' + CF.ui.esc(p.about) + "</p></div>"; }), { label: "Places" }) +
      '<div class="jr-cards">' + ["The Tower", "The Star", "The Moon"].map(function (c) { return CF.ui.flip({ front: "<b>?</b>", back: "<b>" + c + "</b>", label: "Fortune card" }); }).join("") + "</div>";
  var log = Array.isArray(s.Log) ? s.Log : [];
  return log.length ? CF.ui.timeline(log.map(function (l, i) { var m = /^(Day \\d+)\\s*[—-]\\s*(.*)$/.exec(l) || [, "", l]; return { title: m[2], time: m[1], done: i < log.length - 1, current: i === log.length - 1 }; })) : '<p class="cf-muted">Nothing has happened yet.</p>';
}
function draw(dir) {
  if (!root.querySelector(".jr-body")) root.innerHTML = '<div class="cf-app"><div class="jr-bar"></div><div class="cf-appbody jr-body"></div></div>';
  root.querySelector(".jr-bar").innerHTML = bar();
  var body = root.querySelector(".jr-body");
  var done = dir ? CF.fx.transition(body, page(), dir) : Promise.resolve((body.innerHTML = page()));
  var gold = Number(app.state("Journey.Gold")) || 0;
  done.then(function () {
    var el = root.querySelector(".jr-gold");
    if (el && lastGold !== null && lastGold !== gold) CF.fx.countUp(el, gold, { from: lastGold });
    lastGold = gold;
  });
}
root.addEventListener("click", function (e) {
  var t = e.target.closest("[data-tab]");
  if (t) {
    var order = ["map", "places", "log"];
    var next = t.getAttribute("data-tab");
    if (next === tab) return;
    var dir = order.indexOf(next) > order.indexOf(tab) ? "left" : "right";
    tab = next;
    draw(dir);
    return;
  }
  if (e.target.closest("[data-bag]")) app.drawer(CF.ui.list([{ title: "Lantern", right: "×1" }, { title: "Rope", right: "×2" }]), { title: "Bag" });
  if (e.target.closest("[data-cf-send]")) app.toast("Written in the input box: send it when you're ready", { icon: "send" });
});
draw();
app.onState(function () { draw(); });`,
  script: "",
};

const heroSheet: EngineModule = {
  ...base(),
  id: "hero-sheet",
  name: "Hero sheet",
  description:
    "A hub app styled from the style guide's dark fantasy recipe: the place's art under a scrim with a gradient fallback, a bundled heading font (Cinzel, embedded because the CSS names it), a framed portrait, one focal value, staggered entrances, a count-up and a single glow for a level up, all calm when the player wants less motion.",
  slot: "overlay",
  button: "🛡️ Hero",
  vars: [
    newVar({ id: "ex-h-name", group: "Hero", name: "Name", type: "text", start: "Aldric", rule: "The hero's name." }),
    newVar({ id: "ex-h-level", group: "Hero", name: "Level", type: "number", start: "3", min: 1, max: 20, rule: "+1 when the story grants a level, at most once a scene." }),
    newVar({ id: "ex-h-hp", group: "Hero", name: "Health", type: "number", start: "42", min: 0, max: 60, rule: "Lose 5 to 20 on a wound; regain 10 after rest." }),
    newVar({ id: "ex-h-gold", group: "Hero", name: "Gold", type: "number", start: "120", min: 0, rule: "delta when the hero pays or is paid." }),
    newVar({ id: "ex-h-place", group: "Hero", name: "Place", type: "text", start: "Ashford", rule: "Where the hero is, as a place name from the card." }),
    newVar({ id: "ex-h-traits", group: "Hero", name: "Traits", type: "list", start: "Oathbound, Scarred", rule: "Insert a trait the story earns; at most six." }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: `.hs { min-height: 100%; display: flex; flex-direction: column; background-color: var(--cf-bg); }
.hs-hero { position: relative; padding: 56px 16px 16px; display: flex; gap: 12px; align-items: flex-end; overflow: hidden;
  background: radial-gradient(ellipse at 30% 0%, color-mix(in srgb, var(--cf-accent) 35%, transparent), transparent 60%), linear-gradient(160deg, var(--cf-surface2), var(--cf-bg)); }
.hs-hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 20%, color-mix(in srgb, var(--cf-bg) 92%, transparent)); pointer-events: none; }
.hs-hero > * { position: relative; z-index: 1; }
.hs-art { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; }
.hs-portrait { width: 72px; aspect-ratio: 3 / 4; border-radius: 3px; object-fit: cover; flex: none; border: 1px solid color-mix(in srgb, var(--cf-accent) 60%, var(--cf-border)); outline: 1px solid color-mix(in srgb, var(--cf-accent) 30%, transparent); outline-offset: 3px; box-shadow: var(--cf-shadow); background: var(--cf-surface2); display: grid; place-items: center; font: 600 1.8em "Cinzel", Georgia, serif; color: var(--cf-accent); }
.hs-name { font-family: "Cinzel", Georgia, serif; font-size: 1.6em; letter-spacing: .04em; overflow-wrap: anywhere; }
.hs-level { color: var(--cf-accent); font-variant-numeric: tabular-nums; }
.hs-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 16px; }
.hs-rule { display: flex; align-items: center; gap: 8px; color: var(--cf-muted); font-size: .8em; }
.hs-rule::before, .hs-rule::after { content: ""; flex: 1; height: 1px; background: color-mix(in srgb, var(--cf-accent) 35%, var(--cf-border)); }
.hs-gold { font-size: 1.6em; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--cf-accent); }
.hs.first .hs-in { animation: hs-rise .32s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i, 0) * 50ms); }
@keyframes hs-rise { from { opacity: 0; transform: translateY(8px); } }
.cf-reduce-motion .hs.first .hs-in { animation: none; }`,
  js: `var lastLevel = null;
function draw() {
  var h = app.state("Hero") || {};
  var name = String(h.Name || "Hero");
  var art = CF.assets.background(h.Place || "");
  var face = CF.assets.portrait(name);
  var traits = Array.isArray(h.Traits) ? h.Traits : [];
  var i = 0;
  // Each block rises in after the one before it.
  function item(cls, html) { return '<div class="hs-in ' + cls + '" style="--i:' + i++ + '">' + html + "</div>"; }
  // The entrance plays when the screen opens, not on every update.
  root.innerHTML = '<div class="hs cf-app' + (lastLevel === null ? " first" : "") + '">' +
    '<div class="hs-hero">' + (art ? '<img class="hs-art" alt="" src="' + CF.ui.esc(art) + '">' : "") +
      (face ? '<img class="hs-portrait" alt="" src="' + CF.ui.esc(face) + '">' : '<div class="hs-portrait" aria-hidden="true">' + CF.ui.esc(name.charAt(0)) + "</div>") +
      '<div><h1 class="hs-name">' + CF.ui.esc(name) + '</h1><span class="cf-label">Level <b class="hs-level">' + (Number(h.Level) || 1) + "</b> · " + CF.ui.esc(h.Place || "On the road") + "</span></div></div>" +
    '<div class="hs-body">' +
      item("", CF.ui.meter({ label: "Health", value: Number(h.Health) || 0, max: 60, delta: app.delta()["Hero.Health"] })) +
      item("cf-spread", '<span class="cf-label">Gold</span><span class="hs-gold">' + (Number(h.Gold) || 0) + "</span>") +
      item("hs-rule", "✦") +
      item("", traits.length ? '<div class="cf-row">' + traits.map(function (t) { return CF.ui.chip(t); }).join("") + "</div>" : '<p class="cf-muted">No traits yet. The road will give them.</p>') +
    "</div></div>";
  var d = app.delta();
  var gold = root.querySelector(".hs-gold");
  if (d["Hero.Gold"]) CF.fx.countUp(gold, d["Hero.Gold"][1], { from: d["Hero.Gold"][0] });
  var level = Number(h.Level) || 1;
  // The screen's one big moment: a level up.
  if (lastLevel !== null && level > lastLevel) {
    var stop = CF.fx.glow(root.querySelector(".hs-portrait"));
    setTimeout(stop, 2400);
    app.toast("Level " + level + "!", { icon: "star" });
  }
  lastLevel = level;
}
draw();
app.onState(draw);`,
  script: "",
};

const worldMap: EngineModule = {
  ...base(),
  id: "world-map",
  name: "World map",
  description:
    "A hub app that needs no art: a procedural island drawn from the card's name with CF.art.mapImage, the places as pins on it, a crest for each faction from CF.art.sigil, and a sky for the time of day behind the header.",
  slot: "overlay",
  button: "🗺️ Map",
  vars: [
    newVar({ id: "ex-w-where", group: "World", name: "Location", type: "choice", options: ["Saltreach", "Old Harbor", "Ash Tower"], start: "Saltreach", rule: "Where {{user}} is now." }),
    newVar({ id: "ex-w-part", group: "World", name: "PartOfDay", type: "choice", options: ["Morning", "Afternoon", "Evening", "Night"], start: "Morning", rule: "The time of day in the scene." }),
  ],
  rules: [
    {
      comment: "Map actions",
      content: '<action app="map">{"travel":P}</action> means {{user}} sets off for P: narrate the way there and set /World/Location to P on arrival.',
      constant: false,
      keys: ['app="map"'],
      depth: 2,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  // White on the sky picture (not a theme colour: the sky is a picture, dark at night and bright by day, so it carries a shadow).
  css: `.wm-sky { padding: 18px 16px 14px; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; color: white; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
.wm-sky h1 { font-size: 1.4em; }
.wm-factions { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.wm-faction { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wm-faction span { overflow-wrap: anywhere; }`,
  js: `var PLACES = [
  { name: "Saltreach", x: 30, y: 62 },
  { name: "Old Harbor", x: 56, y: 44 },
  { name: "Ash Tower", x: 70, y: 26 },
];
var FACTIONS = ["The Tide Guild", "House Varn", "Order of Ash"];
// The same seed draws the same island every time: the card's own name.
var image = CF.art.mapImage({ kind: "island", seed: "Saltreach", places: PLACES, palette: "parchment" });
function draw() {
  var w = app.state("World") || {};
  var pins = PLACES.map(function (p) {
    return p.name === w.Location
      ? { label: p.name, x: p.x, y: p.y, here: true }
      : { label: p.name, x: p.x, y: p.y, send: "map", payload: { travel: p.name }, text: "I set off for " + p.name + "." };
  });
  root.innerHTML = '<div class="cf-app">' +
    '<div class="wm-sky" style="background:' + CF.art.sky(w.PartOfDay) + '"><h1>' + CF.ui.esc(w.Location || "Somewhere") + '</h1><span class="cf-small">' + CF.ui.esc(w.PartOfDay || "") + "</span></div>" +
    '<div class="cf-appbody cf-stack">' +
      CF.ui.map({ image: image, label: "The isle", pins: pins }) +
      CF.art.divider("flourish") +
      '<div class="wm-factions">' + FACTIONS.map(function (f) { return '<div class="wm-faction">' + CF.art.sigil(f, { size: 36 }) + "<span>" + CF.ui.esc(f) + "</span></div>"; }).join("") + "</div>" +
    "</div></div>";
}
draw();
app.onState(draw);`,
  script: "",
};

const statChart: EngineModule = {
  ...base(),
  id: "stat-chart",
  name: "Stat chart",
  description: "A panel section drawn with CF.art: the hero's attributes as a radar, stamina as a dial gauge that turns red when low, and a sparkline of gold over the last replies.",
  slot: "panel",
  vars: [
    newVar({ id: "ex-s-attrs", group: "Stats", name: "Attributes", type: "counts", start: "STR: 12, DEX: 15, INT: 9, WIS: 11, CHA: 14", rule: "Raise one attribute by 1 when the story earns it; never above 20." }),
    newVar({ id: "ex-s-stamina", group: "Stats", name: "Stamina", type: "number", start: "70", min: 0, max: 100, rule: "−10 to −25 for hard effort; +40 after rest." }),
    newVar({ id: "ex-s-gold", group: "Stats", name: "GoldLog", type: "list", start: "40, 55, 30", rule: "Insert the gold {{user}} has at the end of each reply; keep the last 8." }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: ".sc { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; } .sc-radar { grid-row: span 2; max-width: 200px; } .sc-gold { display: flex; align-items: center; gap: 6px; font-size: 0.85em; color: var(--cf-muted); }",
  js: `function draw() {
  var s = app.state("Stats") || {};
  var attrs = s.Attributes || {};
  var gold = (Array.isArray(s.GoldLog) ? s.GoldLog : []).map(Number).filter(function (n) { return !isNaN(n); });
  root.innerHTML = '<div class="sc">' +
    '<div class="sc-radar">' + CF.art.chart("radar", Object.keys(attrs).map(function (k) { return { label: k, value: Number(attrs[k]) || 0 }; }), { max: 20, title: "Attributes", empty: "No attributes yet" }) + "</div>" +
    CF.art.gauge({ value: Number(s.Stamina) || 0, max: 100, label: "Stamina", danger: 0.25, ticks: 10 }) +
    '<div class="sc-gold">Gold ' + (gold.length > 1 ? CF.art.chart("spark", gold, { title: "Gold" }) : "") + "<b>" + (gold.length ? gold[gold.length - 1] : 0) + "</b></div>" +
    "</div>";
}
draw();
app.onState(draw);`,
  script: "",
};

const prologue: EngineModule = {
  ...base(),
  id: "prologue",
  name: "Prologue",
  description:
    "A hub screen whose intro cutscene plays the first time it opens in a chat (CF.scene with once): the harbor fades in, a chapter card, two characters, a shake, a typed exchange and a choice that writes the player's answer. The steps live in the module's settings, so the user can edit the words; a button plays it again.",
  slot: "overlay",
  button: "🎬 Prologue",
  vars: [],
  rules: [
    {
      comment: "Prologue actions",
      content: '<action app="prologue">{"answer":A}</action> means {{user}} answered the captain in the prologue with A: play the scene on from that answer.',
      constant: false,
      keys: ['app="prologue"'],
      depth: 2,
      order: 100,
    },
  ],
  regex: [],
  settings: {
    scenes: {
      intro: [
        { bg: "Harbor", time: "Evening" },
        { title: "Prologue", sub: "The Drowned Crown", hold: 1400 },
        { fx: "weather", text: "light rain" },
        { show: "Mina", side: "left" },
        { show: "Captain Varn", side: "right", emotion: "angry" },
        { say: "You came back. After everything.", who: "Mina" },
        { fx: "shake" },
        { say: "The crown is gone, and the guild thinks you took it.", who: "Captain Varn" },
        {
          choice: [
            { label: "I didn't take it.", send: "prologue", payload: { answer: "innocent" }, text: "I didn't take it." },
            { label: "And if I did?", send: "prologue", payload: { answer: "defiant" }, text: "And if I did?" },
          ],
        },
      ],
    },
  },
  html: "",
  css: ".pr-body { min-height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 12px; text-align: center; }",
  js: `var intro = (settings.scenes || {}).intro || [];
function menu() {
  root.innerHTML = '<div class="cf-app"><div class="cf-appbody pr-body">' +
    "<h1>The Drowned Crown</h1>" +
    '<p class="cf-muted">' + (CF.scene.seen("prologue") ? "You've seen the prologue." : "The prologue plays when you open this screen.") + "</p>" +
    CF.ui.button("Play the prologue again", { primary: true, icon: "spark" }).replace("<button", "<button data-replay") +
    "</div></div>";
}
function play(once) {
  CF.scene.play(root, intro, { fill: true, once: once ? "prologue" : undefined, label: "Prologue" }).done.then(function (r) {
    menu();
    if (r.choice) app.toast("Your answer is in the input box: send it when you're ready", { icon: "send" });
  });
}
root.addEventListener("click", function (e) {
  if (e.target.closest("[data-replay]")) play(false);
});
menu();
play(true);`,
  script: "",
};

const chapterCard: EngineModule = {
  ...base(),
  id: "chapter-card",
  name: "Chapter card",
  description:
    "An inline block under the reply where a new chapter starts: the first time, a short cutscene (a sky for the time of day and the chapter's title card); after that, and on swipes, a still banner. Shows playing a scene on a change, not on every redraw.",
  slot: "message",
  vars: [
    newVar({ id: "ex-c-num", group: "Story", name: "Chapter", type: "number", start: "1", min: 1, rule: "+1 when the story reaches a clear turning point; at most once every few replies." }),
    newVar({ id: "ex-c-title", group: "Story", name: "ChapterTitle", type: "text", start: "Arrival", rule: "A two to four word title for the chapter, set when Chapter changes." }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: ".cc .cf-scene { height: 220px; min-height: 0; } .cc-still { padding: 18px 12px; text-align: center; border-radius: var(--cf-radius); } .cc-still h2 { font-size: 1.4em; } .cc-still p { margin: 4px 0 0; }",
  js: `var d = app.delta()["Story.Chapter"];
var n = Number(app.state("Story.Chapter")) || 1;
var name = String(app.state("Story.ChapterTitle") || "");
var key = "chapter-" + n;
function still() {
  root.innerHTML = '<div class="cc"><div class="cc-still cf-card"><span class="cf-label">Chapter ' + n + "</span><h2>" + CF.ui.esc(name) + "</h2></div></div>";
}
// Only the reply where the chapter changed shows anything, and the cutscene plays once per chapter.
if (!d) root.innerHTML = "";
else if (CF.scene.seen(key)) still();
else {
  root.innerHTML = '<div class="cc"></div>';
  CF.scene.play(root.firstChild, [
    { bg: "", time: "Evening", fade: 500 },
    { title: "Chapter " + n, sub: name, hold: 1800 },
  ], { once: key, label: "Chapter " + n }).done.then(still);
}`,
  script: "",
};

const companionCard: EngineModule = {
  ...base(),
  id: "companion-card",
  name: "Companion card",
  description:
    "A panel section: a companion's portrait that follows her mood, outfit and health (hurt below 30), with a crossfade when they change, beside her mood, outfit and a health bar. It follows the values with { follow }; with a portrait binding (set_portrait) app.portrait(who) alone does the same.",
  slot: "panel",
  vars: [
    newVar({ id: "ex-m-mood", group: "Mina", name: "Mood", type: "choice", options: ["neutral", "joy", "sadness", "anger", "fear"], start: "neutral", rule: "Mina's feeling at the end of the reply, as the scene shows it." }),
    newVar({ id: "ex-m-outfit", group: "Mina", name: "Outfit", type: "choice", options: ["Casual", "Uniform", "Armor"], start: "Casual", rule: "Changes only when the story says she changes clothes." }),
    newVar({ id: "ex-m-hp", group: "Mina", name: "Health", type: "number", start: "100", min: 0, max: 100, rule: "−5 to −30 when she's hurt; +10 when she rests or is treated." }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: ".cc-row { display: flex; gap: 12px; align-items: center; } .cc-info { flex: 1; min-width: 0; } .cc-info h3 { margin: 0; font-family: var(--cf-heading); } .cc-info .cf-row { flex-wrap: wrap; }",
  js: `var who = "Mina";
// What the portrait follows. With set_portrait for Mina, app.portrait(who, { size: "l" }) is enough.
var follow = { emotion: who + ".Mood", outfit: who + ".Outfit", hurt: { path: who + ".Health", below: 30, emotion: "hurt" } };
function draw() {
  var s = app.state(who) || {};
  var hp = Number(s.Health) || 0;
  var d = app.delta()[who + ".Health"];
  root.innerHTML =
    '<div class="cc-row">' +
    app.portrait(who, { follow: follow, size: "l", shape: "tall" }) +
    '<div class="cf-stack cc-info"><h3>' + CF.ui.esc(who) + "</h3>" +
    '<div class="cf-row">' + CF.ui.chip(hp < 30 ? "hurt" : s.Mood || "neutral") + CF.ui.chip(s.Outfit || "Casual") + "</div>" +
    CF.ui.meter({ label: "Health", value: hp, max: 100, delta: d ? d[1] - d[0] : 0 }) +
    "</div></div>";
}
draw();
// A redraw keeps the crossfade: the new portrait fades from the one shown before.
app.onState(draw);`,
  script: "",
};

const dangerMeter: EngineModule = {
  ...base(),
  id: "danger-meter",
  name: "Danger meter",
  description:
    'A panel section that pairs with a theme mood: the danger level as a meter and the moods that are on as chips; its fill turns red while the Danger mood is on. Add the mood with set_mood { name: "Danger", path: "World.Danger", min: 70, tokens: { accent: "#e0313f" }, tint: { color: "#400", strength: 0.15 }, ambience: "embers" } and every screen shifts with it.',
  slot: "panel",
  vars: [newVar({ id: "ex-danger", group: "World", name: "Danger", type: "number", start: "10", min: 0, max: 100, rule: "+10 to +25 when a threat closes in; −10 when {{user}} reaches safety. 70 and up is open danger." })],
  rules: [],
  regex: [],
  html: "",
  css: '.dm { display: flex; flex-direction: column; gap: 6px; } [data-cf-mood~="danger"] .dm .cf-meter-fill { background: var(--cf-bad); }',
  js: `function draw() {
  var danger = Number(app.state("World.Danger")) || 0;
  var d = app.delta()["World.Danger"];
  // The moods on at this panel's reply: an older panel keeps its own.
  var on = app.mood.active().map(function (m) { return CF.ui.chip(m.name); }).join("");
  root.innerHTML = '<div class="dm">' + CF.ui.meter({ label: "Danger", value: danger, max: 100, delta: d ? d[1] - d[0] : 0 }) + (on ? '<div class="cf-row">' + on + "</div>" : "") + "</div>";
}
draw();
app.onState(draw);`,
  script: "",
};


const npcTexts: EngineModule = {
  ...base(),
  id: "npc-texts",
  name: "Mina's texts",
  description:
    "A hub screen that the story writes: Mina texts {{user}} between scenes through a living-screen feed (off until the user turns it on), with a typing dot while she writes. The player texts back through the input box.",
  slot: "overlay",
  button: "💬 Mina",
  vars: [],
  rules: [
    {
      comment: "Texting Mina",
      content: '<action app="texts">{"to":"Mina","text":"…"}</action> means {{user}} texted Mina those words just now. She reads it soon; let her answer in the scene or later, in her own texting voice.',
      constant: false,
      keys: ['app="texts"'],
      depth: 2,
      order: 100,
    },
  ],
  regex: [],
  html: "",
  css: ".tx-body { display: flex; flex-direction: column; gap: 8px; } .tx-compose { display: flex; gap: 8px; margin-top: 8px; } .tx-compose .cf-input { flex: 1; min-width: 0; } .tx-old { opacity: 0.75; }",
  js: `var who = "Mina";
var shown = -1;
function draw() {
  // Oldest first, read at this screen's message: a swipe brings its own texts.
  var texts = app.live("texts");
  // Only texts that arrived while the screen was open ease in.
  var fresh = shown < 0 ? 0 : Math.max(0, texts.length - shown);
  shown = texts.length;
  root.innerHTML = '<div class="cf-app">' + CF.ui.appBar(who) + '<div class="cf-appbody"><div class="tx-body">' +
    (texts.length
      ? texts.map(function (t, i) {
          var cls = i >= texts.length - fresh ? "cf-live-new" : t.fallback ? "tx-old" : "";
          return '<div class="' + cls + '">' + CF.ui.bubble(t.text) + "</div>";
        }).join("")
      : '<p class="cf-muted">No texts yet.</p>') +
    (CF.live.pending("texts") ? CF.ui.typing(who + " is typing") : "") +
    '</div><form class="tx-compose"><input class="cf-input" name="text" placeholder="Text ' + who + '" aria-label="Text ' + who + '" autocomplete="off"><button type="submit" class="cf-btn primary">Send</button></form></div></div>';
}
root.addEventListener("submit", function (e) {
  e.preventDefault();
  var input = e.target.querySelector("[name=text]");
  var text = input.value.trim();
  if (!text) return;
  app.send("texts", { to: who, text: text }, "📱 texted " + who + ": " + text);
  input.value = "";
  app.toast("In the input box: send it with your next message");
});
draw();
app.on("live", draw);
app.onState(draw);`,
  script: "",
  live: [
    {
      id: "texts",
      name: "Mina's texts",
      enabled: false,
      pack: {
        voice: "Mina texting {{user}}: lowercase, quick, teasing; an emoji only when she's flustered",
        tone: "Warm, curious about what {{user}} is up to, a little jealous when other girls come up",
        format: "A text message from Mina to {{user}}, reacting to what just happened or picking up a thread from earlier",
        length: "One or two short lines",
      },
      from: "Mina",
      count: 1,
      every: 2,
      on: [],
      history: 6,
      keep: 40,
      into: "",
      fallback: ["Mina: you up?", "Mina: still thinking about earlier lol", "Mina: text me when ur free"],
    },
  ],
};

const townNews: EngineModule = {
  ...base(),
  id: "town-news",
  name: "Town news",
  description:
    "A hub screen of headlines that react to the story: a living-screen feed (off until the user turns it on) writes one every four replies or when the danger changes, into the Town.News list so the story knows the news too.",
  slot: "overlay",
  button: "📰 News",
  vars: [
    newVar({ id: "ex-news", group: "Town", name: "News", type: "list", start: "", rule: "The town's headlines, oldest first. The Gazette writes these; don't add to the list yourself, but people in the story may have read them." }),
    newVar({ id: "ex-town-danger", group: "Town", name: "Danger", type: "number", start: "10", min: 0, max: 100, rule: "+10 when a threat to the town grows; −10 when it's beaten back." }),
  ],
  rules: [],
  regex: [],
  html: "",
  css: ".nw-item h3 { margin: 0; font-size: 1em; } .nw-item p { margin: 4px 0 0; color: var(--cf-muted); }",
  js: `function split(text) {
  var m = /^(.*?)\\s+[—–-]\\s+([\\s\\S]*)$/.exec(text);
  return m ? { head: m[1], body: m[2] } : { head: text, body: "" };
}
function draw() {
  var news = app.live("news").slice().reverse();
  root.innerHTML = '<div class="cf-app">' + CF.ui.appBar("The Gazette") + '<div class="cf-appbody cf-stack">' +
    (CF.live.pending("news") ? '<div class="cf-row">' + CF.ui.typing("New headline") + '<span class="cf-small cf-muted">Hot off the press…</span></div>' : "") +
    (news.length
      ? news.map(function (n, i) {
          var p = split(n.text);
          return '<article class="cf-card nw-item' + (i === 0 ? " cf-live-new" : "") + '"><h3>' + CF.ui.esc(p.head) + "</h3>" + (p.body ? "<p>" + CF.ui.esc(p.body) + "</p>" : "") + "</article>";
        }).join("")
      : '<p class="cf-muted">No news yet. The Gazette prints when something happens.</p>') +
    "</div></div>";
}
draw();
app.on("live", draw);
app.onState(draw);`,
  script: "",
  live: [
    {
      id: "news",
      name: "The Gazette",
      enabled: false,
      pack: {
        voice: "The town's one newspaper: a dry, slightly sensational editor who loves a rumour",
        tone: "Brisk; grim when the danger is high, gossipy when it's low",
        format: "A headline, a dash, then one sentence of story about what the town heard happened",
        length: "Under thirty words",
      },
      from: "",
      count: 1,
      every: 4,
      on: ["Town.Danger"],
      history: 8,
      keep: 20,
      into: "Town.News",
      fallback: ["Quiet Night in the Harbour — Fishermen report calm waters and an empty tavern.", "Market Prices Hold — Traders shrug off the week's rumours."],
    },
  ],
};

export const EXAMPLES: EngineModule[] = [relationshipPanel, inventoryApp, letterBlock, vnScene, journeyApp, heroSheet, worldMap, statChart, prologue, chapterCard, companionCard, dangerMeter, npcTexts, townNews, ...MINIGAME_TEMPLATES];
