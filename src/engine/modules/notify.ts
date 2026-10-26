/**
 * Shared part: notifications. One banner system for every screen and kit, styled by the card
 * theme: a new text on the phone, an event starting, a quest update. Screens call
 * `CF.notify({ title, text, icon })` or emit "notify" on the bus; the part also watches lists in
 * the state (new texts, news, events) and announces what the latest reply added.
 */
import type { EngineModule } from "./types";

export interface NotifyWatch {
  /** A list in the state, like "Phone.Texts". */
  path: string;
  title: string;
  icon: string;
}

export interface NotifySettings {
  position: "top" | "bottom";
  seconds: number;
  /** Lists to announce new lines of. Ones the card doesn't have are skipped. */
  watch: NotifyWatch[];
}

export const defaultNotifySettings = (): NotifySettings => ({
  position: "top",
  seconds: 4,
  watch: [
    { path: "Phone.Texts", title: "Messages", icon: "chat" },
    { path: "Phone.News", title: "News", icon: "star" },
    { path: "Phone.Quests", title: "Notes", icon: "star" },
  ],
});

export function notifySettings(raw: Record<string, unknown> | undefined): NotifySettings {
  const base = defaultNotifySettings();
  if (!raw) return base;
  return {
    position: raw.position === "bottom" ? "bottom" : "top",
    seconds: Number.isFinite(Number(raw.seconds)) ? Math.max(2, Math.min(15, Number(raw.seconds))) : base.seconds,
    watch: Array.isArray(raw.watch)
      ? raw.watch
          .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
          .map((w) => ({ path: String(w.path ?? ""), title: String(w.title ?? ""), icon: String(w.icon ?? "star") }))
      : base.watch,
  };
}

// Runs in the card's script with CF, settings and hooks. Plain ES5 for any WebView.
const SCRIPT = String.raw`
var doc = window.parent.document;
var box = null;
var shown = {};
function stack() {
  if (box && box.isConnected) return box.shadowRoot.querySelector(".nt-stack");
  box = doc.createElement("div");
  box.id = "cf-notify";
  box.style.cssText = "position:fixed;left:0;right:0;" + (settings.position === "bottom" ? "bottom:72px;" : "top:8px;") + "z-index:10000;pointer-events:none;display:flex;justify-content:center;padding:0 10px;";
  var shadow = box.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" + CF.themeCss().replace(/:root/g, ":host") +
    ".nt-stack{display:flex;flex-direction:column;gap:8px;width:min(420px,100%);font-family:var(--cf-font);font-size:calc(14px*var(--cf-scale,1))}" +
    ".nt{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:calc(var(--cf-radius) + 6px);background:var(--cf-surface);color:var(--cf-text);border:1px solid var(--cf-border);box-shadow:0 8px 28px rgba(0,0,0,.35);cursor:pointer;animation:nt-in .35s ease both}" +
    ".nt.out{animation:nt-out .3s ease both}.nt-icon{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--cf-accent);color:#fff}" +
    ".nt-icon svg{width:16px;height:16px}.nt b{display:block;font-size:.8em;color:var(--cf-muted);text-transform:uppercase;letter-spacing:.06em}.nt span{display:block;overflow-wrap:anywhere;line-height:1.35}" +
    "@keyframes nt-in{from{opacity:0;transform:translateY(" + (settings.position === "bottom" ? "" : "-") + "12px)}to{opacity:1;transform:none}}@keyframes nt-out{to{opacity:0;transform:scale(.96)}}" +
    "@media (prefers-reduced-motion:reduce){.nt,.nt.out{animation:none}}</style>" +
    '<div class="nt-stack" role="status" aria-live="polite"></div>';
  doc.body.appendChild(box);
  return shadow.querySelector(".nt-stack");
}
function notify(n) {
  n = n || {};
  var text = String(n.text || "").trim();
  if (!text) return;
  var list = stack();
  var el = doc.createElement("div");
  el.className = "nt";
  el.innerHTML = '<span class="nt-icon">' + CF.ui.icon(n.icon || "star") + "</span><div>" + (n.title ? "<b>" + CF.ui.esc(n.title) + "</b>" : "") + "<span>" + CF.ui.esc(text) + "</span></div>";
  function drop() { el.classList.add("out"); setTimeout(function () { el.remove(); }, 300); }
  el.addEventListener("click", function () { drop(); if (n.open) try { CF.open(n.open); } catch (e) {} });
  if (settings.position === "bottom") list.appendChild(el); else list.insertBefore(el, list.firstChild);
  while (list.children.length > 3) list.lastChild.remove();
  setTimeout(drop, settings.seconds * 1000);
}
function read(stat, path) {
  var out = stat;
  String(path).split(".").forEach(function (k) { out = out && typeof out === "object" ? out[k] : undefined; });
  return out;
}
CF.notify = notify;
CF.bus.on("notify", notify);
hooks.afterUpdate(function (stat, before, info) {
  if (!before || !info || !info.latest) return stat;
  var queue = [];
  settings.watch.forEach(function (w) {
    var now = read(stat, w.path), was = read(before, w.path);
    if (!Array.isArray(now)) return;
    was = Array.isArray(was) ? was : [];
    now.filter(function (line) { return was.indexOf(line) < 0; }).forEach(function (line) {
      var key = w.path + "|" + line;
      if (shown[key]) return;
      shown[key] = true;
      queue.push({ title: w.title, text: String(line), icon: w.icon, open: w.path.indexOf("Phone.") === 0 ? "phone" : "" });
    });
  });
  queue.slice(-3).forEach(function (n, i) { setTimeout(function () { notify(n); }, 500 + i * 350); });
  return stat;
});
`;

export function notifyModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  return {
    id: "notify",
    name: "Notifications",
    version: "1.0.0",
    description: "Banners over the chat for new texts, news, events and anything a screen announces, in the card's theme.",
    slot: "script",
    tags: ["built-in", "notifications"],
    requires: [],
    core: "notify",
    enabled,
    vars: [],
    rules: [],
    regex: [],
    html: "",
    css: "",
    js: "",
    script: SCRIPT,
    settings: notifySettings(raw) as unknown as Record<string, unknown>,
  };
}
