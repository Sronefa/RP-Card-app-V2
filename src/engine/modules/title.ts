/**
 * Shared part: the title screen. An inline block at the top of the opening message: card art, the
 * title, a premise and "New game / Continue / Settings". New game starts the story (the character
 * creator below it shows up then, if the card has one), Continue jumps to where the chat is, and
 * Settings opens the player's settings app. After New game it folds into a slim header.
 *
 * Styles fit the kits: "classic" (art and a menu), "lock" (a phone lock screen that unlocks into the
 * menu), "gate" (petals, leaves or snow falling by the in-game season) and "cast" (a visual-novel
 * menu with the cast's portraits, and Gallery and Endings when the card has routes), "embers" (sparks
 * rising over dark art), "system" (a game's status window that boots up, for isekai), "glitch" (a
 * title that tears in neon, for cyberpunk), "stars" (stars streaking past at warp, for space) and
 * "static" (a VHS tape playing, noise and a timestamp, for horror).
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export const TITLE_STYLES = {
  classic: "Art and a menu",
  lock: "Phone lock screen",
  gate: "Seasons falling (petals, leaves, snow)",
  cast: "Visual novel with the cast",
  embers: "Embers rising (dark fantasy)",
  system: "A system window booting up (isekai)",
  glitch: "Neon glitch (cyberpunk)",
  stars: "Stars streaking past (space)",
  static: "VHS static (horror)",
} as const;
export type TitleStyle = keyof typeof TITLE_STYLES;

export interface CastMember {
  name: string;
  /** A card image file; empty for the first letter. */
  avatar: string;
}

export interface TitleSettings {
  style: TitleStyle;
  title: string;
  tagline: string;
  premise: string;
  /** A card image for the background; empty for the theme's gradient. */
  art: string;
  /** A card audio file that plays from New game, at the player's music volume. */
  music: string;
  newGame: string;
  /** Sent when New game is pressed and nothing else starts the story; empty sends nothing. */
  opening: string;
  /** Portraits on the "cast" style. */
  cast: CastMember[];
}

export const defaultTitleSettings = (): TitleSettings => ({
  style: "classic",
  title: "",
  tagline: "",
  premise: "",
  art: "",
  music: "",
  newGame: "New game",
  opening: "",
  cast: [],
});

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

export function titleSettings(raw: Record<string, unknown> | undefined): TitleSettings {
  const base = defaultTitleSettings();
  if (!raw) return base;
  return {
    style: typeof raw.style === "string" && raw.style in TITLE_STYLES ? (raw.style as TitleStyle) : base.style,
    title: str(raw.title, base.title),
    tagline: str(raw.tagline, base.tagline),
    premise: str(raw.premise, base.premise),
    art: str(raw.art, base.art),
    music: str(raw.music, base.music),
    newGame: str(raw.newGame, base.newGame) || base.newGame,
    opening: str(raw.opening, base.opening),
    cast: Array.isArray(raw.cast)
      ? raw.cast
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => ({ name: str(c.name, ""), avatar: str(c.avatar, "") }))
      : base.cast,
  };
}

const JS = String.raw`
var esc = CF.ui.esc;
var busy = false;
// The lock screen style: locked until the player taps.
var locked = settings.style === "lock";
// The latest state: Continue on a long chat writes there, not on the opening message.
function started() { return CF.state.get("Game.$Started") === true; }
function has(id) { return CF.modules().some(function (m) { return m.id === id; }); }
function art() {
  var src = settings.art ? app.asset(settings.art) : CF.assets.scene("title");
  return src ? '<img class="ts-art" alt="" src="' + esc(src) + '" onerror="this.remove()">' : "";
}
function time() { return CF.state.get("Time") || {}; }
// Falling petals, leaves or snow for the "gate" style, by season and weather.
function fall() {
  if (settings.style !== "gate" && settings.style !== "embers") return "";
  var t = time();
  var kind = settings.style === "embers" ? "ember" : /snow/i.test(t.Weather || "") || t._Season === "Winter" ? "snow" : t._Season === "Autumn" ? "leaf" : t._Season === "Summer" ? "mote" : "petal";
  var out = "";
  for (var i = 0; i < 16; i++) {
    out += '<i style="left:' + ((i * 37) % 100) + "%;animation-delay:-" + ((i * 1.7) % 9).toFixed(1) + "s;animation-duration:" + (7 + (i % 5)) + "s;--s:" + (0.6 + (i % 4) * 0.2) + '"></i>';
  }
  return '<div class="ts-fall ts-' + kind + '" aria-hidden="true">' + out + "</div>";
}
// Effects over the art: streaking stars, a scan bar, or tape noise with the in-game time.
function fx() {
  var out = "";
  if (settings.style === "stars") {
    for (var i = 0; i < 28; i++) out += '<i style="--a:' + ((i * 137) % 360) + "deg;animation-delay:-" + ((i * 0.37) % 2.4).toFixed(2) + "s;--l:" + (40 + (i * 23) % 60) + 'px"></i>';
    return '<div class="ts-warp" aria-hidden="true">' + out + "</div>";
  }
  if (settings.style === "glitch") return '<div class="ts-scan" aria-hidden="true"></div>';
  if (settings.style === "static") {
    var t = time();
    return '<div class="ts-noise" aria-hidden="true"></div><div class="ts-roll" aria-hidden="true"></div><div class="ts-vhs" aria-hidden="true"><span>▶ PLAY</span><span>' + esc((t.Clock || "00:00") + (t.Day ? " · DAY " + t.Day : "")) + "</span></div>";
  }
  return "";
}
function cast() {
  if (settings.style !== "cast" || !settings.cast.length) return "";
  return '<div class="ts-cast">' + settings.cast.slice(0, 6).map(function (c, i) {
    return '<figure style="--i:' + i + '">' + CF.ui.avatar(c.avatar ? app.asset(c.avatar) : CF.assets.portrait(c.name), c.name) + "<figcaption>" + esc(c.name) + "</figcaption></figure>";
  }).join("") + "</div>";
}
function lockScreen() {
  var t = time();
  return '<div class="ts ts-lock" data-unlock role="button" tabindex="0" aria-label="Unlock">' + art() + '<div class="ts-shade"></div><div class="ts-lockbody">' +
    '<span class="ts-lockicon">' + CF.ui.icon("lock") + "</span>" +
    '<b class="ts-clock">' + esc(t.Clock || "--:--") + "</b>" +
    "<span>" + esc([t._Weekday, t.Day ? "Day " + t.Day : "", t.Weather].filter(Boolean).join(" · ")) + "</span>" +
    '<div class="ts-note"><span class="cf-small">' + esc(settings.title || "New message") + "</span>" + (settings.tagline ? "<b>" + esc(settings.tagline) + "</b>" : "") + "</div>" +
    '<span class="ts-swipe">Tap to unlock</span></div></div>';
}
function render() {
  var title = settings.title || "A new story";
  if (started()) {
    root.innerHTML = '<div class="ts ts-slim">' + art() + '<div class="ts-shade"></div><div class="ts-slimtext"><h2>' + esc(title) + "</h2>" +
      (settings.tagline ? '<span class="cf-small">' + esc(settings.tagline) + "</span>" : "") + "</div></div>";
    return;
  }
  if (locked) {
    root.innerHTML = lockScreen();
    return;
  }
  var more = CF.state.latestId() > 0;
  var routes = settings.style === "cast" && has("routes");
  var sys = settings.style === "system";
  root.innerHTML = '<div class="ts ts-' + esc(settings.style) + '">' + art() + '<div class="ts-shade"></div>' + fall() + fx() + '<div class="ts-body">' +
    (sys ? '<div class="ts-win"><span class="ts-winhead">' + CF.ui.icon("spark") + " System</span>" +
      '<p class="ts-boot"><span>Soul signature detected.</span><span>Building a new world…</span><span>Welcome, Player.</span></p>' : "") +
    cast() +
    (settings.tagline ? '<span class="ts-tag">' + esc(settings.tagline) + "</span>" : "") +
    '<h1 data-text="' + esc(title) + '">' + esc(title) + "</h1>" +
    (settings.premise ? '<p class="ts-premise">' + esc(settings.premise) + "</p>" : "") +
    '<div class="ts-menu">' +
    '<button type="button" class="cf-btn primary" data-new' + (busy ? " disabled" : "") + ">" + esc(settings.newGame) + "</button>" +
    (more ? '<button type="button" class="cf-btn" data-continue>Continue</button>' : "") +
    (routes ? '<div class="ts-pair"><button type="button" class="cf-btn" data-routes="gallery">Gallery</button><button type="button" class="cf-btn" data-routes="endings">Endings</button></div>' : "") +
    (has("settings") ? '<button type="button" class="cf-btn ghost" data-settings>Settings</button>' : "") +
    "</div>" + (sys ? "</div>" : "") + "</div></div>";
}
function music() {
  if (!settings.music) return;
  try {
    var level = Number(app.settings().music);
    if (!(level > 0)) return;
    var host = window.parent;
    if (host.cfTitleMusic) host.cfTitleMusic.pause();
    var audio = new host.Audio(app.asset(settings.music));
    audio.loop = true;
    audio.volume = Math.max(0, Math.min(1, level / 100));
    host.cfTitleMusic = audio;
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}
function toChat() {
  try {
    var chat = window.parent.document.getElementById("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  } catch (e) {}
}
// A tap right as the chat opens can come before the engine has written the first state.
function whenReady() {
  return new Promise(function (resolve) {
    var n = 0;
    (function go() {
      if (CF.state.latestId() >= 0 || n++ > 50) resolve();
      else setTimeout(go, 100);
    })();
  });
}
root.addEventListener("keydown", function (e) {
  if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-unlock]")) { e.preventDefault(); locked = false; render(); }
});
root.addEventListener("click", function (e) {
  if (e.target.closest("[data-unlock]")) { locked = false; return render(); }
  var r = e.target.closest("[data-routes]");
  if (r) return app.open("routes", { tab: r.getAttribute("data-routes") });
  if (e.target.closest("[data-settings]")) return app.open("settings");
  var cont = e.target.closest("[data-continue]");
  if (!cont && !e.target.closest("[data-new]")) return;
  if (busy) return;
  busy = true;
  render();
  if (!cont) music();
  whenReady()
    .then(function () { return app.setMany([[["Game", "$Started"], true]], "pressed " + (cont ? "Continue" : "New game")); })
    .then(function () {
      app.emit("title:start", { continued: !!cont });
      if (cont) return toChat();
      // The creator, when there is one, starts the story; otherwise the opening line does.
      if (settings.opening && !has("creator")) return app.write(settings.opening, { now: true });
    })
    .catch(function (err) { app.toast("Couldn't start: " + err.message); })
    .then(function () { busy = false; render(); });
});
render();
app.onState(render);
`;

const CSS = String.raw`
.ts { position: relative; overflow: hidden; border-radius: var(--cf-radius); min-height: 340px; display: flex; align-items: flex-end;
  background: radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--cf-accent) 45%, var(--cf-bg)), var(--cf-bg) 70%); color: #fff; }
.ts-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ts-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 20%, rgba(0,0,0,.78) 100%); }
.ts-body { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 24px 18px 20px; width: 100%; animation: ts-in .6s ease both; }
.ts-tag { text-transform: uppercase; letter-spacing: .14em; font-size: .72em; opacity: .85; }
.ts h1 { font-family: var(--cf-heading); font-size: clamp(1.8em, 8vw, 2.6em); line-height: 1.05; text-shadow: 0 2px 18px rgba(0,0,0,.5); overflow-wrap: anywhere; }
.ts-premise { line-height: 1.5; opacity: .92; max-width: 34em; }
.ts-menu { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; max-width: 320px; }
.ts-menu .cf-btn { justify-content: center; min-height: 44px; }
.ts-menu .cf-btn:not(.primary) { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.25); color: #fff; }
.ts-slim { min-height: 0; height: 72px; align-items: center; }
.ts-slimtext { position: relative; padding: 0 16px; display: flex; flex-direction: column; }
.ts-slimtext h2 { font-family: var(--cf-heading); font-size: 1.2em; }
.ts-slim .ts-shade { background: rgba(0,0,0,.5); }
@keyframes ts-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.ts-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ts-pair .cf-btn { justify-content: center; min-height: 44px; }
/* Phone lock screen */
.ts-lock { cursor: pointer; align-items: stretch; min-height: 380px; }
.ts-lock .ts-shade { background: linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.55)); }
.ts-lockbody { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 26px 16px 18px; text-shadow: 0 2px 8px rgba(0,0,0,.35); }
.ts-lockicon svg { width: 18px; height: 18px; opacity: .85; }
.ts-clock { font-size: 4.2em; font-weight: 300; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.ts-note { margin-top: auto; width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 16px; background: rgba(255,255,255,.18); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); text-align: left; }
.ts-swipe { margin-top: 14px; padding: 8px 20px; border-radius: 999px; background: rgba(255,255,255,.16); animation: ts-pulse 2.4s ease-in-out infinite; }
@keyframes ts-pulse { 0%, 100% { opacity: .7; } 50% { opacity: 1; } }
/* Seasons falling */
.ts-fall { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.ts-fall i { position: absolute; top: -20px; width: calc(10px * var(--s)); height: calc(8px * var(--s)); animation: ts-fall linear infinite; opacity: .85; }
.ts-petal i { background: #ffc7d9; border-radius: 80% 0 80% 0; }
.ts-leaf i { background: #d9822b; border-radius: 0 80% 0 80%; }
.ts-snow i { background: #fff; border-radius: 50%; width: calc(6px * var(--s)); height: calc(6px * var(--s)); }
.ts-mote i { background: rgba(255,240,170,.8); border-radius: 50%; width: calc(4px * var(--s)); height: calc(4px * var(--s)); }
@keyframes ts-fall { 0% { transform: translate(0, 0) rotate(0); } 50% { transform: translate(24px, 210px) rotate(160deg); } 100% { transform: translate(-12px, 440px) rotate(320deg); } }
/* Visual novel cast */
.ts-cast { display: flex; justify-content: center; gap: 4px; margin-bottom: 4px; }
.ts-cast figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; animation: ts-in .6s ease both; animation-delay: calc(var(--i) * 90ms); }
.ts-cast .cf-avatar { width: 58px; height: 58px; font-size: 1.4em; box-shadow: 0 0 0 2px rgba(255,255,255,.75), 0 6px 18px rgba(0,0,0,.35); }
.ts-cast figcaption { font-size: .75em; max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-cast + .ts-tag, .ts-cast ~ h1 { text-align: center; }
.ts-cast ~ .ts-premise { text-align: center; margin: 0 auto; }
.ts-cast ~ .ts-menu { align-self: center; width: 100%; }
/* Embers rising */
.ts-embers { background: radial-gradient(120% 80% at 50% 110%, color-mix(in srgb, var(--cf-accent) 55%, #000), #050403 70%); }
.ts-ember i { top: auto; bottom: -10px; width: calc(4px * var(--s)); height: calc(4px * var(--s)); border-radius: 50%; background: #ffb347; box-shadow: 0 0 6px 2px rgba(255,120,40,.7); animation-name: ts-rise; }
@keyframes ts-rise { 0% { transform: translate(0, 0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translate(30px, -420px); opacity: 0; } }
.ts-embers h1 { letter-spacing: .04em; text-shadow: 0 0 22px rgba(255,90,40,.45), 0 2px 18px rgba(0,0,0,.7); }
/* System window */
.ts-system { align-items: center; background: radial-gradient(100% 80% at 50% 0%, color-mix(in srgb, var(--cf-accent) 30%, #050a18), #03060f 75%); }
.ts-system .ts-shade { background: rgba(3,8,20,.55); }
.ts-win { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid color-mix(in srgb, var(--cf-accent) 70%, transparent); border-radius: 6px; background: rgba(8,24,56,.72); box-shadow: 0 0 24px color-mix(in srgb, var(--cf-accent) 35%, transparent), inset 0 0 18px rgba(63,184,255,.12); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: ts-open .5s ease both; }
.ts-winhead { display: flex; align-items: center; gap: 6px; justify-content: center; text-transform: uppercase; letter-spacing: .3em; font-size: .72em; color: var(--cf-accent); border-bottom: 1px solid color-mix(in srgb, var(--cf-accent) 40%, transparent); padding-bottom: 8px; }
.ts-winhead svg { width: 14px; height: 14px; }
.ts-boot { display: flex; flex-direction: column; gap: 2px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .8em; color: #bfe6ff; }
.ts-boot span { opacity: 0; animation: ts-in .4s ease forwards; }
.ts-boot span:nth-child(1) { animation-delay: .3s; } .ts-boot span:nth-child(2) { animation-delay: .9s; } .ts-boot span:nth-child(3) { animation-delay: 1.5s; color: #fff; }
.ts-system h1 { text-align: center; color: #fff; text-shadow: 0 0 16px color-mix(in srgb, var(--cf-accent) 70%, transparent); }
.ts-system .ts-premise, .ts-system .ts-tag { text-align: center; }
.ts-system .ts-menu { align-self: center; width: 100%; }
@keyframes ts-open { from { opacity: 0; transform: scaleY(.2); } to { opacity: 1; transform: none; } }
/* Neon glitch */
.ts-glitch { background: linear-gradient(160deg, color-mix(in srgb, var(--cf-accent) 35%, #05050c), #05050c 55%, color-mix(in srgb, var(--cf-accent2) 25%, #05050c)); }
.ts-glitch .ts-shade { background: linear-gradient(180deg, rgba(5,5,12,.2), rgba(5,5,12,.85)), repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 1px, transparent 1px 3px); }
.ts-glitch h1 { position: relative; text-transform: uppercase; letter-spacing: .06em; color: #fff; text-shadow: 0 0 12px color-mix(in srgb, var(--cf-accent) 80%, transparent); }
.ts-glitch h1::before, .ts-glitch h1::after { content: attr(data-text); position: absolute; inset: 0; pointer-events: none; }
.ts-glitch h1::before { color: var(--cf-accent2); transform: translate(-2px, 0); clip-path: inset(0 0 60% 0); animation: ts-tear 2.8s steps(1) infinite; opacity: .85; }
.ts-glitch h1::after { color: var(--cf-accent); transform: translate(2px, 0); clip-path: inset(55% 0 0 0); animation: ts-tear 2.2s steps(1) infinite reverse; opacity: .85; }
@keyframes ts-tear { 0%, 88%, 100% { clip-path: inset(0 0 100% 0); } 90% { clip-path: inset(10% 0 55% 0); transform: translate(-4px, 0); } 93% { clip-path: inset(60% 0 8% 0); transform: translate(4px, 0); } 96% { clip-path: inset(35% 0 40% 0); transform: translate(-2px, 0); } }
.ts-scan { position: absolute; left: 0; right: 0; height: 60px; top: -60px; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--cf-accent2) 18%, transparent), transparent); animation: ts-scan 4s linear infinite; pointer-events: none; }
@keyframes ts-scan { to { top: 100%; } }
.ts-glitch .ts-tag { color: var(--cf-accent2); font-family: var(--cf-heading); }
/* Stars at warp */
.ts-warp { position: absolute; left: 50%; top: 38%; width: 0; height: 0; pointer-events: none; }
.ts-warp i { position: absolute; left: 0; top: 0; width: var(--l); height: 2px; border-radius: 2px; transform-origin: 0 50%; background: linear-gradient(90deg, transparent, #fff); animation: ts-warp 2.4s linear infinite; opacity: 0; }
@keyframes ts-warp { 0% { transform: rotate(var(--a)) translateX(0) scaleX(.1); opacity: 0; } 20% { opacity: .9; } 100% { transform: rotate(var(--a)) translateX(320px) scaleX(1); opacity: 0; } }
.ts.ts-stars { background: radial-gradient(60% 50% at 50% 38%, color-mix(in srgb, var(--cf-accent2) 30%, #02040a), #02040a 75%); }
.ts.ts-stars h1 { letter-spacing: .12em; text-transform: uppercase; font-family: var(--cf-heading); }
/* VHS static */
.ts-static { background: #0a0a0a; }
.ts-static .ts-art { filter: grayscale(.6) contrast(1.2) brightness(.8); }
.ts-noise { position: absolute; inset: -50%; pointer-events: none; opacity: .22; mix-blend-mode: screen;
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.4 -.35'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>");
  animation: ts-noise .25s steps(3) infinite; }
@keyframes ts-noise { 33% { transform: translate(-3%, 2%); } 66% { transform: translate(2%, -3%); } }
.ts-roll { position: absolute; left: 0; right: 0; height: 18%; top: -20%; background: linear-gradient(180deg, transparent, rgba(255,255,255,.07), transparent); animation: ts-roll 5s linear infinite; pointer-events: none; }
@keyframes ts-roll { to { top: 110%; } }
.ts-vhs { position: absolute; top: 12px; left: 14px; right: 14px; display: flex; justify-content: space-between; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .85em; letter-spacing: .1em; color: #f2f2f2; text-shadow: 2px 0 rgba(255,0,0,.5), -2px 0 rgba(0,255,255,.4); }
.ts-vhs span:first-child { animation: ts-pulse 1.2s steps(1) infinite; }
.ts-static h1 { font-family: var(--cf-heading); letter-spacing: .08em; text-shadow: 2px 0 rgba(200,0,20,.6), -1px 0 rgba(0,200,200,.35), 0 2px 18px rgba(0,0,0,.8); animation: ts-jitter 4s steps(1) infinite; }
@keyframes ts-jitter { 0%, 92%, 100% { transform: none; } 93% { transform: translate(2px, -1px); } 95% { transform: translate(-3px, 1px) skewX(4deg); } 97% { transform: translate(1px, 0); } }
@media (prefers-reduced-motion: reduce) { .ts-body, .ts-cast figure, .ts-swipe, .ts-win { animation: none; } .ts-boot span { animation: none; opacity: 1; } .ts-fall, .ts-warp, .ts-scan, .ts-roll { display: none; } .ts-noise, .ts-static h1, .ts-glitch h1::before, .ts-glitch h1::after, .ts-vhs span { animation: none; } }
`;

export function titleModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  return {
    id: "title",
    name: "Title screen",
    version: "1.0.0",
    description: "The opening message starts on a title screen: card art, title, premise and New game / Continue / Settings.",
    slot: "message",
    tags: ["built-in", "title"],
    requires: [],
    core: "title",
    enabled,
    vars: [newVar({ id: "title-started", group: "Game", name: "Started", type: "toggle", start: "no", hidden: true, pinned: false, rule: "Whether the player has left the title screen." })],
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: titleSettings(raw) as unknown as Record<string, unknown>,
  };
}

/** The tag that shows the title screen in a message. */
export const TITLE_TAG = '<cf-module id="title"/>';
