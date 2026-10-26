/**
 * Shared part: the hub menu. One button above the input box opens a home screen of tiles, one per
 * hub screen of the card (and the status panel), so a card with many screens doesn't crowd the
 * input box with buttons. With "only the menu" on, the other hub buttons go away.
 */
import type { EngineModule } from "./types";

export interface MenuSettings {
  title: string;
  button: string;
  /** Hide the other hub buttons: everything opens from the menu. */
  only: boolean;
  /** A tile for the status panel. */
  status: boolean;
}

export const defaultMenuSettings = (): MenuSettings => ({ title: "Menu", button: "☰ Menu", only: true, status: true });

export function menuSettings(raw: Record<string, unknown> | undefined): MenuSettings {
  const base = defaultMenuSettings();
  if (!raw) return base;
  return {
    title: typeof raw.title === "string" ? raw.title : base.title,
    button: typeof raw.button === "string" && raw.button.trim() ? raw.button : base.button,
    only: raw.only !== false,
    status: raw.status !== false,
  };
}

const JS = String.raw`
var esc = CF.ui.esc;
// A button label's leading emoji or symbol becomes the tile's icon.
function split(label, name) {
  var m = /^([^\w\s"'(]{1,3})\s+(.+)$/.exec(String(label || "").trim());
  return m ? { icon: m[1], text: m[2] } : { icon: "", text: String(label || name || "").trim() || name };
}
function tile(id, label, name) {
  var t = split(label, name);
  return '<button type="button" class="mn-tile" data-open="' + esc(id) + '"><span class="mn-icon" aria-hidden="true">' +
    (t.icon ? esc(t.icon) : esc(t.text.charAt(0).toUpperCase())) + '</span><span class="mn-label">' + esc(t.text) + "</span></button>";
}
function render() {
  var tiles = [];
  if (settings.status && CF.hasPanel()) tiles.push(tile("status", "📊 Status", "Status"));
  CF.modules().forEach(function (m) {
    if (m.slot !== "overlay" || m.id === "menu") return;
    tiles.push(tile(m.id, m.button, m.name));
  });
  root.innerHTML = '<div class="cf-app">' + CF.ui.appBar(settings.title || "Menu") + '<div class="cf-appbody">' +
    (tiles.length ? '<div class="mn-grid">' + tiles.join("") + "</div>" : '<p class="cf-muted">No screens to open yet.</p>') + "</div></div>";
}
root.addEventListener("click", function (e) {
  var b = e.target.closest("[data-open]");
  if (b) app.open(b.getAttribute("data-open"));
});
render();
`;

const CSS = String.raw`
.mn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 12px; padding-top: 4px; }
.mn-tile { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 6px; min-height: 96px; border-radius: calc(var(--cf-radius) + 4px);
  border: 1px solid var(--cf-border); background: var(--cf-surface2); color: var(--cf-text); font: inherit; cursor: pointer; transition: transform .15s, border-color .15s; }
.mn-tile:hover, .mn-tile:focus-visible { border-color: var(--cf-accent); transform: translateY(-2px); }
.mn-icon { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 1.5em;
  background: color-mix(in srgb, var(--cf-accent) 22%, var(--cf-surface)); color: var(--cf-accent); }
.mn-label { font-size: .85em; text-align: center; overflow-wrap: anywhere; }
`;

export function menuModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const s = menuSettings(raw);
  return {
    id: "menu",
    name: "Menu",
    version: "1.0.0",
    description: "One hub button that opens a home screen of tiles for every other screen.",
    slot: "overlay",
    button: s.button,
    tags: ["built-in", "hub"],
    requires: [],
    core: "menu",
    enabled,
    vars: [],
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: s as unknown as Record<string, unknown>,
  };
}
