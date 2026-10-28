/**
 * Reference modules the UI engineer reads and copies patterns from: one per slot, small, and built
 * only on the engine core and the kit. The core modules (time, settings app) are examples too.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "../modules/types";

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

export const EXAMPLES: EngineModule[] = [relationshipPanel, inventoryApp, letterBlock, vnScene, journeyApp];
