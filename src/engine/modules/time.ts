/**
 * Core module: in-game time. The clock, day, weekday, season and weather live in the state; the
 * model moves the clock in its update block and the engine keeps the rest consistent after every
 * reply (rolls the day at midnight, works out the weekday, season and part of the day, drops timers
 * that ran out, and says where each regular is from their routine). Time words go to the lorebook
 * scan, so entries keyed on "night" or "winter" turn on by themselves.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule } from "./types";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];

export interface Routine {
  npc: string;
  place: string;
  /** "08:00" */
  from: string;
  to: string;
  /** "Mon-Fri", "Sat, Sun" or empty for every day. */
  days: string;
}

export interface TimeSettings {
  startDay: number;
  startClock: string;
  startWeekday: string;
  startSeason: string;
  daysPerSeason: number;
  weathers: string[];
  startWeather: string;
  routines: Routine[];
  /** Feed the time to the lorebook scan. */
  lore: boolean;
}

export const defaultTimeSettings = (): TimeSettings => ({
  startDay: 1,
  startClock: "08:00",
  startWeekday: "Monday",
  startSeason: "Spring",
  daysPerSeason: 30,
  weathers: ["Clear", "Cloudy", "Rain", "Storm", "Snow", "Fog"],
  startWeather: "Clear",
  routines: [],
  lore: true,
});

export function timeSettings(raw: Record<string, unknown> | undefined): TimeSettings {
  const base = defaultTimeSettings();
  const s = { ...base, ...(raw as Partial<TimeSettings>) };
  return {
    startDay: Number.isFinite(Number(s.startDay)) ? Math.max(1, Math.round(Number(s.startDay))) : base.startDay,
    startClock: /^\d{1,2}:\d{2}$/.test(String(s.startClock)) ? String(s.startClock).padStart(5, "0") : base.startClock,
    startWeekday: WEEKDAYS.includes(String(s.startWeekday)) ? String(s.startWeekday) : base.startWeekday,
    startSeason: SEASONS.includes(String(s.startSeason)) ? String(s.startSeason) : base.startSeason,
    daysPerSeason: Math.max(1, Math.round(Number(s.daysPerSeason) || base.daysPerSeason)),
    weathers: Array.isArray(s.weathers) && s.weathers.filter(Boolean).length ? s.weathers.map(String).filter(Boolean) : base.weathers,
    startWeather: String(s.startWeather || base.startWeather),
    // Unfinished rows stay, so the author can fill them in; only named ones count.
    routines: Array.isArray(s.routines)
      ? s.routines.filter((r) => r && typeof r === "object").map((r) => ({ npc: String(r.npc ?? ""), place: String(r.place ?? ""), from: String(r.from ?? ""), to: String(r.to ?? ""), days: String(r.days ?? "") }))
      : [],
    lore: s.lore !== false,
  };
}

/** The same rules the card's script applies, for starting values here. */
export function partOfDay(clock: string): string {
  const h = Number(clock.split(":")[0]);
  return h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
}

function timeVars(s: TimeSettings): EngineVar[] {
  const vars: EngineVar[] = [
    newVar({
      id: "time-day",
      group: "Time",
      name: "Day",
      type: "number",
      start: String(s.startDay),
      min: 1,
      rule: "The day count since the story began. Add 1 when the clock passes midnight or the characters sleep through the night.",
    }),
    newVar({
      id: "time-clock",
      group: "Time",
      name: "Clock",
      type: "text",
      start: s.startClock,
      rule: "The time of day as HH:MM, 24-hour. Move it forward as the scene takes time: a talk 10 to 30 minutes, a meal about an hour, travel by its distance, sleep to the morning. Never move it back.",
    }),
    newVar({
      id: "time-weather",
      group: "Time",
      name: "Weather",
      type: "choice",
      options: s.weathers.includes(s.startWeather) ? s.weathers : [s.startWeather, ...s.weathers],
      start: s.startWeather,
      rule: "Change it now and then as the day goes, plausibly for the season.",
    }),
    newVar({
      id: "time-timers",
      group: "Time",
      name: "Timers",
      type: "list",
      start: "",
      rule: "Things due at an in-game time, written as 'what @ Day N HH:MM' (like 'Meet Mina at the café @ Day 3 18:00'). Add one when something gets scheduled; the engine takes it out once the time has passed.",
    }),
    newVar({ id: "time-weekday", group: "Time", name: "Weekday", type: "text", start: s.startWeekday, readOnly: true, rule: "Set by the engine from the day." }),
    newVar({ id: "time-season", group: "Time", name: "Season", type: "text", start: s.startSeason, readOnly: true, rule: "Set by the engine from the day." }),
    newVar({ id: "time-part", group: "Time", name: "PartOfDay", type: "text", start: partOfDay(s.startClock), readOnly: true, rule: "Set by the engine from the clock." }),
    newVar({ id: "time-expired", group: "Time", name: "Expired", type: "list", start: "", readOnly: true, rule: "Timers that just ran out. Bring them up if they matter to the scene." }),
  ];
  if (s.routines.some((r) => r.npc.trim()))
    vars.push(
      newVar({
        id: "time-whereabouts",
        group: "Time",
        name: "Whereabouts",
        type: "text",
        start: "",
        readOnly: true,
        rule: "Where the regulars are right now, from their routines. Follow it unless the story moved them.",
      }),
    );
  return vars;
}

// Runs in the card's script with CF, settings and hooks. Plain ES5 for any WebView.
const SCRIPT = String.raw`
var WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
var SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
var SHORT = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
function minutes(clock) {
  var m = /^\s*(\d{1,3}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function clockText(min) {
  var h = Math.floor(min / 60) % 24, m = min % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}
function part(min) {
  var h = Math.floor(min / 60);
  return h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
}
function mod(a, n) { return ((a % n) + n) % n; }
function weekday(day) {
  var start = Math.max(0, WEEK.indexOf(settings.startWeekday));
  return WEEK[mod(start + day - settings.startDay, 7)];
}
function season(day) {
  var start = Math.max(0, SEASONS.indexOf(settings.startSeason));
  return SEASONS[mod(start + Math.floor((day - settings.startDay) / settings.daysPerSeason), 4)];
}
function due(text) {
  var m = /@\s*Day\s*(\d+)\s*,?\s*(\d{1,2}):(\d{2})/i.exec(String(text));
  return m ? Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]) : null;
}
function onDay(spec, name) {
  spec = String(spec || "").toLowerCase().trim();
  if (!spec || /every|daily|all/.test(spec)) return true;
  var today = WEEK.indexOf(name);
  return spec.split(/\s*,\s*/).some(function (part) {
    var range = part.split(/\s*-\s*/);
    var a = SHORT[range[0].slice(0, 3)], b = SHORT[(range[1] || range[0]).slice(0, 3)];
    if (a === undefined || b === undefined) return false;
    return a <= b ? today >= a && today <= b : today >= a || today <= b;
  });
}
function whereabouts(min, name) {
  return (settings.routines || [])
    .filter(function (r) {
      var from = minutes(r.from), to = minutes(r.to);
      if (!String(r.npc || "").trim() || from === null || to === null || !onDay(r.days, name)) return false;
      return from <= to ? min >= from && min < to : min >= from || min < to;
    })
    .map(function (r) { return r.npc + ": " + r.place + " (until " + r.to + ")"; })
    .join("; ");
}
hooks.afterUpdate(function (stat, before) {
  var t = stat && stat.Time;
  if (!t || typeof t !== "object") return stat;
  var prev = before && before.Time;
  var day = Math.max(1, Math.round(Number(t.Day)) || settings.startDay);
  var min = minutes(t.Clock);
  if (min === null) min = (prev && minutes(prev.Clock)) || minutes(settings.startClock) || 0;
  if (min >= 1440) {
    day += Math.floor(min / 1440);
    min = min % 1440;
  }
  if (prev) {
    var prevMin = minutes(prev.Clock);
    // The clock went back but the day didn't move: the night passed.
    if (prevMin !== null && Number(prev.Day) === day && min < prevMin) day += 1;
  }
  t.Day = day;
  t.Clock = clockText(min);
  t._Weekday = weekday(day);
  t._Season = season(day);
  t._PartOfDay = part(min);
  var now = day * 1440 + min;
  var expired = [];
  t.Timers = (Array.isArray(t.Timers) ? t.Timers : []).filter(function (x) {
    var at = due(x);
    if (at !== null && at <= now) {
      expired.push(String(x).replace(/\s*@.*$/, ""));
      return false;
    }
    return true;
  });
  t._Expired = expired;
  if ((settings.routines || []).some(function (r) { return String(r.npc || "").trim(); })) t._Whereabouts = whereabouts(min, t._Weekday);
  if (settings.lore && typeof injectPrompts === "function") {
    try {
      injectPrompts([{ id: "cardforge-time", position: "none", depth: 0, role: "system", should_scan: true,
        content: [t._Weekday, t._PartOfDay, t._Season, t.Weather].join(" ") }]);
    } catch (e) {}
  }
  return stat;
});
`;

const WEATHER_ICONS: Record<string, string> = { clear: "sun", sunny: "sun", cloudy: "cloud", rain: "rain", storm: "storm", snow: "snow", fog: "fog" };

// The panel's time bar.
const JS = String.raw`
var icons = ${JSON.stringify(WEATHER_ICONS)};
function draw() {
  var t = app.state("Time") || {};
  var night = t._PartOfDay === "Night" || t._PartOfDay === "Evening";
  var weather = String(t.Weather || "");
  var next = (t.Timers || [])[0];
  root.innerHTML =
    '<div class="cf-row cf-small cf-time" aria-label="In-game time">' +
    CF.ui.icon(night ? "moon" : "sun") +
    "<b>" + CF.ui.esc(t.Clock || "") + "</b>" +
    '<span class="cf-muted">' + CF.ui.esc(["Day " + (t.Day || 1), t._Weekday, t._Season].filter(Boolean).join(" · ")) + "</span>" +
    '<span style="margin-left:auto" class="cf-row">' + CF.ui.icon(icons[weather.toLowerCase()] || "cloud") + CF.ui.esc(weather) + "</span>" +
    "</div>" +
    (next ? '<div class="cf-small cf-muted cf-row">' + CF.ui.icon("clock") + CF.ui.esc(next) + "</div>" : "") +
    ((t._Expired || []).length ? '<div class="cf-small cf-row">' + CF.ui.icon("calendar") + CF.ui.esc("Ran out: " + t._Expired.join(", ")) + "</div>" : "");
}
draw();
app.onState(draw);
`;

const CSS = ".cf-time { padding-bottom: 6px; margin-bottom: 4px; border-bottom: 1px solid color-mix(in srgb, var(--cf-border) 60%, transparent); }";

export function timeModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = timeSettings(raw);
  return {
    id: "time",
    name: "In-game time",
    version: "1.0.0",
    description: "Clock, day, weekday, season and weather; timers that expire; where the regulars are by their routines.",
    slot: "panel",
    tags: ["core", "time"],
    requires: [],
    core: "time",
    enabled,
    vars: timeVars(settings),
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: settings as unknown as Record<string, unknown>,
  };
}
