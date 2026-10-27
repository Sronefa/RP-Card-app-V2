/**
 * Built-in screen: the phone. One hub for the whole game state, modeled on modern-sim phone cards:
 * a lock screen with the in-game time, weather and notifications, a home screen of apps the author
 * picks and orders, and an app catalog (messages, contacts, social feed, news, wallet, map,
 * calendar, shop, quests, photos, settings and a card-specific "system" app). Modules tagged
 * "phone-app" join the home screen as apps of their own.
 *
 * What the player does on the phone (texting, buying, travelling, posting, filing a request) goes
 * into SillyTavern's input box as an action, `<action app="phone">{"app":"messages",…}</action>`,
 * which the engine already hides from the prompt two messages back. The model fills the phone in
 * its update block: texts, posts and news are lists of short lines.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export const PHONE_APPS = {
  messages: { label: "Messages", icon: "chat", color: "#22c55e" },
  contacts: { label: "Contacts", icon: "people", color: "#64748b" },
  social: { label: "Social", icon: "heart", color: "#ec4899" },
  news: { label: "News", icon: "news", color: "#f97316" },
  wallet: { label: "Wallet", icon: "wallet", color: "#0ea5e9" },
  map: { label: "Map", icon: "map", color: "#14b8a6" },
  calendar: { label: "Calendar", icon: "calendar", color: "#ef4444" },
  shop: { label: "Shop", icon: "bag", color: "#a855f7" },
  quests: { label: "Notes", icon: "note", color: "#eab308" },
  photos: { label: "Photos", icon: "camera", color: "#6366f1" },
  settings: { label: "Settings", icon: "gear", color: "#475569" },
  system: { label: "System", icon: "spark", color: "#0f766e" },
} as const;
export type PhoneAppId = keyof typeof PHONE_APPS;
export const PHONE_APP_IDS = Object.keys(PHONE_APPS) as PhoneAppId[];

export interface PhoneContact {
  name: string;
  role: string;
  /** A card image file, shown from the CHARX assets. */
  avatar: string;
}

export interface PhoneStage {
  name: string;
  /** Affection from which this stage starts. */
  from: number;
  color: string;
}

export interface PhonePlace {
  name: string;
  description: string;
}

export interface PhoneShopItem {
  name: string;
  price: number;
  description: string;
}

export interface PhonePhoto {
  file: string;
  caption: string;
}

export interface PhoneSettings {
  name: string;
  button: string;
  /** The home screen, in order. */
  apps: PhoneAppId[];
  lock: boolean;
  /** A round button over the chat that opens the phone. */
  floating: boolean;
  /** The model may show the phone inside a message with <cf-module id="phone"/>. */
  inline: boolean;
  /** A card image for the wallpaper; empty for the theme's colours. */
  wallpaper: string;
  contacts: PhoneContact[];
  contactFields: { affection: boolean; outfit: boolean; location: boolean; notes: boolean };
  stages: PhoneStage[];
  currency: string;
  /** A value of the card's to use for money, like "Player.Gold"; empty for the phone's own. */
  moneyPath: string;
  startMoney: number;
  itemsPath: string;
  locationPath: string;
  startLocation: string;
  places: PhonePlace[];
  shop: PhoneShopItem[];
  photos: PhonePhoto[];
  system: { name: string; description: string };
  /** How many texts, posts and news lines the phone keeps. */
  keep: number;
}

export const defaultPhoneSettings = (): PhoneSettings => ({
  name: "Phone",
  button: "📱 Phone",
  apps: ["messages", "contacts", "social", "news", "wallet", "map", "calendar", "shop", "quests", "photos", "settings"],
  lock: true,
  floating: false,
  inline: true,
  wallpaper: "",
  contacts: [],
  contactFields: { affection: true, outfit: true, location: true, notes: false },
  stages: [
    { name: "Stranger", from: 0, color: "#94a3b8" },
    { name: "Acquaintance", from: 20, color: "#38bdf8" },
    { name: "Friend", from: 40, color: "#22c55e" },
    { name: "Close", from: 60, color: "#f59e0b" },
    { name: "Lover", from: 80, color: "#ec4899" },
  ],
  currency: "$",
  moneyPath: "",
  startMoney: 120,
  itemsPath: "",
  locationPath: "",
  startLocation: "Home",
  places: [],
  shop: [],
  photos: [],
  system: { name: "System", description: "Requests filed here reach the story: the world answers them." },
  keep: 40,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : fallback);
const rows = <T,>(v: unknown, map: (x: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object").map((x) => map(x as Record<string, unknown>)) : [];
const pathText = (v: unknown) => str(v).replace(/[^\w$. -]/g, "").trim();

export function phoneSettings(raw: Record<string, unknown> | undefined): PhoneSettings {
  const base = defaultPhoneSettings();
  if (!raw) return base;
  const fields = { ...base.contactFields, ...((raw.contactFields as object | undefined) ?? {}) };
  const system = (raw.system as Record<string, unknown> | undefined) ?? {};
  return {
    name: str(raw.name, base.name),
    button: str(raw.button, base.button),
    apps: Array.isArray(raw.apps) ? [...new Set(raw.apps.filter((a): a is PhoneAppId => PHONE_APP_IDS.includes(a as PhoneAppId)))] : base.apps,
    lock: raw.lock !== false,
    floating: raw.floating === true,
    inline: raw.inline !== false,
    wallpaper: str(raw.wallpaper),
    contacts: Array.isArray(raw.contacts) ? rows(raw.contacts, (c) => ({ name: str(c.name), role: str(c.role), avatar: str(c.avatar) })) : base.contacts,
    contactFields: { affection: fields.affection !== false, outfit: fields.outfit !== false, location: fields.location !== false, notes: fields.notes === true },
    stages: Array.isArray(raw.stages) ? rows(raw.stages, (s) => ({ name: str(s.name), from: num(s.from, 0), color: str(s.color, "#94a3b8") })) : base.stages,
    currency: str(raw.currency, base.currency),
    moneyPath: pathText(raw.moneyPath),
    startMoney: num(raw.startMoney, base.startMoney),
    itemsPath: pathText(raw.itemsPath),
    locationPath: pathText(raw.locationPath),
    startLocation: str(raw.startLocation, base.startLocation),
    places: Array.isArray(raw.places) ? rows(raw.places, (p) => ({ name: str(p.name), description: str(p.description) })) : base.places,
    shop: Array.isArray(raw.shop) ? rows(raw.shop, (i) => ({ name: str(i.name), price: Math.max(0, num(i.price, 0)), description: str(i.description) })) : base.shop,
    photos: Array.isArray(raw.photos) ? rows(raw.photos, (p) => ({ file: str(p.file), caption: str(p.caption) })) : base.photos,
    system: { name: str(system.name, base.system.name), description: str(system.description, base.system.description) },
    keep: Math.max(5, Math.min(200, Math.round(num(raw.keep, base.keep)))),
  };
}

const has = (s: PhoneSettings, app: PhoneAppId) => s.apps.includes(app);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();

/** The phone's settings as its screen uses them: unfinished rows left out, value paths resolved. */
function usable(s: PhoneSettings) {
  return {
    ...s,
    contacts: s.contacts.filter((c) => clean(c.name)).map((c) => ({ ...c, name: clean(c.name) })),
    stages: s.stages.filter((st) => st.name.trim()).sort((a, b) => a.from - b.from),
    places: s.places.filter((p) => p.name.trim()),
    shop: s.shop.filter((i) => i.name.trim()),
    photos: s.photos.filter((p) => p.file.trim()),
    paths: {
      money: s.moneyPath || "Phone.Money",
      items: s.itemsPath || "Phone.Items",
      location: s.locationPath || "Phone.Location",
    },
  };
}

function phoneVars(s: ReturnType<typeof usable>): EngineVar[] {
  const g = "Phone";
  const vars: EngineVar[] = [];
  const v = (id: string, fields: Partial<EngineVar>) => vars.push(newVar({ id: `phone-${id}`, group: g, pinned: false, ...fields }));
  if (has(s, "messages")) {
    v("texts", {
      name: "Texts",
      type: "list",
      start: "",
      rule: "Texts on {{user}}'s phone, oldest first: 'Name: text' for a text to {{user}}, 'Me → Name: text' for one {{user}} sent, 'Name @ Group: text' in a group chat. Insert a text when someone would plausibly write between scenes, in their own voice; not every reply.",
    });
    v("read", { name: "Read", type: "counts", start: "", hidden: true, rule: "How many texts the player has read, per chat." });
  }
  if (has(s, "contacts"))
    for (const c of s.contacts) {
      if (s.contactFields.affection)
        vars.push(newVar({ id: `phone-aff-${c.name}`, group: c.name, name: "Affection", type: "number", start: "10", min: 0, max: 100, pinned: false, rule: `How ${c.name} feels about {{user}}, 0 to 100: +1 to +3 for kindness or shared moments, −2 to −5 for slights.` }));
      if (s.contactFields.outfit)
        vars.push(newVar({ id: `phone-outfit-${c.name}`, group: c.name, name: "Outfit", type: "text", start: "", pinned: false, rule: `What ${c.name} is wearing now, a few words. Change it when they change.` }));
      if (s.contactFields.location)
        vars.push(newVar({ id: `phone-where-${c.name}`, group: c.name, name: "Location", type: "text", start: "", pinned: false, rule: `Where ${c.name} is right now, a few words.` }));
      if (s.contactFields.notes)
        vars.push(newVar({ id: `phone-notes-${c.name}`, group: c.name, name: "Notes", type: "text", start: "", pinned: false, rule: `One line on where things stand between ${c.name} and {{user}}.` }));
    }
  if (has(s, "social"))
    v("feed", {
      name: "Feed",
      type: "list",
      start: "",
      rule: "Social posts, oldest first: 'Name: post', with comments added as ' // Name: comment'. Insert a post when someone would share what just happened in the story.",
    });
  if (has(s, "news")) v("news", { name: "News", type: "list", start: "", rule: "News and rumours, oldest first: 'Headline — one sentence'. Insert one when something happens in the world that people would hear about." });
  if (has(s, "wallet") || has(s, "shop")) {
    if (!s.moneyPath) v("money", { name: "Money", type: "number", start: String(s.startMoney), min: 0, pinned: true, rule: `{{user}}'s money in ${s.currency || "the currency"}. Delta it when {{user}} pays or is paid.` });
    v("transactions", { name: "Transactions", type: "list", start: "", rule: "Money in and out, oldest first, as '+20 Paycheck' or '−5 Coffee'. Insert one with every change to the money." });
  }
  if (has(s, "map") && !s.locationPath) v("location", { name: "Location", type: "text", start: s.startLocation, pinned: true, rule: "Where {{user}} is now, as a place name. Change it when {{user}} arrives somewhere." });
  if (has(s, "shop") && !s.itemsPath) v("items", { name: "Items", type: "counts", start: "", rule: "What {{user}} owns: insert when bought or found, delta −1 when used up, remove at 0." });
  if (has(s, "quests")) {
    v("quests", { name: "Quests", type: "list", start: "", rule: "Open goals and leads, short. Insert when one comes up; when one is done, replace it with the same text starting '✓ '." });
    v("notes", { name: "Notes", type: "text", start: "", hidden: true, rule: "The player's own notes." });
  }
  return vars;
}

function phoneRules(s: ReturnType<typeof usable>): ModuleRule[] {
  const lines = ['<action app="phone"> is something {{user}} did on their phone just now. Narrate it briefly where it fits and update the state:'];
  if (has(s, "messages")) lines.push('- {"app":"messages","to":N,"text":T}: {{user}} texted N. Insert "Me → N: T" into /Phone/Texts. N may answer by text in this reply ("N: …") if they would.');
  if (has(s, "contacts")) lines.push('- {"app":"contacts","call":N}: {{user}} calls N. Play the call out.');
  if (has(s, "social")) lines.push('- {"app":"social","post":T}: insert "Me: T" into /Phone/Feed; people may comment. {"app":"social","comment":T,"on":P}: append " // Me: T" to post P.');
  if (has(s, "map")) lines.push(`- {"app":"map","travel":P}: {{user}} goes to P. Narrate the trip, set ${s.paths.location} to P and move the clock by the distance.`);
  if (has(s, "shop"))
    lines.push(
      `- {"app":"shop","buy":I,"price":X}: {{user}} buys I. Delta ${s.paths.money} by −X, insert I into ${s.paths.items}, and log it in /Phone/Transactions. If the money is short, it fails.`,
      `- {"app":"shop","use":I}: {{user}} uses one I now. Narrate it and delta ${s.paths.items}/I by −1.`,
    );
  if (has(s, "system")) lines.push(`- {"app":"system","request":T}: {{user}} filed a request with ${s.system.name}. ${s.system.description}`);
  const rules: ModuleRule[] = [{ comment: "Phone actions", content: lines.join("\n"), constant: false, keys: ['app="phone"'], depth: 2, order: 100 }];
  if (s.inline)
    rules.push({
      comment: "Phone in the scene",
      content: 'When {{user}} looks at their phone in the scene, put <cf-module id="phone"/> on its own line where they do.',
      constant: true,
      keys: [],
      depth: 4,
      order: 100,
    });
  return rules;
}

// Runs in the card's script: keeps the lists short, and the floating button.
const SCRIPT = String.raw`
var keep = settings.keep || 40;
hooks.afterUpdate(function (stat) {
  var p = stat && stat.Phone;
  if (!p || typeof p !== "object") return stat;
  ["Texts", "Feed", "News", "Transactions"].forEach(function (k) {
    if (Array.isArray(p[k]) && p[k].length > keep) p[k] = p[k].slice(-keep);
  });
  return stat;
});
if (settings.floating) {
  (function () {
    var doc = window.parent.document;
    var old = doc.getElementById("cf-phone-fab");
    if (old) old.remove();
    var b = doc.createElement("button");
    b.id = "cf-phone-fab";
    b.type = "button";
    b.setAttribute("aria-label", "Open the " + settings.name);
    b.textContent = "📱";
    b.style.cssText = "position:fixed;right:14px;bottom:96px;z-index:9998;width:48px;height:48px;border-radius:50%;border:0;font-size:22px;cursor:pointer;background:rgba(20,20,24,.85);color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.4);";
    b.addEventListener("click", function () { CF.open("phone"); });
    doc.body.appendChild(b);
    window.addEventListener("pagehide", function () { b.remove(); });
  })();
}
`;

const JS = String.raw`
var S = settings.live || settings;
var APPS = settings.catalog;
var ui = CF.ui, esc = ui.esc;
// A phone shown inside a message (the regex page marks its root) gets a frame of its own.
var inline = root.hasAttribute("data-cf-inline");
var view = { name: S.lock ? "lock" : "home", params: {} };
var pending = [];
var draft = {};

function get(path) {
  var v = app.state(path);
  return v;
}
function list(path) {
  var v = get(path);
  return Array.isArray(v) ? v : [];
}
function money() { var n = Number(get(S.paths.money)); return isFinite(n) ? n : 0; }
function moneyText(n) { return (S.currency || "") + (Math.round(n * 100) / 100); }
function time() { return app.state("Time") || {}; }
function clock() { return time().Clock || ""; }
function battery() {
  var m = /^(\d+):(\d+)/.exec(clock());
  var mins = m ? Number(m[1]) * 60 + Number(m[2]) : 600;
  return Math.max(4, Math.min(100, Math.round(100 - Math.max(0, mins - 420) / 13)));
}

// ---------------------------------------------------------------- texts
function parseText(line) {
  var s = String(line);
  var m = /^\s*Me\s*(?:→|->)\s*([^:]+):\s*([\s\S]*)$/.exec(s);
  if (m) return { thread: m[1].trim(), from: "Me", me: true, text: m[2] };
  m = /^\s*([^:@]+?)\s*@\s*([^:]+):\s*([\s\S]*)$/.exec(s);
  if (m) return { thread: m[2].trim(), from: m[1].trim(), group: true, text: m[3] };
  m = /^\s*([^:]+):\s*([\s\S]*)$/.exec(s);
  if (m) return { thread: m[1].trim(), from: m[1].trim(), text: m[2] };
  return null;
}
function threads() {
  var out = {}, order = [];
  list("Phone.Texts").forEach(function (line, i) {
    var t = parseText(line);
    if (!t) return;
    if (!out[t.thread]) { out[t.thread] = { name: t.thread, texts: [], incoming: 0, group: !!t.group }; order.push(t.thread); }
    var th = out[t.thread];
    th.texts.push(t);
    th.last = i;
    if (!t.me) th.incoming++;
    if (t.group) th.group = true;
  });
  var read = app.state("Phone.$Read") || {};
  return order.map(function (k) { var th = out[k]; th.unread = Math.max(0, th.incoming - (Number(read[k]) || 0)); return th; })
    .sort(function (a, b) { return b.last - a.last; });
}
function unreadTexts() { return threads().reduce(function (n, t) { return n + t.unread; }, 0); }
function markRead(name) {
  var th = threads().filter(function (t) { return t.name === name; })[0];
  if (!th || !th.unread) return;
  app.setMany([[["Phone", "$Read", name], th.incoming]]).catch(function () {});
}

// ---------------------------------------------------------------- contacts
function contact(name) {
  return S.contacts.filter(function (c) { return c.name === name; })[0] || { name: name, role: "", avatar: "" };
}
function avatar(c, big) {
  var html = ui.avatar(c.avatar ? CF.asset(c.avatar) : CF.assets.portrait(c.name), c.name);
  return big ? html.replace('class="cf-avatar"', 'class="cf-avatar ph-big"') : html;
}
function stageOf(aff) {
  var st = null;
  S.stages.forEach(function (s) { if (aff >= s.from) st = s; });
  return st;
}

// ---------------------------------------------------------------- shell
function statusBar(light) {
  var t = time();
  return '<div class="ph-status' + (light ? " light" : "") + '"><b>' + esc(clock()) + "</b>" +
    '<span class="ph-status-right"><span class="ph-signal" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
    '<span class="ph-battery" aria-label="Battery ' + battery() + '%"><i style="width:' + battery() + '%"></i></span></span></div>';
}
function bar(title, o) {
  o = o || {};
  return '<div class="ph-bar">' + '<button type="button" class="ph-icon-btn" data-go="' + (o.back || "home") + '"' + (o.params ? " data-params='" + esc(JSON.stringify(o.params)) + "'" : "") + ' aria-label="Back">' + ui.icon("back") + "</button>" +
    "<h1>" + esc(title) + "</h1>" + (o.right || "<span class=\"ph-bar-space\"></span>") + "</div>";
}
function homeBar() {
  return '<button type="button" class="ph-homebar" data-go="home" aria-label="Home"><i></i></button>';
}
function badge(n) { return n ? '<span class="ph-badge">' + (n > 99 ? "99+" : n) + "</span>" : ""; }
function counts(id) {
  if (id === "messages") return unreadTexts();
  if (id === "social") { var r = app.state("Phone.$Read") || {}; return Math.max(0, list("Phone.Feed").length - (Number(r["@feed"]) || 0)); }
  if (id === "news") { var r2 = app.state("Phone.$Read") || {}; return Math.max(0, list("Phone.News").length - (Number(r2["@news"]) || 0)); }
  if (id === "calendar") return (time().Timers || []).filter(function (x) { var m = /@\s*Day\s*(\d+)/i.exec(x); return m && Number(m[1]) === Number(time().Day); }).length;
  return 0;
}
function seen(key, n) {
  var r = app.state("Phone.$Read") || {};
  if ((Number(r[key]) || 0) !== n) app.setMany([[["Phone", "$Read", key], n]]).catch(function () {});
}
function wallpaper() {
  var wall = S.wallpaper ? CF.asset(S.wallpaper) : CF.assets.scene("wallpaper");
  return wall ? "background-image: linear-gradient(rgba(0,0,0,.15), rgba(0,0,0,.35)), url('" + wall.replace(/'/g, "%27") + "')" : "";
}

// ---------------------------------------------------------------- screens
var screens = {};
screens.lock = function () {
  var t = time();
  var notes = [];
  threads().filter(function (th) { return th.unread; }).slice(0, 3).forEach(function (th) {
    var last = th.texts.filter(function (x) { return !x.me; }).slice(-1)[0];
    notes.push({ icon: "chat", app: "Messages", title: th.name, text: last ? last.text : "", go: "thread", params: { name: th.name } });
  });
  (t.Timers || []).slice(0, 2).forEach(function (x) {
    notes.push({ icon: "calendar", app: "Calendar", title: String(x).replace(/\s*@.*$/, ""), text: (/@\s*(.*)$/.exec(x) || [])[1] || "", go: "calendar" });
  });
  return '<div class="ph-lock" style="' + wallpaper() + '">' + statusBar(true) +
    '<div class="ph-lock-time"><span class="ph-lock-icon">' + ui.icon("lock") + "</span><b>" + esc(clock() || "--:--") + "</b>" +
    "<span>" + esc([t._Weekday, t.Day ? "Day " + t.Day : ""].filter(Boolean).join(", ")) + "</span>" +
    (t.Weather ? '<span class="ph-weather">' + ui.icon(weatherIcon(t.Weather)) + esc(t.Weather) + "</span>" : "") + "</div>" +
    '<div class="ph-notes">' + notes.map(function (n) {
      return '<button type="button" class="ph-note" data-go="' + n.go + '"' + (n.params ? " data-params='" + esc(JSON.stringify(n.params)) + "'" : "") + ">" +
        '<span class="ph-note-app">' + ui.icon(n.icon) + esc(n.app) + "</span><b>" + esc(n.title) + "</b><span>" + esc(n.text) + "</span></button>";
    }).join("") + "</div>" +
    '<button type="button" class="ph-unlock" data-go="home">Tap to unlock</button></div>';
};
function weatherIcon(w) {
  w = String(w || "").toLowerCase();
  return /storm|thunder/.test(w) ? "storm" : /rain|drizzle/.test(w) ? "rain" : /snow/.test(w) ? "snow" : /fog|mist/.test(w) ? "fog" : /cloud|overcast/.test(w) ? "cloud" : "sun";
}
function homeApps() {
  var out = S.apps.map(function (id) { var a = APPS[id]; return { id: id, label: a.label, icon: a.icon, color: a.color }; })
    .filter(function (a) { return a.id !== "settings" || CF.modules().some(function (m) { return m.id === "settings"; }); });
  (settings.extra || []).forEach(function (m) { out.push({ id: "module:" + m.id, label: m.name, icon: "star", color: "#334155" }); });
  return out;
}
screens.home = function () {
  var t = time();
  return '<div class="ph-home" style="' + wallpaper() + '">' + statusBar(true) +
    '<div class="ph-widget"><b>' + esc(clock()) + "</b><span>" + esc([t._Weekday, t.Day ? "Day " + t.Day : "", t.Weather].filter(Boolean).join(" · ")) + "</span></div>" +
    '<div class="ph-grid">' + homeApps().map(function (a) {
      return '<button type="button" class="ph-app" data-open="' + esc(a.id) + '"><span class="ph-tile" style="background:' + esc(a.color) + '">' + ui.icon(a.icon) + badge(counts(a.id)) + "</span><span class=\"ph-app-label\">" + esc(a.label) + "</span></button>";
    }).join("") + "</div></div>";
};
screens.messages = function () {
  var all = threads();
  var known = all.map(function (t) { return t.name; });
  S.contacts.forEach(function (c) { if (known.indexOf(c.name) < 0) all.push({ name: c.name, texts: [], unread: 0 }); });
  return bar("Messages") + '<div class="ph-body">' + (all.length ? '<ul class="ph-list">' + all.map(function (th) {
    var last = th.texts[th.texts.length - 1];
    return '<li><button type="button" class="ph-row" data-go="thread" data-params=\'' + esc(JSON.stringify({ name: th.name })) + "'>" + avatar(contact(th.name)) +
      '<span class="ph-row-main"><b>' + esc(th.name) + (th.group ? ' <span class="cf-chip">group</span>' : "") + '</b><span class="ph-sub">' + esc(last ? (last.me ? "You: " : th.group ? last.from + ": " : "") + last.text : "No messages yet") + "</span></span>" +
      (th.unread ? '<span class="ph-badge static">' + th.unread + "</span>" : "") + "</button></li>";
  }).join("") + "</ul>" : empty("No messages yet.")) + "</div>";
};
screens.thread = function (p) {
  var th = threads().filter(function (t) { return t.name === p.name; })[0] || { texts: [], group: false };
  markRead(p.name);
  var mine = pending.filter(function (x) { return x.to === p.name; });
  return bar(p.name, { back: "messages" }) + '<div class="ph-body ph-chat">' +
    (th.texts.length || mine.length ? th.texts.map(function (t) {
      return '<div class="ph-msg' + (t.me ? " me" : "") + '">' + (th.group && !t.me ? '<span class="ph-from">' + esc(t.from) + "</span>" : "") + esc(t.text) + "</div>";
    }).join("") + mine.map(function (x) {
      return '<div class="ph-msg me pending">' + esc(x.text) + '<span class="ph-from">Sends with your next message</span></div>';
    }).join("") : empty("Say hi to " + p.name + ".")) + "</div>" +
    '<form class="ph-compose" data-compose="messages" data-to="' + esc(p.name) + '"><input class="cf-input" name="text" placeholder="Text ' + esc(p.name) + '" autocomplete="off" aria-label="Message to ' + esc(p.name) + '" value="' + esc(draft[p.name] || "") + '">' +
    '<button type="submit" class="ph-send" aria-label="Send">' + ui.icon("send") + "</button></form>";
};
screens.contacts = function () {
  return bar("Contacts") + '<div class="ph-body">' + (S.contacts.length ? '<ul class="ph-list">' + S.contacts.map(function (c) {
    var aff = Number(app.state([c.name, "Affection"]));
    var st = S.contactFields.affection && isFinite(aff) ? stageOf(aff) : null;
    return '<li><button type="button" class="ph-row" data-go="contact" data-params=\'' + esc(JSON.stringify({ name: c.name })) + "'>" + avatar(c) +
      '<span class="ph-row-main"><b>' + esc(c.name) + '</b><span class="ph-sub">' + esc(c.role || "") + "</span></span>" +
      (st ? '<span class="ph-stage" style="--stage:' + esc(st.color) + '">' + esc(st.name) + "</span>" : "") + "</button></li>";
  }).join("") + "</ul>" : empty("No contacts yet.")) + "</div>";
};
screens.contact = function (p) {
  var c = contact(p.name);
  var s = app.state(c.name) || {};
  var aff = Number(s.Affection);
  var st = isFinite(aff) ? stageOf(aff) : null;
  var facts = [];
  if (S.contactFields.outfit) facts.push(["Wearing", s.Outfit]);
  if (S.contactFields.location) facts.push(["Where", s.Location]);
  if (S.contactFields.notes) facts.push(["Notes", s.Notes]);
  var d = app.delta()[c.name + ".Affection"];
  return bar(c.name, { back: "contacts" }) + '<div class="ph-body ph-profile">' + avatar(c, true) + "<h2>" + esc(c.name) + "</h2>" + (c.role ? '<span class="cf-muted">' + esc(c.role) + "</span>" : "") +
    (S.contactFields.affection && isFinite(aff)
      ? '<div class="cf-card ph-aff" style="--stage:' + esc(st ? st.color : "var(--cf-accent)") + '">' + ui.meter({ label: "Affection", value: aff, max: 100, delta: d ? d[1] - d[0] : 0 }) +
        (st ? '<span class="ph-stage">' + esc(st.name) + "</span>" : "") + "</div>"
      : "") +
    (facts.length ? '<dl class="ph-facts">' + facts.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1] || "–") + "</dd>"; }).join("") + "</dl>" : "") +
    '<div class="ph-actions">' + (S.apps.indexOf("messages") >= 0 ? '<button type="button" class="cf-btn primary" data-go="thread" data-params=\'' + esc(JSON.stringify({ name: c.name })) + "'>" + ui.icon("chat") + "Message</button>" : "") +
    '<button type="button" class="cf-btn" data-act=\'' + esc(JSON.stringify({ app: "contacts", call: c.name })) + "' data-say=\"" + esc("📱 Calling " + c.name + "…") + '">' + ui.icon("phone") + "Call</button></div></div>";
};
function splitPost(line) {
  var parts = String(line).split(/\s*\/\/\s*/);
  var head = parseText(parts[0]) || { from: "Someone", text: parts[0] };
  return { from: head.from, text: head.text, comments: parts.slice(1).map(function (c) { return parseText(c) || { from: "", text: c }; }) };
}
screens.social = function () {
  var posts = list("Phone.Feed");
  seen("@feed", posts.length);
  return bar("Social") + '<div class="ph-body">' +
    '<form class="ph-compose top" data-compose="social"><input class="cf-input" name="text" placeholder="Share something" aria-label="New post" autocomplete="off"><button type="submit" class="ph-send" aria-label="Post">' + ui.icon("send") + "</button></form>" +
    (posts.length ? posts.slice().reverse().map(function (line) {
      var p = splitPost(line);
      return '<article class="cf-card ph-post"><div class="cf-row">' + avatar(contact(p.from)) + "<b>" + esc(p.from) + "</b></div><p>" + esc(p.text) + "</p>" +
        (p.comments.length ? '<div class="ph-comments">' + p.comments.map(function (c) { return "<p><b>" + esc(c.from) + "</b> " + esc(c.text) + "</p>"; }).join("") + "</div>" : "") + "</article>";
    }).join("") : empty("Nothing posted yet.")) + "</div>";
};
screens.news = function () {
  var news = list("Phone.News");
  seen("@news", news.length);
  return bar("News") + '<div class="ph-body">' + (news.length ? news.slice().reverse().map(function (line, i) {
    var m = /^(.*?)\s+[—–-]\s+([\s\S]*)$/.exec(String(line));
    return '<details class="cf-card ph-news"' + (i === 0 ? " open" : "") + "><summary>" + esc(m ? m[1] : line) + "</summary>" + (m ? "<p>" + esc(m[2]) + "</p>" : "") + "</details>";
  }).join("") : empty("No news.")) + "</div>";
};
screens.wallet = function () {
  var tx = list("Phone.Transactions").slice().reverse();
  var d = app.delta()[S.paths.money];
  return bar("Wallet") + '<div class="ph-body"><div class="ph-balance"><span class="cf-label">Balance</span><b>' + esc(moneyText(money())) + "</b>" + (d && typeof d[0] === "number" ? ui.delta(d[1] - d[0]) : "") + "</div>" +
    (tx.length ? '<ul class="ph-list">' + tx.map(function (line) {
      var m = /^\s*([+−-]\s*[\d.,]+)\s*(.*)$/.exec(String(line));
      var up = m && m[1].charAt(0) === "+";
      return '<li class="ph-tx"><span>' + esc(m ? m[2] : line) + '</span><b class="' + (m ? (up ? "up" : "down") : "") + '">' + esc(m ? m[1].replace(/\s/g, "") : "") + "</b></li>";
    }).join("") + "</ul>" : empty("No transactions yet.")) + "</div>";
};
screens.map = function () {
  var here = String(get(S.paths.location) || "");
  return bar("Map") + '<div class="ph-body"><div class="cf-card ph-here">' + ui.icon("map") + '<span class="ph-row-main"><span class="cf-label">You are at</span><b>' + esc(here || "Somewhere") + "</b></span></div>" +
    (S.places.length ? '<ul class="ph-list">' + S.places.map(function (pl, i) {
      var at = pl.name.toLowerCase() === here.toLowerCase();
      return '<li><button type="button" class="ph-row" data-go="place" data-params=\'' + esc(JSON.stringify({ i: i })) + "'><span class=\"ph-pin" + (at ? " here" : "") + '">' + ui.icon("map") + '</span><span class="ph-row-main"><b>' + esc(pl.name) + '</b><span class="ph-sub">' + esc(pl.description) + "</span></span>" + (at ? '<span class="cf-chip">Here</span>' : "") + "</button></li>";
    }).join("") + "</ul>" : empty("No places on the map.")) + "</div>";
};
screens.place = function (p) {
  var pl = S.places[p.i] || { name: "", description: "" };
  var here = String(get(S.paths.location) || "").toLowerCase() === pl.name.toLowerCase();
  return bar(pl.name, { back: "map" }) + '<div class="ph-body"><p>' + esc(pl.description) + "</p>" +
    (here ? '<p class="cf-muted">You are here.</p>' : '<button type="button" class="cf-btn primary" data-act=\'' + esc(JSON.stringify({ app: "map", travel: pl.name })) + "' data-say=\"" + esc("📍 Heading to " + pl.name + ".") + '">' + ui.icon("map") + "Go here</button>") + "</div>";
};
screens.calendar = function () {
  var t = time();
  var days = {};
  var order = [];
  (t.Timers || []).forEach(function (x) {
    var m = /^(.*?)\s*@\s*Day\s*(\d+)\s*,?\s*(\d{1,2}:\d{2})?/i.exec(String(x));
    var day = m ? Number(m[2]) : 0;
    if (!days[day]) { days[day] = []; order.push(day); }
    days[day].push({ what: m ? m[1] : x, at: m ? m[3] || "" : "" });
  });
  order.sort(function (a, b) { return a - b; });
  return bar("Calendar") + '<div class="ph-body"><div class="ph-today"><span class="cf-label">Today</span><b>' + esc([t._Weekday, "Day " + (t.Day || 1)].filter(Boolean).join(", ")) + "</b><span>" + esc([t._Season, t.Weather].filter(Boolean).join(" · ")) + "</span></div>" +
    (order.length ? order.map(function (day) {
      return '<section class="ph-day"><h3>' + esc(day ? (day === Number(t.Day) ? "Today" : day === Number(t.Day) + 1 ? "Tomorrow" : "Day " + day) : "Someday") + "</h3>" +
        days[day].map(function (e) { return '<div class="ph-event"><b>' + esc(e.at || "—") + "</b><span>" + esc(e.what) + "</span></div>"; }).join("") + "</section>";
    }).join("") : empty("Nothing planned.")) +
    ((t._Expired || []).length ? '<p class="cf-small cf-muted">Just passed: ' + esc(t._Expired.join(", ")) + "</p>" : "") + "</div>";
};
screens.shop = function (p) {
  var tab = (p && p.tab) || (S.shop.length ? "shop" : "bag");
  var bag = get(S.paths.items) || {};
  var have = money();
  var names = Object.keys(bag).filter(function (k) { return Number(bag[k]) > 0; });
  var shopHtml = S.shop.length ? '<ul class="ph-list">' + S.shop.map(function (it) {
    var short = have < it.price;
    return '<li class="ph-shop"><span class="ph-row-main"><b>' + esc(it.name) + '</b><span class="ph-sub">' + esc(it.description) + "</span></span>" +
      '<button type="button" class="cf-btn' + (short ? "" : " primary") + '"' + (short ? " disabled" : "") + " data-act='" + esc(JSON.stringify({ app: "shop", buy: it.name, price: it.price })) + "' data-say=\"" + esc("🛍 Buying " + it.name + ".") + '">' + esc(moneyText(it.price)) + "</button></li>";
  }).join("") + "</ul>" : empty("Nothing for sale.");
  var bagHtml = names.length ? '<ul class="ph-list">' + names.map(function (k) {
    return '<li class="ph-shop"><span class="ph-row-main"><b>' + esc(k) + '</b><span class="ph-sub">×' + esc(bag[k]) + "</span></span>" +
      "<button type=\"button\" class=\"cf-btn\" data-act='" + esc(JSON.stringify({ app: "shop", use: k })) + "' data-say=\"" + esc("Using the " + k + ".") + '">Use</button></li>';
  }).join("") + "</ul>" : empty("Your bag is empty.");
  return bar("Shop", { right: '<span class="ph-money">' + esc(moneyText(have)) + "</span>" }) + '<div class="ph-body">' +
    '<div class="ph-seg" role="tablist">' + (S.shop.length ? '<button type="button" role="tab" aria-selected="' + (tab === "shop") + '" data-go="shop" data-params=\'{"tab":"shop"}\'>Shop</button>' : "") +
    '<button type="button" role="tab" aria-selected="' + (tab === "bag") + '" data-go="shop" data-params=\'{"tab":"bag"}\'>Bag</button></div>' +
    (tab === "shop" ? shopHtml : bagHtml) + "</div>";
};
screens.quests = function () {
  var qs = list("Phone.Quests");
  var open = qs.filter(function (q) { return !/^\s*✓/.test(q); });
  var done = qs.filter(function (q) { return /^\s*✓/.test(q); });
  return bar("Notes") + '<div class="ph-body">' +
    '<section><h3 class="ph-h">To do</h3>' + (open.length ? '<ul class="ph-checks">' + open.map(function (q) { return "<li><i></i>" + esc(q) + "</li>"; }).join("") + "</ul>" : empty("Nothing open.")) + "</section>" +
    (done.length ? '<section><h3 class="ph-h">Done</h3><ul class="ph-checks done">' + done.map(function (q) { return "<li><i>" + ui.icon("check") + "</i>" + esc(q.replace(/^\s*✓\s*/, "")) + "</li>"; }).join("") + "</ul></section>" : "") +
    '<label class="cf-stack"><span class="ph-h">My notes</span><textarea class="cf-input ph-notes-box" data-notes rows="4" placeholder="Only you see these">' + esc(app.state("Phone.$Notes") || "") + "</textarea></label></div>";
};
screens.photos = function () {
  return bar("Photos") + '<div class="ph-body">' + (S.photos.length ? '<div class="ph-photos">' + S.photos.map(function (ph, i) {
    return '<button type="button" class="ph-photo" data-go="photo" data-params=\'' + esc(JSON.stringify({ i: i })) + "' aria-label=\"" + esc(ph.caption || ph.file) + '"><img alt="" loading="lazy" src="' + esc(CF.asset(ph.file)) + '"></button>';
  }).join("") + "</div>" : empty("No photos yet.")) + "</div>";
};
screens.photo = function (p) {
  var ph = S.photos[p.i] || { file: "", caption: "" };
  return bar(ph.caption || "Photo", { back: "photos" }) + '<div class="ph-body"><img class="ph-full" alt="' + esc(ph.caption) + '" src="' + esc(CF.asset(ph.file)) + '">' + (ph.caption ? "<p>" + esc(ph.caption) + "</p>" : "") + "</div>";
};
screens.system = function () {
  return bar(S.system.name) + '<div class="ph-body"><div class="cf-card ph-system">' + ui.icon("spark") + "<p>" + esc(S.system.description) + "</p></div>" +
    '<form class="cf-stack" data-compose="system"><textarea class="cf-input" name="text" rows="4" placeholder="Your request" aria-label="Your request"></textarea><button type="submit" class="cf-btn primary">File the request</button></form></div>';
};
screens.module = function (p) {
  return '<div class="ph-module" data-module="' + esc(p.id) + '"></div>';
};
screens.settings = function () {
  return '<div class="ph-module" data-module="settings"></div>';
};
function empty(text) { return '<p class="ph-empty">' + esc(text) + "</p>"; }

// ---------------------------------------------------------------- render and actions
function render() {
  var fn = screens[view.name] || screens.home;
  var html = fn(view.params || {});
  var inApp = view.name !== "lock" && view.name !== "home";
  root.innerHTML = '<div class="ph' + (inline ? " ph-inline" : "") + '"><div class="ph-screen' + (inApp ? " ph-in-app" : "") + '">' + (inApp ? statusBar(false) : "") + html + "</div>" + (view.name !== "lock" ? homeBar() : "") + "</div>";
  var mount = root.querySelector("[data-module]");
  if (mount) CF.mount(root.ownerDocument.defaultView, mount.getAttribute("data-module"), mount, { app: app });
  var chat = root.querySelector(".ph-chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}
function go(name, params) {
  view = { name: name, params: params || {} };
  render();
}
function act(payload, say) {
  app.send("phone", payload, say || "").then(function () { app.toast("In your message box: send it when you're ready"); });
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-open]"))) {
    var id = b.getAttribute("data-open");
    if (id.indexOf("module:") === 0) return go("module", { id: id.slice(7) });
    return go(id);
  }
  if ((b = t.closest("[data-go]"))) {
    var params = {};
    try { params = JSON.parse(b.getAttribute("data-params") || "{}"); } catch (err) {}
    return go(b.getAttribute("data-go"), params);
  }
  if ((b = t.closest("[data-act]"))) {
    var payload = null;
    try { payload = JSON.parse(b.getAttribute("data-act")); } catch (err) {}
    if (payload) act(payload, b.getAttribute("data-say"));
  }
});
// Compose forms send from their button and Enter as well as on submit: SillyTavern frames may not
// allow form submission.
function compose(form) {
  var box = form.querySelector("[name=text]");
  var text = box.value.trim();
  if (!text) return;
  var kind = form.getAttribute("data-compose");
  if (kind === "messages") {
    var to = form.getAttribute("data-to");
    pending.push({ to: to, text: text });
    draft[to] = "";
    act({ app: "messages", to: to, text: text }, "📱 To " + to + ": " + text);
  } else if (kind === "social") act({ app: "social", post: text }, "📱 Posted: " + text);
  else if (kind === "system") act({ app: "system", request: text }, "📱 " + S.system.name + ": " + text);
  box.value = "";
  render();
}
root.addEventListener("submit", function (e) {
  var form = e.target.closest("[data-compose]");
  if (!form) return;
  e.preventDefault();
  compose(form);
});
root.addEventListener("click", function (e) {
  var button = e.target.closest("[data-compose] [type=submit]");
  if (!button) return;
  e.preventDefault();
  compose(button.closest("[data-compose]"));
}, true);
root.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  var form = e.target.closest("[data-compose]");
  if (!form) return;
  e.preventDefault();
  compose(form);
});
root.addEventListener("input", function (e) {
  var form = e.target.closest("[data-compose=messages]");
  if (form) draft[form.getAttribute("data-to")] = e.target.value;
});
root.addEventListener("change", function (e) {
  if (e.target.hasAttribute("data-notes")) app.setMany([[["Phone", "$Notes"], e.target.value]]).catch(function () {});
});
render();
app.onState(function () {
  // A text that arrived in the state is no longer pending.
  var sent = list("Phone.Texts").join("\n");
  pending = pending.filter(function (x) { return sent.indexOf(x.text) < 0; });
  if (!root.querySelector("input:focus, textarea:focus")) render();
});
`;

const CSS = String.raw`
.ph { position: relative; display: flex; flex-direction: column; flex: 1 0 auto; min-height: 100%; height: 100vh; height: 100dvh; background: #000; overflow: hidden; }
.ph-inline { height: 640px; min-height: 0; flex: none; max-width: 380px; margin: 0 auto; border-radius: 28px; border: 6px solid #111; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.ph-screen { flex: 1; min-height: 0; display: flex; flex-direction: column; background-color: var(--cf-bg); background-image: var(--cf-texture); color: var(--cf-text); overflow: hidden; }
.ph-status { display: flex; align-items: center; justify-content: space-between; padding: 6px 52px 4px 16px; font-size: 0.8em; flex: none; }
.ph-inline .ph-status { padding-right: 16px; }
.ph-status.light { color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
.ph-status-right { display: flex; align-items: center; gap: 6px; }
.ph-signal { display: flex; align-items: flex-end; gap: 1.5px; height: 10px; }
.ph-signal i { width: 3px; background: currentColor; border-radius: 1px; }
.ph-signal i:nth-child(1) { height: 3px; } .ph-signal i:nth-child(2) { height: 5px; } .ph-signal i:nth-child(3) { height: 7px; } .ph-signal i:nth-child(4) { height: 10px; }
.ph-battery { position: relative; width: 22px; height: 11px; border: 1.5px solid currentColor; border-radius: 3px; padding: 1px; }
.ph-battery::after { content: ""; position: absolute; right: -4px; top: 3px; width: 2px; height: 4px; background: currentColor; border-radius: 0 1px 1px 0; }
.ph-battery i { display: block; height: 100%; background: currentColor; border-radius: 1px; }
.ph-lock, .ph-home { flex: 1; display: flex; flex-direction: column; background-color: var(--cf-accent); background-image: radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--cf-accent2) 85%, transparent), transparent 60%), linear-gradient(160deg, var(--cf-accent), color-mix(in srgb, var(--cf-accent) 40%, #000)); background-size: cover; background-position: center; color: #fff; overflow: auto; }
.ph-lock-time { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 28px 16px 18px; text-shadow: 0 2px 8px rgba(0,0,0,.35); }
.ph-lock-time b { font-size: 4em; font-weight: 300; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.ph-lock-icon { opacity: .8; }
.ph-weather { display: inline-flex; align-items: center; gap: 4px; opacity: .9; font-size: 0.9em; }
.ph-notes { display: flex; flex-direction: column; gap: 8px; padding: 0 12px; flex: 1; }
.ph-note { font: inherit; text-align: left; color: #fff; display: grid; gap: 1px; padding: 10px 12px; border: 0; border-radius: 16px; background: rgba(255,255,255,.18); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); cursor: pointer; min-height: 44px; }
.ph-note span:last-child { opacity: .9; font-size: .9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-note-app { display: flex; align-items: center; gap: 4px; font-size: .75em; text-transform: uppercase; letter-spacing: .05em; opacity: .8; }
.ph-unlock { font: inherit; color: #fff; background: rgba(255,255,255,.16); border: 0; border-radius: 999px; padding: 10px 22px; margin: 16px auto 22px; min-height: 44px; cursor: pointer; animation: ph-pulse 2.4s ease-in-out infinite; }
@keyframes ph-pulse { 0%, 100% { opacity: .75; } 50% { opacity: 1; } }
.ph-widget { margin: 10px 14px 4px; padding: 12px 14px; border-radius: 20px; background: rgba(255,255,255,.16); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); display: flex; flex-direction: column; text-shadow: 0 1px 4px rgba(0,0,0,.25); }
.ph-widget b { font-size: 1.9em; font-weight: 400; font-variant-numeric: tabular-nums; }
.ph-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 6px; padding: 18px 12px 24px; }
.ph-app { font: inherit; color: #fff; background: none; border: 0; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; min-width: 0; }
.ph-tile { position: relative; width: 54px; height: 54px; border-radius: 15px; display: grid; place-items: center; box-shadow: 0 3px 10px rgba(0,0,0,.25); background-image: linear-gradient(160deg, rgba(255,255,255,.28), rgba(255,255,255,0) 60%); transition: transform .15s; }
.ph-app:active .ph-tile { transform: scale(.92); }
.ph-tile .cf-icon { width: 26px; height: 26px; color: #fff; }
.ph-app-label { font-size: .72em; text-shadow: 0 1px 3px rgba(0,0,0,.5); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-badge { position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 11px; font-weight: 600; display: grid; place-items: center; box-shadow: 0 0 0 2px rgba(0,0,0,.15); }
.ph-badge.static { position: static; flex: none; }
.ph-homebar { flex: none; height: 26px; border: 0; background: #000; display: grid; place-items: center; cursor: pointer; padding: 0; }
.ph-homebar i { width: 120px; height: 5px; border-radius: 999px; background: rgba(255,255,255,.75); }
.ph-bar { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--cf-border); background: var(--cf-surface); flex: none; }
.ph-bar h1 { flex: 1; font-size: 1.05em; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-bar-space { width: 40px; flex: none; }
.ph-icon-btn { font: inherit; color: var(--cf-accent); background: none; border: 0; width: 40px; height: 40px; display: grid; place-items: center; cursor: pointer; border-radius: 50%; flex: none; }
.ph-icon-btn .cf-icon { width: 22px; height: 22px; }
.ph-money { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--cf-accent); padding-right: 6px; min-width: 40px; text-align: right; }
.ph-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.ph-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.ph-list > li { border-bottom: 1px solid color-mix(in srgb, var(--cf-border) 60%, transparent); }
.ph-list > li:last-child { border-bottom: 0; }
.ph-row { font: inherit; color: var(--cf-text); width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 2px; background: none; border: 0; text-align: left; cursor: pointer; min-height: 52px; }
.ph-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ph-sub { color: var(--cf-muted); font-size: .85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-stage { font-size: .75em; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--stage, var(--cf-accent)) 22%, transparent); color: var(--cf-text); border: 1px solid color-mix(in srgb, var(--stage, var(--cf-accent)) 60%, transparent); white-space: nowrap; }
.ph-chat { gap: 6px; background: color-mix(in srgb, var(--cf-surface) 40%, var(--cf-bg)); }
.ph-msg { max-width: 78%; padding: 7px 12px; border-radius: 18px 18px 18px 6px; background: var(--cf-surface2); align-self: flex-start; overflow-wrap: anywhere; line-height: 1.35; animation: ph-in .25s ease; }
.ph-msg.me { align-self: flex-end; border-radius: 18px 18px 6px 18px; background: var(--cf-accent); color: #fff; }
.ph-msg.pending { opacity: .6; }
.ph-from { display: block; font-size: .72em; opacity: .75; font-weight: 600; }
.ph-msg.pending .ph-from { font-weight: 400; margin-top: 2px; }
@keyframes ph-in { from { opacity: 0; transform: translateY(4px); } }
.ph-compose { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--cf-border); background: var(--cf-surface); flex: none; }
.ph-compose.top { border: 0; padding: 0; background: none; }
.ph-compose .cf-input { border-radius: 999px; padding: 6px 14px; }
.ph-send { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--cf-accent); color: #fff; display: grid; place-items: center; cursor: pointer; }
.ph-profile { align-items: center; text-align: center; }
.ph-profile h2 { font-size: 1.3em; }
.cf-avatar.ph-big { width: 96px; height: 96px; font-size: 2.2em; box-shadow: 0 0 0 3px var(--cf-surface), 0 0 0 5px color-mix(in srgb, var(--cf-accent) 60%, transparent); }
.ph-aff { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 6px; }
.ph-aff .cf-meter-fill { background: var(--stage); }
.ph-aff .ph-stage { align-self: flex-start; }
.ph-facts { width: 100%; margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; text-align: left; }
.ph-facts dt { color: var(--cf-muted); font-size: .85em; }
.ph-facts dd { margin: 0; overflow-wrap: anywhere; }
.ph-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.ph-post p { margin-top: 6px; overflow-wrap: anywhere; }
.ph-comments { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--cf-border); font-size: .9em; display: flex; flex-direction: column; gap: 3px; }
.ph-news summary { cursor: pointer; font-weight: 600; min-height: 28px; }
.ph-news p { margin-top: 6px; color: var(--cf-muted); }
.ph-balance { display: flex; flex-direction: column; align-items: center; padding: 18px 0 10px; }
.ph-balance b { font-size: 2.4em; font-variant-numeric: tabular-nums; color: var(--cf-accent); }
.ph-tx { display: flex; justify-content: space-between; gap: 8px; padding: 9px 2px; }
.ph-tx b { font-variant-numeric: tabular-nums; }
.ph-tx b.up { color: var(--cf-good); } .ph-tx b.down { color: var(--cf-bad); }
.ph-here { display: flex; align-items: center; gap: 10px; }
.ph-here .cf-icon, .ph-pin .cf-icon { width: 22px; height: 22px; color: var(--cf-accent); }
.ph-pin { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--cf-surface2); flex: none; }
.ph-pin.here { background: color-mix(in srgb, var(--cf-accent) 25%, transparent); }
.ph-today { display: flex; flex-direction: column; padding: 4px 0 6px; }
.ph-today b { font-size: 1.3em; }
.ph-today span:last-child { color: var(--cf-muted); font-size: .9em; }
.ph-day h3, .ph-h { font-size: .8em; text-transform: uppercase; letter-spacing: .06em; color: var(--cf-muted); margin: 6px 0 4px; font-family: var(--cf-font); }
.ph-event { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; padding: 8px 10px; border-left: 3px solid var(--cf-accent); background: var(--cf-surface2); border-radius: 0 var(--cf-radius) var(--cf-radius) 0; margin-bottom: 6px; }
.ph-event b { font-variant-numeric: tabular-nums; }
.ph-seg { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--cf-surface2); }
.ph-seg button { flex: 1; font: inherit; color: var(--cf-muted); background: none; border: 0; border-radius: 8px; min-height: 34px; cursor: pointer; }
.ph-seg button[aria-selected=true] { background: var(--cf-surface); color: var(--cf-text); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.ph-shop { display: flex; align-items: center; gap: 10px; padding: 9px 2px; }
.ph-shop .cf-btn { flex: none; min-width: 64px; justify-content: center; font-variant-numeric: tabular-nums; }
.ph-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ph-checks li { display: flex; gap: 10px; align-items: flex-start; overflow-wrap: anywhere; }
.ph-checks i { flex: none; width: 18px; height: 18px; margin-top: 2px; border-radius: 50%; border: 2px solid var(--cf-accent); display: grid; place-items: center; }
.ph-checks.done li { color: var(--cf-muted); text-decoration: line-through; }
.ph-checks.done i { background: var(--cf-accent); color: #fff; }
.ph-checks.done i .cf-icon { width: 12px; height: 12px; }
.ph-notes-box { resize: vertical; }
.ph-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
.ph-photo { padding: 0; border: 0; aspect-ratio: 1; background: var(--cf-surface2); cursor: pointer; overflow: hidden; }
.ph-photo img, .ph-full { width: 100%; height: 100%; object-fit: cover; display: block; }
.ph-full { height: auto; border-radius: var(--cf-radius); }
.ph-system { display: flex; gap: 10px; align-items: flex-start; }
.ph-system .cf-icon { width: 28px; height: 28px; color: var(--cf-accent); }
.ph-module { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.ph-module > .cf-app { flex: 1 0 auto; }
.ph-empty { color: var(--cf-muted); text-align: center; padding: 24px 8px; }
@media (prefers-reduced-motion: reduce) { .ph-unlock, .ph-msg { animation: none; } }
`;

export function phoneModule(raw?: Record<string, unknown>, enabled = true, extra: { id: string; name: string }[] = []): EngineModule {
  const settings = phoneSettings(raw);
  const live = usable(settings);
  return {
    id: "phone",
    name: "Phone",
    version: "1.0.0",
    description: "A modern phone over the chat: lock screen, home screen and apps for texts, contacts, social, news, wallet, map, calendar, shop, notes, photos and more.",
    slot: "overlay",
    button: settings.button.trim() || "📱 Phone",
    tags: ["built-in", "phone"],
    requires: ["time"],
    core: "phone",
    enabled,
    vars: phoneVars(live),
    rules: phoneRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live, catalog: PHONE_APPS, extra },
  };
}
