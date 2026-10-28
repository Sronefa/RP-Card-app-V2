// CardForge effects kit (CF.fx): weather and particles, shake and flash, glow and pulse, typed
// text, count-ups, page transitions and parallax. One call each, on an element of a screen.
//
// Runs in the card's Tavern Helper script with the engine core. Every effect animates only
// transform and opacity, stops with its screen, and does nothing (or jumps to the end) when the
// player wants less motion: the settings app's Motion choice, else the device's reduced-motion
// setting. Nothing here loads from the network.

var CF_FX_KINDS = {
  rain: { count: 46, life: [0.5, 0.9], size: [1, 2] },
  snow: { count: 34, life: [6, 11], size: [3, 7] },
  embers: { count: 22, life: [3, 6], size: [2, 5] },
  petals: { count: 18, life: [6, 10], size: [8, 13] },
  dust: { count: 20, life: [8, 14], size: [1, 3] },
};

function cfWin(el) {
  return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
}

/** Whether the player wants less motion: their setting, else the device's. */
function cfReducedMotion(win) {
  var mode = cfSettings().motion;
  if (mode === "reduce") return true;
  if (mode === "full") return false;
  try {
    var w = win || window;
    return !!(w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
}

function cfRand(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}

/** A layer over `el` for effects, kept under its content's clicks. */
function cfFxLayer(el, cls) {
  var doc = el.ownerDocument;
  var layer = doc.createElement("div");
  layer.className = "cf-fx-layer " + cls;
  layer.setAttribute("aria-hidden", "true");
  var win = cfWin(el);
  if (el !== doc.body && win.getComputedStyle && win.getComputedStyle(el).position === "static") el.style.position = "relative";
  el.appendChild(layer);
  return layer;
}

/** Runs a Web Animation when there is one; resolves when it ends (at once without one). */
function cfAnimate(el, frames, options) {
  if (!el || typeof el.animate !== "function") return Promise.resolve();
  try {
    var a = el.animate(frames, options);
    return a.finished ? a.finished.then(function () {}, function () {}) : Promise.resolve();
  } catch (e) {
    return Promise.resolve();
  }
}

function cfNoop() {}

var cfFx = {
  /** Whether effects are cut down for this screen. */
  reduced: function (el) {
    return cfReducedMotion(el ? cfWin(el) : undefined);
  },

  /**
   * Weather and particles over an element: "rain", "snow", "embers", "petals" or "dust".
   * { count, color, speed } adjust it. Returns a function that stops it.
   */
  particles: function (el, kind, o) {
    o = o || {};
    var spec = CF_FX_KINDS[kind];
    if (!el || !spec || cfReducedMotion(cfWin(el))) return cfNoop;
    var layer = cfFxLayer(el, "cf-fx-" + kind);
    var count = Math.max(1, Math.min(80, Math.round(o.count || spec.count)));
    var speed = o.speed > 0 ? o.speed : 1;
    var html = "";
    for (var i = 0; i < count; i++) {
      var life = cfRand(spec.life) / speed;
      var size = cfRand(spec.size);
      html +=
        '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;--s:" + size.toFixed(1) + "px;--d:" + life.toFixed(2) + "s;--w:" + (Math.random() * 40 - 20).toFixed(0) + "px;animation-delay:-" + (Math.random() * life).toFixed(2) + "s" +
        (o.color ? ";background:" + cfEsc(o.color) : "") + '"></i>';
    }
    layer.innerHTML = html;
    return function () {
      layer.remove();
    };
  },

  /** Particles that fit a weather word from the state ("light rain", "Snow", "storm"); nothing for clear skies. */
  weather: function (el, text, o) {
    var w = String(text || "").toLowerCase();
    var kind = /snow|blizzard|sleet/.test(w) ? "snow" : /rain|storm|drizzle|shower|thunder/.test(w) ? "rain" : /ash|ember|fire/.test(w) ? "embers" : /blossom|petal|spring/.test(w) ? "petals" : /dust|sand|haze/.test(w) ? "dust" : "";
    if (!kind) return cfNoop;
    var heavy = /heavy|storm|blizzard|thunder/.test(w);
    var light = /light|drizzle|flurr/.test(w);
    return cfFx.particles(el, kind, Object.assign({ count: Math.round(CF_FX_KINDS[kind].count * (heavy ? 1.6 : light ? 0.5 : 1)) }, o || {}));
  },

  /** Shakes an element, for a hit or a jolt. { strength } in pixels (default 8), { ms }. */
  shake: function (el, o) {
    o = o || {};
    if (!el || cfReducedMotion(cfWin(el))) return Promise.resolve();
    var s = o.strength || 8;
    return cfAnimate(
      el,
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(" + -s + "px, " + s / 3 + "px)" },
        { transform: "translate(" + s + "px, " + -s / 3 + "px)" },
        { transform: "translate(" + -s / 2 + "px, 0)" },
        { transform: "translate(" + s / 2 + "px, 0)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: o.ms || 380, easing: "ease-out" },
    );
  },

  /** A flash of colour over an element (white by default), for lightning, a hit or a reveal. */
  flash: function (el, o) {
    o = o || {};
    if (!el || cfReducedMotion(cfWin(el))) return Promise.resolve();
    var layer = cfFxLayer(el, "cf-fx-flash");
    layer.style.background = o.color || "#fff";
    layer.style.opacity = "0";
    return cfAnimate(layer, [{ opacity: 0 }, { opacity: o.strength || 0.7, offset: 0.15 }, { opacity: 0 }], { duration: o.ms || 450, easing: "ease-out" }).then(function () {
      layer.remove();
    });
  },

  /** A soft glow that breathes around an element until stopped. */
  glow: function (el, o) {
    o = o || {};
    if (!el) return cfNoop;
    el.classList.add("cf-fx-glow");
    if (o.color) el.style.setProperty("--cf-fx-glow", o.color);
    return function () {
      el.classList.remove("cf-fx-glow");
    };
  },

  /** A gentle repeating pulse (scale), to draw the eye to a button or a badge, until stopped. */
  pulse: function (el) {
    if (!el) return cfNoop;
    el.classList.add("cf-fx-pulse");
    return function () {
      el.classList.remove("cf-fx-pulse");
    };
  },

  /**
   * Types text into an element. { speed } in ms per letter (default 28). A tap shows the rest.
   * Returns { done: Promise, skip() }. With less motion the text shows at once.
   */
  typewriter: function (el, text, o) {
    o = o || {};
    text = String(text == null ? "" : text);
    if (!el) return { done: Promise.resolve(), skip: cfNoop };
    var win = cfWin(el);
    var finish;
    var done = new Promise(function (resolve) {
      finish = resolve;
    });
    var timer = null;
    var i = 0;
    function end() {
      if (timer) win.clearTimeout(timer);
      timer = null;
      el.textContent = text;
      el.classList.remove("cf-fx-typing");
      el.removeEventListener("click", end);
      finish();
    }
    if (cfReducedMotion(win) || !text) {
      end();
      return { done: done, skip: cfNoop };
    }
    var speed = o.speed > 0 ? o.speed : 28;
    el.textContent = "";
    el.classList.add("cf-fx-typing");
    el.addEventListener("click", end);
    (function step() {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) return end();
      // A beat after the end of a sentence.
      var ch = text.charAt(i - 1);
      timer = win.setTimeout(step, /[.!?…]/.test(ch) ? speed * 8 : /[,;:]/.test(ch) ? speed * 4 : speed);
    })();
    return { done: done, skip: end };
  },

  /** Counts a number up (or down) to `to` in an element. { from, ms, format(n) }. */
  countUp: function (el, to, o) {
    o = o || {};
    if (!el) return Promise.resolve();
    var win = cfWin(el);
    var format = typeof o.format === "function" ? o.format : function (n) { return String(Math.round(n)); };
    var target = Number(to) || 0;
    var from = o.from !== undefined ? Number(o.from) || 0 : Number(String(el.textContent).replace(/[^\d.-]/g, "")) || 0;
    if (cfReducedMotion(win) || from === target || typeof win.requestAnimationFrame !== "function") {
      el.textContent = format(target);
      return Promise.resolve();
    }
    var ms = o.ms || 700;
    var start = null;
    return new Promise(function (resolve) {
      function frame(t) {
        if (start === null) start = t;
        var k = Math.min(1, (t - start) / ms);
        var eased = 1 - Math.pow(1 - k, 3);
        el.textContent = format(from + (target - from) * eased);
        if (k < 1) win.requestAnimationFrame(frame);
        else resolve();
      }
      win.requestAnimationFrame(frame);
    });
  },

  /**
   * Swaps an element's content with a transition: "fade", "left", "right" (pages going forward and
   * back) or "up". Resolves when the new content is in.
   */
  transition: function (el, html, o) {
    o = o || {};
    var type = typeof o === "string" ? o : o.type || "fade";
    if (!el) return Promise.resolve();
    if (cfReducedMotion(cfWin(el))) {
      el.innerHTML = html;
      return Promise.resolve();
    }
    var dx = type === "left" ? -24 : type === "right" ? 24 : 0;
    var dy = type === "up" ? 16 : 0;
    var ms = (o && o.ms) || 180;
    return cfAnimate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(" + dx + "px, " + -dy / 2 + "px)" }], { duration: ms * 0.6, easing: "ease-in" }).then(function () {
      el.innerHTML = html;
      return cfAnimate(el, [{ opacity: 0, transform: "translate(" + -dx + "px, " + dy + "px)" }, { opacity: 1, transform: "none" }], { duration: ms, easing: "ease-out" });
    });
  },

  /**
   * Layers inside `el` marked data-depth="0.2" (far) to "1" (near) drift with the pointer or the
   * phone's tilt. Returns a function that stops it.
   */
  parallax: function (el, o) {
    o = o || {};
    var win = cfWin(el);
    if (!el || cfReducedMotion(win)) return cfNoop;
    var reach = o.reach || 14;
    var layers = Array.prototype.slice.call(el.querySelectorAll("[data-depth]"));
    var queued = false;
    var x = 0;
    var y = 0;
    function apply() {
      queued = false;
      layers.forEach(function (l) {
        var d = Number(l.getAttribute("data-depth")) || 0;
        l.style.transform = "translate3d(" + (x * reach * d).toFixed(1) + "px, " + (y * reach * d).toFixed(1) + "px, 0)";
      });
    }
    function queue() {
      if (queued) return;
      queued = true;
      if (win.requestAnimationFrame) win.requestAnimationFrame(apply);
      else win.setTimeout(apply, 16);
    }
    function move(e) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      x = ((e.clientX - r.left) / r.width - 0.5) * -2;
      y = ((e.clientY - r.top) / r.height - 0.5) * -2;
      queue();
    }
    function tilt(e) {
      if (e.gamma == null || e.beta == null) return;
      x = Math.max(-1, Math.min(1, e.gamma / 30)) * -1;
      y = Math.max(-1, Math.min(1, (e.beta - 40) / 30)) * -1;
      queue();
    }
    el.addEventListener("pointermove", move);
    win.addEventListener("deviceorientation", tilt);
    return function () {
      el.removeEventListener("pointermove", move);
      win.removeEventListener("deviceorientation", tilt);
      layers.forEach(function (l) {
        l.style.transform = "";
      });
    };
  },
};
