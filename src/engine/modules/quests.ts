/**
 * Kit part (Fantasy RPG, Dark fantasy, Isekai): the quest log. Quests {{user}} has taken, with
 * their objective as it stands; a board of offers to accept; what's done and what failed; and a
 * rank that rises with renown (a guild's F to S). One quest is tracked and pinned to the status
 * panel. Banners announce new, finished and failed quests and a new rank.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface Quest {
  name: string;
  objective: string;
  reward: string;
  giver: string;
}

export interface QuestRank {
  name: string;
  from: number;
}

export interface QuestsSettings {
  title: string;
  button: string;
  /** What the board is called: a guild board, a notice board, the System. */
  board: string;
  /** Quests {{user}} starts with. */
  start: Quest[];
  /** Offers on the board at the start. */
  offers: Quest[];
  ranks: QuestRank[];
}

export const defaultQuestsSettings = (): QuestsSettings => ({
  title: "Quests",
  button: "📜 Quests",
  board: "Guild board",
  start: [{ name: "A new arrival", objective: "Register at the adventurers' guild", reward: "A guild card", giver: "" }],
  offers: [
    { name: "Wolves at the mill", objective: "Drive off the wolves troubling the old mill", reward: "40 gold", giver: "The miller" },
    { name: "Herbs for the healer", objective: "Gather ten silverleaf from the forest edge", reward: "20 gold, 2 health potions", giver: "Sister Ana" },
    { name: "The missing courier", objective: "Find the courier who never reached the next town", reward: "80 gold", giver: "Merchant guild" },
  ],
  ranks: [
    { name: "F", from: 0 },
    { name: "E", from: 50 },
    { name: "D", from: 150 },
    { name: "C", from: 300 },
    { name: "B", from: 600 },
    { name: "A", from: 1000 },
    { name: "S", from: 2000 },
  ],
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const quests = (v: unknown) => rows(v).map((q) => ({ name: str(q.name), objective: str(q.objective), reward: str(q.reward), giver: str(q.giver) }));

export function questsSettings(raw: Record<string, unknown> | undefined): QuestsSettings {
  const base = defaultQuestsSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    board: str(raw.board, base.board),
    start: Array.isArray(raw.start) ? quests(raw.start) : base.start,
    offers: Array.isArray(raw.offers) ? quests(raw.offers) : base.offers,
    ranks: Array.isArray(raw.ranks) ? rows(raw.ranks).map((r) => ({ name: str(r.name), from: Math.max(0, num(r.from, 0)) })) : base.ranks,
  };
}

/** A quest as a line in the state: "Name — objective". */
export const questLine = (q: Quest) => (q.objective.trim() ? `${q.name.trim()} — ${q.objective.trim()}` : q.name.trim());
/** An offer adds its reward: "Name — objective (reward: 40 gold)". */
const offerLine = (q: Quest) => questLine(q) + (q.reward.trim() ? ` (reward: ${q.reward.trim()})` : "");
// Commas split list starting values, so lines go in without them.
const startOf = (lines: string[]) => lines.map((l) => l.replace(/,/g, ";")).join(", ");

function usable(s: QuestsSettings, xp: string) {
  const named = (q: Quest) => q.name.trim();
  return {
    ...s,
    start: s.start.filter(named),
    offers: s.offers.filter(named),
    ranks: s.ranks.filter((r) => r.name.trim()).sort((a, b) => a.from - b.from),
    xp,
  };
}
type Live = ReturnType<typeof usable>;

function questsVars(s: Live): EngineVar[] {
  const vars = [
    newVar({ id: "quests-active", group: "Quests", name: "Active", type: "list", start: startOf(s.start.map(questLine)), rule: 'Quests {{user}} has taken, as "Name — objective". Update the objective as it moves on.' }),
    newVar({ id: "quests-board", group: "Quests", name: "Board", type: "list", start: startOf(s.offers.map(offerLine)), pinned: false, rule: `Offers on the ${s.board || "board"}, as "Name — objective (reward: …)". Add new ones now and then; take old ones down.` }),
    newVar({ id: "quests-done", group: "Quests", name: "Done", type: "list", start: "", pinned: false, rule: "Finished quests, by name." }),
    newVar({ id: "quests-failed", group: "Quests", name: "Failed", type: "list", start: "", pinned: false, rule: "Failed or abandoned quests, by name." }),
    newVar({ id: "quests-tracked", group: "Quests", name: "Tracked", type: "text", start: s.start[0]?.name.trim() ?? "", rule: "The quest the player is following; the player picks it. Keep it in mind when you suggest what's next." }),
  ];
  if (s.ranks.length) {
    vars.push(newVar({ id: "quests-renown", group: "Quests", name: "Renown", type: "number", start: "0", min: 0, pinned: false, rule: "{{user}}'s standing: +10 to +50 for a finished quest by its size, −10 for a failed one." }));
    vars.push(newVar({ id: "quests-rank", group: "Quests", name: "Rank", type: "text", start: s.ranks[0].name, readOnly: true, rule: "{{user}}'s rank, set by the engine from renown. Higher ranks get harder, better-paid work." }));
  }
  return vars;
}

function questsRules(s: Live): ModuleRule[] {
  const pay = [`pay its reward`, s.xp ? `add XP to /${s.xp.replace(/\./g, "/")}` : "", s.ranks.length ? "raise /Quests/Renown" : ""].filter(Boolean).join(", ");
  return [
    {
      comment: "Quest actions",
      content: [
        '<action app="quests"> is something {{user}} chose in the quest log:',
        `- {"accept":Q}: {{user}} takes the offer Q. Remove it from /Quests/Board and insert "Name — objective" into /Quests/Active; whoever gave it explains.`,
        '- {"abandon":Q}: {{user}} gives Q up. Remove it from /Quests/Active and insert its name into /Quests/Failed.',
        '- {"ask":Q}: {{user}} asks around about Q. Give a lead that moves it on.',
      ].join("\n"),
      constant: false,
      keys: ['app="quests"'],
      depth: 2,
      order: 100,
    },
    {
      comment: "Quests",
      content: `When a quest in /Quests/Active is done, remove it, insert its name into /Quests/Done and ${pay}. A quest that can no longer be done goes into /Quests/Failed the same way.`,
      constant: true,
      keys: [],
      order: 100,
    },
  ];
}

const SCRIPT = String.raw`
var S = settings.live || settings;
function name(line) { return String(line).split(/\s+[—–-]\s+|:\s/)[0].trim(); }
function rankOf(v) { var out = S.ranks[0]; S.ranks.forEach(function (r) { if (v >= r.from) out = r; }); return out; }
function added(now, was) { return (Array.isArray(now) ? now : []).filter(function (l) { return (Array.isArray(was) ? was : []).indexOf(l) < 0; }); }
hooks.afterUpdate(function (stat, before, info) {
  var Q = stat && stat.Quests;
  if (!Q || typeof Q !== "object") return stat;
  var active = Array.isArray(Q.Active) ? Q.Active : [];
  var names = active.map(name);
  if (!Q.Tracked || names.indexOf(Q.Tracked) < 0) Q.Tracked = names[0] || "";
  if (S.ranks.length) Q._Rank = rankOf(Number(Q.Renown) || 0).name;
  var B = before && before.Quests;
  if (B && info && info.latest) {
    var wasNames = (B.Active || []).map(name);
    var news = [];
    added(Q.Active, B.Active).forEach(function (l) { if (wasNames.indexOf(name(l)) < 0) news.push(["New quest", name(l), "scroll"]); });
    added(Q.Done, B.Done).forEach(function (l) { news.push(["Quest complete", name(l), "check"]); });
    added(Q.Failed, B.Failed).forEach(function (l) { news.push(["Quest failed", name(l), "close"]); });
    if (S.ranks.length && Q._Rank !== B._Rank && (Number(Q.Renown) || 0) > (Number(B.Renown) || 0)) news.push(["Rank up", "You are now rank " + Q._Rank, "star"]);
    news.forEach(function (n, i) { setTimeout(function () { CF.bus.emit("notify", { title: n[0], text: n[1], icon: n[2], open: "quests" }); }, 500 + i * 250); });
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "active";
function get(path) { return app.state(path); }
function list(path) { var v = get(path); return Array.isArray(v) ? v : []; }
function split(line) {
  var m = /^(.*?)\s+[—–-]\s+(.*)$/.exec(String(line)) || /^(.*?):\s+(.*)$/.exec(String(line));
  var name = m ? m[1].trim() : String(line).trim(), rest = m ? m[2] : "";
  var r = /\s*\(reward:\s*([^)]*)\)\s*$/i.exec(rest);
  return { name: name, objective: r ? rest.slice(0, r.index) : rest, reward: r ? r[1] : "" };
}
function known(n) { return S.start.concat(S.offers).filter(function (q) { return q.name.trim() === n; })[0] || null; }
function act(payload, text) { app.send("quests", payload, text).then(function () { app.toast("In your message box: send it when you're ready"); }); }
function card(q, buttons, cls) {
  var k = known(q.name) || {};
  var reward = q.reward || k.reward, giver = k.giver;
  return '<article class="qs-card ' + (cls || "") + '"><header><b>' + esc(q.name) + "</b>" + (cls === "tracked" ? '<span class="qs-pin">' + ui.icon("star") + "Tracked</span>" : "") + "</header>" +
    (q.objective ? '<p class="qs-obj">' + ui.icon("compass") + "<span>" + esc(q.objective) + "</span></p>" : "") +
    (giver || reward ? '<p class="cf-small cf-muted">' + esc([giver ? "From " + giver : "", reward ? "Reward: " + reward : ""].filter(Boolean).join(" · ")) + "</p>" : "") +
    (buttons ? '<div class="qs-btns">' + buttons + "</div>" : "") + "</article>";
}
function rankCard() {
  if (!S.ranks.length) return "";
  var v = Number(get("Quests.Renown")) || 0, rank = get("Quests._Rank") || S.ranks[0].name;
  var next = S.ranks.filter(function (r) { return r.from > v; })[0];
  var cur = S.ranks.filter(function (r) { return r.from <= v; }).pop() || S.ranks[0];
  var d = app.delta()["Quests.Renown"];
  return '<div class="cf-card qs-rank"><span class="qs-badge">' + esc(rank) + '</span><div class="qs-rankmain"><span class="cf-label">Rank</span>' +
    (next ? ui.meter({ label: "Renown to " + next.name, value: v - cur.from, max: next.from - cur.from, delta: d && typeof d[0] === "number" ? d[1] - d[0] : undefined }) : "<b>Highest rank</b>") + "</div></div>";
}
function activeView() {
  var tracked = get("Quests.Tracked");
  var qs = list("Quests.Active").map(split);
  return '<div class="cf-stack">' + rankCard() + (qs.length ? qs.map(function (q) {
    var on = q.name === tracked;
    return card(q, (on ? "" : '<button type="button" class="cf-btn" data-track="' + esc(q.name) + '">' + ui.icon("star") + "Track</button>") +
      '<button type="button" class="cf-btn ghost" data-ask="' + esc(q.name) + '">Ask around</button>' +
      '<button type="button" class="cf-btn ghost qs-drop" data-abandon="' + esc(q.name) + '">Abandon</button>', on ? "tracked" : "");
  }).join("") : '<p class="cf-muted">No quests. Check the ' + esc(S.board || "board") + ".</p>") + "</div>";
}
function boardView() {
  var qs = list("Quests.Board").map(split);
  return '<div class="qs-board">' + (qs.length ? qs.map(function (q, i) {
    return card(q, '<button type="button" class="cf-btn primary" data-accept="' + esc(q.name) + '">Accept</button>', "note n" + (i % 3));
  }).join("") : '<p class="cf-muted">Nothing posted right now.</p>') + "</div>";
}
function logView() {
  var done = list("Quests.Done"), failed = list("Quests.Failed");
  if (!done.length && !failed.length) return '<p class="cf-muted">Nothing finished yet.</p>';
  return '<ul class="qs-log">' + done.map(function (l) { return '<li class="ok">' + ui.icon("check") + esc(split(l).name) + "</li>"; }).join("") +
    failed.map(function (l) { return '<li class="bad">' + ui.icon("close") + esc(split(l).name) + "</li>"; }).join("") + "</ul>";
}
function draw() {
  var n = list("Quests.Board").length;
  var tabs = [{ id: "active", label: "Active", html: activeView() }, { id: "board", label: (S.board || "Board") + (n ? " (" + n + ")" : ""), html: boardView() }, { id: "log", label: "Log", html: logView() }];
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-track]"))) { var q = b.getAttribute("data-track"); return app.setMany([[["Quests", "Tracked"], q]], "tracking " + q); }
  if ((b = t.closest("[data-accept]"))) { var a = b.getAttribute("data-accept"); return act({ accept: a }, "I take the job: " + a + "."); }
  if ((b = t.closest("[data-ask]"))) { var k = b.getAttribute("data-ask"); return act({ ask: k }, "I ask around about " + k + "."); }
  if ((b = t.closest("[data-abandon]"))) {
    var d = b.getAttribute("data-abandon");
    var m = app.modal("<h2>Abandon " + esc(d) + '?</h2><p class="cf-muted">It counts as failed.</p><div class="cf-stack"><button type="button" class="cf-btn primary" data-yes>Abandon it</button><button type="button" class="cf-btn ghost" data-cf-close>Keep it</button></div>');
    m.addEventListener("click", function (ev) { if (ev.target.closest("[data-yes]")) { m.remove(); act({ abandon: d }, "I give up on " + d + "."); } });
  }
});
draw();
app.onState(draw);
`;

const CSS = String.raw`
.qs-rank { display: flex; align-items: center; gap: 12px; }
.qs-badge { flex: none; width: 52px; height: 52px; display: grid; place-items: center; font-family: var(--cf-heading); font-size: 1.6em; font-weight: 700; color: var(--cf-accent2); border: 2px solid var(--cf-accent2); border-radius: 12px; background: color-mix(in srgb, var(--cf-accent2) 14%, var(--cf-surface)); }
.qs-rankmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.qs-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--cf-border); border-left: 4px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface); box-shadow: var(--cf-shadow); }
.qs-card.tracked { border-left-color: var(--cf-accent); }
.qs-card header { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.qs-card header b { font-family: var(--cf-heading); font-size: 1.05em; }
.qs-pin { display: inline-flex; align-items: center; gap: 4px; font-size: .75em; color: var(--cf-accent); }
.qs-pin .cf-icon, .qs-obj .cf-icon { width: 14px; height: 14px; flex: none; }
.qs-obj { display: flex; gap: 6px; align-items: flex-start; }
.qs-obj .cf-icon { margin-top: 3px; color: var(--cf-accent); }
.qs-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.qs-btns .cf-btn { min-height: 40px; }
.qs-drop { color: var(--cf-bad); }
.qs-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.qs-card.note { border-left-width: 1px; background: color-mix(in srgb, var(--cf-accent2) 8%, var(--cf-surface)); position: relative; padding-top: 18px; }
.qs-card.note::before { content: ""; position: absolute; top: 6px; left: 50%; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--cf-accent); box-shadow: 0 1px 2px rgba(0,0,0,.4); }
.qs-card.n0 { transform: rotate(-.6deg); } .qs-card.n2 { transform: rotate(.5deg); }
.qs-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.qs-log li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--cf-radius); background: var(--cf-surface2); }
.qs-log .cf-icon { width: 16px; height: 16px; flex: none; }
.qs-log .ok .cf-icon { color: var(--cf-good); }
.qs-log .bad { color: var(--cf-muted); text-decoration: line-through; }
.qs-log .bad .cf-icon { color: var(--cf-bad); }
@media (prefers-reduced-motion: reduce) { .qs-card.n0, .qs-card.n2 { transform: none; } }
`;

/** `xp` is the hero's XP value when the card has one, for quest rewards. */
export function questsModule(raw?: Record<string, unknown>, enabled = true, xp = ""): EngineModule {
  const settings = questsSettings(raw);
  const live = usable(settings, xp);
  return {
    id: "quests",
    name: "Quest log",
    version: "1.0.0",
    description: "Quests with their objectives, a board of offers, a log of what's done and failed, and a rank from renown.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "rpg", "quests", "fantasy"],
    requires: [],
    core: "quests",
    enabled,
    vars: questsVars(live),
    rules: questsRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
