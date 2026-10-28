// CardForge moods and expressive portraits (CF.mood, CF.ui.portrait): the theme and the cast
// follow the game state.
//
// A mood (CF_CONFIG.theme.moods, set in the Look tab or by the engineer) turns on while a value
// matches: a text value from its list, a number in its range, or any true value. While it's on,
// its colours and texture replace the theme's, a tint lies over the screens and particles drift
// over the open screen; the colours fade from one mood to the next. A portrait bound to the state
// (CF_CONFIG.theme.portraits) shows the expression and outfit the values name, the closest
// tagged image when the exact one is missing, and crossfades when they change.
//
// Runs in the card's Tavern Helper script with the engine core. Less motion: no fades, no particles.

function cfMoodList() {
  return (CF_CONFIG.theme && Array.isArray(CF_CONFIG.theme.moods) && CF_CONFIG.theme.moods) || [];
}

function cfStatePath(stat, path) {
  try {
    return cfGet(stat, cfPath(path));
  } catch (e) {
    return undefined;
  }
}

/** Whether a mood is on for this state. */
function cfMoodOn(mood, stat) {
  var v = cfStatePath(stat, mood.path);
  if (v === undefined || v === null || v === "") return false;
  var ranged = mood.min !== undefined || mood.max !== undefined;
  if (mood.is && mood.is.length) {
    var t = String(v).trim().toLowerCase();
    var hit = mood.is.some(function (x) {
      return String(x).trim().toLowerCase() === t;
    });
    if (hit || !ranged) return hit;
  }
  if (ranged) {
    var n = Number(v);
    if (typeof v === "boolean" || !isFinite(n)) return false;
    return (mood.min === undefined || n >= mood.min) && (mood.max === undefined || n <= mood.max);
  }
  return v !== false && v !== 0 && String(v).toLowerCase() !== "false";
}

/** The moods on at a message ("latest" by default), in order. */
function cfMoodActive(messageId) {
  var moods = cfMoodList();
  if (!moods.length) return [];
  var stat = cfRead(undefined, messageId === undefined ? "latest" : messageId) || {};
  return moods.filter(function (m) {
    return cfMoodOn(m, stat);
  });
}

// The colour tokens fade between moods: they're registered as colours in the kit.
var CF_MOOD_FADE = ["bg", "surface", "surface2", "text", "muted", "accent", "accent2", "border", "good", "bad"]
  .map(function (k) {
    return "--cf-" + k + " .9s ease";
  })
  .join(", ");

/** States that the mood and the portraits follow. */
function cfStateEvents() {
  var list = ["cf:state"];
  try {
    list.push(CF_EVENTS.VARIABLE_UPDATE_ENDED, tavern_events.MESSAGE_SWIPED, tavern_events.MESSAGE_DELETED);
  } catch (e) {}
  return list;
}

/** Whether a screen shows the newest state: an open screen or the latest message's panel. */
function cfScreenIsLatest(messageId) {
  if (messageId === undefined || messageId === "latest") return true;
  try {
    return Number(messageId) >= cfLatestId();
  } catch (e) {
    return true;
  }
}

/**
 * Puts the moods on at a screen's message into its document: their tokens, the tint and (on the
 * latest screen) the ambience. Changes fade unless the player wants less motion.
 */
function cfMoodApply(doc, messageId) {
  if (!doc || !doc.body) return [];
  var state = doc.cfMoodState || (doc.cfMoodState = { key: null, ambience: "", stop: null });
  var moods = cfMoodList().length ? cfMoodActive(messageId) : [];
  var reduced = cfReducedMotion(doc.defaultView);
  var ids = moods.map(function (m) {
    return m.id;
  });
  var key = ids.join(" ") + (reduced ? "|r" : "");
  if (key === state.key) return moods;
  var first = state.key === null;
  state.key = key;
  if (first && !moods.length) return moods;

  var style = doc.getElementById("cf-mood");
  if (!style) {
    style = doc.createElement("style");
    style.id = "cf-mood";
    (doc.head || doc.documentElement).appendChild(style);
  }
  var vars = moods
    .map(function (m) {
      return m.vars;
    })
    .filter(Boolean)
    .join("; ");
  style.textContent = (vars ? ":root { " + vars + "; }" : "") + (!first && !reduced ? "\n:root { transition: " + CF_MOOD_FADE + "; }" : "");
  if (ids.length) doc.body.setAttribute("data-cf-mood", ids.join(" "));
  else doc.body.removeAttribute("data-cf-mood");

  // The tint: the last mood that has one.
  var tint = null;
  moods.forEach(function (m) {
    if (m.tint) tint = m.tint;
  });
  var layer = doc.querySelector(".cf-mood-tint");
  if (tint && !layer) {
    layer = doc.createElement("div");
    layer.className = "cf-mood-tint";
    layer.setAttribute("aria-hidden", "true");
    doc.body.appendChild(layer);
  }
  if (layer) {
    if (tint) layer.style.background = tint.color;
    layer.style.opacity = tint ? String(tint.strength) : "0";
  }

  // The ambience: the last mood's, on the newest screen only.
  var ambience = "";
  if (!reduced && cfScreenIsLatest(messageId))
    moods.forEach(function (m) {
      if (m.ambience) ambience = m.ambience;
    });
  if (ambience !== state.ambience) {
    if (state.stop) state.stop();
    state.stop = ambience ? cfFx.particles(doc.body, ambience, { count: Math.round(CF_FX_KINDS[ambience].count * 0.6) }) : null;
    if (state.stop) {
      var fx = doc.body.lastElementChild;
      if (fx && fx.classList.contains("cf-fx-layer")) fx.classList.add("cf-mood-ambience");
    }
    state.ambience = ambience;
  }
  return moods;
}

// ---------------------------------------------------------------- expressive portraits

function cfPortraitBindings() {
  return (CF_CONFIG.theme && Array.isArray(CF_CONFIG.theme.portraits) && CF_CONFIG.theme.portraits) || [];
}

function cfPortraitBinding(name) {
  var n = cfLow(name);
  return (
    cfPortraitBindings().find(function (b) {
      return cfLow(b.name) === n;
    }) || null
  );
}

/**
 * The emotion and outfit a character shows at a message: what's asked for, else what their
 * binding's values say (hurt wins over the emotion value while the health value is low).
 */
function cfPortraitLook(name, o, messageId) {
  o = o || {};
  var b = o.follow || cfPortraitBinding(name) || {};
  var stat = b.emotion || b.outfit || b.hurt ? cfRead(undefined, messageId === undefined ? "latest" : messageId) || {} : {};
  var emotion = o.emotion !== undefined ? o.emotion : b.emotion ? cfStatePath(stat, b.emotion) : "";
  var outfit = o.outfit !== undefined ? o.outfit : b.outfit ? cfStatePath(stat, b.outfit) : "";
  if (o.emotion === undefined && b.hurt) {
    var h = cfStatePath(stat, b.hurt.path);
    if (h !== undefined && h !== null && h !== "" && Number(h) < Number(b.hurt.below)) emotion = b.hurt.emotion || "hurt";
  }
  return { emotion: emotion == null ? "" : String(emotion), outfit: outfit == null ? "" : String(outfit) };
}

/** The picture for a look: emotion in the outfit, the emotion or a close one, the outfit, the portrait. */
function cfPortraitUrl(name, look) {
  if (look.emotion && look.outfit) {
    var both = cfAssetFind({ kind: "emotion", subject: name, variant: look.emotion + " " + look.outfit }) || cfAssetFind({ kind: "outfit", subject: name, variant: look.outfit + " " + look.emotion });
    if (both) return cfAssetUrl(both);
  }
  return cfAssets.portrait(name, { emotion: look.emotion || undefined, outfit: look.outfit || undefined });
}

function cfPortraitImg(url) {
  return '<span class="cf-portrait-img" style="background-image:url(\'' + cfEsc(url).replace(/'/g, "%27") + "')\"></span>";
}

/**
 * A character's portrait as markup. { emotion, outfit } pick the look; without them it follows the
 * card's portrait binding (or { follow: { emotion: path, outfit: path, hurt } }) and changes by
 * itself when the state does. { size: "s" | "m" | "l" }, { shape: "round" | "tall" }.
 */
function cfPortraitHtml(name, o, messageId) {
  o = o || {};
  name = String(name || "");
  var look = cfPortraitLook(name, o, messageId);
  var url = cfPortraitUrl(name, look);
  var live = o.emotion === undefined && o.outfit === undefined && !!(o.follow || cfPortraitBinding(name));
  var size = o.size === "s" || o.size === "l" ? o.size : "m";
  return (
    '<span class="cf-portrait ' + size + (o.shape === "tall" ? " tall" : "") + (url ? "" : " letter") + '" role="img" aria-label="' + cfEsc(name + (look.emotion ? ", " + look.emotion : "")) + '"' +
    ' data-cf-portrait="' + cfEsc(name) + '" data-cf-url="' + cfEsc(url || "") + '"' +
    (live ? ' data-cf-live=""' + (o.follow ? " data-cf-follow='" + cfEsc(JSON.stringify(o.follow)).replace(/'/g, "&#39;") + "'" : "") : "") +
    ">" +
    (url ? cfPortraitImg(url) : '<span class="cf-portrait-letter">' + cfEsc(name.trim().charAt(0).toUpperCase() || "?") + "</span>") +
    "</span>"
  );
}

/** Fades a portrait element to a new picture (or swaps it at once with less motion). */
function cfPortraitSwap(el, url, fromUrl) {
  var doc = el.ownerDocument;
  var reduced = cfReducedMotion(doc.defaultView);
  if (!url) {
    el.classList.add("letter");
    el.innerHTML = '<span class="cf-portrait-letter">' + cfEsc((el.getAttribute("data-cf-portrait") || "?").trim().charAt(0).toUpperCase()) + "</span>";
    el.setAttribute("data-cf-url", "");
    return;
  }
  el.classList.remove("letter");
  el.setAttribute("data-cf-url", url);
  if (reduced || !fromUrl) {
    el.innerHTML = cfPortraitImg(url);
    return;
  }
  // The old picture stays on top and fades out over the new one.
  el.innerHTML = cfPortraitImg(url) + cfPortraitImg(fromUrl);
  var old = el.lastChild;
  old.classList.add("old");
  cfAnimate(old, [{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: "ease" }).then(function () {
    if (old.parentNode) old.remove();
  });
}

/** Live portraits on a screen take the look of the screen's state. */
function cfPortraitRefresh(doc, messageId) {
  doc.cfPortraitsShown = doc.cfPortraitsShown || {};
  Array.prototype.forEach.call(doc.querySelectorAll("[data-cf-portrait][data-cf-live]"), function (el) {
    var follow = null;
    try {
      follow = JSON.parse(el.getAttribute("data-cf-follow") || "null");
    } catch (e) {}
    var name = el.getAttribute("data-cf-portrait");
    var look = cfPortraitLook(name, follow ? { follow: follow } : {}, messageId);
    var url = cfPortraitUrl(name, look) || "";
    var was = el.getAttribute("data-cf-url") || "";
    el.setAttribute("aria-label", name + (look.emotion ? ", " + look.emotion : ""));
    if (url !== was) cfPortraitSwap(el, url, was);
    doc.cfPortraitsShown[name] = url;
  });
}

/**
 * A redraw puts a new portrait element in: when the same character showed another picture a moment
 * ago, it fades from that one.
 */
function cfPortraitWatch(doc) {
  doc.cfPortraitsShown = doc.cfPortraitsShown || {};
  var win = doc.defaultView;
  if (!win || typeof win.MutationObserver !== "function") return null;
  var observer = new win.MutationObserver(function (records) {
    records.forEach(function (r) {
      Array.prototype.forEach.call(r.addedNodes, function (node) {
        if (node.nodeType !== 1) return;
        var found = node.matches("[data-cf-portrait]") ? [node] : [];
        found = found.concat(Array.prototype.slice.call(node.querySelectorAll("[data-cf-portrait]")));
        found.forEach(function (el) {
          var name = el.getAttribute("data-cf-portrait");
          var url = el.getAttribute("data-cf-url") || "";
          var before = doc.cfPortraitsShown[name];
          doc.cfPortraitsShown[name] = url;
          if (before && url && before !== url && !el.querySelector(".old")) cfPortraitSwap(el, url, before);
        });
      });
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return observer;
}

/** Sets a screen's document up to follow the moods and live portraits; `listen` ties listeners to the screen. */
function cfLivingStart(doc, messageId, listen) {
  if (!doc.body) return;
  cfMoodApply(doc, messageId);
  var observer = cfPortraitWatch(doc);
  var follow = function () {
    setTimeout(function () {
      cfMoodApply(doc, messageId);
      cfPortraitRefresh(doc, messageId);
    }, 0);
  };
  cfStateEvents().concat("cf:settings").forEach(function (event) {
    listen(event, follow);
  });
  return function () {
    if (observer) observer.disconnect();
    if (doc.cfMoodState && doc.cfMoodState.stop) doc.cfMoodState.stop();
  };
}

var cfMood = {
  /** The moods on now (or at a message): [{ id, name }]. */
  active: function (messageId) {
    return cfMoodActive(messageId).map(function (m) {
      return { id: m.id, name: m.name };
    });
  },
  /** Whether a mood (by id or name) is on. */
  is: function (idOrName, messageId) {
    var want = cfLow(idOrName);
    return cfMoodActive(messageId).some(function (m) {
      return m.id === want || cfLow(m.name) === want;
    });
  },
  /** Every mood the card has: [{ id, name, path }]. */
  list: function () {
    return cfMoodList().map(function (m) {
      return { id: m.id, name: m.name, path: m.path };
    });
  },
  /** The look a character's portrait shows: { emotion, outfit }. */
  look: function (name, messageId) {
    return cfPortraitLook(name, {}, messageId);
  },
};
