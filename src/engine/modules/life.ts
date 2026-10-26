/**
 * Kit part (Modern life sim): daily life. Needs that drain with the clock (energy, hunger, hygiene,
 * mood, stress), a job with shifts and pay, bills that come due, skills that grow with use, and a
 * home whose rooms are where {{user}} sleeps, cooks and washes. The engine moves the needs by the
 * time that passed and works out the next shift and the bills due after every reply; the model
 * plays out what {{user}} does from the Life screen and changes the values the story touches.
 */
import { newVar, type EngineVar } from "../sheet";
import { valueKey } from "./people";
import type { EngineModule, ModuleRule } from "./types";

export interface LifeNeed {
  name: string;
  start: number;
  /** How much the clock moves it per in-game hour. */
  perHour: number;
  /** "high": higher is worse (hunger, stress). */
  worse: "low" | "high";
  /** The line past which {{user}} feels it. */
  warn: number;
  /** What changes it in the story, for the model. */
  hint: string;
}

export interface LifeJob {
  title: string;
  employer: string;
  /** Pay per shift. */
  salary: number;
  /** "Mon-Fri", "Sat, Sun" or empty for every day. */
  days: string;
  from: string;
  to: string;
}

export interface LifeBill {
  name: string;
  amount: number;
  /** Comes due every this many days... */
  every: number;
  /** ...starting on this day. */
  first: number;
}

export interface LifeSkill {
  name: string;
  start: number;
}

export interface LifeRoom {
  name: string;
  /** What tapping it does: sleep, cook, wash, relax, or any short action. */
  action: string;
}

export interface LifeSettings {
  title: string;
  button: string;
  needs: LifeNeed[];
  job: LifeJob;
  bills: LifeBill[];
  skills: LifeSkill[];
  /** The group skills go in: "Skills", or "Player" to share the character creator's stats. */
  skillsGroup: string;
  home: string;
  rooms: LifeRoom[];
  /** When {{user}} wakes after sleeping. */
  wakeAt: string;
  currency: string;
  /** A value of the card's to use for money, like "Phone.Money"; empty for the part's own. */
  moneyPath: string;
  startMoney: number;
}

export const defaultLifeSettings = (): LifeSettings => ({
  title: "Life",
  button: "🏠 Life",
  needs: [
    { name: "Energy", start: 80, perHour: 4, worse: "low", warn: 25, hint: "sleep restores it, a shift or a workout drains it" },
    { name: "Hunger", start: 20, perHour: 5, worse: "high", warn: 70, hint: "a meal lowers it a lot, a snack a little" },
    { name: "Hygiene", start: 90, perHour: 2, worse: "low", warn: 30, hint: "a shower restores it, sweat and rain lower it" },
    { name: "Mood", start: 60, perHour: 1, worse: "low", warn: 25, hint: "good company, fun and rest lift it; bad news and fights lower it" },
    { name: "Stress", start: 20, perHour: 0, worse: "high", warn: 75, hint: "work, debt and conflict raise it; rest and fun lower it" },
  ],
  job: { title: "Barista", employer: "Corner Café", salary: 90, days: "Mon-Fri", from: "09:00", to: "17:00" },
  bills: [
    { name: "Rent", amount: 650, every: 30, first: 7 },
    { name: "Phone bill", amount: 35, every: 30, first: 12 },
  ],
  skills: [
    { name: "Cooking", start: 1 },
    { name: "Fitness", start: 1 },
    { name: "Charisma", start: 1 },
    { name: "Work", start: 1 },
  ],
  skillsGroup: "Skills",
  home: "Studio apartment",
  rooms: [
    { name: "Bed", action: "sleep" },
    { name: "Kitchen", action: "cook" },
    { name: "Bathroom", action: "wash" },
    { name: "Couch", action: "relax" },
  ],
  wakeAt: "07:00",
  currency: "$",
  moneyPath: "",
  startMoney: 400,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();
const pathText = (v: unknown) => str(v).replace(/[^\w$. -]/g, "").trim();

export function lifeSettings(raw: Record<string, unknown> | undefined): LifeSettings {
  const base = defaultLifeSettings();
  if (!raw) return base;
  const job = (raw.job && typeof raw.job === "object" ? raw.job : {}) as Record<string, unknown>;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    needs: Array.isArray(raw.needs)
      ? rows(raw.needs).map((n) => ({
          name: str(n.name),
          start: Math.max(0, Math.min(100, num(n.start, 50))),
          perHour: Math.max(0, Math.min(50, num(n.perHour, 0))),
          worse: n.worse === "high" ? ("high" as const) : ("low" as const),
          warn: Math.max(0, Math.min(100, num(n.warn, 25))),
          hint: str(n.hint),
        }))
      : base.needs,
    job: {
      title: str(job.title, raw.job ? "" : base.job.title),
      employer: str(job.employer, raw.job ? "" : base.job.employer),
      salary: Math.max(0, num(job.salary, raw.job ? 0 : base.job.salary)),
      days: str(job.days, raw.job ? "" : base.job.days),
      from: str(job.from, raw.job ? "" : base.job.from),
      to: str(job.to, raw.job ? "" : base.job.to),
    },
    bills: Array.isArray(raw.bills)
      ? rows(raw.bills).map((b) => ({ name: str(b.name), amount: Math.max(0, num(b.amount, 0)), every: Math.max(1, Math.round(num(b.every, 30))), first: Math.max(1, Math.round(num(b.first, 1))) }))
      : base.bills,
    skills: Array.isArray(raw.skills) ? rows(raw.skills).map((k) => ({ name: str(k.name), start: Math.max(0, Math.min(10, num(k.start, 0))) })) : base.skills,
    skillsGroup: clean(str(raw.skillsGroup, base.skillsGroup)) || base.skillsGroup,
    home: str(raw.home, base.home),
    rooms: Array.isArray(raw.rooms) ? rows(raw.rooms).map((r) => ({ name: str(r.name), action: str(r.action) })) : base.rooms,
    wakeAt: /^\d{1,2}:\d{2}$/.test(str(raw.wakeAt)) ? str(raw.wakeAt).padStart(5, "0") : base.wakeAt,
    currency: str(raw.currency, base.currency),
    moneyPath: pathText(raw.moneyPath),
    startMoney: num(raw.startMoney, base.startMoney),
  };
}

/** What the screen and script use: unnamed rows out, money resolved. `shared` is a money value another part keeps. */
function usable(s: LifeSettings, shared: string) {
  return {
    ...s,
    needs: s.needs.filter((n) => clean(n.name)).map((n) => ({ ...n, name: clean(n.name) })),
    bills: s.bills.filter((b) => b.name.trim() && b.amount > 0),
    skills: s.skills.filter((k) => clean(k.name)).map((k) => ({ ...k, name: clean(k.name) })),
    rooms: s.rooms.filter((r) => r.name.trim()),
    money: s.moneyPath || shared || "Life.Money",
  };
}
type Live = ReturnType<typeof usable>;

/** `taken` holds values other parts keep (the creator's stats), which skills share. */
function lifeVars(s: Live, taken: Set<string>): EngineVar[] {
  const vars: EngineVar[] = [];
  s.needs.forEach((n, i) =>
    vars.push(
      newVar({
        id: `life-need-${n.name}`,
        group: "Needs",
        name: n.name,
        type: "number",
        start: String(n.start),
        min: 0,
        max: 100,
        pinned: i < 2,
        rule: `{{user}}'s ${n.name.toLowerCase()}, 0 to 100 (${n.worse === "high" ? "higher is worse" : "higher is better"}). The engine moves it with the clock; change it only for what happens in the scene: ${n.hint || "what the story does to it"}.`,
      }),
    ),
  );
  if (s.job.title.trim()) {
    vars.push(newVar({ id: "life-job-title", group: "Job", name: "Title", type: "text", start: s.job.title, pinned: false, rule: "{{user}}'s job. Change it on a promotion, a new job or getting fired." }));
    vars.push(newVar({ id: "life-job-performance", group: "Job", name: "Performance", type: "number", start: "50", min: 0, max: 100, pinned: false, rule: "How {{user}} is doing at work, 0 to 100: +2 to +5 for a good shift, −5 to −10 for a bad one or a missed shift. Around 80 a promotion comes up." }));
    vars.push(newVar({ id: "life-job-shift", group: "Job", name: "Shift", type: "text", start: "", readOnly: true, pinned: false, rule: "When {{user}} works next, set by the engine." }));
  }
  // Money of its own only when there's pay or bills: a survival card without them needs none.
  if (!s.moneyPath && s.money === "Life.Money" && (s.job.title.trim() || s.bills.length))
    vars.push(newVar({ id: "life-money", group: "Life", name: "Money", type: "number", start: String(s.startMoney), min: 0, pinned: true, rule: `{{user}}'s money in ${s.currency || "the currency"}. Delta it when {{user}} pays or is paid.` }));
  if (s.bills.length) {
    vars.push(newVar({ id: "life-bills", group: "Life", name: "Bills", type: "list", start: "", readOnly: true, pinned: false, rule: "Bills due soon or overdue, set by the engine. Unpaid bills bring reminders, then late fees and an angry landlord." }));
    vars.push(newVar({ id: "life-paid", group: "Life", name: "Paid", type: "counts", start: "", hidden: true, pinned: false, rule: "The due day each bill was last paid for." }));
  }
  if (s.home.trim()) vars.push(newVar({ id: "life-home", group: "Life", name: "Home", type: "text", start: s.home, pinned: false, rule: "Where {{user}} lives. Change it when they move." }));
  for (const k of s.skills) {
    const v = newVar({ id: `life-skill-${k.name}`, group: s.skillsGroup, name: k.name, type: "number", start: String(k.start), min: 0, max: 10, pinned: false, rule: `{{user}}'s ${k.name.toLowerCase()} skill, 0 to 10. +1 after real practice, at most once a day; it shows in how things go.` });
    if (!taken.has(valueKey(v))) vars.push(v);
  }
  return vars;
}

function lifeRules(s: Live): ModuleRule[] {
  const actions = [
    '<action app="life"> is something {{user}} chose to do from the Life screen. Play it out briefly and update the state:',
    `- {"do":"sleep"}: {{user}} sleeps until about ${s.wakeAt} (the next day if it's past that). Move the clock and day, set Needs/Energy near 100, raise Hunger a little.`,
    '- {"do":"cook"} / {"do":"eat"}: a meal, about 40 minutes. Lower Hunger by 40 to 60. Cooking may practice the Cooking skill.',
    '- {"do":"wash"}: a shower, 20 minutes. Set Hygiene near 100.',
    '- {"do":"relax"}: an hour of rest. Raise Mood, lower Stress.',
    '- {"do":"room","room":R,"what":T}: {{user}} does T in R.',
  ];
  if (s.job.title.trim())
    actions.push(
      `- {"do":"work"}: {{user}} works a shift as ${s.job.title}${s.job.employer ? ` at ${s.job.employer}` : ""}. Play the shift in a few beats, move the clock to its end, lower Energy by 25 to 35, raise Stress, delta Job/Performance by how it went, and pay ${s.currency}${s.job.salary} into ${s.money}${s.money.startsWith("Phone.") ? " (log it in /Phone/Transactions)" : ""}.`,
      '- {"do":"skip"}: {{user}} skips the shift. The boss notices: Job/Performance −5 to −10.',
    );
  if (s.skills.length) actions.push('- {"do":"practice","skill":K}: an hour or two practising K. Raise ${s.skillsGroup}/K by 1 if it was real effort (once a day at most), lower Energy.');
  const rules: ModuleRule[] = [{ comment: "Daily life actions", content: actions.join("\n"), constant: false, keys: ['app="life"'], depth: 2, order: 100 }];
  const lines = ["Daily life: needs past their warning line show in the scene (yawning, a growling stomach, feeling grimy, a short temper)."];
  if (s.job.title.trim()) lines.push("Job/Shift says when {{user}} works; missing a shift has consequences.");
  if (s.bills.length) lines.push("Life/Bills lists what is due; overdue bills bring reminders and fees.");
  rules.push({ comment: "Daily life", content: lines.join(" "), constant: true, keys: [], order: 100 });
  return rules;
}

// Runs in the card's script: needs drain with the clock, the next shift and the bills due.
const SCRIPT = String.raw`
var S = settings.live || settings;
var SHORT = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
var WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function onDay(when, index) {
  when = String(when || "").trim().toLowerCase();
  if (!when) return true;
  return when.split(",").some(function (part) {
    var r = part.trim().split("-");
    var a = SHORT[r[0].trim().slice(0, 3)], b = r[1] ? SHORT[r[1].trim().slice(0, 3)] : a;
    if (a === undefined || b === undefined) return false;
    return a <= b ? index >= a && index <= b : index >= a || index <= b;
  });
}
function shift(t) {
  var job = S.job;
  if (!job.title) return "";
  var today = WEEK.indexOf(String(t._Weekday || ""));
  var now = minutes(t.Clock), from = minutes(job.from), to = minutes(job.to);
  if (today < 0 || from === null || to === null) return job.from ? "Shifts " + job.from + "–" + job.to : "";
  if (onDay(job.days, today)) {
    if (now !== null && now >= from && now < to) return "On shift now, until " + job.to;
    if (now !== null && now < from) return "Today " + job.from + "–" + job.to;
  }
  for (var i = 1; i <= 7; i++) {
    var d = (today + i) % 7;
    if (onDay(job.days, d)) return (i === 1 ? "Tomorrow" : WEEK[d]) + " " + job.from + "–" + job.to;
  }
  return "";
}
// The next unpaid due day of a bill.
function dueDay(bill, paid) {
  var d = bill.first;
  while (d <= paid) d += bill.every;
  return d;
}
function bills(stat, day) {
  var paid = (stat.Life && stat.Life.$Paid) || {};
  var out = [];
  S.bills.forEach(function (b) {
    var d = dueDay(b, Number(paid[b.name]) || 0);
    var cost = (S.currency || "") + b.amount;
    if (d < day) out.push(b.name + " " + cost + ": overdue since Day " + d);
    else if (d === day) out.push(b.name + " " + cost + ": due today");
    else if (d - day <= 3) out.push(b.name + " " + cost + ": due Day " + d);
  });
  return out;
}
function bad(n, v) { return n.worse === "high" ? v >= n.warn : v <= n.warn; }
hooks.afterUpdate(function (stat, before, info) {
  var t = stat && stat.Time;
  if (!t || typeof t !== "object") return stat;
  var day = Number(t.Day) || 1;
  var needs = stat.Needs && typeof stat.Needs === "object" ? stat.Needs : null;
  var prev = before && before.Needs ? before.Needs : {};
  var warn = [];
  if (needs && before && before.Time) {
    var a = minutes(before.Time.Clock), b = minutes(t.Clock);
    var hours = a === null || b === null ? 0 : ((day - (Number(before.Time.Day) || 1)) * 1440 + b - a) / 60;
    hours = Math.max(0, Math.min(24, hours));
    S.needs.forEach(function (n) {
      var v = needs[n.name];
      if (typeof v !== "number") return;
      // A need the story changed this turn (a meal, a night's sleep) is left as the story set it.
      if (v === prev[n.name] && hours > 0 && n.perHour > 0) {
        v = Math.round(v + (n.worse === "high" ? 1 : -1) * n.perHour * hours);
        needs[n.name] = v = Math.max(0, Math.min(100, v));
      }
      if (bad(n, v) && typeof prev[n.name] === "number" && !bad(n, prev[n.name])) warn.push(n);
    });
  }
  if (stat.Job && typeof stat.Job === "object") stat.Job._Shift = shift(t);
  if (S.bills.length) {
    if (!stat.Life || typeof stat.Life !== "object") stat.Life = {};
    var was = before && before.Life && Array.isArray(before.Life._Bills) ? before.Life._Bills : [];
    stat.Life._Bills = bills(stat, day);
    if (before && info && info.latest)
      stat.Life._Bills.filter(function (l) { return was.indexOf(l) < 0; }).forEach(function (l) {
        setTimeout(function () { CF.bus.emit("notify", { title: "Bills", text: l, icon: "wallet" }); }, 600);
      });
  }
  if (info && info.latest)
    warn.forEach(function (n) {
      setTimeout(function () { CF.bus.emit("notify", { title: n.name, text: n.worse === "high" ? n.name + " is getting high" : n.name + " is running low", icon: "heart" }); }, 500);
    });
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = "today";
function get(path) { return app.state(path); }
function money() { var n = Number(get(S.money)); return isFinite(n) ? n : 0; }
function cash(n) { return (S.currency || "") + (Math.round(n * 100) / 100); }
function delta(path) { var d = app.delta()[path]; return d && typeof d[0] === "number" ? d[1] - d[0] : undefined; }
function needs() {
  var v = get("Needs") || {};
  return S.needs.filter(function (n) { return typeof v[n.name] === "number"; }).map(function (n) {
    var val = v[n.name];
    var low = n.worse === "high" ? val >= n.warn : val <= n.warn;
    return '<div class="lf-need' + (n.worse === "high" ? " high" : "") + (low ? " warn" : "") + '">' + ui.meter({ label: n.name, value: val, max: 100, delta: delta("Needs." + n.name) }) + "</div>";
  }).join("");
}
function act(payload, say) {
  app.send("life", payload, say).then(function () { app.toast("In your message box: send it when you're ready"); });
}
var ROOM = { sleep: ["sleep", "Sleep until " + S.wakeAt], cook: ["cook", "Cook a meal"], eat: ["eat", "Eat something"], wash: ["wash", "Take a shower"], relax: ["relax", "Relax for an hour"] };
function roomButton(r, i) {
  var known = ROOM[String(r.action).toLowerCase()];
  return '<button type="button" class="lf-room" data-room="' + i + '"><b>' + esc(r.name) + "</b><span>" + esc(known ? known[1] : r.action || "Spend time here") + "</span></button>";
}
function billsView() {
  var day = Number(get("Time.Day")) || 1;
  var paid = get("Life.$Paid") || {};
  if (!S.bills.length) return '<p class="cf-muted">No bills.</p>';
  return '<ul class="lf-bills">' + S.bills.map(function (b, i) {
    var d = b.first;
    while (d <= (Number(paid[b.name]) || 0)) d += b.every;
    var state = d < day ? "overdue" : d === day ? "today" : d - day <= 3 ? "soon" : "";
    var when = d < day ? "Overdue since Day " + d : d === day ? "Due today" : "Due Day " + d + " (in " + (d - day) + (d - day === 1 ? " day)" : " days)");
    var short = money() < b.amount;
    return '<li class="lf-bill ' + state + '"><span class="lf-bill-main"><b>' + esc(b.name) + '</b><span class="cf-small">' + esc(when) + "</span></span>" +
      '<button type="button" class="cf-btn' + (state && !short ? " primary" : "") + '" data-pay="' + i + '"' + (short ? " disabled" : "") + ">Pay " + esc(cash(b.amount)) + "</button></li>";
  }).join("") + "</ul>";
}
function draw() {
  var t = get("Time") || {};
  var job = get("Job") || {};
  var today = '<div class="cf-stack">' +
    '<div class="cf-card lf-head"><span class="cf-label">' + esc([t._Weekday, t.Day ? "Day " + t.Day : "", t.Clock].filter(Boolean).join(" · ")) + "</span>" +
    (typeof get(S.money) === "number" ? '<b class="lf-money">' + esc(cash(money())) + ui.delta(delta(S.money)) + "</b>" : "") +
    (job._Shift ? '<span class="cf-small">' + ui.icon("clock") + " " + esc(job._Shift) + "</span>" : "") + "</div>" +
    '<div class="cf-card cf-stack">' + (needs() || '<p class="cf-muted">No needs tracked.</p>') + "</div>" +
    ((get("Life._Bills") || []).length ? '<div class="cf-card lf-due"><span class="cf-label">Due</span>' + (get("Life._Bills") || []).map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>" : "") +
    "</div>";
  var home = '<div class="cf-stack"><div class="cf-card"><span class="cf-label">Home</span><b>' + esc(get("Life.Home") || S.home || "Home") + "</b></div>" +
    '<div class="lf-rooms">' + S.rooms.map(roomButton).join("") + "</div></div>";
  var work = S.job.title ? '<div class="cf-stack"><div class="cf-card cf-stack"><span class="cf-label">' + esc(S.job.employer || "Work") + "</span><b>" + esc(job.Title || S.job.title) + "</b>" +
    '<span class="cf-small cf-muted">' + esc((S.job.days || "Every day") + ", " + S.job.from + "–" + S.job.to + " · " + cash(S.job.salary) + " a shift") + "</span>" +
    (typeof job.Performance === "number" ? ui.meter({ label: "Performance", value: job.Performance, max: 100, delta: delta("Job.Performance") }) : "") +
    (job._Shift ? '<p class="cf-small">' + esc(job._Shift) + "</p>" : "") + "</div>" +
    '<div class="cf-row lf-two"><button type="button" class="cf-btn primary" data-do="work">' + ui.icon("clock") + "Go to work</button>" +
    '<button type="button" class="cf-btn" data-do="skip">Skip the shift</button></div></div>' : '<p class="cf-muted">No job right now.</p>';
  var sk = get(S.skillsGroup) || {};
  var skills = S.skills.length ? '<div class="cf-stack">' + S.skills.map(function (k) {
    var v = Number(sk[k.name]) || 0;
    return '<div class="cf-card lf-skill">' + ui.meter({ label: k.name, value: v, max: 10, delta: delta(S.skillsGroup + "." + k.name) }) +
      '<button type="button" class="cf-btn ghost" data-practice="' + esc(k.name) + '">Practice</button></div>';
  }).join("") + "</div>" : '<p class="cf-muted">No skills tracked.</p>';
  var tabs = [{ id: "today", label: "Today", html: today }, { id: "home", label: "Home", html: home }];
  if (S.job.title) tabs.push({ id: "work", label: "Work", html: work });
  if (S.bills.length) tabs.push({ id: "bills", label: "Bills", html: billsView() });
  if (S.skills.length) tabs.push({ id: "skills", label: "Skills", html: skills });
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-room]"))) {
    var r = S.rooms[Number(b.getAttribute("data-room"))];
    var known = ROOM[String(r.action).toLowerCase()];
    return known ? act({ do: known[0] }, known[1] + ".") : act({ do: "room", room: r.name, what: r.action }, r.action ? r.action + "." : "");
  }
  if ((b = t.closest("[data-do]"))) {
    var d = b.getAttribute("data-do");
    return act({ do: d }, d === "work" ? "I head to work." : "I skip work today.");
  }
  if ((b = t.closest("[data-practice]"))) {
    var k = b.getAttribute("data-practice");
    return act({ do: "practice", skill: k }, "I practise " + k.toLowerCase() + " for a while.");
  }
  if ((b = t.closest("[data-pay]"))) {
    var bill = S.bills[Number(b.getAttribute("data-pay"))];
    var paid = get("Life.$Paid") || {};
    var due = bill.first;
    while (due <= (Number(paid[bill.name]) || 0)) due += bill.every;
    var changes = [[S.money.split("."), money() - bill.amount], [["Life", "$Paid", bill.name], due]];
    var tx = get("Phone.Transactions");
    if (Array.isArray(tx)) changes.push([["Phone", "Transactions"], tx.concat("−" + bill.amount + " " + bill.name)]);
    app.setMany(changes, "paid the " + bill.name.toLowerCase()).then(function () { app.toast("Paid the " + bill.name.toLowerCase()); });
  }
});
draw();
app.onState(draw);
`;

const CSS = String.raw`
.lf-head { display: flex; flex-direction: column; gap: 2px; }
.lf-money { font-size: 1.8em; font-variant-numeric: tabular-nums; color: var(--cf-accent); display: flex; align-items: center; gap: 8px; }
.lf-head .cf-icon { width: 14px; height: 14px; vertical-align: -2px; }
.lf-need.high .cf-meter-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--cf-accent2) 70%, var(--cf-surface2)), var(--cf-accent2)); }
.lf-need.warn .cf-meter-fill { background: var(--cf-bad); }
/* Higher is worse for hunger and stress: a rise is bad news. */
.lf-need.high .cf-delta.up { background: color-mix(in srgb, var(--cf-bad) 28%, transparent); }
.lf-need.high .cf-delta.down { background: color-mix(in srgb, var(--cf-good) 28%, transparent); }
.lf-need.warn .cf-meter-head span:first-child::after { content: " !"; color: var(--cf-bad); font-weight: 700; }
.lf-due p { margin-top: 4px; color: var(--cf-bad); }
.lf-rooms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.lf-room { font: inherit; color: var(--cf-text); text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 14px 12px; min-height: 76px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); cursor: pointer; }
.lf-room:hover, .lf-room:focus-visible { border-color: var(--cf-accent); }
.lf-room span { font-size: .85em; color: var(--cf-muted); }
.lf-two { flex-wrap: wrap; }
.lf-two .cf-btn { flex: 1; justify-content: center; min-height: 44px; }
.lf-bills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.lf-bill { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--cf-border); border-left-width: 4px; border-radius: var(--cf-radius); background: var(--cf-surface2); }
.lf-bill.soon { border-left-color: var(--cf-accent2); }
.lf-bill.today, .lf-bill.overdue { border-left-color: var(--cf-bad); }
.lf-bill-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lf-bill .cf-btn { flex: none; min-height: 40px; }
.lf-skill { display: flex; align-items: center; gap: 10px; }
.lf-skill .cf-meter { flex: 1; min-width: 0; }
`;

/** `shared` is a money value another part already keeps (the phone's), used when the settings name none. */
export function lifeModule(raw?: Record<string, unknown>, enabled = true, shared = "", taken: Set<string> = new Set()): EngineModule {
  const settings = lifeSettings(raw);
  const live = usable(settings, shared);
  return {
    id: "life",
    name: "Daily life",
    version: "1.0.0",
    description: "Needs that drain with the clock, a job with shifts and pay, bills that come due, skills and a home.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "life", "needs", "money", "modern"],
    requires: ["time"],
    core: "life",
    enabled,
    vars: lifeVars(live, taken),
    rules: lifeRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
