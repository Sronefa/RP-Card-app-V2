/**
 * Kit part (School / academy): the school app. A timetable of periods per weekday, with the class
 * on now and the next one worked out from the clock; grades and study points per subject with exam
 * days; attendance and rule violations that expire on their own; clubs; announcements; and requests
 * to the student council, which reach the story as actions.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface SchoolPeriod {
  name: string;
  from: string;
  to: string;
}

export interface SchoolDay {
  /** "Mon", "Tue"…; a row per school day. */
  day: string;
  /** The class in each period, in order, comma-separated: "Homeroom, Math, Literature…". */
  classes: string;
}

export interface SchoolExam {
  name: string;
  day: number;
}

export interface SchoolClub {
  name: string;
  description: string;
}

export interface SchoolRule {
  rule: string;
  penalty: string;
}

export interface SchoolSettings {
  title: string;
  button: string;
  /** The school's name. */
  name: string;
  subjects: string[];
  periods: SchoolPeriod[];
  timetable: SchoolDay[];
  exams: SchoolExam[];
  clubs: SchoolClub[];
  council: { name: string; description: string };
  rules: SchoolRule[];
  /** How many days a violation stays on the record. */
  violationDays: number;
}

export const defaultSchoolSettings = (): SchoolSettings => ({
  title: "School",
  button: "🏫 School",
  name: "Seiran Academy",
  subjects: ["Math", "Literature", "History", "Science", "English", "Art", "PE"],
  periods: [
    { name: "Homeroom", from: "08:30", to: "08:45" },
    { name: "1st period", from: "08:50", to: "09:40" },
    { name: "2nd period", from: "09:50", to: "10:40" },
    { name: "3rd period", from: "10:50", to: "11:40" },
    { name: "Lunch", from: "11:40", to: "12:30" },
    { name: "4th period", from: "12:30", to: "13:20" },
    { name: "5th period", from: "13:30", to: "14:20" },
    { name: "Clubs", from: "15:00", to: "17:30" },
  ],
  timetable: [
    { day: "Mon", classes: "Homeroom, Math, Literature, History, Lunch, Science, PE, Clubs" },
    { day: "Tue", classes: "Homeroom, English, Math, Art, Lunch, History, Literature, Clubs" },
    { day: "Wed", classes: "Homeroom, Science, English, Math, Lunch, PE, Art, Clubs" },
    { day: "Thu", classes: "Homeroom, Literature, History, English, Lunch, Math, Science, Clubs" },
    { day: "Fri", classes: "Homeroom, Math, Science, Literature, Lunch, English, History, Clubs" },
  ],
  exams: [
    { name: "Midterms", day: 14 },
    { name: "Finals", day: 42 },
  ],
  clubs: [
    { name: "Literature club", description: "Poems, tea and arguments about endings." },
    { name: "Kendo club", description: "Early mornings, loud halls, a captain who never smiles." },
    { name: "Photography club", description: "A darkroom nobody else knows about." },
  ],
  council: { name: "Student council", description: "Requests go to the student council: festivals, club budgets, complaints. They answer in the story." },
  rules: [
    { rule: "Be in class before the bell", penalty: "A lateness mark; three make a violation" },
    { rule: "Uniform on school grounds", penalty: "A violation" },
    { rule: "No one on the roof", penalty: "A violation and a talk with the homeroom teacher" },
  ],
  violationDays: 7,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$:,]/g, " ").trim();

export function schoolSettings(raw: Record<string, unknown> | undefined): SchoolSettings {
  const base = defaultSchoolSettings();
  if (!raw) return base;
  const council = (raw.council && typeof raw.council === "object" ? raw.council : {}) as Record<string, unknown>;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    name: str(raw.name, base.name),
    subjects: Array.isArray(raw.subjects) ? raw.subjects.map(String) : base.subjects,
    periods: Array.isArray(raw.periods) ? rows(raw.periods).map((p) => ({ name: str(p.name), from: str(p.from), to: str(p.to) })) : base.periods,
    timetable: Array.isArray(raw.timetable) ? rows(raw.timetable).map((d) => ({ day: str(d.day), classes: str(d.classes) })) : base.timetable,
    exams: Array.isArray(raw.exams) ? rows(raw.exams).map((e) => ({ name: str(e.name), day: Math.max(1, Math.round(num(e.day, 1))) })) : base.exams,
    clubs: Array.isArray(raw.clubs) ? rows(raw.clubs).map((c) => ({ name: str(c.name), description: str(c.description) })) : base.clubs,
    council: { name: str(council.name, base.council.name), description: str(council.description, base.council.description) },
    rules: Array.isArray(raw.rules) ? rows(raw.rules).map((r) => ({ rule: str(r.rule), penalty: str(r.penalty) })) : base.rules,
    violationDays: Math.max(1, Math.min(60, Math.round(num(raw.violationDays, base.violationDays)))),
  };
}

function usable(s: SchoolSettings) {
  return {
    ...s,
    subjects: s.subjects.map(clean).filter(Boolean),
    periods: s.periods.filter((p) => p.name.trim()),
    timetable: s.timetable.filter((d) => d.day.trim()).map((d) => ({ day: d.day.trim(), classes: d.classes.split(",").map((c) => c.trim()) })),
    exams: s.exams.filter((e) => e.name.trim()).sort((a, b) => a.day - b.day),
    clubs: s.clubs.filter((c) => c.name.trim()),
    rules: s.rules.filter((r) => r.rule.trim()),
  };
}
type Live = ReturnType<typeof usable>;

function schoolVars(s: Live): EngineVar[] {
  const g = "School";
  const vars: EngineVar[] = [];
  const v = (id: string, fields: Partial<EngineVar>) => vars.push(newVar({ id: `school-${id}`, group: g, pinned: false, ...fields }));
  v("now", { name: "Now", type: "text", start: "", readOnly: true, pinned: true, rule: "The period and class on now, set by the engine from the clock." });
  v("next", { name: "Next", type: "text", start: "", readOnly: true, rule: "The next class, set by the engine." });
  if (s.subjects.length) {
    v("grades", {
      name: "Grades",
      type: "counts",
      start: s.subjects.map((x) => `${x}: 60`).join(", "),
      rule: "{{user}}'s grade per subject, 0 to 100. On an exam's day, set each subject's grade from its Study points and how the exam went (about 50 + 4 × Study, ±10). Small changes for quizzes and homework.",
    });
    v("study", { name: "Study", type: "counts", start: s.subjects.map((x) => `${x}: 0`).join(", "), rule: "Study points per subject: +1 to +3 for each real study session. They set the next exam's grades." });
  }
  v("attendance", { name: "Attendance", type: "number", start: "100", min: 0, max: 100, rule: "Attendance, 0 to 100: −3 for each skipped class, −1 for being late. Below 80 the homeroom teacher calls {{user}} in." });
  v("violations", {
    name: "Violations",
    type: "list",
    start: "",
    rule: `Rule violations staff caught, as 'What happened — expires Day N' with N = today + ${s.violationDays}. The engine removes them when they expire. Three at once means detention.`,
  });
  if (s.exams.length) v("exams", { name: "Exams", type: "list", start: "", readOnly: true, rule: "Coming exams with how many days are left, set by the engine." });
  if (s.clubs.length) {
    v("club", { name: "Club", type: "text", start: "", rule: "The club {{user}} is in; empty for none." });
    v("rank", { name: "ClubRank", type: "text", start: "", rule: "{{user}}'s standing in the club (new member, regular, ace, captain)." });
  }
  v("announcements", { name: "Announcements", type: "list", start: "", rule: "School announcements, oldest first: one short line each (events, exam dates, closures, festivals). Insert one when the school announces something." });
  return vars;
}

function schoolRules(s: Live): ModuleRule[] {
  const lines = ['<action app="school"> is something {{user}} chose in the school app. Play it out and update the state:'];
  lines.push('- {"do":"attend","class":C}: {{user}} goes to C. Play a beat of the class and move the clock to its end.');
  lines.push('- {"do":"skip","class":C}: {{user}} skips C. Attendance −3; a teacher may notice (a violation).');
  if (s.subjects.length) lines.push('- {"do":"study","subject":S}: an hour or two of study. Study/S +1 to +3 by how focused it was; the clock moves.');
  if (s.clubs.length) lines.push('- {"do":"join","club":K}: {{user}} asks to join K. Set School/Club if they are let in. {"do":"visit","club":K}: {{user}} drops by K.');
  lines.push(`- {"do":"request","text":T}: {{user}} filed a request with the ${s.council.name}: ${s.council.description}`);
  const rules: ModuleRule[] = [{ comment: "School actions", content: lines.join("\n"), constant: false, keys: ['app="school"'], depth: 2, order: 100 }];
  const always = [`School (${s.name || "the school"}): School/_Now says what is on; the bell and the periods move the day.`];
  if (s.exams.length) always.push("On an exam's day, play the exam and set the grades (see School/Grades).");
  if (s.rules.length) always.push(`School rules: ${s.rules.map((r) => `${r.rule}${r.penalty ? ` (${r.penalty})` : ""}`).join("; ")}.`);
  rules.push({ comment: "School", content: always.join(" "), constant: true, keys: [], order: 100 });
  return rules;
}

// Runs in the card's script: the period now and next, coming exams, expiring violations.
const SCRIPT = String.raw`
var S = settings.live || settings;
var WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function row(weekday) {
  var key = String(weekday || "").slice(0, 3).toLowerCase();
  return S.timetable.filter(function (d) { return d.day.slice(0, 3).toLowerCase() === key; })[0] || null;
}
function label(p, cls) { return cls && cls !== p.name ? p.name + ": " + cls : p.name; }
function nextDayText(t) {
  var at = WEEK.indexOf(String(t._Weekday || ""));
  for (var i = 1; i <= 7 && at >= 0; i++) {
    var d = WEEK[(at + i) % 7], r = row(d);
    if (r && S.periods.length) return (i === 1 ? "Tomorrow" : d) + " " + S.periods[0].from + ", " + label(S.periods[0], r.classes[0]);
  }
  return "";
}
hooks.afterUpdate(function (stat, before, info) {
  var t = stat && stat.Time;
  if (!t || typeof t !== "object") return stat;
  if (!stat.School || typeof stat.School !== "object") stat.School = {};
  var sc = stat.School, day = Number(t.Day) || 1, now = minutes(t.Clock), r = row(t._Weekday);
  var cur = "", next = "";
  if (!r) cur = "No school today";
  else if (now !== null) {
    S.periods.forEach(function (p, i) {
      var a = minutes(p.from), b = minutes(p.to);
      if (a === null || b === null) return;
      if (!cur && now >= a && now < b) cur = label(p, r.classes[i]) + " (until " + p.to + ")";
      if (!next && now < a) next = p.from + " " + label(p, r.classes[i]);
    });
    if (!cur) {
      var first = minutes((S.periods[0] || {}).from), last = minutes((S.periods[S.periods.length - 1] || {}).to);
      cur = first !== null && now < first ? "Before school" : last !== null && now >= last ? "After school" : "Between classes";
    }
  }
  sc._Now = cur;
  sc._Next = next || nextDayText(t);
  if (S.exams.length)
    sc._Exams = S.exams.filter(function (e) { return e.day >= day; }).map(function (e) {
      return e.name + (e.day === day ? ": today" : ": Day " + e.day + " (in " + (e.day - day) + (e.day - day === 1 ? " day)" : " days)"));
    });
  if (Array.isArray(sc.Violations))
    sc.Violations = sc.Violations.filter(function (v) {
      var m = /expires\s+Day\s*(\d+)/i.exec(String(v));
      return !m || Number(m[1]) > day;
    });
  if (before && info && info.latest) {
    var g = sc.Grades || {}, was = (before.School && before.School.Grades) || {};
    var changed = Object.keys(g).filter(function (k) { return typeof was[k] === "number" && g[k] !== was[k]; });
    if (changed.length > 1)
      setTimeout(function () {
        CF.bus.emit("notify", { title: "Results", text: changed.map(function (k) { return k + " " + g[k]; }).join(" · "), icon: "book", open: "school" });
      }, 500);
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "today";
function get(path) { return app.state(path); }
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function act(payload, say) {
  app.send("school", payload, say).then(function () { app.toast("In your message box: send it when you're ready"); });
}
function todayRow() {
  var key = String(get("Time._Weekday") || "").slice(0, 3).toLowerCase();
  return S.timetable.filter(function (d) { return d.day.slice(0, 3).toLowerCase() === key; })[0] || null;
}
function delta(path) { var d = app.delta()[path]; return d && typeof d[0] === "number" ? d[1] - d[0] : undefined; }
function todayView() {
  var sc = get("School") || {};
  var r = todayRow(), now = minutes(get("Time.Clock"));
  var list = r ? '<ol class="sc-periods">' + S.periods.map(function (p, i) {
    var a = minutes(p.from), b = minutes(p.to);
    var on = now !== null && a !== null && b !== null && now >= a && now < b;
    var past = now !== null && b !== null && now >= b;
    var cls = r.classes[i] || "";
    var lesson = cls && cls !== p.name && cls.toLowerCase() !== "lunch" && S.subjects.indexOf(cls) >= 0;
    return '<li class="sc-period' + (on ? " on" : past ? " past" : "") + '"><span class="sc-time">' + esc(p.from) + "</span><span class=\"sc-class\"><b>" + esc(cls || p.name) + "</b>" +
      (cls && cls !== p.name ? '<span class="cf-small cf-muted">' + esc(p.name) + "</span>" : "") + "</span>" +
      (lesson && !past ? '<span class="sc-go"><button type="button" class="cf-btn' + (on ? " primary" : "") + '" data-attend="' + esc(cls) + '">Go</button><button type="button" class="cf-btn ghost" data-skip="' + esc(cls) + '" aria-label="Skip ' + esc(cls) + '">Skip</button></span>' : "") + "</li>";
  }).join("") + "</ol>" : '<p class="cf-muted">No classes today.</p>';
  var news = (sc.Announcements || []).slice(-4).reverse();
  return '<div class="cf-stack"><div class="cf-card sc-now"><span class="cf-label">' + esc(S.name || "Now") + "</span><b>" + esc(sc._Now || "—") + "</b>" +
    (sc._Next ? '<span class="cf-small">Next: ' + esc(sc._Next) + "</span>" : "") + "</div>" + list +
    (news.length ? '<div class="cf-card"><span class="cf-label">Announcements</span>' + news.map(function (n) { return '<p class="sc-news">' + ui.icon("news") + esc(n) + "</p>"; }).join("") + "</div>" : "") + "</div>";
}
function gradesView() {
  var g = get("School.Grades") || {}, st = get("School.Study") || {};
  var exams = get("School._Exams") || [];
  return '<div class="cf-stack">' + (exams.length ? '<div class="cf-card sc-exam">' + ui.icon("calendar") + '<div><span class="cf-label">Exams</span>' + exams.map(function (e) { return "<p>" + esc(e) + "</p>"; }).join("") + "</div></div>" : "") +
    S.subjects.map(function (s) {
      var v = Number(g[s]);
      return '<div class="cf-card sc-subject">' + ui.meter({ label: s, value: isFinite(v) ? v : 0, max: 100, delta: delta("School.Grades." + s) }) +
        '<div class="cf-spread cf-small"><span>' + ui.icon("book") + " Study " + esc(Number(st[s]) || 0) + "</span>" +
        '<button type="button" class="cf-btn ghost" data-study="' + esc(s) + '">Study</button></div></div>';
    }).join("") + "</div>";
}
function recordView() {
  var sc = get("School") || {};
  var v = Array.isArray(sc.Violations) ? sc.Violations : [];
  return '<div class="cf-stack"><div class="cf-card">' + ui.meter({ label: "Attendance", value: Number(sc.Attendance) || 0, max: 100, delta: delta("School.Attendance") }) + "</div>" +
    '<div class="cf-card"><span class="cf-label">Violations</span>' + (v.length ? '<ul class="sc-viol">' + v.map(function (x) {
      var m = /^(.*?)\s*[—–-]\s*(expires\s+Day\s*\d+)\s*$/i.exec(String(x));
      return "<li><span>" + esc(m ? m[1] : x) + "</span>" + (m ? ui.chip(m[2]) : "") + "</li>";
    }).join("") + "</ul>" : '<p class="cf-small cf-muted">A clean record.</p>') + "</div>" +
    (S.rules.length ? '<details class="cf-card sc-rules"><summary>Student handbook</summary><ul>' + S.rules.map(function (r) { return "<li><b>" + esc(r.rule) + "</b>" + (r.penalty ? '<span class="cf-small cf-muted"> · ' + esc(r.penalty) + "</span>" : "") + "</li>"; }).join("") + "</ul></details>" : "") + "</div>";
}
function clubView() {
  var club = get("School.Club") || "", rank = get("School.ClubRank") || "";
  return '<div class="cf-stack">' + (club ? '<div class="cf-card sc-myclub"><span class="cf-label">Your club</span><b>' + esc(club) + "</b>" + (rank ? ui.chip(rank) : "") + "</div>" : "") +
    S.clubs.map(function (c) {
      var mine = club && club.toLowerCase() === c.name.toLowerCase();
      return '<div class="cf-card sc-club"><div><b>' + esc(c.name) + '</b><p class="cf-small cf-muted">' + esc(c.description) + "</p></div>" +
        '<button type="button" class="cf-btn' + (mine ? "" : club ? " ghost" : " primary") + '" data-club="' + esc(c.name) + '" data-mode="' + (mine || club ? "visit" : "join") + '">' + (mine ? "Go" : club ? "Visit" : "Join") + "</button></div>";
    }).join("") + "</div>";
}
function councilView() {
  return '<div class="cf-stack"><div class="cf-card sc-council">' + ui.icon("note") + "<p>" + esc(S.council.description) + "</p></div>" +
    '<form class="cf-stack" data-request><textarea class="cf-input" name="text" rows="4" placeholder="Your request" aria-label="Your request to the ' + esc(S.council.name) + '"></textarea>' +
    '<button type="submit" class="cf-btn primary">Send to the ' + esc(S.council.name) + "</button></form></div>";
}
function draw() {
  var tabs = [{ id: "today", label: "Today", html: todayView() }];
  if (S.subjects.length) tabs.push({ id: "grades", label: "Grades", html: gradesView() });
  tabs.push({ id: "record", label: "Record", html: recordView() });
  if (S.clubs.length) tabs.push({ id: "club", label: "Clubs", html: clubView() });
  tabs.push({ id: "council", label: "Council", html: councilView() });
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
function request(form) {
  var box = form.querySelector("[name=text]");
  var text = box.value.trim();
  if (!text) return;
  act({ do: "request", text: text }, "I file a request with the " + S.council.name + ": " + text);
  box.value = "";
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-attend]"))) return act({ do: "attend", class: b.getAttribute("data-attend") }, "I head to " + b.getAttribute("data-attend") + ".");
  if ((b = t.closest("[data-skip]"))) return act({ do: "skip", class: b.getAttribute("data-skip") }, "I skip " + b.getAttribute("data-skip") + ".");
  if ((b = t.closest("[data-study]"))) return act({ do: "study", subject: b.getAttribute("data-study") }, "I study " + b.getAttribute("data-study") + " for a while.");
  if ((b = t.closest("[data-club]"))) {
    var club = b.getAttribute("data-club"), mode = b.getAttribute("data-mode");
    return act({ do: mode, club: club }, mode === "join" ? "I ask to join the " + club + "." : "I drop by the " + club + ".");
  }
  if ((b = t.closest("[data-request] [type=submit]"))) { e.preventDefault(); request(b.closest("[data-request]")); }
});
root.addEventListener("submit", function (e) {
  var form = e.target.closest("[data-request]");
  if (!form) return;
  e.preventDefault();
  request(form);
});
draw();
app.onState(function () { if (!root.querySelector("textarea:focus")) draw(); });
`;

const CSS = String.raw`
.sc-now { display: flex; flex-direction: column; gap: 2px; border-left: 4px solid var(--cf-accent); }
.sc-now b { font-family: var(--cf-heading); font-size: 1.25em; }
.sc-periods { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sc-period { display: flex; align-items: center; gap: 10px; padding: 8px 10px; min-height: 48px; border-radius: var(--cf-radius); background: var(--cf-surface2); border: 1px solid transparent; }
.sc-period.on { border-color: var(--cf-accent); background: color-mix(in srgb, var(--cf-accent) 12%, var(--cf-surface2)); }
.sc-period.past { opacity: .55; }
.sc-time { width: 44px; flex: none; font-variant-numeric: tabular-nums; color: var(--cf-muted); font-size: .85em; }
.sc-class { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
.sc-go { display: flex; gap: 4px; flex: none; }
.sc-go .cf-btn { min-height: 36px; padding-left: 10px; padding-right: 10px; }
.sc-news { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; }
.sc-news .cf-icon, .sc-subject .cf-icon { width: 14px; height: 14px; flex: none; margin-top: 2px; vertical-align: -2px; }
.sc-exam { display: flex; gap: 10px; align-items: flex-start; border-left: 4px solid var(--cf-accent2); }
.sc-exam > .cf-icon { width: 22px; height: 22px; color: var(--cf-accent2); flex: none; }
.sc-subject { display: flex; flex-direction: column; gap: 4px; }
.sc-subject .cf-meter-fill { transition: width .9s cubic-bezier(.2,.8,.2,1); }
.sc-viol { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sc-viol li { display: flex; justify-content: space-between; gap: 8px; align-items: center; overflow-wrap: anywhere; }
.sc-rules summary { cursor: pointer; font-weight: 600; min-height: 28px; }
.sc-rules ul { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.sc-myclub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-myclub .cf-label { width: 100%; }
.sc-club { display: flex; align-items: center; gap: 10px; }
.sc-club > div { flex: 1; min-width: 0; }
.sc-club .cf-btn { flex: none; min-height: 40px; }
.sc-council { display: flex; gap: 10px; align-items: flex-start; }
.sc-council .cf-icon { width: 24px; height: 24px; color: var(--cf-accent); flex: none; }
`;

export function schoolModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = schoolSettings(raw);
  const live = usable(settings);
  return {
    id: "school",
    name: "School app",
    version: "1.0.0",
    description: "Timetable with the class on now, grades and study per subject, exams, attendance and violations that expire, clubs and council requests.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "school", "time"],
    requires: ["time"],
    core: "school",
    enabled,
    vars: schoolVars(live),
    rules: schoolRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
