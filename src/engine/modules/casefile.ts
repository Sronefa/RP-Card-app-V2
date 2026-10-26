/**
 * Kit part (Horror / mystery): the case file. The question at the heart of the story, the clues
 * {{user}} has found and where, the suspects, and an evidence board where the player pins clues to
 * suspects with red string. From there {{user}} can question a suspect or accuse one with the
 * evidence pinned to them. The truth is the author's, sent to the model only, so the clues it
 * plants point the same way all game. An optional dread meter rises with what {{user}} sees, and
 * the screen comes apart a little as it climbs.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface Suspect {
  name: string;
  description: string;
  /** A card image for their photo on the board; empty for the first letter. */
  avatar: string;
}

export interface Clue {
  name: string;
  where: string;
}

export interface CaseSettings {
  title: string;
  button: string;
  /** The case's name, like "The Hollow House". */
  caseName: string;
  /** What {{user}} is trying to find out. */
  question: string;
  /** What really happened. Only the model sees it, so the clues stay consistent. */
  truth: string;
  suspects: Suspect[];
  /** Clues {{user}} starts with. */
  clues: Clue[];
  /** The fear meter's name, like "Dread"; empty for none. */
  dread: string;
}

export const defaultCaseSettings = (): CaseSettings => ({
  title: "Case file",
  button: "🔎 Case",
  caseName: "The Hollow House",
  question: "What happened to Mara Vell, and who is still in the house?",
  truth:
    "Mara is alive, hidden in the walled-up nursery by her brother Elias, who believes the house will take her if she leaves. The caretaker knows and is paid to keep quiet. The noises at night are Elias bringing her food. The 'ghost' is real too, but it only wants the nursery opened.",
  suspects: [
    { name: "Elias Vell", description: "Mara's brother. Polite and exhausted. Never lets you upstairs alone.", avatar: "" },
    { name: "Mrs. Harrow", description: "The caretaker for thirty years. Keeps the keys and her own counsel.", avatar: "" },
    { name: "Father Doyle", description: "The parish priest. Blessed the house twice this year. Won't say why.", avatar: "" },
  ],
  clues: [{ name: "Mara's last letter", where: "Your desk" }],
  dread: "Dread",
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();

export function caseSettings(raw: Record<string, unknown> | undefined): CaseSettings {
  const base = defaultCaseSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    caseName: str(raw.caseName, base.caseName),
    question: str(raw.question, base.question),
    truth: str(raw.truth, base.truth),
    suspects: Array.isArray(raw.suspects) ? rows(raw.suspects).map((s) => ({ name: str(s.name), description: str(s.description), avatar: str(s.avatar) })) : base.suspects,
    clues: Array.isArray(raw.clues) ? rows(raw.clues).map((c) => ({ name: str(c.name), where: str(c.where) })) : base.clues,
    dread: clean(str(raw.dread, base.dread)),
  };
}

/** A line in the state, "Name — detail", without commas (they split list starting values). */
const line = (name: string, detail: string) => (detail.trim() ? `${name.trim()} — ${detail.trim()}` : name.trim()).replace(/,/g, ";");

function usable(s: CaseSettings) {
  return { ...s, suspects: s.suspects.filter((x) => x.name.trim()), clues: s.clues.filter((c) => c.name.trim()) };
}
type Live = ReturnType<typeof usable>;

function caseVars(s: Live): EngineVar[] {
  const vars = [
    newVar({ id: "case-clues", group: "Case", name: "Clues", type: "list", start: s.clues.map((c) => line(c.name, c.where)).join(", "), rule: 'Clues {{user}} has found, as "Clue — where it was found". Insert one when {{user}} finds or works something out; keep it short and concrete.' }),
    newVar({ id: "case-suspects", group: "Case", name: "Suspects", type: "list", start: s.suspects.map((x) => line(x.name, x.description)).join(", "), pinned: false, rule: 'People who might be behind it, as "Name — what {{user}} knows of them". Insert one when they come under suspicion; update what {{user}} knows.' }),
    newVar({ id: "case-links", group: "Case", name: "Links", type: "list", start: "", readOnly: true, pinned: false, rule: 'The player\'s evidence board, as "Clue → Suspect": what they think points where. It\'s their theory, right or wrong.' }),
    newVar({ id: "case-theory", group: "Case", name: "Theory", type: "text", start: "", readOnly: true, pinned: false, rule: "The player's own notes on what happened. Let {{user}} think along those lines; don't confirm or deny it." }),
    newVar({ id: "case-solved", group: "Case", name: "Solved", type: "toggle", start: "no", pinned: false, rule: "Whether the case is solved: set it when {{user}} names the truth with the evidence to back it." }),
  ];
  if (s.dread)
    vars.push(
      newVar({
        id: "case-dread",
        group: "Case",
        name: s.dread,
        type: "number",
        start: "0",
        min: 0,
        max: 100,
        rule: `{{user}}'s ${s.dread.toLowerCase()}, 0 to 100. +5 to +15 for something wrong, +20 or more for something unspeakable; −5 to −15 for light, company, a drink, a prayer. Above 50 {{user}}'s senses start to lie; above 80 they can't trust anything.`,
      }),
    );
  return vars;
}

function caseRules(s: Live): ModuleRule[] {
  const rules: ModuleRule[] = [
    {
      comment: "Case actions",
      content: [
        '<action app="case"> is something {{user}} chose in the case file:',
        '- {"question":N}: {{user}} confronts N. N answers in character: lies where they have reason to, slips where the evidence is strong.',
        '- {"examine":C}: {{user}} looks again at the clue C. Give one new detail, true to what really happened; it can be a new clue.',
        '- {"accuse":N,"evidence":[…]}: {{user}} accuses N, laying out the clues pinned to them. If N did it and the evidence holds, the truth comes out and /Case/Solved is set. If not, it costs {{user}}: trust, safety, time, or worse.',
      ].join("\n"),
      constant: false,
      keys: ['app="case"'],
      depth: 2,
      order: 100,
    },
  ];
  const body = [
    s.question ? `The case${s.caseName ? ` (${s.caseName})` : ""}: ${s.question}` : "",
    s.truth ? `What really happened (the player must never be told outright; every clue you plant points this way, and red herrings fall apart under a second look): ${s.truth}` : "",
    "Let {{user}} earn the answer: clues come from searching, asking and noticing, one at a time.",
  ]
    .filter(Boolean)
    .join("\n");
  rules.push({ comment: "The case", content: body, constant: true, keys: [], order: 100 });
  return rules;
}

const SCRIPT = String.raw`
var S = settings.live || settings;
function name(l) { return String(l).split(/\s+[—–-]\s+/)[0].trim(); }
function added(now, was) { return (Array.isArray(now) ? now : []).filter(function (l) { return (Array.isArray(was) ? was : []).map(name).indexOf(name(l)) < 0; }); }
hooks.afterUpdate(function (stat, before, info) {
  var C = stat && stat.Case;
  if (!C || typeof C !== "object") return stat;
  if (S.dread && typeof C[S.dread] === "number") C[S.dread] = Math.max(0, Math.min(100, Math.round(C[S.dread])));
  var B = before && before.Case;
  if (B && info && info.latest) {
    var news = [];
    added(C.Clues, B.Clues).forEach(function (l) { news.push(["New clue", name(l), "search"]); });
    added(C.Suspects, B.Suspects).forEach(function (l) { news.push(["New suspect", name(l), "eye"]); });
    if (C.Solved === true && B.Solved !== true) news.push(["Case closed", S.caseName || "Solved", "check"]);
    if (S.dread) {
      var d = Number(C[S.dread]) || 0, w = Number(B[S.dread]) || 0;
      if (d >= 80 && w < 80) news.push([S.dread, "You can't trust what you see", "skull"]);
      else if (d >= 50 && w < 50) news.push([S.dread, "Something is wrong", "eye"]);
    }
    news.forEach(function (n, i) { setTimeout(function () { CF.bus.emit("notify", { title: n[0], text: n[1], icon: n[2], open: "case" }); }, 500 + i * 250); });
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "board";
var held = "";
function list(path) { var v = app.state(path); return Array.isArray(v) ? v : []; }
function split(l) { var m = /^(.*?)\s+[—–-]\s+(.*)$/.exec(String(l)); return { name: (m ? m[1] : String(l)).trim(), note: m ? m[2] : "" }; }
function links() { return list("Case._Links").map(function (l) { var m = /^(.*?)\s*→\s*(.*)$/.exec(String(l)); return m ? { clue: m[1].trim(), who: m[2].trim() } : null; }).filter(Boolean); }
function pinned(who) { return links().filter(function (k) { return k.who === who; }).map(function (k) { return k.clue; }); }
function face(n) {
  var s = S.suspects.filter(function (x) { return x.name.trim() === n; })[0];
  return ui.avatar(s && s.avatar ? app.asset(s.avatar) : null, n);
}
function dread() { return S.dread ? Number(app.state("Case." + S.dread)) || 0 : 0; }
function act(payload, text) { app.send("case", payload, text).then(function () { app.toast("In your message box: send it when you're ready"); }); }
function save(next, why) { return app.setMany([[["Case", "_Links"], next.map(function (k) { return k.clue + " → " + k.who; })]], why); }
function head() {
  var solved = app.state("Case.Solved") === true;
  var d = dread();
  return '<div class="cf-card cs-head' + (solved ? " solved" : "") + '"><span class="cf-label">' + esc(S.caseName || "The case") + "</span>" +
    (S.question ? '<p class="cs-q">' + esc(S.question) + "</p>" : "") + (solved ? '<span class="cs-stamp">Solved</span>' : "") +
    (S.dread ? '<div class="cs-dread">' + ui.meter({ label: S.dread, value: d, max: 100, showMax: false }) + "</div>" : "") + "</div>";
}
function board() {
  var sus = list("Case.Suspects").map(split), clues = list("Case.Clues").map(split), ls = links();
  if (!sus.length && !clues.length) return '<p class="cf-muted">Nothing on the board yet.</p>';
  return '<div class="cs-board"><svg class="cs-strings" aria-hidden="true"></svg>' +
    '<div class="cs-row cs-sus">' + sus.map(function (s, i) {
      var n = pinned(s.name).length;
      return '<button type="button" class="cs-photo r' + (i % 3) + (held ? " target" : "") + '" data-who="' + esc(s.name) + '">' + face(s.name) + "<b>" + esc(s.name) + "</b>" + (n ? '<span class="cs-count">' + n + "</span>" : "") + "</button>";
    }).join("") + "</div>" +
    '<div class="cs-row cs-clues">' + clues.map(function (c, i) {
      var on = ls.some(function (k) { return k.clue === c.name; });
      return '<button type="button" class="cs-note r' + (i % 3) + (held === c.name ? " held" : "") + (on ? " linked" : "") + '" data-clue="' + esc(c.name) + '"><b>' + esc(c.name) + "</b>" + (c.note ? "<span>" + esc(c.note) + "</span>" : "") + "</button>";
    }).join("") + "</div></div>" +
    '<p class="cf-small cf-muted cs-hint">' + (held ? "Now tap the suspect it points to. Tap a pinned pair again to pull the string." : "Tap a clue, then a suspect, to pin them together with string.") + "</p>";
}
function strings() {
  var svg = root.querySelector(".cs-strings"), box = root.querySelector(".cs-board");
  if (!svg || !box) return;
  var r = box.getBoundingClientRect();
  svg.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
  function find(attr, v) { var all = root.querySelectorAll("[" + attr + "]"); for (var i = 0; i < all.length; i++) if (all[i].getAttribute(attr) === v) return all[i]; return null; }
  svg.innerHTML = links().map(function (k) {
    var a = find("data-clue", k.clue), b = find("data-who", k.who);
    if (!a || !b) return "";
    var p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    var x1 = p.left + p.width / 2 - r.left, y1 = p.top + 6 - r.top, x2 = q.left + q.width / 2 - r.left, y2 = q.bottom - 6 - r.top;
    return '<path d="M' + x1 + " " + y1 + " Q" + (x1 + x2) / 2 + " " + ((y1 + y2) / 2 + 24) + " " + x2 + " " + y2 + '"/>';
  }).join("");
}
function suspects() {
  var sus = list("Case.Suspects").map(split);
  if (!sus.length) return '<p class="cf-muted">No suspects yet.</p>';
  return '<div class="cf-stack">' + sus.map(function (s) {
    var ev = pinned(s.name);
    return '<article class="cf-card cs-sus-card"><header>' + face(s.name) + "<div><b>" + esc(s.name) + "</b>" + (s.note ? '<span class="cf-small cf-muted">' + esc(s.note) + "</span>" : "") + "</div></header>" +
      (ev.length ? '<div class="cs-ev">' + ev.map(function (c) { return ui.chip(c); }).join("") + "</div>" : '<p class="cf-small cf-muted">No evidence pinned.</p>') +
      '<div class="cs-btns"><button type="button" class="cf-btn" data-question="' + esc(s.name) + '">Question</button><button type="button" class="cf-btn primary" data-accuse="' + esc(s.name) + '">Accuse</button></div></article>';
  }).join("") + "</div>";
}
function notes() {
  var clues = list("Case.Clues").map(split);
  return '<div class="cf-stack"><div class="cf-card"><label class="cf-label" for="cs-theory">Your theory</label><textarea id="cs-theory" class="cs-theory" rows="5" placeholder="What do you think happened?">' + esc(app.state("Case._Theory") || "") + '</textarea><button type="button" class="cf-btn primary cs-save" data-theory>Save notes</button></div>' +
    (clues.length ? '<ul class="cs-clue-list">' + clues.map(function (c) {
      return '<li><div><b>' + esc(c.name) + "</b>" + (c.note ? '<span class="cf-small cf-muted">' + esc(c.note) + "</span>" : "") + '</div><button type="button" class="cf-btn ghost" data-examine="' + esc(c.name) + '">Look closer</button></li>';
    }).join("") + "</ul>" : "") + "</div>";
}
function draw() {
  var d = dread();
  var tabs = [{ id: "board", label: "Board", html: board() }, { id: "suspects", label: "Suspects", html: suspects() }, { id: "notes", label: "Notes", html: notes() }];
  root.innerHTML = '<div class="cs' + (d >= 80 ? " d2" : d >= 50 ? " d1" : "") + '">' + ui.appBar(S.title) + '<div class="cf-appbody cf-stack">' + head() + ui.tabs(tabs, tab) + "</div></div>";
  requestAnimationFrame(strings);
}
function accuse(who) {
  var ev = pinned(who);
  var m = app.modal("<h2>Accuse " + esc(who) + '?</h2><p class="cf-muted">' + (ev.length ? "You lay out what's pinned to them:" : "Nothing on the board points to them. You'd be going on instinct.") + "</p>" +
    (ev.length ? '<div class="cs-ev">' + ev.map(function (c) { return ui.chip(c); }).join("") + "</div>" : "") +
    '<div class="cf-stack" style="margin-top:12px"><button type="button" class="cf-btn primary" data-yes>Make the accusation</button><button type="button" class="cf-btn ghost" data-cf-close>Not yet</button></div>');
  m.addEventListener("click", function (ev2) { if (ev2.target.closest("[data-yes]")) { m.remove(); act({ accuse: who, evidence: ev }, "It was you, " + who + "." + (ev.length ? " " + ev.join(", ") + "." : "")); } });
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); held = ""; requestAnimationFrame(strings); return; }
  if ((b = t.closest("[data-clue]"))) { var c = b.getAttribute("data-clue"); held = held === c ? "" : c; return draw(); }
  if ((b = t.closest("[data-who]"))) {
    if (!held) return;
    var who = b.getAttribute("data-who"), clue = held, ls = links();
    held = "";
    var has = ls.some(function (k) { return k.clue === clue && k.who === who; });
    var next = has ? ls.filter(function (k) { return !(k.clue === clue && k.who === who); }) : ls.concat([{ clue: clue, who: who }]);
    return save(next, has ? "unpinned " + clue + " from " + who : "pinned " + clue + " to " + who);
  }
  if ((b = t.closest("[data-question]"))) { var q = b.getAttribute("data-question"); return act({ question: q }, "I need a word with " + q + "."); }
  if ((b = t.closest("[data-accuse]"))) return accuse(b.getAttribute("data-accuse"));
  if ((b = t.closest("[data-examine]"))) { var x = b.getAttribute("data-examine"); return act({ examine: x }, "I look at the " + x.charAt(0).toLowerCase() + x.slice(1) + " again."); }
  if (t.closest("[data-theory]")) {
    var text = root.querySelector("#cs-theory").value.trim();
    return app.setMany([[["Case", "_Theory"], text]], "wrote down a theory").then(function () { app.toast("Notes saved"); });
  }
});
window.addEventListener("resize", strings);
draw();
app.onState(draw);
`;

const CSS = String.raw`
.cs-head { position: relative; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
.cs-q { font-family: var(--cf-heading); font-size: 1.05em; line-height: 1.4; }
.cs-stamp { position: absolute; top: 10px; right: -4px; transform: rotate(12deg); padding: 2px 12px; border: 3px double var(--cf-good); color: var(--cf-good); font-weight: 700; text-transform: uppercase; letter-spacing: .2em; font-size: .8em; }
.cs-dread .cf-meter-fill { background: linear-gradient(90deg, #4b4b4b, var(--cf-bad)); }
.cs-board { position: relative; padding: 14px 10px; border-radius: var(--cf-radius); border: 1px solid var(--cf-border);
  background: radial-gradient(circle at 30% 20%, rgba(255,255,255,.05), transparent 60%), repeating-radial-gradient(circle at 10% 10%, rgba(0,0,0,.05) 0 2px, transparent 2px 5px), color-mix(in srgb, #8a6a43 55%, var(--cf-surface2)); }
.cs-strings { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; }
.cs-strings path { fill: none; stroke: #c4141f; stroke-width: 2; filter: drop-shadow(0 1px 1px rgba(0,0,0,.5)); }
.cs-row { position: relative; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.cs-sus { margin-bottom: 26px; }
.cs-photo, .cs-note { font: inherit; color: #1b1712; cursor: pointer; position: relative; box-shadow: 0 3px 8px rgba(0,0,0,.35); transition: transform .15s; }
.cs-photo { width: 96px; padding: 6px 6px 8px; background: #f3efe6; border: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.cs-photo .cf-avatar { width: 84px; height: 72px; border-radius: 0; font-size: 1.6em; background-color: #3b3733; color: #e6e0d4; filter: grayscale(.8) contrast(1.1); }
.cs-photo b { font-size: .78em; line-height: 1.2; overflow-wrap: anywhere; }
.cs-photo.target { outline: 2px dashed #c4141f; outline-offset: 2px; }
.cs-count { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; border-radius: 10px; background: #c4141f; color: #fff; font-size: .72em; display: grid; place-items: center; }
.cs-note { width: 132px; min-height: 72px; padding: 14px 8px 8px; border: 0; text-align: left; display: flex; flex-direction: column; gap: 3px; background: #fbf3c4; }
.cs-note::before { content: ""; position: absolute; top: 4px; left: 50%; width: 9px; height: 9px; margin-left: -4px; border-radius: 50%; background: #c4141f; box-shadow: 0 1px 2px rgba(0,0,0,.5); }
.cs-note b { font-size: .82em; line-height: 1.25; }
.cs-note span { font-size: .72em; opacity: .75; }
.cs-note.linked { background: #f7e7a6; }
.cs-note.held { transform: translateY(-4px) scale(1.04); box-shadow: 0 0 0 2px #c4141f, 0 8px 16px rgba(0,0,0,.4); }
.r0 { transform: rotate(-1.5deg); } .r2 { transform: rotate(1.2deg); }
.cs-hint { text-align: center; }
.cs-sus-card header { display: flex; gap: 10px; align-items: center; }
.cs-sus-card header > div { display: flex; flex-direction: column; min-width: 0; }
.cs-ev { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cs-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.cs-btns .cf-btn, .cs-save { justify-content: center; min-height: 44px; }
.cs-theory { width: 100%; margin: 6px 0 8px; padding: 8px 10px; font: inherit; color: var(--cf-text); background: var(--cf-surface2); border: 1px solid var(--cf-border); border-radius: var(--cf-radius); resize: vertical; }
.cs-clue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cs-clue-list li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: var(--cf-radius); background: var(--cf-surface2); }
.cs-clue-list li > div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cs-clue-list .cf-btn { flex: none; min-height: 40px; }
/* Dread: the screen comes apart */
.cs.d1 .cf-appbar h1 { animation: cs-flicker 3.5s steps(1) infinite; }
.cs.d2 .cf-appbody { animation: cs-drift 6s ease-in-out infinite; }
.cs.d2 .cf-appbar h1 { animation: cs-flicker 1.2s steps(1) infinite; text-shadow: 2px 0 rgba(196,20,31,.7), -2px 0 rgba(0,180,160,.5); }
.cs.d2 .cs-photo .cf-avatar { filter: grayscale(1) contrast(1.6) blur(.6px); }
@keyframes cs-flicker { 0%, 100% { opacity: 1; } 47% { opacity: .35; } 49% { opacity: 1; } 83% { opacity: .6; } }
@keyframes cs-drift { 50% { transform: translate(.6px, -.6px) skewX(-.4deg); filter: blur(.25px); } }
@media (prefers-reduced-motion: reduce) { .cs.d1 .cf-appbar h1, .cs.d2 .cf-appbar h1, .cs.d2 .cf-appbody { animation: none; } .cs-note, .cs-photo { transition: none; } }
`;

export function caseModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = caseSettings(raw);
  const live = usable(settings);
  return {
    id: "case",
    name: "Case file",
    version: "1.0.0",
    description: "The question, the clues and the suspects; an evidence board with red string; questioning and accusing; a dread meter.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "mystery", "horror", "clues"],
    requires: [],
    core: "case",
    enabled,
    vars: caseVars(live),
    rules: caseRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
