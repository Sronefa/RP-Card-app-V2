/**
 * Core module: the player settings app, opened from the hub. The player picks light or dark, an
 * accent, the text size and how much motion, how panels behave, sound levels, and can fix or reset game values by
 * hand; those edits go to a log the model sees, so it doesn't "correct" them back. Settings are kept
 * per chat.
 */
import type { EngineModule } from "./types";

export interface SettingsAppSettings {
  sections: { look: boolean; panels: boolean; generations: boolean; sound: boolean; state: boolean };
}

export const defaultSettingsApp = (): SettingsAppSettings => ({
  sections: { look: true, panels: true, generations: true, sound: true, state: true },
});

export function settingsAppSettings(raw: Record<string, unknown> | undefined): SettingsAppSettings {
  const sections = { ...defaultSettingsApp().sections, ...((raw?.sections as object | undefined) ?? {}) };
  return { sections };
}

const JS = String.raw`
var esc = CF.ui.esc;
var show = settings.sections || {};
var tab = "look";
function option(value, label, current) {
  return '<option value="' + esc(value) + '"' + (String(value) === String(current) ? " selected" : "") + ">" + esc(label) + "</option>";
}
function field(label, control) {
  return '<label class="cf-stack" style="gap:4px"><span class="cf-small cf-muted">' + esc(label) + "</span>" + control + "</label>";
}
function check(name, label, on) {
  return '<label class="cf-row"><input type="checkbox" data-setting="' + name + '"' + (on ? " checked" : "") + "> " + esc(label) + "</label>";
}
function leaves(value, path, out) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.keys(value).forEach(function (k) {
      if (k.charAt(0) === "_") return;
      leaves(value[k], path.concat(k), out);
    });
  } else out.push({ path: path, value: value });
  return out;
}
function editable(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return v == null ? "" : String(v);
}
function parse(text, old) {
  if (typeof old === "number") { var n = Number(text); return isFinite(n) ? n : old; }
  if (typeof old === "boolean") return /^(yes|true|on|1)$/i.test(text.trim());
  if (Array.isArray(old)) return text.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (old && typeof old === "object") { try { return JSON.parse(text); } catch (e) { return old; } }
  return text;
}
function look(s) {
  return '<div class="cf-stack">' +
    field("Light or dark", '<select class="cf-input" data-setting="mode">' + option("auto", "As the card was made", s.mode) + option("light", "Light", s.mode) + option("dark", "Dark", s.mode) + "</select>") +
    field("Accent colour", '<div class="cf-row"><input type="color" data-setting="accent" value="' + esc(s.accent || "#888888") + '" style="width:56px;height:36px;border:0;background:none">' +
      (s.accent ? '<button type="button" class="cf-btn ghost" data-reset="accent">Card colour</button>' : '<span class="cf-small cf-muted">The card’s own colour</span>') + "</div>") +
    field("Text size", '<select class="cf-input" data-setting="textScale">' + [0.85, 1, 1.15, 1.3].map(function (n) { return option(n, Math.round(n * 100) + "%", s.textScale); }).join("") + "</select>") +
    field("Motion", '<select class="cf-input" data-setting="motion">' + option("auto", "As my device is set", s.motion) + option("full", "Full effects", s.motion) + option("reduce", "Less motion", s.motion) + "</select>") +
    field("Minigames", '<select class="cf-input" data-setting="minigames">' + option("play", "Play them", s.minigames) + option("skip", "Skip them (the story decides)", s.minigames) + "</select>") +
    "</div>";
}
function panels(s) {
  return '<div class="cf-stack">' + check("compact", "Compact status panels (tap “All” for the rest)", s.compact) +
    field("Panels kept live", '<select class="cf-input" data-setting="livePanels">' + [3, 5, 10, 0].map(function (n) { return option(n, n ? "The last " + n : "All of them", s.livePanels); }).join("") + "</select>") +
    '<p class="cf-small cf-muted">Older panels turn into still pictures, which keeps long chats quick on phones.</p>' +
    check("trimOld", "Keep long chats light (old messages keep a snapshot every 50)", s.trimOld !== false) + "</div>";
}
function generations(s) {
  return '<div class="cf-stack">' + check("sideCalls", "Background generations (texts, feeds, shop stock)", s.sideCalls) +
    '<p class="cf-small cf-muted">They use your own API and cost extra tokens. Turned off, those screens just wait for the story.</p>' +
    updates(s) +
    living(s) + "</div>";
}
function updates(s) {
  var u = CF.updateMode ? CF.updateMode() : null;
  if (!u) return "";
  var how = u.mode === "side"
    ? '<p class="cf-small">The game state is kept with one after each reply, about ' + u.tokens + " tokens a turn. Turned off, the values stop changing.</p>"
    : '<p class="cf-small cf-muted">The story model writes the game state in each reply. When a reply leaves it out or is cut off, one background generation (about ' + u.tokens + " tokens) writes it instead.</p>";
  if (u.locked) return how;
  return field("Game state updates", '<select class="cf-input" data-setting="updateMode">' +
    option("card", "As the card was made (" + (u.card === "side" ? "a second call" : "in the reply") + ")", s.updateMode || "card") +
    option("reply", "In the story model's reply", s.updateMode) + option("side", "With a second call after each reply", s.updateMode) + "</select>") + how;
}
function living(s) {
  var feeds = CF.live ? CF.live.feeds() : [];
  if (!feeds.length) return "";
  var off = s.liveOff || [];
  return '<div class="cf-stack" style="gap:6px"><span class="cf-label">Living screens</span>' +
    feeds.map(function (f) {
      var how = f.every === 1 ? "after each reply" : f.every > 1 ? "every " + f.every + " replies" : "when the story changes it";
      return '<label class="cf-row"><input type="checkbox" data-live="' + esc(f.id) + '"' + (off.indexOf(f.id) < 0 && s.sideCalls !== false ? " checked" : "") + (s.sideCalls === false ? " disabled" : "") + "> " +
        '<span class="cf-stack" style="gap:0">' + esc(f.name) + '<span class="cf-small cf-muted">About ' + f.tokens + " tokens, " + how + "</span></span></label>";
    }).join("") + "</div>";
}
function sound(s) {
  return '<div class="cf-stack">' +
    field("Music " + s.music + "%", '<input type="range" min="0" max="100" step="5" data-setting="music" value="' + esc(s.music) + '">') +
    field("Ambience " + s.ambience + "%", '<input type="range" min="0" max="100" step="5" data-setting="ambience" value="' + esc(s.ambience) + '">') +
    "</div>";
}
function state() {
  var all = leaves(app.state() || {}, [], []);
  if (!all.length) return '<p class="cf-muted">No game state yet.</p>';
  return '<div class="cf-stack"><p class="cf-small cf-muted">Fix a value by hand. The story is told about your change, so it sticks.</p>' +
    all.map(function (l) {
      return field(l.path.join(" › "), '<input class="cf-input" data-path="' + esc(JSON.stringify(l.path)) + '" value="' + esc(editable(l.value)) + '">');
    }).join("") +
    '<div class="cf-row"><button type="button" class="cf-btn primary" data-save>Save changes</button><button type="button" class="cf-btn ghost" data-reset-state>Back to the start</button></div>' +
    '<div class="cf-stack" style="gap:6px"><span class="cf-label">Values look wrong?</span>' +
    '<div class="cf-row"><button type="button" class="cf-btn" data-rebuild>Rebuild from the chat</button><button type="button" class="cf-btn ghost" data-redo>Redo the last update</button></div>' +
    '<p class="cf-small cf-muted">Rebuild reads every message again, keeping your own changes. Redo asks a second call to write the last reply’s update again (it costs tokens).</p></div></div>';
}
function render() {
  var s = app.settings();
  var tabs = [];
  if (show.look !== false) tabs.push({ id: "look", label: "Look", html: look(s) });
  if (show.panels !== false) tabs.push({ id: "panels", label: "Panels", html: panels(s) });
  if (show.generations !== false) tabs.push({ id: "generations", label: "Generations", html: generations(s) });
  if (show.sound !== false) tabs.push({ id: "sound", label: "Sound", html: sound(s) });
  if (show.state !== false) tabs.push({ id: "state", label: "Game state", html: state() });
  if (!tabs.some(function (t) { return t.id === tab; })) tab = tabs.length ? tabs[0].id : "";
  root.innerHTML = '<div class="cf-app">' + CF.ui.appBar("Settings") + '<div class="cf-appbody">' + CF.ui.tabs(tabs, tab) + "</div></div>";
}
root.addEventListener("click", function (e) {
  var t = e.target.closest("[data-cf-tab]");
  if (t) tab = t.getAttribute("data-cf-tab");
  if (e.target.closest("[data-reset]")) app.setSettings({ accent: "" }).then(render);
  if (e.target.closest("[data-save]")) {
    var inputs = root.querySelectorAll("[data-path]");
    var current = app.state() || {};
    var jobs = [];
    inputs.forEach(function (input) {
      var path = JSON.parse(input.getAttribute("data-path"));
      var old = path.reduce(function (o, k) { return o == null ? o : o[k]; }, current);
      var next = parse(input.value, old);
      if (JSON.stringify(next) !== JSON.stringify(old)) jobs.push([path, next]);
    });
    (async function () {
      for (var i = 0; i < jobs.length; i++) await app.set(jobs[i][0], jobs[i][1], "set by the player");
      app.toast(jobs.length ? "Saved " + jobs.length + (jobs.length === 1 ? " change" : " changes") : "Nothing changed");
      render();
    })().catch(function (err) { app.toast("Couldn't save: " + err.message); });
  }
  if (e.target.closest("[data-rebuild]")) {
    app.toast("Rebuilding…");
    CF.state.rebuild().then(function () { app.toast("Values rebuilt from the chat"); render(); }, function (err) { app.toast("Couldn't rebuild: " + err.message); });
  }
  if (e.target.closest("[data-redo]")) {
    app.toast("Asking for the last update again…");
    CF.state.redo().then(function () { app.toast("Last update written again"); render(); }, function (err) { app.toast("Couldn't redo it: " + err.message); });
  }
  if (e.target.closest("[data-reset-state]")) {
    var box = app.modal('<div class="cf-stack"><h2>Start the values over?</h2><p class="cf-small">Every game value goes back to how the story began. The chat stays.</p><div class="cf-row"><button type="button" class="cf-btn primary" data-confirm>Start over</button><button type="button" class="cf-btn ghost" data-cf-close>Keep them</button></div></div>');
    box.querySelector("[data-confirm]").addEventListener("click", function () {
      box.remove();
      CF.state.reset().then(function () { app.toast("Values reset"); render(); });
    });
  }
});
root.addEventListener("change", function (e) {
  var live = e.target.getAttribute("data-live");
  if (live) {
    var off = (app.settings().liveOff || []).filter(function (id) { return id !== live; });
    if (!e.target.checked) off.push(live);
    app.setSettings({ liveOff: off }).then(render);
    return;
  }
  var name = e.target.getAttribute("data-setting");
  if (!name) return;
  var value = e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" || name === "textScale" || name === "livePanels" ? Number(e.target.value) : e.target.value;
  var patch = {};
  patch[name] = value;
  app.setSettings(patch).then(render);
});
render();
app.onState(function () { if (tab === "state") render(); });
`;

export function settingsAppModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  return {
    id: "settings",
    name: "Settings app",
    version: "1.0.0",
    description: "The player's own settings: light or dark, accent, text size, motion, panels, generations, sound, and fixing values by hand.",
    slot: "overlay",
    button: "⚙ Settings",
    tags: ["core", "settings"],
    requires: [],
    core: "settings",
    enabled,
    vars: [],
    rules: [],
    regex: [],
    html: "",
    css: "",
    js: JS,
    script: "",
    settings: settingsAppSettings(raw) as unknown as Record<string, unknown>,
  };
}
