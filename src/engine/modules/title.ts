/**
 * Shared part: the title screen. An inline block at the top of the opening message: card art, the
 * title, a premise and "New game / Continue / Settings". New game starts the story (the character
 * creator below it shows up then, if the card has one), Continue jumps to where the chat is, and
 * Settings opens the player's settings app. After New game it folds into a slim header.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export interface TitleSettings {
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
}

export const defaultTitleSettings = (): TitleSettings => ({
  title: "",
  tagline: "",
  premise: "",
  art: "",
  music: "",
  newGame: "New game",
  opening: "",
});

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

export function titleSettings(raw: Record<string, unknown> | undefined): TitleSettings {
  const base = defaultTitleSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    tagline: str(raw.tagline, base.tagline),
    premise: str(raw.premise, base.premise),
    art: str(raw.art, base.art),
    music: str(raw.music, base.music),
    newGame: str(raw.newGame, base.newGame) || base.newGame,
    opening: str(raw.opening, base.opening),
  };
}

const JS = String.raw`
var esc = CF.ui.esc;
var busy = false;
// The latest state: Continue on a long chat writes there, not on the opening message.
function started() { return CF.state.get("Game.$Started") === true; }
function has(id) { return CF.modules().some(function (m) { return m.id === id; }); }
function art() {
  return settings.art ? '<img class="ts-art" alt="" src="' + esc(app.asset(settings.art)) + '" onerror="this.remove()">' : "";
}
function render() {
  var title = settings.title || "A new story";
  if (started()) {
    root.innerHTML = '<div class="ts ts-slim">' + art() + '<div class="ts-shade"></div><div class="ts-slimtext"><h2>' + esc(title) + "</h2>" +
      (settings.tagline ? '<span class="cf-small">' + esc(settings.tagline) + "</span>" : "") + "</div></div>";
    return;
  }
  var more = CF.state.latestId() > 0;
  root.innerHTML = '<div class="ts">' + art() + '<div class="ts-shade"></div><div class="ts-body">' +
    (settings.tagline ? '<span class="ts-tag">' + esc(settings.tagline) + "</span>" : "") +
    "<h1>" + esc(title) + "</h1>" +
    (settings.premise ? '<p class="ts-premise">' + esc(settings.premise) + "</p>" : "") +
    '<div class="ts-menu">' +
    '<button type="button" class="cf-btn primary" data-new' + (busy ? " disabled" : "") + ">" + esc(settings.newGame) + "</button>" +
    (more ? '<button type="button" class="cf-btn" data-continue>Continue</button>' : "") +
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
root.addEventListener("click", function (e) {
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
@media (prefers-reduced-motion: reduce) { .ts-body { animation: none; } }
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
