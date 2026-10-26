/**
 * Shared part: the title screen. An inline block at the top of the opening message: card art, the
 * title, a premise and "New game / Continue / Settings". New game starts the story (the character
 * creator below it shows up then, if the card has one), Continue jumps to where the chat is, and
 * Settings opens the player's settings app. After New game it folds into a slim header.
 *
 * Styles fit the kits: "classic" (art and a menu), "lock" (a phone lock screen that unlocks into the
 * menu), "gate" (petals, leaves or snow falling by the in-game season) and "cast" (a visual-novel
 * menu with the cast's portraits, and Gallery and Endings when the card has routes).
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export const TITLE_STYLES = {
  classic: "Art and a menu",
  lock: "Phone lock screen",
  gate: "Seasons falling (petals, leaves, snow)",
  cast: "Visual novel with the cast",
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
  return settings.art ? '<img class="ts-art" alt="" src="' + esc(app.asset(settings.art)) + '" onerror="this.remove()">' : "";
}
function time() { return CF.state.get("Time") || {}; }
// Falling petals, leaves or snow for the "gate" style, by season and weather.
function fall() {
  if (settings.style !== "gate") return "";
  var t = time();
  var kind = /snow/i.test(t.Weather || "") || t._Season === "Winter" ? "snow" : t._Season === "Autumn" ? "leaf" : t._Season === "Summer" ? "mote" : "petal";
  var out = "";
  for (var i = 0; i < 16; i++) {
    out += '<i style="left:' + ((i * 37) % 100) + "%;animation-delay:-" + ((i * 1.7) % 9).toFixed(1) + "s;animation-duration:" + (7 + (i % 5)) + "s;--s:" + (0.6 + (i % 4) * 0.2) + '"></i>';
  }
  return '<div class="ts-fall ts-' + kind + '" aria-hidden="true">' + out + "</div>";
}
function cast() {
  if (settings.style !== "cast" || !settings.cast.length) return "";
  return '<div class="ts-cast">' + settings.cast.slice(0, 6).map(function (c, i) {
    return '<figure style="--i:' + i + '">' + CF.ui.avatar(c.avatar ? app.asset(c.avatar) : null, c.name) + "<figcaption>" + esc(c.name) + "</figcaption></figure>";
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
  root.innerHTML = '<div class="ts ts-' + esc(settings.style) + '">' + art() + '<div class="ts-shade"></div>' + fall() + '<div class="ts-body">' +
    cast() +
    (settings.tagline ? '<span class="ts-tag">' + esc(settings.tagline) + "</span>" : "") +
    "<h1>" + esc(title) + "</h1>" +
    (settings.premise ? '<p class="ts-premise">' + esc(settings.premise) + "</p>" : "") +
    '<div class="ts-menu">' +
    '<button type="button" class="cf-btn primary" data-new' + (busy ? " disabled" : "") + ">" + esc(settings.newGame) + "</button>" +
    (more ? '<button type="button" class="cf-btn" data-continue>Continue</button>' : "") +
    (routes ? '<div class="ts-pair"><button type="button" class="cf-btn" data-routes="gallery">Gallery</button><button type="button" class="cf-btn" data-routes="endings">Endings</button></div>' : "") +
    (has("settings") ? '<button type="button" class="cf-btn ghost" data-settings>Settings</button>' : "") +
    "</div></div></div>";
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
@media (prefers-reduced-motion: reduce) { .ts-body, .ts-cast figure, .ts-swipe { animation: none; } .ts-fall { display: none; } }
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
