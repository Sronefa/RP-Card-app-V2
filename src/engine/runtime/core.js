// CardForge engine core: the shared runtime every engine screen builds on.
//
// Runs in the card's Tavern Helper script, after updater.js and before glue.js, and shares one
// object, `CardForge`, through Tavern Helper's initializeGlobal. Screens (status panel, overlays,
// inline blocks) live in their own iframes and reach it as `window.CardForge` or
// `parent.CardForge`. It gives them:
// - state: the game state at their message (or the latest), and edits by the player, logged;
// - act: structured actions written into SillyTavern's input box;
// - bus: events between screens; settings: the player's choices for this chat;
// - theme and UI kit: the card theme as CSS variables and ready-made pieces;
// - modules: mounting a module's screen in a slot, and the hub buttons above the input box.
// Nothing here loads from the network. Never write the closing script tag literally in this file.

var CF_KEY = "cardforge";
var CF_DEFAULT_SETTINGS = {
  mode: "auto",
  accent: "",
  textScale: 1,
  compact: true,
  livePanels: 5,
  sideCalls: true,
  music: 70,
  ambience: 70,
  motion: "auto",
};
var CF_SCRIPT_TAG = "scr" + "ipt";
var cfHooks = [];
var cfOverlay = null;

function cfHost() {
  return window.parent;
}

function cfModules() {
  return (CF_CONFIG.modules || []).filter(function (m) {
    return m.enabled !== false;
  });
}

function cfModule(id) {
  return cfModules().find(function (m) {
    return m.id === id;
  });
}

// ---------------------------------------------------------------- settings (per chat)

function cfSettings() {
  var stored = {};
  try {
    var vars = getVariables({ type: "chat" }) || {};
    stored = (vars[CF_KEY] && vars[CF_KEY].settings) || {};
  } catch (e) {}
  return Object.assign({}, CF_DEFAULT_SETTINGS, stored);
}

async function cfSetSettings(patch) {
  var next = Object.assign(cfSettings(), patch || {});
  await updateVariablesWith(
    function (vars) {
      vars[CF_KEY] = Object.assign({}, vars[CF_KEY], { settings: next });
      return vars;
    },
    { type: "chat" },
  );
  await eventEmit("cf:settings", next);
  return next;
}

// ---------------------------------------------------------------- kept across chats

/** Values kept with the character, not the chat: unlocked endings, gallery pictures, achievements. */
function cfKept() {
  try {
    var vars = getVariables({ type: "character" }) || {};
    return (vars[CF_KEY] && vars[CF_KEY].keep) || {};
  } catch (e) {
    return {};
  }
}

function cfKeepGet(key) {
  var all = cfKept();
  return key === undefined ? all : all[key];
}

async function cfKeepSet(key, value) {
  await updateVariablesWith(
    function (vars) {
      var mine = Object.assign({}, vars[CF_KEY]);
      mine.keep = Object.assign({}, mine.keep);
      mine.keep[key] = value;
      vars[CF_KEY] = mine;
      return vars;
    },
    { type: "character" },
  );
  await eventEmit("cf:keep", key);
  return value;
}

/** Adds lines to a kept list, once each; resolves to the lines that were new. */
async function cfKeepAdd(key, lines) {
  var have = cfKeepGet(key);
  have = Array.isArray(have) ? have : [];
  var fresh = (Array.isArray(lines) ? lines : [lines]).map(String).filter(function (l, i, all) {
    return l && have.indexOf(l) < 0 && all.indexOf(l) === i;
  });
  if (fresh.length) await cfKeepSet(key, have.concat(fresh));
  return fresh;
}

// ---------------------------------------------------------------- theme

function cfMode(settings) {
  var mode = (settings || cfSettings()).mode;
  return mode === "light" || mode === "dark" ? mode : CF_CONFIG.theme.mode;
}

function cfThemeCss(settings) {
  settings = settings || cfSettings();
  // The bundled fonts the card uses come first: @font-face rules with the font inside.
  var css = (CF_CONFIG.theme.fonts ? CF_CONFIG.theme.fonts + "\n" : "") + ":root { " + CF_CONFIG.theme[cfMode(settings)];
  if (/^#[0-9a-f]{3,8}$/i.test(settings.accent || "")) css += "; --cf-accent: " + settings.accent;
  var scale = Number(settings.textScale) || 1;
  css += "; --cf-scale: " + Math.min(1.6, Math.max(0.7, scale)) + "; }";
  return css;
}

/** Puts the theme and the kit into a screen's document, and keeps them current. */
function cfStyle(doc, settings) {
  var style = doc.getElementById("cf-kit");
  if (!style) {
    style = doc.createElement("style");
    style.id = "cf-kit";
    var head = doc.head || doc.documentElement;
    head.insertBefore(style, head.firstChild);
  }
  style.textContent = cfThemeCss(settings) + "\n" + CF_CONFIG.kit;
  if (doc.body) {
    doc.body.classList.add("cf");
    // The kit's own animations stop when the player wants less motion.
    doc.body.classList.toggle("cf-reduce-motion", cfReducedMotion(doc.defaultView));
  }
}

// ---------------------------------------------------------------- state

/** The id of the latest message that has a game state. */
function cfLatestId() {
  for (var i = getLastMessageId(); i >= 0; i--) {
    var data = cfMessageData(i);
    if (data && cfIsObject(data.stat_data)) return i;
  }
  return -1;
}

function cfData(messageId) {
  var id = messageId === undefined || messageId === "latest" ? cfLatestId() : messageId;
  if (id < 0) return {};
  return cfMessageData(id) || {};
}

function cfRead(path, messageId) {
  var stat = cfData(messageId).stat_data;
  return path ? cfGet(stat, cfPath(path)) : stat;
}

/** Hidden values ("$" keys) never reach the model, so changing them needs no note to it. */
function cfHiddenPath(keys) {
  return keys.some(function (k) {
    return String(k).charAt(0) === "$";
  });
}

/**
 * Changes the player made by hand, on the latest state, in one write: [[path, value], ...]. They're
 * logged in one line (with `note`) so the AI keeps them; hidden values aren't logged.
 */
async function cfPlayerSetMany(changes, note) {
  var id = cfLatestId();
  if (id < 0) throw new Error("There is no game state yet.");
  var data = cfClone(cfMessageData(id));
  var done = changes.map(function (change) {
    var keys = Array.isArray(change[0]) ? change[0].map(String) : cfPath(change[0]);
    var before = cfGet(data.stat_data, keys);
    cfSet(data.stat_data, keys, change[1]);
    return { keys: keys, before: before };
  });
  var schema = cfSchemaOrNull();
  if (schema) {
    var checked = schema.safeParse(data.stat_data);
    if (checked.success) data.stat_data = checked.data;
  }
  data.delta_data = Object.assign({}, data.delta_data);
  var lines = [];
  var results = done.map(function (d) {
    var after = cfGet(data.stat_data, d.keys);
    data.delta_data[d.keys.join(".")] = [d.before, after];
    if (!cfHiddenPath(d.keys)) lines.push(d.keys.join(".") + ": " + JSON.stringify(d.before) + " → " + JSON.stringify(after));
    return after;
  });
  if (lines.length) {
    var log = Array.isArray(data.stat_data._PlayerEdits) ? data.stat_data._PlayerEdits.slice() : [];
    log.push(lines.join("; ") + (note ? " (" + note + ")" : ""));
    data.stat_data._PlayerEdits = log.slice(-5);
  }
  await cfWrite(id, data);
  await eventEmit("cf:state", id);
  return results;
}

/** A change the player made by hand, on the latest state. It's logged so the AI keeps it. */
async function cfPlayerSet(path, value, note) {
  return (await cfPlayerSetMany([[path, value]], note))[0];
}

/** Puts every value back to the start, on the latest state, and tells the model. */
async function cfPlayerReset() {
  var id = cfLatestId();
  if (id < 0) return;
  var data = cfClone(cfMessageData(id));
  var before = data.stat_data;
  var fresh = cfClone(CF_CONFIG.initial);
  var schema = cfSchemaOrNull();
  if (schema) {
    var checked = schema.safeParse(fresh);
    if (checked.success) fresh = checked.data;
  }
  fresh = cfRunHooks(fresh, null, id);
  fresh._PlayerEdits = ["The player reset every value to the start."];
  data.stat_data = fresh;
  data.delta_data = cfDelta(before, fresh);
  await cfWrite(id, data);
  await eventEmit("cf:state", id);
}

// ---------------------------------------------------------------- actions

function cfAttr(text) {
  return String(text).replace(/[&"<>]/g, "");
}

/** The structured request a screen sends: `<action app="shop">{"buy":"rope"}</action>`. */
function cfActionText(app, payload, text) {
  var body = payload == null ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return '<action app="' + cfAttr(app) + '">' + body + "</action>" + (text ? "\n" + text : "");
}

/** Adds text to SillyTavern's input box, after what the player typed; with `now`, sends it too. */
async function cfWriteInput(text, options) {
  var doc = cfHost().document;
  var box = doc.getElementById("send_textarea");
  if (!box) throw new Error("SillyTavern's input box isn't on the page.");
  if (text) box.value = box.value.trim() ? box.value.replace(/\s+$/, "") + "\n" + text : text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  if (options && options.now) {
    var button = doc.getElementById("send_but");
    if (button) button.click();
  }
  return text;
}

/** Writes an action into SillyTavern's input box; with `now`, sends it too. */
async function cfSend(app, payload, text, options) {
  var line = cfActionText(app, payload, text);
  await cfWriteInput(line);
  await eventEmit("cf:action", { app: app, payload: payload, text: text || "" });
  if (options && options.now) await cfWriteInput("", { now: true });
  return line;
}

// ---------------------------------------------------------------- UI kit (HTML strings, any document)

var CF_ICONS = {
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  coin: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v8m-3-6h4.5a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3H15",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4v4l3 2",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  cloud: "M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z",
  rain: "M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15zm1 3-1 2m5-2-1 2m5-2-1 2",
  snow: "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9",
  fog: "M4 9h16M3 13h18M5 17h14",
  storm: "M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14zm5 0-2 4h4l-2 4",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-.1-1.3 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15 2h-4l-.3 2.4a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6L6 12l.1 1.3-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3L11 22h4l.3-2.4a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6z",
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6 6 18",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h2",
  bag: "M5 8h14l-1 12H6zm4 0V6a3 3 0 0 1 6 0v2",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zm6-2v14m6-12v14",
  chat: "M4 5h16v11H9l-5 4z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  calendar: "M4 6h16v14H4zm0 4h16M8 3v4m8-4v4",
  news: "M5 4h12v16H6a2 2 0 0 1-2-2V8h3m2-1h6m-6 4h6m-6 4h4",
  wallet: "M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11v3m-1 6h2",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zm8 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  note: "M6 3h9l4 4v14H6zm9 0v4h4M9 12h7m-7 4h5",
  spark: "M12 3v5m0 8v5M3 12h5m8 0h5M6 6l3 3m6 6 3 3m0-12-3 3m-6 6-3 3",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  send: "M4 12l16-8-6 16-2-7z",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9a6 6 0 0 1 12 0m1-9a3 3 0 1 0 0-6m2 15a5 5 0 0 0-3-4.6",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  check: "M5 12l5 5 9-10",
  plus: "M12 5v14M5 12h14",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16m4-14h7",
  gift: "M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7c-1-3-5-3.5-5-1s5 1 5 1zm0 0c1-3 5-3.5 5-1s-5 1-5 1",
  sword: "M20 4 9.5 14.5M20 4h-5l-8.5 8.5M20 4v5l-8.5 8.5M5.5 12.5l6 6M8 16l-4 4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  flask: "M9 3h6m-5 0v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.3 14h9.4",
  skull: "M12 3a8 8 0 0 0-8 8c0 3 1.5 4.6 3 5.5V20h10v-3.5c1.5-.9 3-2.5 3-5.5a8 8 0 0 0-8-8zm-3 7.5v1m6-1v1M10 20v-2.5m4 2.5v-2.5",
  fire: "M12 21a6 6 0 0 0 6-6c0-4-3-6-4.5-10-2 2-3 4.5-2.5 7-1.2-.8-1.8-2-2-3.2C7.2 10.6 6 12.6 6 15a6 6 0 0 0 6 6z",
  scroll: "M8 4h10a2 2 0 0 1 0 4h-2v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h2zm0 12h6M11 8h3m-3 4h3",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  rocket: "M12 3c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zm0 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 13l-3 3v3l4-2m9-4 3 3v3l-4-2m-5 3v3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4",
  chip: "M7 7h10v10H7zm3 3h4v4h-4zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4",
};

function cfEsc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var cfUi = {
  esc: cfEsc,
  icon: function (name, label) {
    var d = CF_ICONS[name] || CF_ICONS.star;
    return (
      '<svg class="cf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
      (label ? ' role="img" aria-label="' + cfEsc(label) + '"' : ' aria-hidden="true"') +
      '><path d="' + d + '"/></svg>'
    );
  },
  icons: function () {
    return Object.keys(CF_ICONS);
  },
  delta: function (change) {
    if (typeof change !== "number" || !change) return "";
    var n = Math.round(change * 100) / 100;
    return '<span class="cf-delta ' + (n > 0 ? "up" : "down") + '">' + (n > 0 ? "+" : "") + n + "</span>";
  },
  meter: function (o) {
    var min = o.min == null ? 0 : o.min;
    var max = o.max == null ? 100 : o.max;
    var pct = Math.max(0, Math.min(100, ((Number(o.value) - min) / (max - min || 1)) * 100));
    return (
      '<div class="cf-meter' + (o.delta ? " flash" : "") + '" role="meter" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + Number(o.value) + '" aria-label="' + cfEsc(o.label) + '">' +
      '<div class="cf-meter-head"><span>' + cfEsc(o.label) + "</span>" + cfUi.delta(o.delta) +
      '<span class="cf-meter-value">' + cfEsc(o.value) + (o.showMax === false ? "" : " / " + cfEsc(max)) + "</span></div>" +
      '<div class="cf-meter-track"><div class="cf-meter-fill" style="width:' + pct + '%"></div></div></div>'
    );
  },
  stat: function (label, value, delta) {
    return '<div class="cf-stat"><span class="cf-label">' + cfEsc(label) + "</span><b>" + cfEsc(value) + " " + cfUi.delta(delta) + "</b></div>";
  },
  grid: function (items) {
    return '<div class="cf-grid">' + (items || []).map(function (i) { return cfUi.stat(i.label, i.value, i.delta); }).join("") + "</div>";
  },
  chip: function (text) {
    return '<span class="cf-chip">' + cfEsc(text) + "</span>";
  },
  avatar: function (src, name) {
    if (src) return '<span class="cf-avatar" style="background-image:url(\'' + cfEsc(src).replace(/'/g, "%27") + '\')" role="img" aria-label="' + cfEsc(name || "") + '"></span>';
    return '<span class="cf-avatar" aria-hidden="true">' + cfEsc(String(name || "?").charAt(0).toUpperCase()) + "</span>";
  },
  list: function (items) {
    return (
      '<ul class="cf-list">' +
      (items || [])
        .map(function (i) {
          return (
            '<li class="cf-item">' + (i.avatar !== undefined ? cfUi.avatar(i.avatar, i.title) : "") +
            '<div style="flex:1;min-width:0"><div>' + cfEsc(i.title) + "</div>" + (i.sub ? '<div class="cf-muted cf-small">' + cfEsc(i.sub) + "</div>" : "") + "</div>" +
            (i.right !== undefined ? "<div>" + cfEsc(i.right) + "</div>" : "") + "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  },
  bubble: function (text, me) {
    return '<div class="cf-bubble' + (me ? " me" : "") + '">' + cfEsc(text) + "</div>";
  },
  button: function (label, o) {
    o = o || {};
    var attrs = "";
    if (o.send) attrs += ' data-cf-send="' + cfEsc(o.send) + '" data-cf-payload="' + cfEsc(JSON.stringify(o.payload == null ? null : o.payload)) + '"' + (o.text ? ' data-cf-text="' + cfEsc(o.text) + '"' : "") + (o.now ? " data-cf-now" : "");
    if (o.open) attrs += ' data-cf-open="' + cfEsc(o.open) + '"';
    if (o.close) attrs += " data-cf-close";
    if (o.back) attrs += " data-cf-back";
    return '<button type="button" class="cf-btn' + (o.primary ? " primary" : o.ghost ? " ghost" : "") + '"' + attrs + ">" + (o.icon ? cfUi.icon(o.icon) : "") + cfEsc(label) + "</button>";
  },
  /** Tabs: [{ id, label, html }]. The first is open unless `selected` names another. */
  tabs: function (tabs, selected) {
    selected = selected || (tabs[0] && tabs[0].id);
    return (
      '<div class="cf-tabset"><div class="cf-tabs" role="tablist">' +
      tabs.map(function (t) {
        return '<button type="button" class="cf-tab" role="tab" data-cf-tab="' + cfEsc(t.id) + '" aria-selected="' + (t.id === selected) + '">' + cfEsc(t.label) + "</button>";
      }).join("") +
      "</div>" +
      tabs.map(function (t) {
        return '<div class="cf-tabpanel" role="tabpanel" data-cf-panel="' + cfEsc(t.id) + '"' + (t.id === selected ? "" : " hidden") + ">" + t.html + "</div>";
      }).join("") +
      "</div>"
    );
  },
  /** A round progress ring with the value (or `text`) in the middle. */
  ring: function (o) {
    var min = o.min == null ? 0 : o.min;
    var max = o.max == null ? 100 : o.max;
    var pct = Math.max(0, Math.min(1, (Number(o.value) - min) / (max - min || 1)));
    var size = o.size || 64;
    var r = 15.5;
    var len = 2 * Math.PI * r;
    return (
      '<div class="cf-ring" style="width:' + size + "px;height:" + size + 'px" role="meter" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + Number(o.value) + '" aria-label="' + cfEsc(o.label || "") + '">' +
      '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="cf-ring-track" cx="18" cy="18" r="' + r + '"/><circle class="cf-ring-fill" cx="18" cy="18" r="' + r + '" stroke-dasharray="' + len.toFixed(2) + '" stroke-dashoffset="' + (len * (1 - pct)).toFixed(2) + '"/></svg>' +
      '<span class="cf-ring-text">' + cfEsc(o.text != null ? o.text : Math.round(Number(o.value))) + "</span>" +
      (o.label ? '<span class="cf-ring-label">' + cfEsc(o.label) + "</span>" : "") +
      "</div>"
    );
  },
  /** Slides that swipe sideways, with arrows and dots. `slides` are HTML strings. */
  carousel: function (slides, o) {
    o = o || {};
    slides = slides || [];
    return (
      '<div class="cf-carousel" data-cf-carousel role="region" aria-roledescription="carousel" aria-label="' + cfEsc(o.label || "Slides") + '">' +
      '<div class="cf-carousel-track">' +
      slides.map(function (html, i) {
        return '<div class="cf-slide" role="group" aria-roledescription="slide" aria-label="' + (i + 1) + " of " + slides.length + '">' + html + "</div>";
      }).join("") +
      "</div>" +
      (slides.length > 1
        ? '<div class="cf-carousel-nav"><button type="button" class="cf-btn ghost" data-cf-slide="-1" aria-label="Previous">' + cfUi.icon("back") + '</button><span class="cf-dots">' +
          slides.map(function (_, i) {
            return '<button type="button" class="cf-dot" data-cf-slide-to="' + i + '" aria-label="Slide ' + (i + 1) + '"' + (i === 0 ? ' aria-current="true"' : "") + "></button>";
          }).join("") +
          '</span><button type="button" class="cf-btn ghost cf-next" data-cf-slide="1" aria-label="Next">' + cfUi.icon("back") + "</button></div>"
        : "") +
      "</div>"
    );
  },
  /**
   * A visual-novel dialogue box: the speaker's name, their portrait (a URL, say from
   * CF.assets.portrait) on the left or right, the line, and choices as buttons.
   */
  dialogue: function (o) {
    o = o || {};
    var portrait = o.portrait ? '<div class="cf-vn-portrait" style="background-image:url(\'' + cfEsc(o.portrait).replace(/'/g, "%27") + '\')" role="img" aria-label="' + cfEsc(o.name || "") + '"></div>' : "";
    return (
      '<div class="cf-vn' + (o.side === "right" ? " right" : "") + (portrait ? "" : " no-portrait") + '">' + portrait +
      '<div class="cf-vn-box">' + (o.name ? '<div class="cf-vn-name">' + cfEsc(o.name) + "</div>" : "") +
      '<div class="cf-vn-text">' + cfEsc(o.text) + "</div>" +
      (o.choices && o.choices.length
        ? '<div class="cf-vn-choices">' + o.choices.map(function (c) { return cfUi.button(c.label, c); }).join("") + "</div>"
        : o.more ? '<span class="cf-vn-more" aria-hidden="true">▼</span>' : "") +
      "</div></div>"
    );
  },
  /**
   * A map with pins: an image (or the theme's plain ground) and pins at x/y percentages. A pin
   * takes the button options (send, payload, text, open) to act when tapped.
   */
  map: function (o) {
    o = o || {};
    var bg = o.image ? ' style="background-image:url(\'' + cfEsc(o.image).replace(/'/g, "%27") + '\')"' : "";
    return (
      '<div class="cf-map' + (o.image ? "" : " plain") + '"' + bg + ' role="group" aria-label="' + cfEsc(o.label || "Map") + '">' +
      (o.pins || []).map(function (p) {
        var attrs = "";
        if (p.send) attrs += ' data-cf-send="' + cfEsc(p.send) + '" data-cf-payload="' + cfEsc(JSON.stringify(p.payload == null ? null : p.payload)) + '"' + (p.text ? ' data-cf-text="' + cfEsc(p.text) + '"' : "") + (p.now ? " data-cf-now" : "");
        if (p.open) attrs += ' data-cf-open="' + cfEsc(p.open) + '"';
        var x = Math.max(0, Math.min(100, Number(p.x) || 0));
        var y = Math.max(0, Math.min(100, Number(p.y) || 0));
        return '<button type="button" class="cf-pin' + (p.here ? " here" : "") + (p.locked ? " locked" : "") + '" style="left:' + x + "%;top:" + y + '%"' + attrs + (p.locked ? " disabled" : "") + ' aria-label="' + cfEsc(p.label) + (p.here ? ", you are here" : "") + '">' +
          '<span class="cf-pin-dot">' + cfUi.icon(p.icon || (p.here ? "user" : "map")) + '</span><span class="cf-pin-label">' + cfEsc(p.label) + "</span></button>";
      }).join("") +
      "</div>"
    );
  },
  /** A timeline: events top to bottom, done ones ticked and the current one marked. */
  timeline: function (items) {
    return (
      '<ol class="cf-timeline">' +
      (items || []).map(function (i) {
        return '<li class="cf-tl-item' + (i.done ? " done" : "") + (i.current ? " current" : "") + '"' + (i.current ? ' aria-current="step"' : "") + '><span class="cf-tl-dot">' + (i.done ? cfUi.icon("check") : "") + "</span>" +
          '<div class="cf-tl-body"><div class="cf-spread"><b>' + cfEsc(i.title) + "</b>" + (i.time ? '<span class="cf-small cf-muted">' + cfEsc(i.time) + "</span>" : "") + "</div>" +
          (i.sub ? '<div class="cf-small cf-muted">' + cfEsc(i.sub) + "</div>" : "") + "</div></li>";
      }).join("") +
      "</ol>"
    );
  },
  /** A card that flips over when tapped: `front` and `back` are HTML. */
  flip: function (o) {
    o = o || {};
    return (
      '<button type="button" class="cf-flip' + (o.flipped ? " flipped" : "") + '" data-cf-flip aria-pressed="' + !!o.flipped + '" aria-label="' + cfEsc(o.label || "Card") + '">' +
      '<span class="cf-flip-inner"><span class="cf-flip-face cf-flip-front">' + (o.front || "") + '</span><span class="cf-flip-face cf-flip-back">' + (o.back || "") + "</span></span></button>"
    );
  },
  appBar: function (title, o) {
    o = o || {};
    return (
      '<div class="cf-appbar">' + (o.back ? '<button type="button" class="cf-btn ghost" data-cf-back aria-label="Back">' + cfUi.icon("back") + "</button>" : "") +
      "<h1>" + cfEsc(title) + "</h1>" + (o.close ? '<button type="button" class="cf-btn ghost" data-cf-close aria-label="Close">' + cfUi.icon("close") + "</button>" : "") + "</div>"
    );
  },
};

// ---------------------------------------------------------------- screens

/**
 * Sets a screen up: theme and kit, the delegated controls (tabs, actions, back, close), and an `app`
 * object bound to the screen's message. Listeners go away with the screen.
 */
function cfFrame(win, options) {
  options = options || {};
  var doc = win.document;
  var messageId = options.messageId;
  if (messageId === undefined) {
    try {
      messageId = typeof win.getCurrentMessageId === "function" ? win.getCurrentMessageId() : "latest";
    } catch (e) {
      messageId = "latest";
    }
  }
  var cleanups = [];
  function listen(event, fn) {
    eventOn(event, fn);
    cleanups.push(function () {
      eventRemoveListener(event, fn);
    });
  }
  win.addEventListener("pagehide", function () {
    cleanups.splice(0).forEach(function (f) {
      try {
        f();
      } catch (e) {}
    });
  });

  cfStyle(doc);
  listen("cf:settings", function (settings) {
    cfStyle(doc, settings);
  });

  var routes = null;
  var history = [];
  var routeRoot = null;
  function render(entry) {
    var out = routes[entry.name](entry.params || {}, app);
    if (typeof out === "string") routeRoot.innerHTML = out;
    routeRoot.scrollTop = 0;
  }
  function go(name, params) {
    if (!routes || !routes[name]) throw new Error("No screen named '" + name + "'.");
    history.push({ name: name, params: params });
    render(history[history.length - 1]);
  }
  function back() {
    if (history.length < 2) return false;
    history.pop();
    render(history[history.length - 1]);
    return true;
  }
  /** Draws the current page again (after a state change), keeping the scroll. */
  function refresh() {
    if (!routes || !history.length) return;
    var top = routeRoot.scrollTop;
    var scroller = routeRoot.querySelector(".cf-appbody");
    var inner = scroller ? scroller.scrollTop : 0;
    render(history[history.length - 1]);
    routeRoot.scrollTop = top;
    scroller = routeRoot.querySelector(".cf-appbody");
    if (scroller) scroller.scrollTop = inner;
  }

  /** A dialog or drawer on this screen's document: closed by its backdrop, Escape or data-cf-close. */
  function cfSheet(cls, html, label) {
    var back = doc.createElement("div");
    back.className = "cf-modal-back" + (/drawer/.test(cls) ? " cf-drawer-back" : "");
    back.innerHTML = '<div class="' + cls + ' cf-card" role="dialog" aria-modal="true"' + (label ? ' aria-label="' + cfEsc(label) + '"' : "") + ' tabindex="-1">' + html + "</div>";
    var before = doc.activeElement;
    function close() {
      back.remove();
      doc.removeEventListener("keydown", key);
      if (before && before.focus) before.focus();
    }
    function key(e) {
      if (e.key === "Escape") close();
    }
    back.addEventListener("click", function (e) {
      if (e.target === back || (e.target.closest && e.target.closest("[data-cf-close]"))) {
        e.stopPropagation();
        close();
      }
    });
    doc.addEventListener("keydown", key);
    doc.body.appendChild(back);
    var box = back.firstChild;
    if (box && box.focus) box.focus();
    back.close = close;
    return back;
  }

  var app = {
    window: win,
    document: doc,
    messageId: messageId,
    ui: cfUi,
    fx: cfFx,
    settings: cfSettings,
    setSettings: cfSetSettings,
    asset: cfAsset,
    assets: cfAssets,
    /** The game state at this screen's message (or one value by path). */
    state: function (path) {
      return cfRead(path, messageId);
    },
    /** What changed in this screen's message: { "Player.Health": [old, new] }. */
    delta: function () {
      return cfData(messageId).delta_data || {};
    },
    set: cfPlayerSet,
    /** Several changes in one write and one log line: [[path, value], ...]. */
    setMany: cfPlayerSetMany,
    send: cfSend,
    /** Adds plain text to the input box; with { now: true } sends it. */
    write: cfWriteInput,
    open: cfOpen,
    close: cfClose,
    /** Runs `fn` when the state changes (updates, swipes, the player's edits). */
    onState: function (fn) {
      [CF_EVENTS.VARIABLE_UPDATE_ENDED, "cf:state", tavern_events.MESSAGE_SWIPED, tavern_events.MESSAGE_DELETED].forEach(function (event) {
        listen(event, function () {
          setTimeout(fn, 0);
        });
      });
    },
    on: function (name, fn) {
      listen("cf:" + name, fn);
    },
    emit: function (name, detail) {
      return eventEmit("cf:" + name, detail);
    },
    /** A short message at the top. { kind: "good" | "bad", icon, ms }. */
    toast: function (text, o) {
      o = o || {};
      var box = doc.querySelector(".cf-toasts");
      if (!box) {
        box = doc.createElement("div");
        box.className = "cf-toasts";
        doc.body.appendChild(box);
      }
      var el = doc.createElement("div");
      el.className = "cf-toast" + (o.kind === "good" || o.kind === "bad" ? " " + o.kind : "");
      el.setAttribute("role", "status");
      el.innerHTML = (o.icon ? cfUi.icon(o.icon) + " " : "") + cfEsc(text);
      box.appendChild(el);
      win.setTimeout(function () {
        el.remove();
      }, o.ms || 2600);
      return el;
    },
    /** A dialog over this screen. { title } adds a heading and a close button. Escape, the backdrop or data-cf-close closes it. */
    modal: function (html, o) {
      o = o || {};
      return cfSheet("cf-modal", (o.title ? '<div class="cf-spread"><h2>' + cfEsc(o.title) + '</h2><button type="button" class="cf-btn ghost" data-cf-close aria-label="Close">' + cfUi.icon("close") + "</button></div>" : "") + html, o.title);
    },
    /** A panel that slides in from the side ("right", the default, or "left") or the "bottom". */
    drawer: function (html, o) {
      o = o || {};
      var side = o.side === "left" || o.side === "bottom" ? o.side : "right";
      return cfSheet("cf-drawer " + side, (o.title ? '<div class="cf-spread"><h2>' + cfEsc(o.title) + '</h2><button type="button" class="cf-btn ghost" data-cf-close aria-label="Close">' + cfUi.icon("close") + "</button></div>" : "") + html, o.title);
    },
    /** A router for app-like screens: routes are functions (params, app) returning HTML. */
    router: function (root, table, start, params) {
      routes = table;
      routeRoot = root;
      history = [];
      go(start, params);
      return { go: go, back: back, refresh: refresh };
    },
  };
  app.go = go;
  app.back = back;

  doc.addEventListener("click", function (e) {
    var target = e.target && e.target.closest ? e.target : null;
    if (!target) return;
    var tab = target.closest("[data-cf-tab]");
    if (tab) {
      var set = tab.closest(".cf-tabset");
      var id = tab.getAttribute("data-cf-tab");
      set.querySelectorAll("[data-cf-tab]").forEach(function (t) {
        t.setAttribute("aria-selected", String(t === tab));
      });
      set.querySelectorAll("[data-cf-panel]").forEach(function (p) {
        p.hidden = p.getAttribute("data-cf-panel") !== id;
        if (!p.hidden) cfAnimate(p, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: cfReducedMotion(win) ? 0 : 160, easing: "ease-out" });
      });
      return;
    }
    var flip = target.closest("[data-cf-flip]");
    if (flip) {
      var on = !flip.classList.contains("flipped");
      flip.classList.toggle("flipped", on);
      flip.setAttribute("aria-pressed", String(on));
      return;
    }
    var slide = target.closest("[data-cf-slide], [data-cf-slide-to]");
    if (slide) {
      var carousel = slide.closest("[data-cf-carousel]");
      var track = carousel && carousel.querySelector(".cf-carousel-track");
      if (!track) return;
      var count = track.children.length;
      var at = Math.round(track.scrollLeft / (track.clientWidth || 1));
      var next = slide.hasAttribute("data-cf-slide-to") ? Number(slide.getAttribute("data-cf-slide-to")) : at + Number(slide.getAttribute("data-cf-slide"));
      next = (next + count) % count;
      if (typeof track.scrollTo === "function") track.scrollTo({ left: next * track.clientWidth, behavior: cfReducedMotion(win) ? "auto" : "smooth" });
      else track.scrollLeft = next * track.clientWidth;
      cfCarouselDots(carousel, next);
      return;
    }
    var send = target.closest("[data-cf-send]");
    if (send) {
      var payload = null;
      try {
        payload = JSON.parse(send.getAttribute("data-cf-payload") || "null");
      } catch (err) {}
      cfSend(send.getAttribute("data-cf-send"), payload, send.getAttribute("data-cf-text") || "", { now: send.hasAttribute("data-cf-now") });
      return;
    }
    var open = target.closest("[data-cf-open]");
    if (open) return cfOpen(open.getAttribute("data-cf-open"));
    if (target.closest("[data-cf-back]")) {
      if (!back()) cfClose();
      return;
    }
    if (target.closest("[data-cf-close]") && !target.closest(".cf-modal-back")) cfClose();
  });
  // Carousels' dots follow a swipe.
  doc.addEventListener(
    "scroll",
    function (e) {
      var track = e.target;
      if (!track || !track.classList || !track.classList.contains("cf-carousel-track")) return;
      cfCarouselDots(track.parentNode, Math.round(track.scrollLeft / (track.clientWidth || 1)));
    },
    true,
  );
  return app;
}

function cfCarouselDots(carousel, index) {
  if (!carousel) return;
  carousel.querySelectorAll("[data-cf-slide-to]").forEach(function (d) {
    if (Number(d.getAttribute("data-cf-slide-to")) === index) d.setAttribute("aria-current", "true");
    else d.removeAttribute("aria-current");
  });
}

/** Mounts a module's screen into an element of a document (by default the page's #cf-root). */
function cfMount(win, moduleId, root, options) {
  var mod = cfModule(moduleId);
  var doc = win.document;
  root = root || doc.getElementById("cf-root") || doc.body;
  if (!mod) {
    root.textContent = "This card's '" + moduleId + "' module is turned off or missing.";
    return null;
  }
  var app = (options && options.app) || cfFrame(win, options);
  if (mod.css) {
    var style = doc.createElement("style");
    style.setAttribute("data-cf-module", mod.id);
    style.textContent = mod.css;
    (doc.head || doc.documentElement).appendChild(style);
  }
  root.setAttribute("data-cf-module", mod.id);
  root.innerHTML = mod.html || "";
  if (mod.js) {
    try {
      new win.Function("CF", "app", "root", "settings", mod.js)(CardForgeApi, app, root, cfClone(mod.settings || {}));
    } catch (e) {
      win.console.error("[CardForge] The '" + mod.name + "' module failed: " + (e && e.message ? e.message : e), e);
    }
  }
  return app;
}

/** Mounts every module of a slot, one section each, under `el`. */
function cfMountSlot(win, slot, el, options) {
  var app = (options && options.app) || cfFrame(win, options);
  cfModules()
    .filter(function (m) {
      return m.slot === slot;
    })
    .forEach(function (m) {
      var section = win.document.createElement("section");
      section.className = "cf-slot cf-slot-" + slot;
      el.appendChild(section);
      cfMount(win, m.id, section, { app: app });
    });
  return app;
}

/** The page for a module's screen: it finds the core and mounts the module. */
function cfScreenDoc(moduleId) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    // The screen fills the overlay, on the theme's background.
    "<style>html, body { height: 100%; margin: 0; background: var(--cf-bg, #111); } #cf-root { min-height: 100%; display: flex; flex-direction: column; } #cf-root > .cf-app { flex: 1 0 auto; }</style>" +
    '</head><body><div id="cf-root"></div><' + CF_SCRIPT_TAG + ">(function () {" +
    "function core() { try { return window.CardForge || window.parent.CardForge; } catch (e) { return null; } }" +
    "var n = 0; (function go() { var CF = core(); if (CF) CF.mount(window, " + JSON.stringify(moduleId) + "); else if (n++ < 100) setTimeout(go, 100); })();" +
    "})();</" + CF_SCRIPT_TAG + "></body></html>"
  );
}

function cfClose() {
  if (!cfOverlay) return;
  var overlay = cfOverlay;
  cfOverlay = null;
  overlay.remove();
  eventEmit("cf:closed");
}

/** Opens a module's screen over the chat (the hub buttons do this). "status" opens the status panel. */
var cfOpenParams = {};

/** `params` reach the opened screen through CF.openParams(), like which tab to start on. */
function cfOpen(moduleId, params) {
  var doc = cfHost().document;
  cfOpenParams = params && typeof params === "object" ? params : {};
  // A screen opening another (the menu's tiles) runs in the frame being replaced: that frame goes
  // only once the new one is written, or the new screen's page never starts.
  var previous = cfOverlay;
  cfOverlay = null;
  var mod = moduleId === "status" ? { id: "status", name: CF_CONFIG.panelTitle || "Status" } : cfModule(moduleId);
  if (!mod) {
    cfOverlay = previous;
    throw new Error("No module '" + moduleId + "' to open.");
  }
  var back = doc.createElement("div");
  back.id = "cf-overlay";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-label", mod.name);
  back.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:12px;";
  var box = doc.createElement("div");
  box.style.cssText = "position:relative;width:min(460px,100%);height:min(780px,100%);border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);background:#111;";
  var frame = doc.createElement("iframe");
  frame.title = mod.name;
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;";
  var close = doc.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.style.cssText = "position:absolute;top:6px;right:8px;z-index:2;width:32px;height:32px;border-radius:50%;border:0;background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:1;cursor:pointer;";
  close.addEventListener("click", cfClose);
  back.addEventListener("click", function (e) {
    if (e.target === back) cfClose();
  });
  box.appendChild(frame);
  box.appendChild(close);
  back.appendChild(box);
  doc.body.appendChild(back);
  cfOverlay = back;
  // The status panel opened full size: on the theme's background, clear of the close button.
  var html = moduleId === "status"
    ? CF_CONFIG.panelDoc.replace("</head>", "<style>html { min-height: 100%; background: var(--cf-bg, #111); } body { padding: 48px 12px 12px; }</style></head>")
    : cfScreenDoc(moduleId);
  var fdoc = frame.contentDocument;
  fdoc.open();
  fdoc.write(html);
  fdoc.close();
  if (previous) {
    previous.remove();
    eventEmit("cf:closed");
  }
  eventEmit("cf:opened", moduleId);
  return frame;
}

// ---------------------------------------------------------------- assets

/** A card image: CHARX assets land in /user/images/<character>/ when the card is imported. */
function cfAsset(file) {
  var name = String(file || "").replace(/^.*[\\/]/, "");
  try {
    var override = cfHost().CF_ASSETS;
    if (override && override[name]) return override[name];
  } catch (e) {}
  return "/user/images/" + encodeURIComponent(CF_CONFIG.charName || "") + "/" + encodeURIComponent(name);
}

// ---------------------------------------------------------------- art by meaning

// The card's tagged images (CF_CONFIG.assets): { s: subject, k: kind, v: variant, f: file, u: path }.
// Screens ask by meaning and get the closest fit, or null when the card has nothing that fits.
var CF_MOOD_FAMILIES = [
  ["joy", "amusement", "excitement", "optimism", "pride", "relief", "approval", "gratitude"],
  ["love", "caring", "desire", "admiration"],
  ["sadness", "grief", "disappointment", "remorse"],
  ["anger", "annoyance", "disapproval", "disgust"],
  ["fear", "nervousness", "embarrassment"],
  ["surprise", "realization", "confusion", "curiosity"],
  ["neutral"],
];

function cfAssetList() {
  return Array.isArray(CF_CONFIG.assets) ? CF_CONFIG.assets : [];
}

function cfLow(s) {
  return String(s || "").trim().toLowerCase();
}

function cfAssetUrl(entry) {
  if (!entry) return null;
  try {
    var override = cfHost().CF_ASSETS;
    if (override && override[entry.f]) return override[entry.f];
  } catch (e) {}
  return entry.u;
}

/** Entries of a kind (and subject), best first by how well the variant fits. */
function cfAssetFind(q) {
  q = q || {};
  var list = cfAssetList().filter(function (e) {
    if (q.kind && [].concat(q.kind).indexOf(e.k) < 0) return false;
    if (q.subject !== undefined && cfLow(e.s) !== cfLow(q.subject)) return false;
    return true;
  });
  if (!q.variant) return list[0] || null;
  var want = cfLow(q.variant);
  return (
    list.find(function (e) { return cfLow(e.v) === want; }) ||
    list.find(function (e) { return e.v && (cfLow(e.v).indexOf(want) >= 0 || want.indexOf(cfLow(e.v)) >= 0); }) ||
    null
  );
}

function cfClosestMood(mood) {
  var m = cfLow(mood);
  var family = CF_MOOD_FAMILIES.find(function (f) { return f.indexOf(m) >= 0; });
  return family ? family.filter(function (x) { return x !== m; }) : [];
}

var cfAssets = {
  list: function (kind) {
    return cfAssetList().filter(function (e) { return !kind || e.k === kind; }).map(function (e) {
      return { subject: e.s, kind: e.k, variant: e.v || "", url: cfAssetUrl(e) };
    });
  },
  find: function (q) {
    return cfAssetUrl(cfAssetFind(q));
  },
  /** A character's picture: the emotion asked for, then a close one, then their portrait. */
  portrait: function (name, opts) {
    opts = opts || {};
    var hit = null;
    if (opts.emotion) {
      hit = cfAssetFind({ kind: "emotion", subject: name, variant: opts.emotion });
      var near = cfClosestMood(opts.emotion);
      for (var i = 0; !hit && i < near.length; i++) hit = cfAssetFind({ kind: "emotion", subject: name, variant: near[i] });
    }
    if (!hit && opts.outfit) hit = cfAssetFind({ kind: "outfit", subject: name, variant: opts.outfit });
    if (!hit) hit = cfAssetFind({ kind: "portrait", subject: name });
    if (!hit) hit = cfAssetFind({ kind: "emotion", subject: name, variant: "neutral" }) || cfAssetFind({ kind: "emotion", subject: name });
    return cfAssetUrl(hit);
  },
  /** A place at a time of day ("night", "Evening"), then the place at any time. */
  background: function (place, time) {
    var hit = (time && cfAssetFind({ kind: "background", subject: place, variant: time })) || cfAssetFind({ kind: "background", subject: place });
    return cfAssetUrl(hit);
  },
  icon: function (name) {
    return cfAssetUrl(cfAssetFind({ kind: "icon", subject: name }));
  },
  /** Engine art by what it is: "title", "map", "wallpaper". */
  scene: function (variant) {
    return cfAssetUrl(cfAssetFind({ kind: ["scene", "ui"], variant: variant }));
  },
};

// ---------------------------------------------------------------- older panels freeze

// A live iframe per reply is heavy on phones. Panels older than the player's "panels kept live"
// become still copies: the same look, drawn in a shadow root, with no script and no iframe.
function cfStillCss(css) {
  return css
    .replace(/(^|[\s,}])(?::root|html)(?=[\s,{.:])/g, "$1:host")
    .replace(/(^|[\s,}])body(?=[\s,{.:])/g, "$1.cf-body");
}

function cfFreeze(frame, id) {
  var fdoc;
  try {
    fdoc = frame.contentDocument;
  } catch (e) {
    return false;
  }
  var panel = fdoc && fdoc.getElementById("cf-panel");
  // Only a panel that has drawn: a blank copy would be worse than a live one.
  if (!panel || !fdoc.getElementById("cf-stats") || !fdoc.getElementById("cf-stats").children.length) return false;
  var doc = frame.ownerDocument;
  var still = doc.createElement("div");
  still.className = "cf-still";
  still.setAttribute("data-cf-still", String(id));
  var css = Array.prototype.map.call(fdoc.querySelectorAll("style"), function (s) { return s.textContent; }).join("\n");
  var body = fdoc.body.cloneNode(true);
  Array.prototype.forEach.call(body.querySelectorAll(CF_SCRIPT_TAG + ", button, iframe"), function (el) {
    if (el.tagName === "BUTTON") el.setAttribute("disabled", "");
    else el.remove();
  });
  var shadow = still.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" + cfStillCss(css) + " :host { display: block; }</style>" + '<div class="cf cf-body">' + body.innerHTML + "</div>";
  frame.replaceWith(still);
  return true;
}

function cfFreezePanels() {
  var keep = Number(cfSettings().livePanels);
  if (!keep || keep < 0) return 0;
  var doc = cfHost().document;
  var latest = getLastMessageId();
  var n = 0;
  Array.prototype.forEach.call(doc.querySelectorAll(".mes[mesid] iframe"), function (frame) {
    var id = Number(frame.closest(".mes[mesid]").getAttribute("mesid"));
    if (id > latest - keep) return;
    if (cfFreeze(frame, id)) n++;
  });
  return n;
}

var cfFreezeTimer = null;
function cfFreezeSoon() {
  clearTimeout(cfFreezeTimer);
  cfFreezeTimer = setTimeout(function () {
    try {
      cfFreezePanels();
    } catch (e) {
      console.warn("[CardForge] Couldn't freeze old panels.", e);
    }
  }, 1500);
}

// ---------------------------------------------------------------- hooks and start

/** Modules that keep derived values (the clock, routines) change the state after each update. */
function cfRunHooks(stat, before, messageId) {
  var out = stat;
  var latest = true;
  var role = "";
  try {
    latest = messageId === undefined || messageId === null || messageId >= getLastMessageId();
    var message = typeof messageId === "number" ? getChatMessages(messageId)[0] : null;
    role = (message && message.role) || "";
  } catch (e) {}
  cfHooks.forEach(function (hook) {
    try {
      var next = hook.fn(out, before, { messageId: messageId, latest: latest, role: role, settings: hook.settings });
      if (cfIsObject(next)) out = next;
    } catch (e) {
      console.error("[CardForge] The '" + hook.module + "' module's update hook failed.", e);
    }
  });
  return out;
}

var CardForgeApi = {
  version: CF_CONFIG.version,
  ui: cfUi,
  fx: cfFx,
  frame: cfFrame,
  mount: cfMount,
  mountSlot: cfMountSlot,
  open: cfOpen,
  /** What the latest open() passed, like { tab: "gallery" }. */
  openParams: function () {
    return cfOpenParams;
  },
  close: cfClose,
  asset: cfAsset,
  assets: cfAssets,
  settings: cfSettings,
  setSettings: cfSetSettings,
  themeCss: cfThemeCss,
  freezePanels: cfFreezePanels,
  /** With side-call updates on: about how many tokens each one costs. Otherwise null. */
  sideCall: function () {
    return CF_CONFIG.side ? { tokens: CF_CONFIG.side.tokens } : null;
  },
  /** Whether the card has a status panel ("status" opens it). */
  hasPanel: function () {
    return !!CF_CONFIG.panelDoc;
  },
  modules: function () {
    return cfModules().map(function (m) {
      return { id: m.id, name: m.name, slot: m.slot, button: m.button || "" };
    });
  },
  state: {
    get: cfRead,
    latestId: cfLatestId,
    set: cfPlayerSet,
    setMany: cfPlayerSetMany,
    reset: cfPlayerReset,
  },
  act: { send: cfSend, text: cfActionText, write: cfWriteInput },
  keep: { get: cfKeepGet, set: cfKeepSet, add: cfKeepAdd },
  bus: {
    on: function (name, fn) {
      eventOn("cf:" + name, fn);
      return function () {
        eventRemoveListener("cf:" + name, fn);
      };
    },
    emit: function (name, detail) {
      return eventEmit("cf:" + name, detail);
    },
  },
};

function cfStartHub() {
  var buttons = [];
  // A menu that collects the hub keeps the input box clear: everything opens from it.
  var menu = cfModules().find(function (m) {
    return m.slot === "overlay" && m.button && m.settings && m.settings.only === true && m.id === "menu";
  });
  if (menu) buttons.push({ name: menu.button, open: menu.id });
  else {
    if (CF_CONFIG.panelDoc) buttons.push({ name: CF_CONFIG.statusButton || "📊 Status", open: "status" });
    cfModules().forEach(function (m) {
      if (m.slot === "overlay" && m.button) buttons.push({ name: m.button, open: m.id });
    });
  }
  if (!buttons.length || typeof replaceScriptButtons !== "function") return;
  try {
    replaceScriptButtons(
      buttons.map(function (b) {
        return { name: b.name, visible: true };
      }),
    );
    buttons.forEach(function (b) {
      eventOnButton(b.name, function () {
        cfOpen(b.open);
      });
    });
  } catch (e) {
    console.warn("[CardForge] The hub buttons didn't load.", e);
  }
}

function cfCoreStart() {
  initializeGlobal("CardForge", CardForgeApi);
  cfModules().forEach(function (m) {
    if (!m.script) return;
    try {
      var setup = new Function("CF", "settings", "hooks", m.script);
      setup(CardForgeApi, cfClone(m.settings || {}), {
        afterUpdate: function (fn) {
          cfHooks.push({ module: m.name, fn: fn, settings: m.settings || {} });
        },
      });
    } catch (e) {
      console.error("[CardForge] The '" + m.name + "' module didn't start.", e);
    }
  });
  cfStartHub();
  [tavern_events.CHARACTER_MESSAGE_RENDERED, tavern_events.USER_MESSAGE_RENDERED, tavern_events.CHAT_CHANGED, CF_EVENTS.VARIABLE_UPDATE_ENDED, "cf:settings"].forEach(function (event) {
    eventOn(event, cfFreezeSoon);
  });
  cfFreezeSoon();
}
