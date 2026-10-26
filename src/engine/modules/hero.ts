/**
 * Kit part (Fantasy RPG, Dark fantasy, Isekai): the hero sheet. Level and experience, resources
 * like health and mana whose maximum grows with the level, stats the player raises with points
 * from each level, skills that unlock at set levels, conditions that wear off, and titles. The
 * model only hands out XP and spends resources; the engine levels {{user}} up, refills and caps the
 * resources, regenerates them with the clock and grants the skills.
 *
 * The "system" style draws it as an isekai status window, and the model announces level-ups and
 * new skills as the System.
 */
import { newVar, type EngineVar } from "../sheet";
import { valueKey } from "./people";
import type { EngineModule, ModuleRule } from "./types";

export const HERO_STYLES = { classic: "Character sheet", system: "System status window (isekai)" } as const;
export type HeroStyle = keyof typeof HERO_STYLES;

export interface HeroResource {
  name: string;
  /** The maximum at level 1... */
  base: number;
  /** ...and how much each level adds. */
  perLevel: number;
  /** Regained per in-game hour; 0 for none. */
  regen: number;
}

export interface HeroStat {
  name: string;
  start: number;
}

export interface HeroAbility {
  name: string;
  /** The level it unlocks at; 0 for one only the story grants. */
  level: number;
  cost: number;
  /** The resource it costs, like "Mana". */
  resource: string;
  description: string;
}

export interface HeroSettings {
  title: string;
  button: string;
  style: HeroStyle;
  /** The group the hero's values go in; "Player" shares the character creator's. */
  group: string;
  resources: HeroResource[];
  stats: HeroStat[];
  /** XP for level 2; each level after needs `xpGrowth` times the one before. */
  xpBase: number;
  xpGrowth: number;
  maxLevel: number;
  pointsPerLevel: number;
  abilities: HeroAbility[];
  conditions: boolean;
  titles: boolean;
}

export const defaultHeroSettings = (): HeroSettings => ({
  title: "Hero",
  button: "⚔️ Hero",
  style: "classic",
  group: "Player",
  resources: [
    { name: "Health", base: 100, perLevel: 12, regen: 4 },
    { name: "Mana", base: 30, perLevel: 6, regen: 3 },
    { name: "Stamina", base: 50, perLevel: 5, regen: 10 },
  ],
  stats: [
    { name: "Strength", start: 5 },
    { name: "Agility", start: 5 },
    { name: "Intellect", start: 5 },
    { name: "Vitality", start: 5 },
  ],
  xpBase: 100,
  xpGrowth: 1.5,
  maxLevel: 50,
  pointsPerLevel: 3,
  abilities: [
    { name: "Power Strike", level: 1, cost: 10, resource: "Stamina", description: "A heavy blow that staggers the target." },
    { name: "Second Wind", level: 3, cost: 20, resource: "Stamina", description: "Catch your breath mid-fight and recover some health." },
    { name: "Firebolt", level: 5, cost: 12, resource: "Mana", description: "A dart of flame that sets the target alight." },
    { name: "Whirlwind", level: 8, cost: 30, resource: "Stamina", description: "Strike every foe within reach." },
  ],
  conditions: true,
  titles: false,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();

export function heroSettings(raw: Record<string, unknown> | undefined): HeroSettings {
  const base = defaultHeroSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    style: raw.style === "system" ? "system" : "classic",
    group: clean(str(raw.group, base.group)) || base.group,
    resources: Array.isArray(raw.resources)
      ? rows(raw.resources).map((r) => ({ name: str(r.name), base: Math.max(1, num(r.base, 100)), perLevel: Math.max(0, num(r.perLevel, 0)), regen: Math.max(0, num(r.regen, 0)) }))
      : base.resources,
    stats: Array.isArray(raw.stats) ? rows(raw.stats).map((s) => ({ name: str(s.name), start: Math.max(0, Math.round(num(s.start, 1))) })) : base.stats,
    xpBase: Math.max(1, Math.round(num(raw.xpBase, base.xpBase))),
    xpGrowth: Math.max(1, Math.min(3, num(raw.xpGrowth, base.xpGrowth))),
    maxLevel: Math.max(2, Math.min(999, Math.round(num(raw.maxLevel, base.maxLevel)))),
    pointsPerLevel: Math.max(0, Math.round(num(raw.pointsPerLevel, base.pointsPerLevel))),
    abilities: Array.isArray(raw.abilities)
      ? rows(raw.abilities).map((a) => ({
          name: str(a.name),
          level: Math.max(0, Math.round(num(a.level, 1))),
          cost: Math.max(0, num(a.cost, 0)),
          resource: str(a.resource),
          description: str(a.description),
        }))
      : base.abilities,
    conditions: raw.conditions !== false,
    titles: raw.titles === true,
  };
}

/** What the screen and script use: unnamed rows out. */
function usable(s: HeroSettings) {
  const resources = s.resources.filter((r) => clean(r.name)).map((r) => ({ ...r, name: clean(r.name) }));
  return {
    ...s,
    resources,
    stats: s.stats.filter((st) => clean(st.name)).map((st) => ({ ...st, name: clean(st.name) })),
    abilities: s.abilities.filter((a) => a.name.trim()).map((a) => ({ ...a, name: a.name.trim(), resource: clean(a.resource) })),
  };
}
type Live = ReturnType<typeof usable>;

/** XP needed to go from `level` to the next. */
export const xpFor = (s: Pick<HeroSettings, "xpBase" | "xpGrowth">, level: number) => Math.round(s.xpBase * Math.pow(s.xpGrowth, level - 1));

/** `taken` holds values other parts keep (the creator's stats), which the hero shares. */
function heroVars(s: Live, taken: Set<string>): EngineVar[] {
  const G = s.group;
  const vars: EngineVar[] = [
    newVar({ id: "hero-level", group: G, name: "Level", type: "number", start: "1", min: 1, readOnly: true, rule: "{{user}}'s level. The engine raises it from XP; never change it yourself." }),
    newVar({
      id: "hero-xp",
      group: G,
      name: "XP",
      type: "number",
      start: "0",
      min: 0,
      pinned: false,
      rule: "Experience. Delta it when {{user}} earns it: 5 to 15 for a clever move or a small win, 20 to 60 for a fight, 50 to 200 for a quest or a hard boss. The engine levels up.",
    }),
    newVar({ id: "hero-next", group: G, name: "NextXP", type: "number", start: String(xpFor(s, 1)), readOnly: true, pinned: false, rule: "XP needed for the next level, set by the engine." }),
    newVar({ id: "hero-points", group: G, name: "Points", type: "number", start: "0", min: 0, readOnly: true, pinned: false, rule: "Unspent stat points; the player spends them in the hero screen." }),
  ];
  for (const r of s.resources) {
    vars.push(
      newVar({
        id: `hero-res-${r.name}`,
        group: G,
        name: r.name,
        type: "number",
        start: String(r.base),
        min: 0,
        rule: `{{user}}'s ${r.name.toLowerCase()}. Delta it for what happens: damage, spells, effort, healing. The engine caps it at _Max${r.name}${r.regen ? " and regains it with time" : ""}.`,
      }),
    );
    vars.push(newVar({ id: `hero-max-${r.name}`, group: G, name: `Max${r.name}`, type: "number", start: String(r.base), readOnly: true, pinned: false, rule: `The most ${r.name.toLowerCase()} {{user}} can have, set by the engine from the level.` }));
  }
  for (const st of s.stats) {
    const v = newVar({ id: `hero-stat-${st.name}`, group: G, name: st.name, type: "number", start: String(st.start), min: 0, pinned: false, rule: `{{user}}'s ${st.name.toLowerCase()}. Weigh it when {{user}} tries something it governs. The player raises it with points.` });
    if (!taken.has(valueKey(v))) vars.push(v);
  }
  vars.push(
    newVar({
      id: "hero-abilities",
      group: G,
      name: "Abilities",
      type: "list",
      start: s.abilities.filter((a) => a.level === 1).map((a) => a.name).join(", "),
      pinned: false,
      rule: "Skills and spells {{user}} knows. The engine adds the ones a level unlocks; insert one only when the story teaches it.",
    }),
  );
  if (s.conditions)
    vars.push(
      newVar({
        id: "hero-conditions",
        group: G,
        name: "Conditions",
        type: "list",
        start: "",
        rule: 'Lasting effects on {{user}}: "Poisoned until Day 4", "Blessed until Day 6", "Broken arm". The engine removes a line when its day comes; remove others when they end.',
      }),
    );
  if (s.titles) {
    vars.push(newVar({ id: "hero-titles", group: G, name: "Titles", type: "list", start: "", pinned: false, rule: "Titles {{user}} has earned for great deeds (Goblin Slayer, Friend of the Forest). Insert one when it's earned." }));
    vars.push(newVar({ id: "hero-title", group: G, name: "Title", type: "text", start: "", pinned: false, rule: "The title {{user}} wears; the player picks it. People react to it." }));
  }
  return vars;
}

function heroRules(s: Live): ModuleRule[] {
  const G = s.group;
  const lines = [
    '<action app="hero"> is something {{user}} chose in the hero screen:',
    `- {"use":A}: {{user}} uses the ability A. Play it out, and delta its cost off /${G}/<resource>. In a fight, the foes answer.`,
    `- {"rest":H}: {{user}} rests about H hours. Move the clock; the engine regains resources with time.`,
  ];
  const rules: ModuleRule[] = [{ comment: "Hero actions", content: lines.join("\n"), constant: false, keys: ['app="hero"'], depth: 2, order: 100 }];
  const levels = `${G}/XP is how {{user}} grows: hand it out for wins and quests; the engine does the levelling, new skills and refills.`;
  rules.push({
    comment: "Hero",
    content:
      s.style === "system"
        ? `${levels} {{user}} has a System only they can see. Announce level-ups, new skills, titles and quest updates as short System lines in square brackets, like [System: Level up! You are now level 3.] or [System: Skill acquired — Appraisal.]`
        : levels,
    constant: true,
    keys: [],
    order: 100,
  });
  return rules;
}

// Runs in the card's script: levelling, maximums, regeneration, unlocked skills and conditions.
const SCRIPT = String.raw`
var S = settings.live || settings;
var G = S.group;
function need(level) { return Math.round(S.xpBase * Math.pow(S.xpGrowth, level - 1)); }
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hours(stat, before) {
  var t = stat.Time, b = before && before.Time;
  if (!t || !b) return 0;
  var x = minutes(b.Clock), y = minutes(t.Clock);
  if (x === null || y === null) return 0;
  return Math.max(0, Math.min(24, ((Number(t.Day) || 1) - (Number(b.Day) || 1)) * 1440 / 60 + (y - x) / 60));
}
function say(title, text, icon) {
  setTimeout(function () { CF.bus.emit("notify", { title: title, text: text, icon: icon, open: "hero" }); }, 500);
}
hooks.afterUpdate(function (stat, before, info) {
  var P = stat && stat[G];
  if (!P || typeof P !== "object") return stat;
  var prev = (before && before[G]) || {};
  var level = Math.max(1, Number(P._Level) || 1), xp = Math.max(0, Number(P.XP) || 0), ups = 0;
  while (level < S.maxLevel && xp >= need(level)) { xp -= need(level); level++; ups++; }
  P._Level = level;
  P.XP = xp;
  P._NextXP = level >= S.maxLevel ? 0 : need(level);
  if (ups) P._Points = (Number(P._Points) || 0) + ups * S.pointsPerLevel;
  var h = hours(stat, before), low = [];
  S.resources.forEach(function (r) {
    var max = Math.round(r.base + r.perLevel * (level - 1));
    P["_Max" + r.name] = max;
    var v = typeof P[r.name] === "number" ? P[r.name] : max;
    // A value the story changed this turn is left as it set it; otherwise time restores it.
    if (h > 0 && r.regen > 0 && v === prev[r.name]) v = v + r.regen * h;
    if (ups) v = max;
    v = Math.round(Math.max(0, Math.min(max, v)));
    P[r.name] = v;
    if (typeof prev[r.name] === "number" && v <= max / 4 && prev[r.name] > max / 4) low.push(r.name);
  });
  var known = Array.isArray(P.Abilities) ? P.Abilities.slice() : [];
  var learned = [];
  S.abilities.forEach(function (a) {
    if (a.level > 0 && a.level <= level && known.indexOf(a.name) < 0) { known.push(a.name); learned.push(a.name); }
  });
  P.Abilities = known;
  var day = stat.Time && Number(stat.Time.Day);
  if (Array.isArray(P.Conditions) && day)
    P.Conditions = P.Conditions.filter(function (c) {
      var m = /(?:until|expires)\s+Day\s+(\d+)/i.exec(String(c));
      return !m || Number(m[1]) > day;
    });
  if (before && info && info.latest) {
    var sys = S.style === "system";
    if (ups) say(sys ? "System" : "Level up", (sys ? "Level up! " : "") + "You are now level " + level + (S.pointsPerLevel ? ". " + ups * S.pointsPerLevel + " stat points to spend." : "."), "star");
    learned.forEach(function (n) { say(sys ? "System" : "New skill", (sys ? "Skill acquired: " : "") + n, "spark"); });
    low.forEach(function (n) { say(n, n + " is running low", "heart"); });
    var titles = Array.isArray(P.Titles) ? P.Titles : [];
    titles.filter(function (t) { return (prev.Titles || []).indexOf(t) < 0; }).forEach(function (t) { say(sys ? "System" : "Title earned", (sys ? "Title earned: " : "") + t, "star"); });
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var G = S.group;
var ui = CF.ui, esc = ui.esc;
var sys = S.style === "system";
var tab = (CF.openParams() || {}).tab || "status";
var plan = {};
function me() { return app.state(G) || {}; }
function delta(name) { var d = app.delta()[G + "." + name]; return d && typeof d[0] === "number" && typeof d[1] === "number" ? d[1] - d[0] : undefined; }
function spent() { var n = 0; Object.keys(plan).forEach(function (k) { n += plan[k]; }); return n; }
function act(payload, text) { app.send("hero", payload, text).then(function () { app.toast("In your message box: send it when you're ready"); }); }
function head(p) {
  var name = p.Name || "You";
  var sub = [p.Race, p.Class, p.Title].filter(function (x) { return typeof x === "string" && x; }).join(" · ");
  var next = Number(p._NextXP) || 0;
  return '<div class="cf-card hr-head">' +
    '<div class="hr-lv"><span>' + (sys ? "LV" : "Level") + "</span><b>" + esc(p._Level || 1) + "</b></div>" +
    '<div class="hr-who"><b class="hr-name">' + esc(name) + "</b>" + (sub ? '<span class="cf-small cf-muted">' + esc(sub) + "</span>" : "") +
    (next ? ui.meter({ label: "XP", value: Number(p.XP) || 0, max: next, delta: delta("XP"), showMax: true }) : '<span class="cf-chip">Max level</span>') + "</div></div>";
}
function resources(p) {
  return S.resources.map(function (r) {
    var max = Number(p["_Max" + r.name]) || r.base;
    var v = Number(p[r.name]); if (!isFinite(v)) v = max;
    return '<div class="hr-res hr-' + esc(r.name.toLowerCase()) + (v <= max / 4 ? " low" : "") + '">' + ui.meter({ label: r.name, value: v, max: max, delta: delta(r.name), showMax: true }) + "</div>";
  }).join("");
}
function status() {
  var p = me();
  var cond = Array.isArray(p.Conditions) ? p.Conditions : [];
  var pts = Number(p._Points) || 0;
  return '<div class="cf-stack">' + head(p) +
    '<div class="cf-card cf-stack">' + resources(p) + "</div>" +
    (pts ? '<button type="button" class="cf-card hr-points" data-tab-go="stats">' + ui.icon("plus") + "<span><b>" + pts + " stat point" + (pts === 1 ? "" : "s") + "</b> to spend</span></button>" : "") +
    (S.conditions ? '<div class="cf-card"><span class="cf-label">Conditions</span><div class="hr-conds">' + (cond.length ? cond.map(function (c) { return ui.chip(c); }).join("") : '<span class="cf-muted cf-small">None</span>') + "</div></div>" : "") +
    '<div class="hr-rest"><button type="button" class="cf-btn" data-rest="1">' + ui.icon("moon") + 'Rest an hour</button><button type="button" class="cf-btn" data-rest="8">' + ui.icon("moon") + "Sleep 8 hours</button></div></div>";
}
function statsView() {
  var p = me();
  var pts = (Number(p._Points) || 0) - spent();
  var names = S.stats.map(function (s) { return s.name; });
  // The creator's stats are shared: show those too.
  Object.keys(p).forEach(function (k) {
    if (names.indexOf(k) < 0 && typeof p[k] === "number" && /^[A-Z]/.test(k) && k !== "XP" && k.indexOf("Max") !== 0 && !S.resources.some(function (r) { return r.name === k; })) names.push(k);
  });
  return '<div class="cf-stack"><div class="cf-card hr-pts"><span class="cf-label">Points to spend</span><b>' + pts + "</b></div>" +
    '<div class="cf-card hr-stats">' + names.map(function (n) {
      var base = Number(p[n]) || 0, add = plan[n] || 0;
      return '<div class="hr-stat"><span class="hr-sname">' + esc(n) + '</span><b>' + (base + add) + (add ? ' <em>+' + add + "</em>" : "") + ui.delta(delta(n)) + "</b>" +
        '<span class="hr-step"><button type="button" class="cf-btn ghost" data-minus="' + esc(n) + '" aria-label="Less ' + esc(n) + '"' + (add ? "" : " disabled") + ">−</button>" +
        '<button type="button" class="cf-btn ghost" data-plus="' + esc(n) + '" aria-label="More ' + esc(n) + '"' + (pts > 0 ? "" : " disabled") + ">+</button></span></div>";
    }).join("") + "</div>" +
    (spent() ? '<div class="cf-row hr-two"><button type="button" class="cf-btn primary" data-confirm>Confirm</button><button type="button" class="cf-btn ghost" data-undo>Undo</button></div>' : "") + "</div>";
}
function info(name) { return S.abilities.filter(function (a) { return a.name === name; })[0] || null; }
function skills() {
  var p = me();
  var known = Array.isArray(p.Abilities) ? p.Abilities : [];
  var level = Number(p._Level) || 1;
  var rows = known.map(function (n) {
    var a = info(n) || { name: n, cost: 0, resource: "", description: "" };
    var have = a.resource ? Number(p[a.resource]) : Infinity;
    var short = a.cost && have < a.cost;
    return '<li class="hr-skill"><div><b>' + esc(a.name) + "</b>" + (a.cost ? '<span class="hr-cost">' + esc(a.cost + " " + a.resource) + "</span>" : "") +
      (a.description ? '<span class="cf-small cf-muted">' + esc(a.description) + "</span>" : "") + "</div>" +
      '<button type="button" class="cf-btn' + (short ? "" : " primary") + '" data-use="' + esc(a.name) + '"' + (short ? " disabled" : "") + ">Use</button></li>";
  });
  S.abilities.filter(function (a) { return a.level > level && known.indexOf(a.name) < 0; }).forEach(function (a) {
    rows.push('<li class="hr-skill locked"><div><b>' + esc(sys ? "???" : a.name) + '</b><span class="cf-small cf-muted">Unlocks at level ' + a.level + "</span></div>" + ui.icon("lock") + "</li>");
  });
  return rows.length ? '<ul class="hr-skills">' + rows.join("") + "</ul>" : '<p class="cf-muted">No skills yet.</p>';
}
function titles() {
  var p = me();
  var list = Array.isArray(p.Titles) ? p.Titles : [];
  if (!list.length) return '<p class="cf-muted">No titles yet. Great deeds earn them.</p>';
  return '<ul class="hr-skills">' + list.map(function (t) {
    var on = p.Title === t;
    return '<li class="hr-skill' + (on ? " worn" : "") + '"><b>' + esc(t) + '</b><button type="button" class="cf-btn' + (on ? " ghost" : "") + '" data-title="' + esc(on ? "" : t) + '">' + (on ? "Take off" : "Wear") + "</button></li>";
  }).join("") + "</ul>";
}
function draw() {
  var tabs = [{ id: "status", label: "Status", html: status() }];
  if (S.stats.length || Number(me()._Points)) tabs.push({ id: "stats", label: "Stats", html: statsView() });
  tabs.push({ id: "skills", label: "Skills", html: skills() });
  if (S.titles) tabs.push({ id: "titles", label: "Titles", html: titles() });
  root.innerHTML = '<div class="hr' + (sys ? " hr-sys" : "") + '">' + ui.appBar(sys ? "Status" : S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div></div>";
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-tab-go]"))) { tab = b.getAttribute("data-tab-go"); return draw(); }
  if ((b = t.closest("[data-plus]"))) { var n = b.getAttribute("data-plus"); plan[n] = (plan[n] || 0) + 1; return draw(); }
  if ((b = t.closest("[data-minus]"))) { var m = b.getAttribute("data-minus"); plan[m] = Math.max(0, (plan[m] || 0) - 1); return draw(); }
  if (t.closest("[data-undo]")) { plan = {}; return draw(); }
  if (t.closest("[data-confirm]")) {
    var p = me(), changes = [], words = [];
    Object.keys(plan).forEach(function (k) { if (plan[k]) { changes.push([[G, k], (Number(p[k]) || 0) + plan[k]]); words.push(k + " +" + plan[k]); } });
    changes.push([[G, "_Points"], Math.max(0, (Number(p._Points) || 0) - spent())]);
    plan = {};
    return app.setMany(changes, "spent stat points: " + words.join(", ")).then(function () { app.toast(sys ? "Stats updated" : "Points spent"); });
  }
  if ((b = t.closest("[data-use]"))) { var a = b.getAttribute("data-use"); return act({ use: a }, "I use " + a + "."); }
  if ((b = t.closest("[data-rest]"))) { var h = Number(b.getAttribute("data-rest")); return act({ rest: h }, h > 1 ? "I find a safe spot and sleep." : "I rest for a while."); }
  if ((b = t.closest("[data-title]"))) { var ti = b.getAttribute("data-title"); return app.setMany([[[G, "Title"], ti]], ti ? "wearing the title " + ti : "took off the title"); }
});
draw();
app.onState(function () { plan = {}; draw(); });
`;

const CSS = String.raw`
.hr-head { display: flex; gap: 12px; align-items: center; }
.hr-lv { flex: none; width: 64px; height: 64px; border-radius: 50%; display: grid; place-content: center; text-align: center; border: 2px solid var(--cf-accent); background: color-mix(in srgb, var(--cf-accent) 14%, var(--cf-surface)); }
.hr-lv span { font-size: .65em; text-transform: uppercase; letter-spacing: .12em; color: var(--cf-muted); }
.hr-lv b { font-size: 1.6em; line-height: 1; font-family: var(--cf-heading); color: var(--cf-accent); }
.hr-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.hr-name { font-family: var(--cf-heading); font-size: 1.25em; overflow-wrap: anywhere; }
.hr-health .cf-meter-fill { background: linear-gradient(90deg, #b3261e, #e35d4f); }
.hr-mana .cf-meter-fill { background: linear-gradient(90deg, #2453b3, #4f8fe3); }
.hr-stamina .cf-meter-fill { background: linear-gradient(90deg, #3d8a2c, #8fc14f); }
.hr-res.low .cf-meter-fill { animation: hr-pulse 1.2s ease-in-out infinite; }
@keyframes hr-pulse { 50% { opacity: .55; } }
.hr-points { font: inherit; color: var(--cf-text); display: flex; align-items: center; gap: 10px; cursor: pointer; border-color: var(--cf-accent2); background: color-mix(in srgb, var(--cf-accent2) 16%, var(--cf-surface)); text-align: left; }
.hr-points .cf-icon { width: 20px; height: 20px; color: var(--cf-accent2); }
.hr-conds { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.hr-rest, .hr-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hr-rest .cf-btn, .hr-two .cf-btn { justify-content: center; min-height: 44px; }
.hr-pts { display: flex; align-items: center; justify-content: space-between; }
.hr-pts b { font-size: 1.6em; color: var(--cf-accent2); font-family: var(--cf-heading); }
.hr-stats { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; padding-bottom: 4px; }
.hr-stat { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--cf-border); }
.hr-stat:last-child { border-bottom: 0; }
.hr-sname { flex: 1; min-width: 0; }
.hr-stat b { font-variant-numeric: tabular-nums; font-size: 1.15em; display: flex; align-items: center; gap: 6px; }
.hr-stat em { font-style: normal; font-size: .75em; color: var(--cf-good); }
.hr-step { display: flex; gap: 4px; }
.hr-step .cf-btn { min-width: 40px; min-height: 40px; justify-content: center; font-size: 1.1em; }
.hr-skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.hr-skill { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); }
.hr-skill > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hr-skill .cf-btn { flex: none; min-height: 40px; }
.hr-skill.locked { opacity: .6; }
.hr-skill.locked .cf-icon { width: 18px; height: 18px; color: var(--cf-muted); }
.hr-skill.worn { border-color: var(--cf-accent2); }
.hr-cost { font-size: .78em; color: var(--cf-accent); }
/* The isekai status window */
.hr-sys .cf-card, .hr-sys .hr-skill { position: relative; border-color: color-mix(in srgb, var(--cf-accent) 55%, transparent); box-shadow: 0 0 14px color-mix(in srgb, var(--cf-accent) 18%, transparent), inset 0 0 12px color-mix(in srgb, var(--cf-accent) 8%, transparent); }
.hr-sys .cf-card::before { content: ""; position: absolute; inset: -1px; pointer-events: none; border-radius: inherit;
  background: linear-gradient(var(--cf-accent), var(--cf-accent)) top left / 12px 2px no-repeat, linear-gradient(var(--cf-accent), var(--cf-accent)) top left / 2px 12px no-repeat,
    linear-gradient(var(--cf-accent), var(--cf-accent)) bottom right / 12px 2px no-repeat, linear-gradient(var(--cf-accent), var(--cf-accent)) bottom right / 2px 12px no-repeat; }
.hr-sys .cf-appbar h1 { letter-spacing: .25em; text-transform: uppercase; }
.hr-sys .hr-lv { border-radius: 6px; box-shadow: 0 0 16px color-mix(in srgb, var(--cf-accent) 45%, transparent); }
.hr-sys .hr-name, .hr-sys .hr-lv b { text-shadow: 0 0 10px color-mix(in srgb, var(--cf-accent) 60%, transparent); }
.hr-sys .cf-label { color: var(--cf-accent); }
@media (prefers-reduced-motion: reduce) { .hr-res.low .cf-meter-fill { animation: none; } }
`;

/** `taken` holds values other parts keep (the creator's stats), which the hero shares. */
export function heroModule(raw?: Record<string, unknown>, enabled = true, taken: Set<string> = new Set()): EngineModule {
  const settings = heroSettings(raw);
  const live = usable(settings);
  return {
    id: "hero",
    name: "Hero sheet",
    version: "1.0.0",
    description: "Level and XP, health and mana that grow with the level, stat points, skills that unlock, conditions and titles.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "rpg", "stats", "fantasy"],
    requires: [],
    core: "hero",
    enabled,
    vars: heroVars(live, taken),
    rules: heroRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
