/**
 * Built-in screen: the character creator. An inline block for the opening message, where the
 * player makes {{user}} step by step: name and look, the card's own choices (origin, class, role…),
 * starting stats from a point budget, and starting items. "Begin" writes everything into the game
 * state in one go and sends the opening message of the route the player picked.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule } from "./types";

export interface CreatorOption {
  name: string;
  description: string;
}

export interface CreatorChoice {
  /** The value's name, like "Origin" or "Class". */
  name: string;
  options: CreatorOption[];
}

export interface CreatorStat {
  name: string;
  base: number;
  max: number;
}

export interface CreatorRoute {
  label: string;
  description: string;
  /** What the player sends; "{name}" becomes the character's name. */
  message: string;
}

export interface CreatorSettings {
  title: string;
  intro: string;
  /** The group the character's values go in. */
  group: string;
  askName: boolean;
  askLook: boolean;
  /** Ready-made looks the player can tap to start from. */
  lookIdeas: string[];
  choices: CreatorChoice[];
  stats: CreatorStat[];
  /** Points to spend on stats above their base. */
  points: number;
  items: string[];
  /** How many starting items the player picks. */
  pickItems: number;
  routes: CreatorRoute[];
  /** Put a one-line summary of the character in the opening message. */
  summary: boolean;
}

export const defaultCreatorSettings = (): CreatorSettings => ({
  title: "Who are you?",
  intro: "Make your character before the story begins.",
  group: "Player",
  askName: true,
  askLook: true,
  lookIdeas: ["Tall and lean, a scar through one eyebrow", "Short and quick, freckled, always smiling", "Broad-shouldered, grey at the temples, calm eyes"],
  choices: [
    {
      name: "Background",
      options: [
        { name: "Wanderer", description: "No home, many roads. You know how to leave." },
        { name: "Noble", description: "Old name, thin purse. People expect things of you." },
        { name: "Scholar", description: "Books first, people second. You notice what others miss." },
      ],
    },
  ],
  stats: [
    { name: "Strength", base: 1, max: 5 },
    { name: "Agility", base: 1, max: 5 },
    { name: "Wits", base: 1, max: 5 },
    { name: "Charm", base: 1, max: 5 },
  ],
  points: 6,
  items: ["Rope", "Lantern", "Knife", "Bread", "Map", "Flask"],
  pickItems: 2,
  routes: [{ label: "Begin", description: "", message: "I'm {name}. The story begins." }],
  summary: true,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const list = <T,>(v: unknown, map: (x: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => map(x as Record<string, unknown>)) : [];

export function creatorSettings(raw: Record<string, unknown> | undefined): CreatorSettings {
  const base = defaultCreatorSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    intro: str(raw.intro, base.intro),
    group: str(raw.group, base.group).replace(/[.[\]"'/~$]/g, "").trim() || "Player",
    askName: raw.askName !== false,
    askLook: raw.askLook !== false,
    lookIdeas: Array.isArray(raw.lookIdeas) ? raw.lookIdeas.map(String) : base.lookIdeas,
    choices: Array.isArray(raw.choices)
      ? list(raw.choices, (c) => ({ name: str(c.name), options: list(c.options, (o) => ({ name: str(o.name), description: str(o.description) })) }))
      : base.choices,
    stats: Array.isArray(raw.stats) ? list(raw.stats, (s) => ({ name: str(s.name), base: Math.max(0, Math.round(num(s.base, 1))), max: Math.max(1, Math.round(num(s.max, 5))) })) : base.stats,
    points: Math.max(0, Math.round(num(raw.points, base.points))),
    items: Array.isArray(raw.items) ? raw.items.map(String) : base.items,
    pickItems: Math.max(0, Math.round(num(raw.pickItems, base.pickItems))),
    routes: Array.isArray(raw.routes) ? list(raw.routes, (r) => ({ label: str(r.label), description: str(r.description), message: str(r.message) })) : base.routes,
    summary: raw.summary !== false,
  };
}

/** The settings the screen uses: unnamed rows (still being filled in) left out. */
function usable(s: CreatorSettings): CreatorSettings {
  return {
    ...s,
    lookIdeas: s.lookIdeas.map((l) => l.trim()).filter(Boolean),
    choices: s.choices
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), options: c.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), description: o.description.trim() })) }))
      .filter((c) => c.options.length),
    stats: s.stats.filter((st) => st.name.trim()).map((st) => ({ ...st, name: st.name.trim(), max: Math.max(st.max, st.base) })),
    items: s.items.map((i) => i.trim()).filter(Boolean),
    routes: s.routes.filter((r) => r.label.trim() && r.message.trim()),
  };
}

const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();

function creatorVars(s: CreatorSettings): EngineVar[] {
  const group = s.group;
  const made = "Set by the player in the character creator. Keep it unless the story itself changes it.";
  const vars: EngineVar[] = [];
  if (s.askName) vars.push(newVar({ id: "creator-name", group, name: "Name", type: "text", start: "", rule: made }));
  if (s.askLook) vars.push(newVar({ id: "creator-look", group, name: "Look", type: "text", start: "", pinned: false, rule: made }));
  for (const c of s.choices)
    vars.push(newVar({ id: `creator-choice-${clean(c.name)}`, group, name: clean(c.name), type: "choice", options: c.options.map((o) => o.name), start: c.options[0].name, rule: made }));
  for (const st of s.stats)
    vars.push(
      newVar({
        id: `creator-stat-${clean(st.name)}`,
        group,
        name: clean(st.name),
        type: "number",
        start: String(st.base),
        min: 0,
        max: st.max,
        rule: `How good {{user}} is at ${st.name.toLowerCase()}, 0 to ${st.max}. Weigh it when {{user}} tries something it governs. Raise it by 1 only at a real milestone.`,
      }),
    );
  if (s.items.length && s.pickItems > 0)
    vars.push(newVar({ id: "creator-items", group, name: "Items", type: "counts", start: "", rule: "What {{user}} carries. Insert an item when {{user}} gets one; delta −1 when one is used up; remove it at 0." }));
  vars.push(newVar({ id: "creator-done", group, name: "Created", type: "toggle", start: "no", hidden: true, pinned: false, rule: "Whether the player has made their character." }));
  return vars;
}

const JS = String.raw`
settings = settings.live || settings;
var esc = CF.ui.esc;
var G = settings.group;
var steps = [];
if (settings.askName || settings.askLook) steps.push({ kind: "who", label: "You" });
settings.choices.forEach(function (c, i) { steps.push({ kind: "choice", index: i, label: c.name }); });
if (settings.stats.length) steps.push({ kind: "stats", label: "Stats" });
if (settings.items.length && settings.pickItems > 0) steps.push({ kind: "items", label: "Gear" });
steps.push({ kind: "begin", label: "Begin" });
var pick = { name: "", look: "", choices: {}, stats: {}, items: [], route: 0 };
settings.choices.forEach(function (c) { pick.choices[c.name] = c.options[0].name; });
settings.stats.forEach(function (s) { pick.stats[s.name] = s.base; });
var step = 0;
var busy = false;

function spent() {
  return settings.stats.reduce(function (n, s) { return n + pick.stats[s.name] - s.base; }, 0);
}
function left() { return settings.points - spent(); }
function created() {
  var st = app.state(G) || {};
  return st.$Created === true;
}
function blocked(kind) {
  if (kind === "who" && settings.askName && !pick.name.trim()) return "Give your character a name.";
  if (kind === "stats" && left() < 0) return "You spent more points than you have.";
  return "";
}
function dots() {
  return '<ol class="cc-steps" aria-label="Steps">' + steps.map(function (s, i) {
    return '<li class="' + (i === step ? "now" : i < step ? "done" : "") + '"' + (i === step ? ' aria-current="step"' : "") + "><span>" + (i + 1) + "</span>" + esc(s.label) + "</li>";
  }).join("") + "</ol>";
}
function who() {
  var out = '<div class="cf-stack">';
  if (settings.askName) out += '<label class="cf-stack cc-field"><span class="cf-label">Name</span><input class="cf-input" data-field="name" maxlength="60" autocomplete="off" value="' + esc(pick.name) + '"></label>';
  if (settings.askLook) {
    out += '<label class="cf-stack cc-field"><span class="cf-label">Look</span><textarea class="cf-input" data-field="look" rows="3" placeholder="Two or three details people notice">' + esc(pick.look) + "</textarea></label>";
    if (settings.lookIdeas.length)
      out += '<div class="cc-ideas">' + settings.lookIdeas.map(function (l, i) { return '<button type="button" class="cf-chip cc-idea" data-idea="' + i + '">' + esc(l) + "</button>"; }).join("") + "</div>";
  }
  return out + "</div>";
}
function choice(c) {
  return '<div class="cc-options" role="radiogroup" aria-label="' + esc(c.name) + '">' + c.options.map(function (o) {
    var on = pick.choices[c.name] === o.name;
    return '<button type="button" role="radio" aria-checked="' + on + '" class="cc-option' + (on ? " on" : "") + '" data-choice="' + esc(c.name) + '" data-value="' + esc(o.name) + '"><b>' + esc(o.name) + "</b>" +
      (o.description ? '<span class="cf-small cf-muted">' + esc(o.description) + "</span>" : "") + "</button>";
  }).join("") + "</div>";
}
function stats() {
  return '<div class="cf-stack"><div class="cf-spread"><span class="cf-muted cf-small">Spend your points</span><span class="cf-chip cc-left' + (left() < 0 ? " over" : "") + '">' + left() + " left</span></div>" +
    settings.stats.map(function (s) {
      var v = pick.stats[s.name];
      var pips = "";
      for (var i = 1; i <= s.max; i++) pips += '<i class="' + (i <= v ? "on" : "") + (i <= s.base ? " base" : "") + '"></i>';
      return '<div class="cc-stat"><span class="cc-stat-name">' + esc(s.name) + '</span><span class="cc-pips" aria-hidden="true">' + pips + "</span>" +
        '<button type="button" class="cf-btn" data-stat="' + esc(s.name) + '" data-step="-1" aria-label="Less ' + esc(s.name) + '"' + (v <= s.base ? " disabled" : "") + ">−</button>" +
        '<b class="cc-num" aria-live="polite">' + v + "</b>" +
        '<button type="button" class="cf-btn" data-stat="' + esc(s.name) + '" data-step="1" aria-label="More ' + esc(s.name) + '"' + (v >= s.max || left() <= 0 ? " disabled" : "") + ">+</button></div>";
    }).join("") + "</div>";
}
function items() {
  var full = pick.items.length >= settings.pickItems;
  return '<div class="cf-stack"><span class="cf-muted cf-small">Pick ' + settings.pickItems + " (" + pick.items.length + " chosen)</span>" +
    '<div class="cc-items">' + settings.items.map(function (it) {
      var on = pick.items.indexOf(it) >= 0;
      return '<button type="button" class="cc-item' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-item="' + esc(it) + '"' + (!on && full ? " disabled" : "") + ">" + esc(it) + "</button>";
    }).join("") + "</div></div>";
}
function summaryLine() {
  var parts = [];
  if (pick.name.trim()) parts.push(pick.name.trim());
  if (pick.look.trim()) parts.push(pick.look.trim());
  settings.choices.forEach(function (c) { parts.push(c.name + ": " + pick.choices[c.name]); });
  if (settings.stats.length) parts.push(settings.stats.map(function (s) { return s.name + " " + pick.stats[s.name]; }).join(", "));
  if (pick.items.length) parts.push("Carrying: " + pick.items.join(", "));
  return parts.join(". ");
}
function begin() {
  var out = '<div class="cf-stack"><div class="cf-card cc-review"><span class="cf-label">Your character</span><p>' + esc(summaryLine() || "Ready.") + "</p></div>";
  if (settings.routes.length > 1)
    out += '<span class="cf-label">Where does it start?</span><div class="cc-options" role="radiogroup" aria-label="Start">' + settings.routes.map(function (r, i) {
      var on = pick.route === i;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="cc-option' + (on ? " on" : "") + '" data-route="' + i + '"><b>' + esc(r.label) + "</b>" + (r.description ? '<span class="cf-small cf-muted">' + esc(r.description) + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  return out + "</div>";
}
function done() {
  var st = app.state(G) || {};
  var bits = settings.choices.map(function (c) { return st[c.name]; }).filter(Boolean);
  var items = Object.keys(st.Items || {});
  return '<div class="cf-card cc-done"><div class="cf-row">' + CF.ui.avatar(null, st.Name || "?") + '<div style="min-width:0"><span class="cf-label">Your character</span><h2>' + esc(st.Name || "You") + "</h2></div></div>" +
    (st.Look ? '<p class="cf-small">' + esc(st.Look) + "</p>" : "") +
    (bits.length ? '<div class="cf-row" style="flex-wrap:wrap">' + bits.map(function (b) { return CF.ui.chip(b); }).join("") + "</div>" : "") +
    (settings.stats.length ? CF.ui.grid(settings.stats.map(function (s) { return { label: s.name, value: st[s.name] == null ? s.base : st[s.name] }; })) : "") +
    (items.length ? '<p class="cf-small cf-muted">Carrying: ' + esc(items.join(", ")) + "</p>" : "") + "</div>";
}
function render() {
  if (created()) {
    root.innerHTML = '<div class="cc">' + done() + "</div>";
    return;
  }
  var s = steps[step];
  var body = s.kind === "who" ? who() : s.kind === "choice" ? choice(settings.choices[s.index]) : s.kind === "stats" ? stats() : s.kind === "items" ? items() : begin();
  var why = blocked(s.kind);
  root.innerHTML = '<div class="cc cf-card"><div class="cc-head"><h2>' + esc(settings.title) + "</h2>" + (step === 0 && settings.intro ? '<p class="cf-small cf-muted">' + esc(settings.intro) + "</p>" : "") + "</div>" +
    dots() + '<h3 class="cc-title">' + esc(s.kind === "begin" ? "Ready?" : s.label) + "</h3>" + body +
    (why ? '<p class="cf-small cc-why" role="status">' + esc(why) + "</p>" : "") +
    '<div class="cc-nav">' + (step > 0 ? '<button type="button" class="cf-btn ghost" data-nav="-1">Back</button>' : "<span></span>") +
    (s.kind === "begin"
      ? '<button type="button" class="cf-btn primary" data-begin' + (busy ? " disabled" : "") + ">" + esc(settings.routes.length > 1 ? "Begin: " + settings.routes[pick.route].label : (settings.routes[0] && settings.routes[0].label) || "Begin") + "</button>"
      : '<button type="button" class="cf-btn primary" data-nav="1"' + (why ? " disabled" : "") + ">Next</button>") + "</div></div>";
}
function start() {
  busy = true;
  render();
  var changes = [];
  if (settings.askName) changes.push([[G, "Name"], pick.name.trim()]);
  if (settings.askLook) changes.push([[G, "Look"], pick.look.trim()]);
  settings.choices.forEach(function (c) { changes.push([[G, c.name], pick.choices[c.name]]); });
  settings.stats.forEach(function (s) { changes.push([[G, s.name], pick.stats[s.name]]); });
  if (settings.items.length && settings.pickItems > 0) {
    var bag = {};
    pick.items.forEach(function (it) { bag[it] = 1; });
    changes.push([[G, "Items"], bag]);
  }
  changes.push([[G, "$Created"], true]);
  var route = settings.routes[pick.route] || settings.routes[0];
  var text = route ? route.message.split("{name}").join(pick.name.trim() || "me") : "";
  if (settings.summary) text = "[" + summaryLine() + "]" + (text ? "\n" + text : "");
  app.setMany(changes, "made in the character creator")
    .then(function () { return app.write(text, { now: true }); })
    .catch(function (e) { busy = false; app.toast("Couldn't start: " + e.message); render(); });
}
root.addEventListener("input", function (e) {
  var f = e.target.getAttribute("data-field");
  if (!f) return;
  pick[f] = e.target.value;
  var next = root.querySelector('[data-nav="1"]');
  if (next) next.disabled = !!blocked(steps[step].kind);
  var why = root.querySelector(".cc-why");
  if (why && !blocked(steps[step].kind)) why.remove();
});
root.addEventListener("click", function (e) {
  var t = e.target;
  var b;
  if ((b = t.closest("[data-idea]"))) {
    pick.look = settings.lookIdeas[Number(b.getAttribute("data-idea"))];
    return render();
  }
  if ((b = t.closest("[data-choice]"))) {
    pick.choices[b.getAttribute("data-choice")] = b.getAttribute("data-value");
    return render();
  }
  if ((b = t.closest("[data-route]"))) {
    pick.route = Number(b.getAttribute("data-route"));
    return render();
  }
  if ((b = t.closest("[data-stat]"))) {
    var name = b.getAttribute("data-stat");
    var stat = settings.stats.filter(function (s) { return s.name === name; })[0];
    var v = pick.stats[name] + Number(b.getAttribute("data-step"));
    if (v >= stat.base && v <= stat.max && (Number(b.getAttribute("data-step")) < 0 || left() > 0)) pick.stats[name] = v;
    return render();
  }
  if ((b = t.closest("[data-item]"))) {
    var it = b.getAttribute("data-item");
    var at = pick.items.indexOf(it);
    if (at >= 0) pick.items.splice(at, 1);
    else if (pick.items.length < settings.pickItems) pick.items.push(it);
    return render();
  }
  if ((b = t.closest("[data-nav]"))) {
    step = Math.max(0, Math.min(steps.length - 1, step + Number(b.getAttribute("data-nav"))));
    render();
    var first = root.querySelector("input, textarea, [role=radio]");
    if (first && first.focus) first.focus({ preventScroll: true });
    return;
  }
  if (t.closest("[data-begin]") && !busy) start();
});
render();
app.onState(function () { if (created()) render(); });
`;

const CSS = String.raw`
.cc { display: flex; flex-direction: column; gap: 12px; }
.cc-head h2 { font-size: 1.25em; color: var(--cf-accent); }
.cc-steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.cc-steps li { display: flex; align-items: center; gap: 4px; font-size: 0.8em; color: var(--cf-muted); white-space: nowrap; padding: 2px 8px 2px 2px; border-radius: 999px; }
.cc-steps li span { width: 1.6em; height: 1.6em; border-radius: 50%; display: grid; place-items: center; background: var(--cf-surface2); font-size: 0.9em; }
.cc-steps li.now { color: var(--cf-text); background: color-mix(in srgb, var(--cf-accent) 14%, transparent); }
.cc-steps li.now span, .cc-steps li.done span { background: var(--cf-accent); color: #fff; }
.cc-title { font-size: 1.05em; }
.cc-field textarea { resize: vertical; min-height: 4.5em; }
.cc-ideas { display: flex; flex-wrap: wrap; gap: 6px; }
.cc-idea { border: 1px solid var(--cf-border); cursor: pointer; font: inherit; font-size: 0.8em; color: var(--cf-text); padding: 6px 10px; min-height: 32px; text-align: left; }
.cc-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.cc-option { font: inherit; color: var(--cf-text); text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; min-height: 44px; border-radius: var(--cf-radius); border: 1px solid var(--cf-border); background: var(--cf-surface2); cursor: pointer; transition: border-color 0.2s, background 0.2s; }
.cc-option.on { border-color: var(--cf-accent); background: color-mix(in srgb, var(--cf-accent) 14%, var(--cf-surface2)); box-shadow: 0 0 0 1px var(--cf-accent) inset; }
.cc-stat { display: grid; grid-template-columns: minmax(0, 1fr) auto 36px 2em 36px; align-items: center; gap: 8px; }
.cc-stat .cf-btn { justify-content: center; padding: 0; width: 36px; font-size: 1.1em; }
.cc-stat-name { overflow-wrap: anywhere; }
.cc-num { text-align: center; font-variant-numeric: tabular-nums; font-size: 1.1em; }
.cc-pips { display: flex; gap: 3px; }
.cc-pips i { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--cf-muted) 30%, transparent); transition: background 0.2s; }
.cc-pips i.on { background: var(--cf-accent); }
.cc-pips i.on.base { background: color-mix(in srgb, var(--cf-accent) 55%, var(--cf-muted)); }
.cc-left.over { background: color-mix(in srgb, var(--cf-bad) 30%, transparent); }
.cc-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 110px), 1fr)); gap: 6px; }
.cc-item { font: inherit; color: var(--cf-text); min-height: 40px; border-radius: var(--cf-radius); border: 1px solid var(--cf-border); background: var(--cf-surface2); cursor: pointer; padding: 6px 8px; }
.cc-item.on { border-color: var(--cf-accent); background: color-mix(in srgb, var(--cf-accent) 18%, var(--cf-surface2)); }
.cc-item[disabled] { opacity: 0.45; cursor: default; }
.cc-why { color: var(--cf-bad); }
.cc-nav { display: flex; justify-content: space-between; gap: 8px; padding-top: 4px; }
.cc-review p { margin-top: 4px; line-height: 1.5; }
.cc-done { display: flex; flex-direction: column; gap: 8px; }
.cc-done h2 { font-size: 1.15em; }
@media (max-width: 340px) { .cc-pips { display: none; } .cc-stat { grid-template-columns: minmax(0, 1fr) 36px 2em 36px; } }
`;

export function creatorModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = creatorSettings(raw);
  const live = usable(settings);
  return {
    id: "creator",
    name: "Character creator",
    version: "1.0.0",
    description: "An opening screen where the player makes their character: name, look, choices, stats from a point budget and starting items. Begin sends the opening message.",
    slot: "message",
    tags: ["built-in", "creator"],
    requires: [],
    core: "creator",
    enabled,
    vars: creatorVars(live),
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    // The screen gets the cleaned settings; the editor keeps the author's rows as they are.
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}

/** The tag that shows the creator in a message. */
export const CREATOR_TAG = '<cf-module id="creator"/>';
