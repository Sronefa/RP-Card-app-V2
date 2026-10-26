/**
 * The status panel shown under each reply.
 *
 * A full HTML document that SillyTavern's regex puts in a code block, which Tavern Helper renders
 * in an iframe. It reads its message's state through the MVU-compatible `Mvu` object the engine
 * core shares, so it shows the values as they were at that reply, with what changed.
 *
 * The document goes into a regex replacement, so it never uses "$" before a digit or "<", nor "{{":
 * SillyTavern would read those as capture groups and macros. Nor HTML entities: Tavern Helper reads
 * the code block's text, which decodes them.
 */
import type { EngineConfig } from "./sheet";
import { themeOf, varPath } from "./sheet";
import { themeTokens } from "./theme";

/** JSON that is safe inside a regex replacement. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/\$/g, "\\u0024").replace(/\{\{/g, "{\\u007b");

export function panelFields(config: EngineConfig) {
  const vars = config.vars.filter((v) => v.name.trim());
  // Values of a group stay together, in the order the groups first appear.
  const order = [...new Set(vars.map((v) => v.group.trim()))];
  return [...vars]
    .sort((a, b) => order.indexOf(a.group.trim()) - order.indexOf(b.group.trim()))
    .map((v) => ({
      path: varPath(v),
      group: v.group.trim(),
      label: v.name.trim(),
      type: v.type,
      min: v.min ?? null,
      max: v.max ?? null,
      pinned: v.pinned !== false,
    }));
}

const SCRIPT = `
(function () {
  var root = document.getElementById("cf-stats");
  // Text only, never attributes. No entity literals here: Tavern Helper reads this script back
  // from a code block, which turns them into the characters they stand for.
  function esc(s) {
    var div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }
  function get(o, path) {
    for (var i = 0; i < path.length; i++) {
      if (o == null) return undefined;
      o = o[path[i]];
    }
    return o;
  }
  function text(field, v) {
    if (v === undefined || v === null || v === "") return "–";
    if (field.type === "toggle") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "–";
    if (typeof v === "object") {
      var keys = Object.keys(v);
      return keys.length ? keys.map(function (k) { return k + " ×" + v[k]; }).join(", ") : "–";
    }
    return String(v);
  }
  function change(field, delta) {
    var key = field.path.join(".");
    var d = delta && delta[key];
    if (!d) return "";
    if (typeof d[0] === "number" && typeof d[1] === "number") {
      var n = Math.round((d[1] - d[0]) * 100) / 100;
      return n ? '<span class="cf-d ' + (n > 0 ? "up" : "down") + '">' + (n > 0 ? "+" : "") + n + "</span>" : "";
    }
    return '<span class="cf-d">' + (d[0] === undefined || d[0] === null ? "new" : "changed") + "</span>";
  }
  function row(field, stat, delta) {
    var v = get(stat, field.path);
    var head = '<div class="cf-row"><span class="cf-l">' + esc(field.label) + "</span>" + change(field, delta) + '<span class="cf-v">' + esc(text(field, v)) + (field.type === "number" && field.max !== null ? " / " + field.max : "") + "</span></div>";
    if (field.type === "number" && field.max !== null) {
      var lo = field.min === null ? 0 : field.min;
      var pct = Math.max(0, Math.min(100, ((Number(v) - lo) / (field.max - lo || 1)) * 100));
      head += '<div class="cf-bar"><i style="width:' + pct + '%"></i></div>';
    }
    return '<div class="cf-f">' + head + "</div>";
  }
  var open = false;
  var CF = null;
  var app = null;
  function data() {
    if (app) return { stat_data: app.state(), delta_data: app.delta() };
    try {
      return Mvu.getMvuData({ type: "message", message_id: getCurrentMessageId() }) || {};
    } catch (e) {
      return {};
    }
  }
  function draw() {
    var d = data();
    var stat = d.stat_data;
    if (!stat) {
      root.innerHTML = '<div class="cf-empty">No game state on this message yet.</div>';
      return;
    }
    var shown = open ? FIELDS : FIELDS.filter(function (f) { return f.pinned; });
    var more = FIELDS.length > shown.length || open;
    root.innerHTML =
      '<div class="cf-head"><b>' + esc(TITLE) + "</b>" +
      (more ? '<button type="button" id="cf-more">' + (open ? "Less" : "All " + FIELDS.length) + "</button>" : "") +
      "</div>" +
      shown
        .map(function (f, i) {
          var group = f.group && (i === 0 || shown[i - 1].group !== f.group) ? '<div class="cf-g">' + esc(f.group) + "</div>" : "";
          return group + row(f, stat, d.delta_data);
        })
        .join("");
    var button = document.getElementById("cf-more");
    if (button) button.onclick = function () { open = !open; draw(); };
  }
  function core() {
    try {
      return window.CardForge || window.parent.CardForge || null;
    } catch (e) {
      return null;
    }
  }
  // With the engine core: the card theme, module sections (like the clock) and live updates.
  function start(found) {
    CF = found;
    app = CF.frame(window);
    open = !app.settings().compact;
    CF.mountSlot(window, "panel", document.getElementById("cf-slots"), { app: app });
    draw();
    app.onState(draw);
    app.on("settings", function (s) { open = !s.compact; draw(); });
  }
  var tries = 0;
  (function wait() {
    var found = core();
    if (found) return start(found);
    if (typeof Mvu !== "undefined" || tries > 50) {
      try {
        var color = getComputedStyle(window.parent.document.body).color;
        if (color) document.body.style.color = color;
      } catch (e) {}
      return draw();
    }
    tries++;
    setTimeout(wait, 100);
  })();
})();
`;

const STYLE = `
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: transparent; }
body.cf { font-family: var(--cf-font); font-size: calc(14px * var(--cf-scale, 1)); color: var(--cf-text); }
#cf-panel { border: 1px solid var(--cf-border, color-mix(in srgb, var(--cf-accent) 45%, transparent)); background-color: var(--cf-surface, color-mix(in srgb, var(--cf-accent) 9%, transparent)); background-image: var(--cf-texture, none); border-radius: var(--cf-radius, 12px); box-shadow: var(--cf-shadow, none); padding: 8px 12px; }
#cf-slots:empty { display: none; }
.cf-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.cf-head b { color: var(--cf-accent); font-weight: 600; font-family: var(--cf-heading, inherit); }
.cf-head button { font: inherit; font-size: 12px; color: inherit; background: none; border: 1px solid color-mix(in srgb, var(--cf-accent) 45%, transparent); border-radius: 999px; padding: 4px 10px; min-height: 28px; cursor: pointer; }
.cf-g { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin-top: 6px; }
.cf-f { padding: 3px 0; }
.cf-row { display: flex; align-items: baseline; gap: 6px; }
.cf-l { opacity: .75; }
.cf-v { margin-left: auto; text-align: right; }
.cf-d { font-size: 11px; border-radius: 999px; padding: 0 6px; background: color-mix(in srgb, var(--cf-accent) 25%, transparent); }
.cf-d.up { background: color-mix(in srgb, var(--cf-good, #22c55e) 28%, transparent); }
.cf-d.down { background: color-mix(in srgb, var(--cf-bad, #ef4444) 28%, transparent); }
.cf-bar { height: 6px; border-radius: 3px; background: rgba(127, 127, 127, .25); overflow: hidden; margin-top: 3px; }
.cf-bar i { display: block; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--cf-accent), var(--cf-accent2, var(--cf-accent))); transition: width .4s; }
.cf-empty { opacity: .7; font-size: 13px; }
`;

/** The panel document. */
export function panelHtml(config: EngineConfig): string {
  // Only the accent as a fallback: with the engine core, the card theme's variables take over.
  const accent = themeTokens(themeOf(config)).accent;
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>html { --cf-accent: ${accent}; }${STYLE.replace(/\s*\n\s*/g, " ")}</style>`,
    '</head><body><div id="cf-panel"><div id="cf-slots"></div><div id="cf-stats"></div></div>',
    `<script>var FIELDS = ${safeJson(panelFields(config))}; var TITLE = ${safeJson(config.panel.title || "Status")};${SCRIPT}</script>`,
    "</body></html>",
  ].join("\n");
}
