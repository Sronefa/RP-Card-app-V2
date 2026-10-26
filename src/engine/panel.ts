/**
 * The status panel shown under each reply.
 *
 * A full HTML document that SillyTavern's regex puts in a code block, which Tavern Helper renders
 * in an iframe. It reads its message's state through the engine core (or, without it, the
 * MVU-compatible `Mvu` object), so it shows the values as they were at that reply, with what
 * changed: meters slide from the old value to the new one and changed values flash, with their
 * +/- change. On phones it starts compact (the pinned values); tapping opens the rest, in the
 * author's tabs. The newest panel can carry action buttons.
 *
 * The document goes into a regex replacement, so it never uses "$" before a digit or "<", nor "{{":
 * SillyTavern would read those as capture groups and macros. Nor HTML entities: Tavern Helper reads
 * the code block's text, which decodes them.
 */
import { enabledModules } from "./modules/compile";
import type { EngineConfig, EngineVar, PanelAction, PanelTab } from "./sheet";
import { themeOf, varPath } from "./sheet";
import { themeTokens } from "./theme";

/** JSON that is safe inside a regex replacement. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/\$/g, "\\u0024").replace(/\{\{/g, "{\\u007b");

/** The values the panel shows: the sheet's, and the character the player made in the creator. */
function panelVars(config: EngineConfig): EngineVar[] {
  const made = enabledModules(config)
    .filter((m) => m.core === "creator")
    .flatMap((m) => m.vars.filter((v) => !v.hidden));
  return [...config.vars, ...made].filter((v) => v.name.trim());
}

/** The groups the panel can put in tabs, in order ("" is the values without a group). */
export const panelGroups = (config: EngineConfig) => [...new Set(panelVars(config).map((v) => v.group.trim()))];

/** The tabs as the panel shows them: the author's, plus "Other" for groups none of them name. */
export function panelTabs(config: EngineConfig): PanelTab[] {
  const tabs = (config.panel.tabs ?? []).filter((t) => t.label.trim() && t.groups.length);
  if (!tabs.length) return [];
  const named = new Set(tabs.flatMap((t) => t.groups.map((g) => g.trim())));
  const rest = [...new Set(panelVars(config).map((v) => v.group.trim()))].filter((g) => !named.has(g));
  return rest.length ? [...tabs, { label: "Other", groups: rest }] : tabs;
}

export function panelFields(config: EngineConfig) {
  const vars = panelVars(config);
  const tabs = panelTabs(config);
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
      tab: Math.max(0, tabs.findIndex((t) => t.groups.some((g) => g.trim() === v.group.trim()))),
    }));
}

export const panelActions = (config: EngineConfig): PanelAction[] => (config.panel.actions ?? []).filter((a) => a.label.trim() && a.text.trim());

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
  function isMeter(f) {
    return f.type === "number" && f.max !== null;
  }
  function pct(f, v) {
    var lo = f.min === null ? 0 : f.min;
    return Math.max(0, Math.min(100, ((Number(v) - lo) / (f.max - lo || 1)) * 100));
  }
  function changeOf(f, delta) {
    return delta && delta[f.path.join(".")];
  }
  function badge(d) {
    if (!d) return "";
    if (typeof d[0] === "number" && typeof d[1] === "number") {
      var n = Math.round((d[1] - d[0]) * 100) / 100;
      return n ? '<span class="cf-d ' + (n > 0 ? "up" : "down") + '">' + (n > 0 ? "+" : "") + n + "</span>" : "";
    }
    return '<span class="cf-d">' + (d[0] === undefined || d[0] === null ? "new" : "changed") + "</span>";
  }
  var animate = false;
  // A meter starts at the old value and slides to the new one once it's on screen.
  function bar(f, v, d) {
    var to = pct(f, v);
    var from = animate && d && typeof d[0] === "number" ? pct(f, d[0]) : to;
    return '<div class="cf-bar"><i style="width:' + from + '%" data-to="' + to + '"></i></div>';
  }
  function row(f, stat, delta) {
    var v = get(stat, f.path);
    var d = changeOf(f, delta);
    return '<div class="cf-f' + (d && animate ? " cf-changed" : "") + '"><div class="cf-r"><span class="cf-l">' + esc(f.label) + "</span>" + badge(d) +
      '<span class="cf-v">' + esc(text(f, v)) + (isMeter(f) ? " / " + f.max : "") + "</span></div>" + (isMeter(f) ? bar(f, v, d) : "") + "</div>";
  }
  function chip(f, stat, delta) {
    var v = get(stat, f.path);
    var d = changeOf(f, delta);
    return '<div class="cf-c' + (d && animate ? " cf-changed" : "") + '"><div class="cf-r"><span class="cf-l">' + esc(f.label) + "</span>" + badge(d) +
      '<b class="cf-v">' + esc(text(f, v)) + "</b></div>" + (isMeter(f) ? bar(f, v, d) : "") + "</div>";
  }
  var open = false;
  var tab = 0;
  var shownDelta = null;
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
  function latest() {
    try {
      return !!app && CF.state.latestId() === Number(app.messageId);
    } catch (e) {
      return false;
    }
  }
  function draw() {
    var d = data();
    var stat = d.stat_data;
    if (!stat) {
      root.innerHTML = '<div class="cf-empty">No game state on this message yet.</div>';
      return;
    }
    var delta = d.delta_data || {};
    // Animate a change once, not on every redraw.
    var sig = JSON.stringify(delta);
    animate = sig !== shownDelta && Object.keys(delta).length > 0;
    shownDelta = sig;
    var pinned = FIELDS.filter(function (f) { return f.pinned; });
    var expandable = TABS.length > 1 || FIELDS.length > pinned.length;
    if (!expandable) open = false;
    var html = '<div class="cf-head"><b>' + esc(TITLE) + "</b>" +
      (expandable ? '<button type="button" id="cf-more" aria-expanded="' + open + '">' + (open ? "Less" : "More") + "</button>" : "") + "</div>";
    if (!open) {
      var compact = pinned.length ? pinned : FIELDS;
      html += '<div class="cf-compact"' + (expandable ? ' role="button" tabindex="0" aria-label="Show everything"' : "") + ">" +
        compact.map(function (f) { return chip(f, stat, delta); }).join("") + "</div>";
    } else {
      if (TABS.length > 1)
        html += '<div class="cf-ptabs" role="tablist">' + TABS.map(function (t, i) {
          return '<button type="button" role="tab" data-tab="' + i + '" aria-selected="' + (i === tab) + '">' + esc(t) + "</button>";
        }).join("") + "</div>";
      var shown = FIELDS.filter(function (f) { return TABS.length < 2 || f.tab === tab; });
      html += shown.map(function (f, i) {
        var group = f.group && (i === 0 || shown[i - 1].group !== f.group) ? '<div class="cf-g">' + esc(f.group) + "</div>" : "";
        return group + row(f, stat, delta);
      }).join("");
    }
    if (ACTIONS.length && latest())
      html += '<div class="cf-actions">' + ACTIONS.map(function (a, i) {
        return '<button type="button" data-act="' + i + '">' + esc(a.label) + "</button>";
      }).join("") + "</div>";
    root.innerHTML = html;
    if (animate)
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          root.querySelectorAll("[data-to]").forEach(function (el) { el.style.width = el.getAttribute("data-to") + "%"; });
        });
      });
  }
  function toggle() {
    open = !open;
    draw();
  }
  root.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("#cf-more") || t.closest(".cf-compact[role=button]")) return toggle();
    var tabButton = t.closest("[data-tab]");
    if (tabButton) {
      tab = Number(tabButton.getAttribute("data-tab"));
      return draw();
    }
    var act = t.closest("[data-act]");
    if (act && app) {
      var a = ACTIONS[Number(act.getAttribute("data-act"))];
      if (a.text.charAt(0) === "/" && typeof triggerSlash === "function") triggerSlash(a.text);
      else app.write(a.text, { now: a.now });
    }
  });
  root.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest(".cf-compact[role=button]")) {
      e.preventDefault();
      toggle();
    }
  });
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
.cf-head button, .cf-actions button { font: inherit; font-size: 12px; color: inherit; background: none; border: 1px solid color-mix(in srgb, var(--cf-accent) 45%, transparent); border-radius: 999px; padding: 4px 12px; min-height: 30px; cursor: pointer; }
.cf-compact { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 130px), 1fr)); gap: 4px 14px; cursor: default; }
.cf-compact[role=button] { cursor: pointer; }
.cf-c { min-width: 0; padding: 2px 0; border-radius: 6px; }
.cf-c .cf-v { font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.cf-g { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin-top: 6px; }
.cf-f { padding: 3px 0; border-radius: 6px; }
.cf-r { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.cf-l { opacity: .75; }
.cf-v { margin-left: auto; text-align: right; overflow-wrap: anywhere; }
.cf-d { font-size: 11px; border-radius: 999px; padding: 0 6px; background: color-mix(in srgb, var(--cf-accent) 25%, transparent); white-space: nowrap; }
.cf-d.up { background: color-mix(in srgb, var(--cf-good, #22c55e) 28%, transparent); }
.cf-d.down { background: color-mix(in srgb, var(--cf-bad, #ef4444) 28%, transparent); }
.cf-bar { height: 6px; border-radius: 3px; background: rgba(127, 127, 127, .25); overflow: hidden; margin-top: 3px; }
.cf-bar i { display: block; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--cf-accent), var(--cf-accent2, var(--cf-accent))); transition: width .8s cubic-bezier(.2, .8, .2, 1); }
.cf-changed { animation: cf-glow 1.6s ease; }
.cf-changed .cf-bar i { animation: cf-flash 1.2s ease .3s; }
@keyframes cf-glow { 0%, 30% { background: color-mix(in srgb, var(--cf-accent) 18%, transparent); } 100% { background: transparent; } }
@keyframes cf-flash { 0%, 100% { filter: none; } 40% { filter: brightness(1.7); } }
.cf-ptabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid color-mix(in srgb, var(--cf-accent) 25%, transparent); margin-bottom: 4px; }
.cf-ptabs button { font: inherit; font-size: 13px; color: inherit; opacity: .7; background: none; border: 0; border-bottom: 2px solid transparent; padding: 6px 10px; min-height: 34px; cursor: pointer; white-space: nowrap; }
.cf-ptabs button[aria-selected=true] { opacity: 1; color: var(--cf-accent); border-bottom-color: var(--cf-accent); }
.cf-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid color-mix(in srgb, var(--cf-accent) 20%, transparent); }
.cf-actions button { font-size: 13px; min-height: 36px; padding: 6px 14px; }
.cf-empty { opacity: .7; font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .cf-bar i { transition: none; } .cf-changed, .cf-changed .cf-bar i { animation: none; } }
`;

/** The panel document. */
export function panelHtml(config: EngineConfig): string {
  // Only the accent as a fallback: with the engine core, the card theme's variables take over.
  const accent = themeTokens(themeOf(config)).accent;
  const data = [
    `var FIELDS = ${safeJson(panelFields(config))};`,
    `var TABS = ${safeJson(panelTabs(config).map((t) => t.label.trim()))};`,
    `var ACTIONS = ${safeJson(panelActions(config))};`,
    `var TITLE = ${safeJson(config.panel.title || "Status")};`,
  ].join(" ");
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>html { --cf-accent: ${accent}; }${STYLE.replace(/\s*\n\s*/g, " ")}</style>`,
    '</head><body><div id="cf-panel"><div id="cf-slots"></div><div id="cf-stats"></div></div>',
    `<script>${data}${SCRIPT}</script>`,
    "</body></html>",
  ].join("\n");
}
