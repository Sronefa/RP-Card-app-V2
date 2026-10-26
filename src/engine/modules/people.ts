/**
 * Shared part: people (NPC cards). A hub screen with a profile for everyone in the card's roster:
 * portrait from the card's images, role, where they are now (from their routine or the story),
 * how they feel about {{user}} with a relationship stage, and what {{user}} has learned about them.
 * Values another module already keeps (the phone's affection, say) are shared, not doubled.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface Person {
  name: string;
  role: string;
  /** A card image file; empty for the first letter. */
  avatar: string;
  about: string;
  likes: string;
}

export interface PeopleStage {
  name: string;
  /** Affection from which this stage starts. */
  from: number;
}

export interface PeopleSettings {
  title: string;
  button: string;
  people: Person[];
  affection: boolean;
  /** Lines {{user}} learns about each person, which the model adds. */
  learned: boolean;
  stages: PeopleStage[];
}

export const defaultPeopleSettings = (): PeopleSettings => ({
  title: "People",
  button: "👥 People",
  people: [],
  affection: true,
  learned: true,
  stages: [
    { name: "Stranger", from: 0 },
    { name: "Acquaintance", from: 15 },
    { name: "Friend", from: 40 },
    { name: "Close", from: 65 },
    { name: "Devoted", from: 90 },
  ],
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

export function peopleSettings(raw: Record<string, unknown> | undefined): PeopleSettings {
  const base = defaultPeopleSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    people: Array.isArray(raw.people)
      ? rows(raw.people).map((p) => ({ name: str(p.name), role: str(p.role), avatar: str(p.avatar), about: str(p.about), likes: str(p.likes) }))
      : base.people,
    affection: raw.affection !== false,
    learned: raw.learned !== false,
    stages: Array.isArray(raw.stages)
      ? rows(raw.stages).map((s) => ({ name: str(s.name), from: Number.isFinite(Number(s.from)) ? Number(s.from) : 0 }))
      : base.stages,
  };
}

/** A value's group and name, lowercased, as conflicts compare them ("$" and "_" aside). */
export const valueKey = (v: EngineVar) => [v.group.trim(), v.name.trim()].filter(Boolean).join(".").toLowerCase();

const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();

/** The settings the screen uses: unnamed rows left out, stages in order. */
function usable(s: PeopleSettings): PeopleSettings {
  return {
    ...s,
    people: s.people.filter((p) => clean(p.name)).map((p) => ({ ...p, name: clean(p.name) })),
    stages: s.stages.filter((st) => st.name.trim()).sort((a, b) => a.from - b.from),
  };
}

/** `taken` holds the value paths other modules already keep, lowercased. */
function peopleVars(s: PeopleSettings, taken: Set<string>): EngineVar[] {
  const vars: EngineVar[] = [];
  const add = (v: EngineVar) => {
    if (!taken.has(valueKey(v))) vars.push(v);
  };
  for (const p of s.people) {
    if (s.affection)
      add(newVar({ id: `people-aff-${p.name}`, group: p.name, name: "Affection", type: "number", start: "10", min: 0, max: 100, pinned: false, rule: `How ${p.name} feels about {{user}}, 0 to 100: +1 to +3 for kindness or shared moments, −2 to −5 for slights.` }));
    if (s.learned)
      add(newVar({ id: `people-learned-${p.name}`, group: p.name, name: "Learned", type: "list", start: "", pinned: false, rule: `What {{user}} has learned about ${p.name}, one short line each.` }));
  }
  return vars;
}

function peopleRules(s: PeopleSettings): ModuleRule[] {
  if (!s.learned || !s.people.length) return [];
  return [
    {
      comment: "People: what {{user}} learns",
      content: "When {{user}} learns something lasting about a person in the cast (a secret, a wish, a past, a habit), insert one short line into their Learned list. Never repeat a line that's there.",
      constant: true,
      keys: [],
      order: 100,
    },
  ];
}

const JS = String.raw`
settings = settings.live || settings;
var esc = CF.ui.esc;
function stageOf(v) {
  var out = null;
  settings.stages.forEach(function (s) { if (v >= s.from) out = s; });
  return out;
}
function nextStage(v) {
  return settings.stages.filter(function (s) { return s.from > v; })[0] || null;
}
// Where a regular is now: their own Location value, else the clock's routines.
function whereNow(name) {
  var own = app.state(name) || {};
  if (own.Location) return String(own.Location);
  var w = String(app.state("Time._Whereabouts") || "");
  var hit = w.split(";").map(function (s) { return s.trim(); }).filter(function (s) { return s.indexOf(name + ":") === 0; })[0];
  return hit ? hit.slice(name.length + 1).trim() : "";
}
function avatar(p, big) {
  return '<span class="pp-av' + (big ? " big" : "") + '">' + CF.ui.avatar(p.avatar ? app.asset(p.avatar) : null, p.name) + "</span>";
}
function home() {
  if (!settings.people.length) return CF.ui.appBar(settings.title) + '<div class="cf-appbody"><p class="cf-muted">No one here yet.</p></div>';
  return CF.ui.appBar(settings.title) + '<div class="cf-appbody"><ul class="pp-list">' + settings.people.map(function (p, i) {
    var st = app.state(p.name) || {};
    var stage = typeof st.Affection === "number" ? stageOf(st.Affection) : null;
    var where = whereNow(p.name);
    return '<li><button type="button" class="pp-row" data-person="' + i + '">' + avatar(p) +
      '<span class="pp-main"><b>' + esc(p.name) + "</b>" + (p.role ? '<span class="cf-small cf-muted">' + esc(p.role) + "</span>" : "") +
      (where ? '<span class="cf-small pp-where">' + CF.ui.icon("map") + esc(where) + "</span>" : "") + "</span>" +
      (stage ? CF.ui.chip(stage.name) : "") + "</button></li>";
  }).join("") + "</ul></div>";
}
function profile(params) {
  var p = settings.people[params.i];
  if (!p) return home();
  var st = app.state(p.name) || {};
  var d = app.delta();
  var change = d[p.name + ".Affection"];
  var out = CF.ui.appBar(p.name, { back: true }) + '<div class="cf-appbody cf-stack"><div class="pp-hero">' + avatar(p, true) +
    "<div><h2>" + esc(p.name) + "</h2>" + (p.role ? '<span class="cf-muted">' + esc(p.role) + "</span>" : "") + "</div></div>";
  if (typeof st.Affection === "number") {
    var stage = stageOf(st.Affection), next = nextStage(st.Affection);
    out += '<div class="cf-card cf-stack">' + CF.ui.meter({ label: "Affection", value: st.Affection, max: 100, delta: change ? change[1] - change[0] : undefined }) +
      '<div class="cf-spread cf-small">' + (stage ? CF.ui.chip(stage.name) : "<span></span>") +
      (next ? '<span class="cf-muted">' + esc(next.name) + " at " + next.from + "</span>" : "") + "</div></div>";
  }
  var where = whereNow(p.name);
  if (where) out += '<div class="cf-card"><span class="cf-label">Where now</span><p>' + esc(where) + "</p></div>";
  if (p.about) out += '<div class="cf-card"><span class="cf-label">About</span><p>' + esc(p.about) + "</p></div>";
  if (p.likes) out += '<div class="cf-card"><span class="cf-label">Likes</span><p>' + esc(p.likes) + "</p></div>";
  var learned = Array.isArray(st.Learned) ? st.Learned : [];
  if (settings.learned)
    out += '<div class="cf-card"><span class="cf-label">What you know</span>' +
      (learned.length ? '<ul class="pp-learned">' + learned.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : '<p class="cf-small cf-muted">Nothing yet. Spend time together.</p>') + "</div>";
  return out + "</div>";
}
var nav = app.router(root, { home: home, person: profile }, "home");
root.addEventListener("click", function (e) {
  var b = e.target.closest("[data-person]");
  if (b) nav.go("person", { i: Number(b.getAttribute("data-person")) });
});
`;

const CSS = String.raw`
.pp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pp-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; min-height: 56px; text-align: left; font: inherit; color: var(--cf-text);
  border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); cursor: pointer; }
.pp-row:hover, .pp-row:focus-visible { border-color: var(--cf-accent); }
.pp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.pp-where { display: inline-flex; align-items: center; gap: 4px; color: var(--cf-accent); }
.pp-where svg { width: 12px; height: 12px; flex: none; }
.pp-hero { display: flex; align-items: center; gap: 14px; }
.pp-hero h2 { font-family: var(--cf-heading); font-size: 1.35em; }
.pp-av.big .cf-avatar { width: 84px; height: 84px; font-size: 2em; }
.pp-learned { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
`;

/** `taken` holds the values other modules keep (by valueKey), so those are shared. */
export function peopleModule(raw?: Record<string, unknown>, enabled = true, taken: Set<string> = new Set()): EngineModule {
  const settings = peopleSettings(raw);
  const live = usable(settings);
  return {
    id: "people",
    name: "People",
    version: "1.0.0",
    description: "A profile for everyone in the cast: portrait, role, where they are now, how they feel about you and what you've learned.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "npc", "relationships"],
    requires: [],
    core: "people",
    enabled,
    vars: peopleVars(live, taken),
    rules: peopleRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
