/**
 * Shared part: the event system. Scheduled events (a festival on day 5, the market every Saturday
 * morning, a shift Monday to Friday) and random ones weighted by place and time of day. After every
 * reply the engine works out what is happening now from the clock and {{user}}'s location and puts
 * it in Events._Now, which the model reads with the state and weaves into the story. Random events
 * roll once per part of the day, the same way on every swipe, so a reroll doesn't change the world.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export interface ScheduledEvent {
  name: string;
  /** "Day 5", "Mon-Fri", "Sat, Sun", or empty for every day. */
  when: string;
  /** "HH:MM", or empty for all day. */
  from: string;
  to: string;
  /** Only while {{user}} is somewhere whose name holds this; empty for anywhere. */
  where: string;
  text: string;
}

export interface RandomEvent {
  name: string;
  /** Chance per part of the day, 0 to 100. */
  chance: number;
  where: string;
  /** "Morning", "Afternoon", "Evening", "Night", or empty for any. */
  part: string;
  text: string;
}

export interface EventsSettings {
  scheduled: ScheduledEvent[];
  random: RandomEvent[];
  /** Where {{user}} is, like "Player.Location"; empty to look for a Location value by itself. */
  locationPath: string;
  /** A banner when an event starts (with the notifications part). */
  notify: boolean;
}

export const defaultEventsSettings = (): EventsSettings => ({
  scheduled: [{ name: "Market day", when: "Sat", from: "08:00", to: "13:00", where: "", text: "Stalls fill the square; prices are good and gossip is better." }],
  random: [{ name: "Sudden downpour", chance: 15, where: "", part: "Afternoon", text: "Rain comes down hard; people crowd under awnings." }],
  locationPath: "",
  notify: true,
});

const str = (v: unknown) => (typeof v === "string" ? v : "");
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

export function eventsSettings(raw: Record<string, unknown> | undefined): EventsSettings {
  const base = defaultEventsSettings();
  if (!raw) return base;
  return {
    scheduled: Array.isArray(raw.scheduled)
      ? rows(raw.scheduled).map((e) => ({ name: str(e.name), when: str(e.when), from: str(e.from), to: str(e.to), where: str(e.where), text: str(e.text) }))
      : base.scheduled,
    random: Array.isArray(raw.random)
      ? rows(raw.random).map((e) => ({ name: str(e.name), chance: Math.max(0, Math.min(100, Number(e.chance) || 0)), where: str(e.where), part: str(e.part), text: str(e.text) }))
      : base.random,
    locationPath: str(raw.locationPath).trim(),
    notify: raw.notify !== false,
  };
}

function usable(s: EventsSettings): EventsSettings {
  return { ...s, scheduled: s.scheduled.filter((e) => e.name.trim()), random: s.random.filter((e) => e.name.trim() && e.chance > 0) };
}

// Runs in the card's script with CF, settings and hooks. Plain ES5 for any WebView.
const SCRIPT = String.raw`
settings = settings.live || settings;
var SHORT = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
var WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function dayIndex(name) { return WEEK.indexOf(String(name || "")); }
// "Day 5", "Mon-Fri", "Sat, Sun" or "" (every day).
function onDay(when, day, weekday) {
  when = String(when || "").trim().toLowerCase();
  if (!when) return true;
  var d = /^day\s*(\d+)$/.exec(when);
  if (d) return Number(d[1]) === day;
  var today = dayIndex(weekday);
  return when.split(",").some(function (part) {
    var r = part.trim().split("-");
    var a = SHORT[r[0].trim().slice(0, 3)], b = r[1] ? SHORT[r[1].trim().slice(0, 3)] : a;
    if (a === undefined || b === undefined || today < 0) return false;
    return a <= b ? today >= a && today <= b : today >= a || today <= b;
  });
}
function inTime(from, to, min) {
  var a = minutes(from), b = minutes(to);
  if (a === null || min === null) return true;
  if (b === null) return min >= a;
  return a <= b ? min >= a && min < b : min >= a || min < b;
}
function read(stat, path) {
  var out = stat;
  String(path).split(".").forEach(function (k) { out = out && typeof out === "object" ? out[k] : undefined; });
  return out;
}
function locationOf(stat) {
  if (settings.locationPath) return String(read(stat, settings.locationPath) || "");
  var groups = ["Player", "Phone", "World", "Map"];
  for (var i = 0; i < groups.length; i++) {
    var v = read(stat, groups[i] + ".Location");
    if (v) return String(v);
  }
  return "";
}
function here(where, location) {
  where = String(where || "").trim().toLowerCase();
  return !where || location.toLowerCase().indexOf(where) >= 0;
}
// The same roll for the same event, day and part of the day: swipes don't reroll the world.
function roll(key) {
  var h = 2166136261;
  for (var i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 100;
}
hooks.afterUpdate(function (stat, before, info) {
  var t = stat && stat.Time;
  if (!t || typeof t !== "object") return stat;
  var day = Number(t.Day) || 1, min = minutes(t.Clock), weekday = t._Weekday, part = t._PartOfDay || "";
  var location = locationOf(stat);
  var now = [];
  settings.scheduled.forEach(function (e) {
    if (onDay(e.when, day, weekday) && inTime(e.from, e.to, min) && here(e.where, location)) now.push(e.name + (e.text ? ": " + e.text : ""));
  });
  settings.random.forEach(function (e) {
    if (e.part && e.part.toLowerCase() !== String(part).toLowerCase()) return;
    if (!here(e.where, location)) return;
    if (roll(e.name + "|" + day + "|" + part) < e.chance) now.push(e.name + (e.text ? ": " + e.text : ""));
  });
  var events = stat.Events && typeof stat.Events === "object" ? stat.Events : (stat.Events = {});
  var was = before && before.Events && Array.isArray(before.Events._Now) ? before.Events._Now : [];
  events._Now = now;
  if (settings.notify && before && info && info.latest) {
    now.filter(function (n) { return was.indexOf(n) < 0; }).forEach(function (n) {
      var name = n.split(":")[0];
      setTimeout(function () { CF.bus.emit("notify", { title: "Event", text: name, icon: "calendar" }); }, 400);
    });
  }
  return stat;
});
`;

export function eventsModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = eventsSettings(raw);
  return {
    id: "events",
    name: "Events",
    version: "1.0.0",
    description: "Scheduled and random events by day, time and place; what's happening now goes in the state for the model to weave in.",
    slot: "script",
    tags: ["built-in", "events", "time"],
    requires: ["time"],
    core: "events",
    enabled,
    vars: [
      newVar({
        id: "events-now",
        group: "Events",
        name: "Now",
        type: "list",
        start: "",
        readOnly: true,
        pinned: false,
        rule: "What is happening around {{user}} right now, set by the engine from the clock and place. Bring each into the scene where it fits; never contradict one.",
      }),
    ],
    rules: [],
    regex: [],
    html: "",
    css: "",
    js: "",
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live: usable(settings) },
  };
}
