/**
 * Kit part (Dating sim / visual novel): routes. Every love interest has a heart meter with stages,
 * trust, a route status (open, locked in, lost) and the gift likes {{user}} has found out. The
 * player plans dates and gives gifts from the screen; a banner plays when someone moves up a stage.
 * Event pictures (CGs) and endings unlock as the story reaches them and stay unlocked across chats,
 * kept with the character, so a new playthrough shows what earlier ones found.
 */
import { newVar, type EngineVar } from "../sheet";
import { valueKey } from "./people";
import type { EngineModule, ModuleRule } from "./types";

export interface LoveInterest {
  name: string;
  avatar: string;
  about: string;
  /** Comma-separated gift and topic preferences. */
  loved: string;
  liked: string;
  disliked: string;
}

export interface RouteStage {
  name: string;
  from: number;
}

export interface DateSpot {
  name: string;
  description: string;
}

export interface RouteGift {
  name: string;
  price: number;
}

export const ENDING_KINDS = ["good", "normal", "bad", "secret"] as const;
export type EndingKind = (typeof ENDING_KINDS)[number];

export interface RouteEnding {
  /** The love interest's name, or empty for an ending of its own. */
  route: string;
  name: string;
  kind: EndingKind;
  /** Shown while it's locked. */
  hint: string;
}

export interface GalleryPicture {
  file: string;
  caption: string;
  route: string;
}

export interface RoutesSettings {
  title: string;
  button: string;
  interests: LoveInterest[];
  stages: RouteStage[];
  trust: boolean;
  /** Love interests notice each other. */
  jealousy: boolean;
  spots: DateSpot[];
  gifts: RouteGift[];
  currency: string;
  moneyPath: string;
  startMoney: number;
  endings: RouteEnding[];
  gallery: GalleryPicture[];
}

export const defaultRoutesSettings = (): RoutesSettings => ({
  title: "Routes",
  button: "💗 Routes",
  interests: [],
  stages: [
    { name: "Stranger", from: 0 },
    { name: "Friend", from: 25 },
    { name: "Crush", from: 50 },
    { name: "Sweetheart", from: 75 },
    { name: "Lover", from: 90 },
  ],
  trust: true,
  jealousy: false,
  spots: [
    { name: "Café", description: "Quiet corner booth, good cake." },
    { name: "Aquarium", description: "Blue light and whispering crowds." },
    { name: "Riverside at dusk", description: "Lanterns on the water." },
  ],
  gifts: [
    { name: "Flowers", price: 20 },
    { name: "Chocolates", price: 15 },
    { name: "A book", price: 25 },
    { name: "Concert tickets", price: 60 },
  ],
  currency: "$",
  moneyPath: "",
  startMoney: 200,
  endings: [],
  gallery: [],
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();
const pathText = (v: unknown) => str(v).replace(/[^\w$. -]/g, "").trim();

export function routesSettings(raw: Record<string, unknown> | undefined): RoutesSettings {
  const base = defaultRoutesSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    interests: Array.isArray(raw.interests)
      ? rows(raw.interests).map((p) => ({ name: str(p.name), avatar: str(p.avatar), about: str(p.about), loved: str(p.loved), liked: str(p.liked), disliked: str(p.disliked) }))
      : base.interests,
    stages: Array.isArray(raw.stages) ? rows(raw.stages).map((s) => ({ name: str(s.name), from: num(s.from, 0) })) : base.stages,
    trust: raw.trust !== false,
    jealousy: raw.jealousy === true,
    spots: Array.isArray(raw.spots) ? rows(raw.spots).map((s) => ({ name: str(s.name), description: str(s.description) })) : base.spots,
    gifts: Array.isArray(raw.gifts) ? rows(raw.gifts).map((g) => ({ name: str(g.name), price: Math.max(0, num(g.price, 0)) })) : base.gifts,
    currency: str(raw.currency, base.currency),
    moneyPath: pathText(raw.moneyPath),
    startMoney: num(raw.startMoney, base.startMoney),
    endings: Array.isArray(raw.endings)
      ? rows(raw.endings).map((e) => ({
          route: str(e.route),
          name: str(e.name),
          kind: (ENDING_KINDS as readonly string[]).includes(str(e.kind)) ? (str(e.kind) as EndingKind) : "normal",
          hint: str(e.hint),
        }))
      : base.endings,
    gallery: Array.isArray(raw.gallery) ? rows(raw.gallery).map((g) => ({ file: str(g.file), caption: str(g.caption), route: str(g.route) })) : base.gallery,
  };
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function usable(s: RoutesSettings, shared: string) {
  return {
    ...s,
    interests: s.interests.filter((p) => clean(p.name)).map((p) => ({ ...p, name: clean(p.name) })),
    stages: s.stages.filter((st) => st.name.trim()).sort((a, b) => a.from - b.from),
    spots: s.spots.filter((p) => p.name.trim()),
    gifts: s.gifts.filter((g) => g.name.trim()),
    endings: s.endings.filter((e) => e.name.trim()),
    gallery: s.gallery.filter((g) => g.caption.trim()),
    money: s.moneyPath || shared || "Routes.Money",
  };
}
type Live = ReturnType<typeof usable>;

/** The line an ending is kept under: "Mina: Under the cherry tree". */
export const endingKey = (e: { route: string; name: string }) => (e.route.trim() ? `${e.route.trim()}: ${e.name.trim()}` : e.name.trim());

function routesVars(s: Live, taken: Set<string>): EngineVar[] {
  const vars: EngineVar[] = [];
  const add = (v: EngineVar) => {
    if (!taken.has(valueKey(v))) vars.push(v);
  };
  for (const p of s.interests) {
    add(newVar({ id: `routes-aff-${p.name}`, group: p.name, name: "Affection", type: "number", start: "10", min: 0, max: 100, pinned: false, rule: `How ${p.name} feels about {{user}}, 0 to 100: +2 to +5 for a moment that lands, −3 to −8 for a slight. Stages unlock at set levels.` }));
    if (s.trust) add(newVar({ id: `routes-trust-${p.name}`, group: p.name, name: "Trust", type: "number", start: "10", min: 0, max: 100, pinned: false, rule: `How much ${p.name} trusts {{user}} with the truth, 0 to 100: kept promises and secrets raise it, lies lower it a lot.` }));
    add(newVar({ id: `routes-route-${p.name}`, group: p.name, name: "Route", type: "choice", options: ["Open", "Locked in", "Lost"], start: "Open", pinned: false, rule: `${p.name}'s route: Locked in once they and {{user}} commit to each other, Lost if {{user}} chose someone else or broke it beyond repair.` }));
    add(newVar({ id: `routes-found-${p.name}`, group: p.name, name: "Discovered", type: "list", start: "", pinned: false, rule: `What {{user}} has found out ${p.name} loves, likes or dislikes, as 'Loves: X', 'Likes: X' or 'Dislikes: X'. Insert one when a reaction shows it.` }));
  }
  vars.push(newVar({ id: "routes-focus", group: "Routes", name: "Focus", type: "text", start: "", pinned: true, rule: "The love interest {{user}} is spending the most time with now; empty for none." }));
  vars.push(newVar({ id: "routes-dates", group: "Routes", name: "Dates", type: "list", start: "", pinned: false, rule: "Dates so far, oldest first: 'Day N: Name at Place (how it went)'. Insert one when a date ends." }));
  if (s.gifts.length) vars.push(newVar({ id: "routes-gifts", group: "Routes", name: "Gifts", type: "counts", start: "", pinned: false, rule: "Gifts {{user}} is carrying. Delta −1 when one is given." }));
  if (s.money === "Routes.Money" && !s.moneyPath)
    vars.push(newVar({ id: "routes-money", group: "Routes", name: "Money", type: "number", start: String(s.startMoney), min: 0, pinned: false, rule: `{{user}}'s money in ${s.currency || "the currency"}. Delta it when {{user}} pays or is paid.` }));
  if (s.gallery.length) vars.push(newVar({ id: "routes-unlocked", group: "Routes", name: "Unlocked", type: "list", start: "", pinned: false, rule: "Special scenes reached this playthrough, by their exact caption. Insert one when its scene happens." }));
  if (s.endings.length) vars.push(newVar({ id: "routes-ending", group: "Routes", name: "Ending", type: "text", start: "", pinned: false, rule: "Set once, when the story reaches an ending, to its exact name from the list of endings." }));
  return vars;
}

function routesRules(s: Live): ModuleRule[] {
  const lines = ['<action app="routes"> is something {{user}} chose on the Routes screen. Play it out and update the state:'];
  lines.push('- {"date":{"with":N,"place":P,"time":T,"plan":X}}: {{user}} asks N out to P (T). Play the date following the plan; how it goes depends on what N likes and on Affection. Insert it into /Routes/Dates and change N\'s Affection by how it went.');
  if (s.gifts.length) lines.push('- {"give":G,"to":N}: {{user}} gives N the G. Delta /Routes/Gifts/G by −1. N reacts by their tastes below; Affection +5 to +8 for a loved gift, +2 to +4 for a liked one, −3 for a disliked one, +1 otherwise. Insert what the reaction showed into N\'s Discovered.');
  const tastes = s.interests
    .filter((p) => p.loved || p.liked || p.disliked)
    .map((p) => `${p.name}: loves ${list(p.loved).join(", ") || "?"}; likes ${list(p.liked).join(", ") || "?"}; dislikes ${list(p.disliked).join(", ") || "?"}.`);
  if (tastes.length) lines.push("Tastes (hidden from {{user}} until discovered):", ...tastes);
  const rules: ModuleRule[] = [{ comment: "Routes actions", content: lines.join("\n"), constant: false, keys: ['app="routes"'], depth: 2, order: 100 }];
  const always = [`Routes: love interests move through stages by Affection (${s.stages.map((st) => `${st.name} ${st.from}`).join(", ")}); each new stage deserves a scene that shows it.`];
  if (s.jealousy) always.push("Love interests notice when {{user}} spends time with the others: jealousy, rivalry, small hurts.");
  if (s.gallery.length) always.push(`Special scenes, by caption: ${s.gallery.map((g) => g.caption).join("; ")}.`);
  if (s.endings.length) always.push(`Endings: ${s.endings.map((e) => `${endingKey(e)} (${e.kind}${e.hint ? `: ${e.hint}` : ""})`).join("; ")}.`);
  rules.push({ comment: "Routes", content: always.join(" "), constant: true, keys: [], order: 100 });
  return rules;
}

// Runs in the card's script: stage-up banners, and unlocks kept across chats.
const SCRIPT = String.raw`
var S = settings.live || settings;
function stageOf(v) {
  var out = null;
  S.stages.forEach(function (s) { if (v >= s.from) out = s; });
  return out;
}
// A short scene over the chat: a name, a line and hearts.
function cutscene(title, line) {
  var doc = window.parent.document;
  var old = doc.getElementById("cf-cutscene");
  if (old) old.remove();
  var box = doc.createElement("div");
  box.id = "cf-cutscene";
  box.style.cssText = "position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;pointer-events:auto;";
  var shadow = box.attachShadow({ mode: "open" });
  var hearts = "";
  for (var i = 0; i < 9; i++) hearts += '<i style="left:' + (8 + i * 11) + "%;animation-delay:" + (i * 0.12).toFixed(2) + 's">♥</i>';
  shadow.innerHTML = "<style>" + CF.themeCss().replace(/:root/g, ":host") +
    ".cs{position:relative;width:min(380px,88vw);padding:22px 18px;text-align:center;border-radius:calc(var(--cf-radius) + 10px);background:var(--cf-surface);color:var(--cf-text);border:1px solid var(--cf-border);box-shadow:0 18px 60px rgba(0,0,0,.45);font-family:var(--cf-font);font-size:calc(15px*var(--cf-scale,1));animation:cs-in .5s cubic-bezier(.2,.9,.3,1.2) both;overflow:hidden}" +
    ".cs small{display:block;text-transform:uppercase;letter-spacing:.14em;color:var(--cf-muted);font-size:.72em}" +
    ".cs b{display:block;font-family:var(--cf-heading);font-size:1.7em;color:var(--cf-accent);margin:4px 0}" +
    ".cs i{position:absolute;bottom:-20px;font-style:normal;color:var(--cf-accent);font-size:18px;animation:cs-up 1.8s ease-out both}" +
    ".back{position:absolute;inset:0;background:rgba(0,0,0,.35);animation:cs-fade .3s both}" +
    "@keyframes cs-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}@keyframes cs-up{from{opacity:0;transform:translateY(0)}20%{opacity:1}to{opacity:0;transform:translateY(-160px)}}@keyframes cs-fade{from{opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){.cs,.cs i,.back{animation:none}.cs i{display:none}}</style>" +
    '<div class="back"></div><div class="cs" role="status"><small>' + CF.ui.esc(title) + "</small><b>" + CF.ui.esc(line) + "</b>" + hearts + "</div>";
  doc.body.appendChild(box);
  function drop() { box.remove(); }
  box.addEventListener("click", drop);
  setTimeout(drop, 2800);
}
hooks.afterUpdate(function (stat, before, info) {
  if (!before || !info || !info.latest) return stat;
  var scenes = [];
  S.interests.forEach(function (p) {
    var now = stat[p.name] && stat[p.name].Affection, was = before[p.name] && before[p.name].Affection;
    if (typeof now !== "number" || typeof was !== "number" || now === was) return;
    var a = stageOf(now), b = stageOf(was);
    if (a && a !== b && now > was) scenes.push([p.name, a.name]);
    else setTimeout(function () { CF.bus.emit("notify", { title: p.name, text: (now > was ? "♥ +" : "♥ ") + (now - was), icon: "heart", open: "routes" }); }, 300);
  });
  var r = stat.Routes || {}, rb = before.Routes || {};
  var fresh = (Array.isArray(r.Unlocked) ? r.Unlocked : []).filter(function (c) { return (rb.Unlocked || []).indexOf(c) < 0; });
  if (fresh.length)
    CF.keep.add("gallery", fresh).then(function (added) {
      if (added.length) CF.bus.emit("notify", { title: "Gallery", text: "Unlocked: " + added.join(", "), icon: "camera", open: "routes" });
    });
  if (r.Ending && r.Ending !== rb.Ending) {
    CF.keep.add("endings", [String(r.Ending)]);
    scenes.push(["Ending reached", String(r.Ending)]);
  }
  scenes.forEach(function (s, i) { setTimeout(function () { cutscene(s[0], s[1]); }, 400 + i * 3000); });
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "cast";
function get(path) { return app.state(path); }
function money() { var n = Number(get(S.money)); return isFinite(n) ? n : 0; }
function cash(n) { return (S.currency || "") + (Math.round(n * 100) / 100); }
function stageOf(v) { var out = null; S.stages.forEach(function (s) { if (v >= s.from) out = s; }); return out; }
function nextStage(v) { return S.stages.filter(function (s) { return s.from > v; })[0] || null; }
function person(name) { return S.interests.filter(function (p) { return p.name === name; })[0]; }
function aff(name) { var v = Number((get(name) || {}).Affection); return isFinite(v) ? v : 0; }
function kept(key) { var v = CF.keep.get(key); return Array.isArray(v) ? v : []; }
function act(payload, say) {
  app.send("routes", payload, say).then(function () { app.toast("In your message box: send it when you're ready"); });
}
function portrait(p, big) {
  return '<span class="rt-av' + (big ? " big" : "") + '">' + ui.avatar(p.avatar ? app.asset(p.avatar) : CF.assets.portrait(p.name), p.name) + "</span>";
}
function hearts(v) {
  var full = Math.round(v / 20);
  var out = "";
  for (var i = 0; i < 5; i++) out += '<span class="' + (i < full ? "on" : "") + '">♥</span>';
  return '<span class="rt-hearts" aria-label="' + v + ' of 100">' + out + "</span>";
}
function routeChip(st) {
  var r = (st && st.Route) || "Open";
  return '<span class="rt-route ' + (r === "Locked in" ? "in" : r === "Lost" ? "lost" : "") + '">' + esc(r) + "</span>";
}
function castView() {
  if (!S.interests.length) return '<p class="cf-muted">No love interests yet.</p>';
  var focus = get("Routes.Focus") || "";
  return '<div class="rt-cast">' + S.interests.map(function (p, i) {
    var st = get(p.name) || {}, v = aff(p.name), stage = stageOf(v);
    return '<button type="button" class="rt-card' + (focus === p.name ? " focus" : "") + '" data-person="' + i + '">' + portrait(p) +
      "<b>" + esc(p.name) + "</b>" + hearts(v) + '<span class="rt-meta">' + (stage ? ui.chip(stage.name) : "") + routeChip(st) + "</span></button>";
  }).join("") + "</div>";
}
function giftsView() {
  var have = get("Routes.Gifts") || {};
  var names = Object.keys(have).filter(function (k) { return Number(have[k]) > 0; });
  return '<div class="cf-stack"><div class="cf-card rt-wallet"><span class="cf-label">Money</span><b>' + esc(cash(money())) + "</b></div>" +
    (names.length ? '<div class="cf-card"><span class="cf-label">Carrying</span><p>' + names.map(function (k) { return esc(k) + " ×" + esc(have[k]); }).join(", ") + '</p><p class="cf-small cf-muted">Give them from someone\'s page.</p></div>' : "") +
    '<ul class="rt-shop">' + S.gifts.map(function (g, i) {
      var short = money() < g.price;
      return '<li><span>' + ui.icon("gift") + "<b>" + esc(g.name) + '</b></span><button type="button" class="cf-btn' + (short ? "" : " primary") + '" data-buy="' + i + '"' + (short ? " disabled" : "") + ">" + esc(cash(g.price)) + "</button></li>";
    }).join("") + "</ul></div>";
}
function galleryView() {
  if (!S.gallery.length) return '<p class="cf-muted">No pictures in this card.</p>';
  var open = kept("gallery").concat(get("Routes.Unlocked") || []);
  var n = S.gallery.filter(function (g) { return open.indexOf(g.caption) >= 0; }).length;
  return '<p class="cf-small cf-muted">' + n + " of " + S.gallery.length + ' unlocked, across every playthrough.</p><div class="rt-gallery">' + S.gallery.map(function (g, i) {
    var on = open.indexOf(g.caption) >= 0;
    return on
      ? '<button type="button" class="rt-cg" data-cg="' + i + '" aria-label="' + esc(g.caption) + '"><img alt="" loading="lazy" src="' + esc(app.asset(g.file)) + '" onerror="this.remove()"><span>' + esc(g.caption) + "</span></button>"
      : '<div class="rt-cg locked" aria-label="Locked"><b>?</b><span>' + esc(g.route || "Locked") + "</span></div>";
  }).join("") + "</div>";
}
function endingsView() {
  if (!S.endings.length) return '<p class="cf-muted">No endings listed in this card.</p>';
  var got = kept("endings").concat(get("Routes.Ending") ? [get("Routes.Ending")] : []);
  var groups = {}, order = [];
  S.endings.forEach(function (e) { var k = e.route || "Other"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(e); });
  var n = S.endings.filter(function (e) { return got.indexOf(e.route ? e.route + ": " + e.name : e.name) >= 0; }).length;
  return '<p class="cf-small cf-muted">' + n + " of " + S.endings.length + " endings found.</p>" + order.map(function (k) {
    return '<section class="cf-card rt-ends"><span class="cf-label">' + esc(k) + "</span>" + groups[k].map(function (e) {
      var key = e.route ? e.route + ": " + e.name : e.name;
      var on = got.indexOf(key) >= 0;
      return '<div class="rt-end ' + e.kind + (on ? " on" : "") + '"><span class="rt-kind">' + esc(e.kind) + "</span><b>" + esc(on ? e.name : "???") + "</b>" + (!on && e.hint ? '<span class="cf-small cf-muted">' + esc(e.hint) + "</span>" : "") + "</div>";
    }).join("") + "</section>";
  }).join("");
}
function home() {
  var tabs = [{ id: "cast", label: "Cast", html: castView() }];
  if (S.gifts.length) tabs.push({ id: "gifts", label: "Gifts", html: giftsView() });
  if (S.gallery.length) tabs.push({ id: "gallery", label: "Gallery", html: galleryView() });
  if (S.endings.length) tabs.push({ id: "endings", label: "Endings", html: endingsView() });
  return ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
function tastes(p, found) {
  var out = [];
  [["Loves", p.loved], ["Likes", p.liked], ["Dislikes", p.disliked]].forEach(function (row) {
    var all = String(row[1] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    var known = found.filter(function (f) { return f.indexOf(row[0] + ":") === 0; }).map(function (f) { return f.slice(row[0].length + 1).trim(); });
    var hidden = Math.max(0, all.length - known.length);
    if (!known.length && !hidden) return;
    out.push('<div class="rt-taste"><span class="cf-label">' + row[0] + "</span><span>" + known.map(function (k) { return ui.chip(k); }).join("") +
      (hidden ? '<span class="cf-chip rt-unknown">' + ["?", "??", "???"][Math.min(hidden, 3) - 1] + "</span>" : "") + "</span></div>");
  });
  return out.join("");
}
function profile(params) {
  var p = S.interests[params.i];
  if (!p) return home();
  var st = get(p.name) || {}, v = aff(p.name), stage = stageOf(v), next = nextStage(v);
  var d = app.delta()[p.name + ".Affection"], up = d && typeof d[0] === "number" ? d[1] - d[0] : 0;
  var td = app.delta()[p.name + ".Trust"];
  var found = Array.isArray(st.Discovered) ? st.Discovered : [];
  var gifts = get("Routes.Gifts") || {};
  var carrying = Object.keys(gifts).filter(function (k) { return Number(gifts[k]) > 0; });
  var focus = get("Routes.Focus") === p.name;
  return ui.appBar(p.name, { back: true }) + '<div class="cf-appbody cf-stack">' +
    '<div class="rt-hero">' + portrait(p, true) + (up > 0 ? '<span class="rt-burst" aria-hidden="true"><i>♥</i><i>♥</i><i>♥</i></span>' : "") +
    "<div><h2>" + esc(p.name) + "</h2>" + (stage ? ui.chip(stage.name) : "") + routeChip(st) + "</div></div>" +
    '<div class="cf-card cf-stack rt-heart">' + ui.meter({ label: "♥ Affection", value: v, max: 100, delta: up || undefined }) +
    (next ? '<span class="cf-small cf-muted">' + esc(next.name) + " at " + next.from + "</span>" : '<span class="cf-small cf-muted">Highest stage</span>') +
    (S.trust && typeof st.Trust === "number" ? ui.meter({ label: "Trust", value: st.Trust, max: 100, delta: td && typeof td[0] === "number" ? td[1] - td[0] : undefined }) : "") + "</div>" +
    (p.about ? '<div class="cf-card"><span class="cf-label">About</span><p>' + esc(p.about) + "</p></div>" : "") +
    (p.loved || p.liked || p.disliked ? '<div class="cf-card cf-stack">' + tastes(p, found) + "</div>" : "") +
    '<div class="rt-actions">' +
    (S.spots.length ? '<button type="button" class="cf-btn primary" data-plan="' + params.i + '">' + ui.icon("calendar") + "Plan a date</button>" : "") +
    (carrying.length ? '<button type="button" class="cf-btn" data-give="' + params.i + '">' + ui.icon("gift") + "Give a gift</button>" : "") +
    '<button type="button" class="cf-btn ghost" data-focus="' + params.i + '"' + (focus ? " disabled" : "") + ">" + (focus ? "Your focus" : "Focus on " + esc(p.name)) + "</button></div></div>";
}
function planner(params) {
  var p = S.interests[params.i];
  if (!p) return home();
  return ui.appBar("A date with " + p.name, { back: true }) + '<div class="cf-appbody"><form class="cf-stack" data-date="' + params.i + '">' +
    '<span class="cf-label">Where</span><div class="rt-spots">' + S.spots.map(function (s, i) {
      return '<label class="rt-spot"><input type="radio" name="place" value="' + esc(s.name) + '"' + (i === 0 ? " checked" : "") + "><span><b>" + esc(s.name) + '</b><span class="cf-small cf-muted">' + esc(s.description) + "</span></span></label>";
    }).join("") + "</div>" +
    '<label class="cf-stack"><span class="cf-label">When</span><select class="cf-input" name="time">' + ["This evening", "Tomorrow after school or work", "This weekend", "Right now"].map(function (t) { return "<option>" + esc(t) + "</option>"; }).join("") + "</select></label>" +
    '<label class="cf-stack"><span class="cf-label">The plan</span><textarea class="cf-input" name="plan" rows="3" placeholder="What you want to do, say or find out"></textarea></label>' +
    '<button type="submit" class="cf-btn primary">Ask ' + esc(p.name) + " out</button></form></div>";
}
var nav = app.router(root, { home: home, person: profile, date: planner }, "home");
function sendDate(form) {
  var p = S.interests[Number(form.getAttribute("data-date"))];
  var place = (form.querySelector("[name=place]:checked") || {}).value || "";
  var time = form.querySelector("[name=time]").value;
  var plan = form.querySelector("[name=plan]").value.trim();
  act({ date: { with: p.name, place: place, time: time, plan: plan } }, "I ask " + p.name + " out: " + place + ", " + time.toLowerCase() + "." + (plan ? " " + plan : ""));
  nav.back();
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-person]"))) return nav.go("person", { i: Number(b.getAttribute("data-person")) });
  if ((b = t.closest("[data-plan]"))) return nav.go("date", { i: Number(b.getAttribute("data-plan")) });
  if ((b = t.closest("[data-focus]"))) {
    var who = S.interests[Number(b.getAttribute("data-focus"))].name;
    return app.setMany([[["Routes", "Focus"], who]], "focusing on " + who);
  }
  if ((b = t.closest("[data-buy]"))) {
    var g = S.gifts[Number(b.getAttribute("data-buy"))];
    var have = get("Routes.Gifts") || {};
    return app.setMany([[S.money.split("."), money() - g.price], [["Routes", "Gifts", g.name], (Number(have[g.name]) || 0) + 1]], "bought " + g.name.toLowerCase())
      .then(function () { app.toast("Bought: " + g.name); });
  }
  if ((b = t.closest("[data-give]"))) {
    var p = S.interests[Number(b.getAttribute("data-give"))];
    var gifts = get("Routes.Gifts") || {};
    var m = app.modal("<h2>A gift for " + esc(p.name) + '</h2><div class="cf-stack">' + Object.keys(gifts).filter(function (k) { return Number(gifts[k]) > 0; }).map(function (k) {
      return '<button type="button" class="cf-btn" data-gift="' + esc(k) + '">' + ui.icon("gift") + esc(k) + "</button>";
    }).join("") + '<button type="button" class="cf-btn ghost" data-cf-close>Not now</button></div>');
    m.addEventListener("click", function (ev) {
      var gb = ev.target.closest("[data-gift]");
      if (!gb) return;
      m.remove();
      act({ give: gb.getAttribute("data-gift"), to: p.name }, "I give " + p.name + " the " + gb.getAttribute("data-gift").toLowerCase() + ".");
    });
    return;
  }
  if ((b = t.closest("[data-cg]"))) {
    var cg = S.gallery[Number(b.getAttribute("data-cg"))];
    app.modal('<figure class="rt-view"><img alt="' + esc(cg.caption) + '" src="' + esc(app.asset(cg.file)) + '"><figcaption>' + esc(cg.caption) + '</figcaption></figure><button type="button" class="cf-btn" data-cf-close>Close</button>');
    return;
  }
  if ((b = t.closest("[data-date] [type=submit]"))) { e.preventDefault(); sendDate(b.closest("[data-date]")); }
});
root.addEventListener("submit", function (e) {
  var form = e.target.closest("[data-date]");
  if (!form) return;
  e.preventDefault();
  sendDate(form);
});
app.onState(function () { if (!root.querySelector("form")) nav.refresh(); });
app.on("keep", function () { if (!root.querySelector("form")) nav.refresh(); });
`;

const CSS = String.raw`
.rt-cast { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.rt-card { font: inherit; color: var(--cf-text); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 12px; min-width: 0; border: 1px solid var(--cf-border); border-radius: calc(var(--cf-radius) + 4px); background: var(--cf-surface2); cursor: pointer; text-align: center; transition: transform .15s, border-color .15s; }
.rt-card:hover, .rt-card:focus-visible { border-color: var(--cf-accent); transform: translateY(-2px); }
.rt-card.focus { border-color: var(--cf-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--cf-accent) 35%, transparent); }
.rt-card b { overflow-wrap: anywhere; }
.rt-av .cf-avatar { width: 64px; height: 64px; font-size: 1.6em; box-shadow: 0 0 0 3px var(--cf-surface), 0 0 0 5px color-mix(in srgb, var(--cf-accent) 55%, transparent); }
.rt-av.big .cf-avatar { width: 96px; height: 96px; font-size: 2.2em; }
.rt-hearts { display: inline-flex; gap: 2px; font-size: 1.05em; color: color-mix(in srgb, var(--cf-muted) 55%, transparent); }
.rt-hearts .on { color: var(--cf-accent); }
.rt-meta { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
.rt-route { font-size: .72em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--cf-border); color: var(--cf-muted); white-space: nowrap; }
.rt-route.in { border-color: var(--cf-accent); color: var(--cf-accent); }
.rt-route.lost { text-decoration: line-through; }
.rt-hero { position: relative; display: flex; align-items: center; gap: 14px; }
.rt-hero h2 { font-family: var(--cf-heading); font-size: 1.4em; margin-bottom: 4px; }
.rt-hero .cf-chip { margin-right: 4px; }
.rt-burst { position: absolute; left: 30px; top: 0; pointer-events: none; }
.rt-burst i { position: absolute; font-style: normal; color: var(--cf-accent); animation: rt-up 1.4s ease-out both; }
.rt-burst i:nth-child(2) { left: 18px; animation-delay: .15s; } .rt-burst i:nth-child(3) { left: 36px; animation-delay: .3s; }
@keyframes rt-up { from { opacity: 0; transform: translateY(40px) scale(.6); } 30% { opacity: 1; } to { opacity: 0; transform: translateY(-30px) scale(1.2); } }
.rt-heart .cf-meter-fill { background: linear-gradient(90deg, var(--cf-accent2), var(--cf-accent)); }
.rt-taste { display: flex; flex-direction: column; gap: 4px; }
.rt-taste > span:last-child { display: flex; flex-wrap: wrap; gap: 4px; }
.rt-unknown { opacity: .6; letter-spacing: .1em; }
.rt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.rt-actions .cf-btn { flex: 1 1 140px; justify-content: center; min-height: 44px; }
.rt-spots { display: flex; flex-direction: column; gap: 6px; }
.rt-spot { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); cursor: pointer; }
.rt-spot:has(input:checked) { border-color: var(--cf-accent); }
.rt-spot input { margin-top: 3px; accent-color: var(--cf-accent); }
.rt-spot > span { display: flex; flex-direction: column; }
.rt-wallet b { display: block; font-size: 1.5em; color: var(--cf-accent); font-variant-numeric: tabular-nums; }
.rt-shop { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rt-shop li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: var(--cf-radius); background: var(--cf-surface2); }
.rt-shop li > span { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rt-shop .cf-icon { width: 18px; height: 18px; color: var(--cf-accent); flex: none; }
.rt-shop .cf-btn { min-width: 64px; justify-content: center; font-variant-numeric: tabular-nums; }
.rt-gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.rt-cg { position: relative; aspect-ratio: 4 / 3; border-radius: var(--cf-radius); overflow: hidden; border: 1px solid var(--cf-border); background: linear-gradient(135deg, color-mix(in srgb, var(--cf-accent) 30%, var(--cf-surface2)), var(--cf-surface2)); padding: 0; cursor: pointer; font: inherit; color: #fff; }
.rt-cg img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rt-cg span { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 8px; font-size: .78em; text-align: left; background: linear-gradient(transparent, rgba(0,0,0,.7)); }
.rt-cg.locked { cursor: default; display: grid; place-items: center; background: var(--cf-surface2); color: var(--cf-muted); }
.rt-cg.locked b { font-size: 2em; opacity: .5; }
.rt-cg.locked span { background: none; color: var(--cf-muted); text-align: center; }
.rt-view { margin: 0 0 10px; }
.rt-view img { width: 100%; border-radius: var(--cf-radius); display: block; }
.rt-view figcaption { margin-top: 6px; }
.rt-ends { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.rt-end { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--cf-border); }
.rt-end:first-of-type { border-top: 0; }
.rt-end .cf-small { grid-column: 2; }
.rt-kind { font-size: .7em; text-transform: uppercase; letter-spacing: .08em; padding: 2px 6px; border-radius: 6px; background: var(--cf-surface2); color: var(--cf-muted); }
.rt-end.on.good .rt-kind { background: var(--cf-good); color: #fff; }
.rt-end.on.bad .rt-kind { background: var(--cf-bad); color: #fff; }
.rt-end.on.secret .rt-kind { background: var(--cf-accent2); color: #fff; }
.rt-end.on.normal .rt-kind { background: var(--cf-accent); color: #fff; }
.rt-end:not(.on) b { color: var(--cf-muted); letter-spacing: .1em; }
@media (prefers-reduced-motion: reduce) { .rt-burst { display: none; } .rt-card { transition: none; } }
`;

/** `shared` is a money value another part keeps; `taken` the values other parts keep (by valueKey). */
export function routesModule(raw?: Record<string, unknown>, enabled = true, shared = "", taken: Set<string> = new Set()): EngineModule {
  const settings = routesSettings(raw);
  const live = usable(settings, shared);
  return {
    id: "routes",
    name: "Routes",
    version: "1.0.0",
    description: "Love interests with heart meters, stages and route status; dates, gifts and discovered tastes; a gallery and endings kept across chats.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "dating", "relationships", "vn"],
    requires: [],
    core: "routes",
    enabled,
    vars: routesVars(live, taken),
    rules: routesRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
