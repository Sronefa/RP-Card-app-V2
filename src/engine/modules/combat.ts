/**
 * Kit part (Fantasy RPG, Dark fantasy, Isekai): the combat HUD. During a fight the model ends each
 * reply with <cf-module id="combat"/>, and the block shows the foes with their health, {{user}}'s
 * own bars, the last blows, and the moves: attack a chosen foe, a skill, an item, defend or flee. A
 * tap sends the move at once. The engine counts the rounds, remembers each foe's full health for
 * its bar, and ends the fight when the last foe falls.
 */
import { newVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface CombatSettings {
  /** Fleeing is allowed. */
  flee: boolean;
  defend: boolean;
  /** How hard foes hit, for the model: "gentle", "fair" or "brutal". */
  difficulty: "gentle" | "fair" | "brutal";
}

/** What the HUD knows of the card's other parts: the hero's bars and skills, the bag's consumables. */
export interface CombatLinks {
  group: string;
  resources: string[];
  abilities: { name: string; cost: number; resource: string }[];
  /** The hero's list of known abilities, like "Player.Abilities". */
  known: string;
  bag: string;
  consumables: string[];
  xp: string;
}

export const defaultCombatSettings = (): CombatSettings => ({ flee: true, defend: true, difficulty: "fair" });

export const noLinks = (): CombatLinks => ({ group: "Player", resources: ["Health"], abilities: [], known: "", bag: "", consumables: [], xp: "" });

export function combatSettings(raw: Record<string, unknown> | undefined): CombatSettings {
  const base = defaultCombatSettings();
  if (!raw) return base;
  return {
    flee: raw.flee !== false,
    defend: raw.defend !== false,
    difficulty: raw.difficulty === "gentle" || raw.difficulty === "brutal" ? raw.difficulty : "fair",
  };
}

const HARDNESS = {
  gentle: "Foes hit softly and often miss; {{user}} should win most fights.",
  fair: "Foes fight sensibly and can hurt {{user}} badly; reckless moves are punished.",
  brutal: "Foes are cunning and deadly; a bad choice can end {{user}}. Never pull punches.",
};

function combatRules(s: CombatSettings, l: CombatLinks): ModuleRule[] {
  const hp = l.resources[0] ? `/${l.group}/${l.resources[0]}` : "{{user}}'s health";
  const end = [`set /Combat/Active to false`, l.xp ? `delta /${l.xp.replace(/\./g, "/")} by 20 to 60 per foe beaten` : "", l.bag ? "add any loot to the bag" : ""].filter(Boolean).join(", ");
  return [
    {
      comment: "Combat",
      content: [
        "When a fight starts: replace /Combat/Active with true and insert each foe into /Combat/Enemies with its health (a rat 8, a bandit 25, a soldier 40, a beast 60, a boss 150 or more; name twins Wolf 1, Wolf 2).",
        `Each reply during the fight: resolve {{user}}'s move and the foes' answer, delta their health and ${hp}, add one short line per blow to /Combat/Log, and end the reply with <cf-module id="combat"/> on its own line.`,
        `A foe at 0 is beaten: remove it from /Combat/Enemies. When none are left, or the fight ends another way, ${end}.`,
        HARDNESS[s.difficulty],
      ].join(" "),
      constant: true,
      keys: [],
      depth: 2,
      order: 90,
    },
    {
      comment: "Combat moves",
      content: [
        '<action app="combat"> is {{user}}\'s move this round:',
        '- {"do":"attack","target":T}: an attack on T with what {{user}} has equipped.',
        `- {"do":"skill","skill":A,"target":T}: the ability A on T; delta its cost off ${l.group ? "/" + l.group + "/<resource>" : "the resource it uses"}.`,
        `- {"do":"item","item":I}: {{user}} uses I from the bag (delta it by −1) and its effect applies.`,
        s.defend ? '- {"do":"defend"}: {{user}} guards; blows this round land softer.' : "",
        s.flee ? '- {"do":"flee"}: {{user}} tries to get away; it works or it doesn\'t, by the odds.' : "",
      ]
        .filter(Boolean)
        .join("\n"),
      constant: false,
      keys: ['app="combat"'],
      depth: 2,
      order: 100,
    },
  ];
}

const SCRIPT = String.raw`
hooks.afterUpdate(function (stat, before, info) {
  var C = stat && stat.Combat;
  if (!C || typeof C !== "object") return stat;
  var was = (before && before.Combat) || {};
  var E = C.Enemies && typeof C.Enemies === "object" ? C.Enemies : {};
  var max = C.$Max && typeof C.$Max === "object" ? Object.assign({}, C.$Max) : {};
  Object.keys(E).forEach(function (k) {
    var v = Number(E[k]);
    if (!(v > 0)) { delete E[k]; return; }
    if (!(Number(max[k]) >= v)) max[k] = v;
  });
  C.Enemies = E;
  var left = Object.keys(E).length;
  var hadFoes = was.Enemies && Object.keys(was.Enemies).length > 0;
  // The last foe fell: the fight is over even if the reply forgot to say so.
  if (C.Active === true && !left && was.Active === true && hadFoes) C.Active = false;
  // A round is a reply: the player's own message carries the round on.
  var round = Number(was._Round) || 0;
  if (C.Active === true) C._Round = was.Active !== true ? 1 : info && info.role === "user" ? round : round + 1;
  else { C._Round = 0; max = {}; }
  C.$Max = max;
  if (Array.isArray(C.Log)) C.Log = C.Log.slice(-4);
  if (before && info && info.latest) {
    if (C.Active === true && was.Active !== true)
      setTimeout(function () { CF.bus.emit("notify", { title: "Combat", text: Object.keys(E).join(", ") || "A fight starts", icon: "sword" }); }, 300);
    else if (C.Active !== true && was.Active === true)
      setTimeout(function () { CF.bus.emit("notify", { title: left ? "The fight is over" : "Victory", text: left ? "You got away" : "Every foe is down", icon: left ? "compass" : "star" }); }, 300);
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var L = S.links;
var ui = CF.ui, esc = ui.esc;
var live = app.messageId === "latest" || app.messageId >= CF.state.latestId();
var done = false, menu = "", target = "";
function get(path) { return app.state(path); }
function foes() { var e = get("Combat.Enemies"); return e && typeof e === "object" ? e : {}; }
function changed(path) { var d = app.delta()[path]; return d ? [Number(d[0]), Number(d[1])] : null; }
function fallen() {
  var d = app.delta(), out = [];
  Object.keys(d).forEach(function (k) {
    if (k.indexOf("Combat.Enemies.") !== 0) return;
    if (Number(d[k][0]) > 0 && !(Number(d[k][1]) > 0)) out.push(k.slice(15));
  });
  return out;
}
function me() { return get(L.group) || {}; }
function bagItems() {
  if (!L.bag) return [];
  var b = get(L.bag) || {};
  return Object.keys(b).filter(function (k) { return Number(b[k]) > 0 && (!L.consumables.length || L.consumables.indexOf(k) >= 0); });
}
function skills() {
  var known = L.known ? get(L.known) : null;
  known = Array.isArray(known) ? known : [];
  return known.map(function (n) { return L.abilities.filter(function (a) { return a.name === n; })[0] || { name: n, cost: 0, resource: "" }; });
}
function foeCard(name, hp, gone) {
  var max = Number((get("Combat.$Max") || {})[name]) || hp || 1;
  var c = changed("Combat.Enemies." + name);
  var hit = c && c[1] < c[0] ? c[0] - (c[1] > 0 ? c[1] : 0) : 0;
  var pct = gone ? 0 : Math.max(0, Math.min(100, (hp / max) * 100));
  var on = !gone && live && !done && name === target;
  return '<button type="button" class="cb-foe' + (gone ? " gone" : "") + (hit ? " hit" : "") + (on ? " on" : "") + '" data-target="' + esc(name) + '"' + (gone || !live || done ? " disabled" : "") + ">" +
    '<span class="cb-ic">' + ui.icon(gone ? "skull" : "sword") + "</span><b>" + esc(name) + "</b>" +
    '<span class="cb-bar"><i style="width:' + pct + '%"></i></span><span class="cf-small">' + (gone ? "Defeated" : esc(hp) + " / " + esc(max)) + "</span>" +
    (hit ? '<span class="cb-dmg" aria-hidden="true">−' + hit + "</span>" : "") + "</button>";
}
function bars() {
  var p = me();
  return L.resources.map(function (r) {
    if (typeof p[r] !== "number") return "";
    var max = Number(p["_Max" + r]) || Math.max(p[r], 1);
    var c = changed(L.group + "." + r);
    return '<div class="cb-me cb-' + esc(r.toLowerCase()) + '">' + ui.meter({ label: r, value: p[r], max: max, delta: c ? c[1] - c[0] : undefined, showMax: true }) + "</div>";
  }).join("");
}
function moves() {
  if (!live || done || get("Combat.Active") !== true) return "";
  if (menu === "skill") {
    var p = me();
    var list = skills();
    return '<div class="cb-sub"><span class="cf-label">Skills</span>' + (list.length ? list.map(function (a) {
      var short = a.cost && Number(p[a.resource]) < a.cost;
      return '<button type="button" class="cf-btn" data-skill="' + esc(a.name) + '"' + (short ? " disabled" : "") + "><span>" + esc(a.name) + "</span>" + (a.cost ? '<span class="cb-cost">' + esc(a.cost + " " + a.resource) + "</span>" : "") + "</button>";
    }).join("") : '<p class="cf-muted cf-small">No skills yet.</p>') + '<button type="button" class="cf-btn ghost" data-menu="">Back</button></div>';
  }
  if (menu === "item") {
    var items = bagItems(), b = get(L.bag) || {};
    return '<div class="cb-sub"><span class="cf-label">Items</span>' + (items.length ? items.map(function (n) {
      return '<button type="button" class="cf-btn" data-item="' + esc(n) + '"><span>' + esc(n) + '</span><span class="cb-cost">×' + esc(b[n]) + "</span></button>";
    }).join("") : '<p class="cf-muted cf-small">Nothing to use.</p>') + '<button type="button" class="cf-btn ghost" data-menu="">Back</button></div>';
  }
  return '<div class="cb-moves">' +
    '<button type="button" class="cf-btn primary" data-do="attack">' + ui.icon("sword") + "Attack</button>" +
    (L.known ? '<button type="button" class="cf-btn" data-menu="skill">' + ui.icon("spark") + "Skill</button>" : "") +
    (L.bag ? '<button type="button" class="cf-btn" data-menu="item">' + ui.icon("flask") + "Item</button>" : "") +
    (S.defend ? '<button type="button" class="cf-btn" data-do="defend">' + ui.icon("shield") + "Defend</button>" : "") +
    (S.flee ? '<button type="button" class="cf-btn ghost" data-do="flee">' + ui.icon("compass") + "Flee</button>" : "") + "</div>";
}
function draw() {
  var E = foes(), names = Object.keys(E), gone = fallen();
  var active = get("Combat.Active") === true;
  if (!names.length && !gone.length && !active) { root.innerHTML = ""; return; }
  if (names.indexOf(target) < 0) target = names[0] || "";
  var log = get("Combat.Log");
  log = Array.isArray(log) ? log : [];
  var round = Number(get("Combat._Round")) || 0;
  root.innerHTML = '<div class="cb' + (live && !done && active ? "" : " old") + '" role="group" aria-label="Combat">' +
    '<div class="cb-head"><span>' + ui.icon("sword") + (active ? "Round " + round : names.length ? "Fight over" : "Victory") + "</span>" + (live && active && names.length > 1 && !done ? '<span class="cf-small cf-muted">Tap a foe to target it</span>' : "") + "</div>" +
    '<div class="cb-foes">' + names.map(function (n) { return foeCard(n, Number(E[n]), false); }).join("") + gone.map(function (n) { return foeCard(n, 0, true); }).join("") + "</div>" +
    '<div class="cb-mine">' + bars() + "</div>" +
    (log.length ? '<ul class="cb-log">' + log.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : "") +
    moves() + "</div>";
}
function send(payload, text) {
  if (done) return;
  done = true;
  draw();
  app.send("combat", payload, text, { now: true }).catch(function (e) { done = false; app.toast("Couldn't send: " + e.message); draw(); });
}
root.addEventListener("click", function (e) {
  var b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.hasAttribute("data-target")) { target = b.getAttribute("data-target"); return draw(); }
  if (b.hasAttribute("data-menu")) { menu = b.getAttribute("data-menu"); return draw(); }
  if (b.hasAttribute("data-skill")) { var a = b.getAttribute("data-skill"); return send({ do: "skill", skill: a, target: target }, "I use " + a + (target ? " on the " + target : "") + "."); }
  if (b.hasAttribute("data-item")) { var i = b.getAttribute("data-item"); return send({ do: "item", item: i }, "I use the " + i.toLowerCase() + "."); }
  var d = b.getAttribute("data-do");
  if (d === "attack") return send({ do: "attack", target: target }, "I attack" + (target ? " the " + target : "") + ".");
  if (d === "defend") return send({ do: "defend" }, "I raise my guard.");
  if (d === "flee") return send({ do: "flee" }, "I try to get away.");
});
draw();
app.onState(function () { live = app.messageId === "latest" || app.messageId >= CF.state.latestId(); draw(); });
`;

const CSS = String.raw`
.cb { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--cf-border); border-radius: calc(var(--cf-radius) + 4px); background: linear-gradient(180deg, color-mix(in srgb, var(--cf-bad) 10%, var(--cf-surface)), var(--cf-surface)); box-shadow: var(--cf-shadow); }
.cb.old { opacity: .8; box-shadow: none; }
.cb-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cb-head > span:first-child { display: flex; align-items: center; gap: 6px; font-family: var(--cf-heading); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--cf-bad); }
.cb-head .cf-icon { width: 16px; height: 16px; }
.cb-foes { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.cb-foe { position: relative; font: inherit; color: var(--cf-text); display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); cursor: pointer; text-align: left; overflow: hidden; }
.cb-foe:disabled { cursor: default; }
.cb-foe.on { border-color: var(--cf-bad); box-shadow: 0 0 0 2px color-mix(in srgb, var(--cf-bad) 40%, transparent); }
.cb-foe.gone { opacity: .5; }
.cb-foe.gone b { text-decoration: line-through; }
.cb-foe.hit { animation: cb-shake .45s ease; }
.cb-ic .cf-icon { width: 18px; height: 18px; color: var(--cf-bad); }
.cb-bar { display: block; width: 100%; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--cf-bad) 15%, var(--cf-surface)); overflow: hidden; }
.cb-bar i { display: block; height: 100%; background: linear-gradient(90deg, #8f1d17, var(--cf-bad)); transition: width .6s ease; }
.cb-dmg { position: absolute; top: 6px; right: 8px; font-weight: 800; color: var(--cf-bad); animation: cb-float 1.1s ease both; }
.cb-mine { display: flex; flex-direction: column; gap: 6px; }
.cb-health .cf-meter-fill { background: linear-gradient(90deg, #b3261e, #e35d4f); }
.cb-mana .cf-meter-fill { background: linear-gradient(90deg, #2453b3, #4f8fe3); }
.cb-stamina .cf-meter-fill { background: linear-gradient(90deg, #3d8a2c, #8fc14f); }
.cb-log { list-style: none; margin: 0; padding: 8px 10px; border-radius: var(--cf-radius); background: var(--cf-surface2); font-size: .88em; display: flex; flex-direction: column; gap: 3px; }
.cb-log li::before { content: "› "; color: var(--cf-muted); }
.cb-log li:last-child { font-weight: 600; }
.cb-moves { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
.cb-moves .cf-btn, .cb-sub .cf-btn { justify-content: center; min-height: 44px; }
.cb-sub { display: flex; flex-direction: column; gap: 6px; }
.cb-sub .cf-btn { justify-content: space-between; }
.cb-cost { font-size: .8em; color: var(--cf-muted); }
@keyframes cb-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
@keyframes cb-float { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-14px); } }
@media (prefers-reduced-motion: reduce) { .cb-foe.hit, .cb-dmg { animation: none; } .cb-bar i { transition: none; } }
`;

export function combatModule(raw?: Record<string, unknown>, enabled = true, links: CombatLinks = noLinks()): EngineModule {
  const settings = combatSettings(raw);
  return {
    id: "combat",
    name: "Combat HUD",
    version: "1.0.0",
    description: "Foes with health bars, your own bars, the last blows, and attack, skill, item, defend and flee as buttons.",
    slot: "message",
    tags: ["built-in", "rpg", "combat", "inline", "fantasy"],
    requires: [],
    core: "combat",
    enabled,
    vars: [
      newVar({ id: "combat-active", group: "Combat", name: "Active", type: "toggle", start: "no", pinned: false, rule: "Whether {{user}} is in a fight right now." }),
      newVar({ id: "combat-enemies", group: "Combat", name: "Enemies", type: "counts", start: "", rule: "The foes in this fight with their health. Remove one when it falls." }),
      newVar({ id: "combat-round", group: "Combat", name: "Round", type: "number", start: "0", readOnly: true, pinned: false, rule: "The fight's round, counted by the engine." }),
      newVar({ id: "combat-log", group: "Combat", name: "Log", type: "list", start: "", pinned: false, rule: "The last blows, one short line each (\"The wolf bites: −8\")." }),
      newVar({ id: "combat-max", group: "Combat", name: "Max", type: "counts", start: "", hidden: true, pinned: false, rule: "Each foe's full health, for its bar." }),
    ],
    rules: combatRules(settings, links),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live: { ...settings, links } },
  };
}
