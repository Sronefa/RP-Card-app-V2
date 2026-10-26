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

export const EXAMPLES: EngineModule[] = [relationshipPanel, inventoryApp, letterBlock];
