// CardForge scene director (CF.scene): small cutscenes as a list of steps. A background fades in,
// a portrait slides in, a line types out, the screen shakes, a beat passes, a choice appears.
// For title screens, chapter cards, a boss entrance or a level up.
//
// Runs in the card's Tavern Helper script with the effects kit, the art kit and the engine core,
// and builds on them: CF.fx for motion, CF.ui's dialogue box, CF.assets for art and CF.art.sky as
// the fallback background. Steps are plain data, so a scene can live in a module's settings or be
// written by the co-writer. The player can tap through lines and skip the whole scene; with less
// motion everything appears without moving. Nothing here loads from the network.

var CF_SCENE_STEPS = ["bg", "show", "hide", "say", "title", "fx", "wait", "choice", "clear"];
var CF_SCENE_FX = ["shake", "flash", "weather", "particles"];
var CF_SCENE_KEY = "cardforge";

/** What a step does: the first step word it has. */
function cfSceneKind(step) {
  if (!step || typeof step !== "object") return "";
  for (var i = 0; i < CF_SCENE_STEPS.length; i++) if (step[CF_SCENE_STEPS[i]] !== undefined) return CF_SCENE_STEPS[i];
  return "";
}

/** Problems with a scene's steps, as sentences; [] when it can play. */
function cfSceneCheck(steps) {
  if (!Array.isArray(steps)) return ["A scene is a list of steps."];
  var out = [];
  steps.forEach(function (step, i) {
    var kind = cfSceneKind(step);
    var at = "Step " + (i + 1);
    if (!kind) out.push(at + " does nothing: give it one of " + CF_SCENE_STEPS.join(", ") + ".");
    else if (kind === "say" && !String(step.say).trim()) out.push(at + " has nothing to say.");
    else if ((kind === "show" || kind === "hide") && !String(step[kind]).trim()) out.push(at + " doesn't name who to " + kind + ".");
    else if (kind === "choice" && (!Array.isArray(step.choice) || !step.choice.length)) out.push(at + " has no choices.");
    else if (kind === "fx" && CF_SCENE_FX.indexOf(step.fx) < 0) out.push(at + ' has an unknown effect "' + step.fx + '": use ' + CF_SCENE_FX.join(", ") + ".");
    else if (kind === "wait" && step.wait !== "tap" && !(Number(step.wait) >= 0)) out.push(at + ' waits for "' + step.wait + '": give ms or "tap".');
  });
  return out;
}

/** The scenes already played in this chat, by the key given to play({ once }). */
function cfSceneSeen(key) {
  try {
    var vars = getVariables({ type: "chat" }) || {};
    var seen = (vars[CF_SCENE_KEY] && vars[CF_SCENE_KEY].scenes) || [];
    return key === undefined ? seen.slice() : seen.indexOf(key) >= 0;
  } catch (e) {
    return key === undefined ? [] : false;
  }
}

async function cfSceneMarkSeen(key) {
  if (!key || cfSceneSeen(key)) return;
  await updateVariablesWith(
    function (vars) {
      var mine = Object.assign({}, vars[CF_SCENE_KEY]);
      mine.scenes = (mine.scenes || []).concat([key]);
      vars[CF_SCENE_KEY] = mine;
      return vars;
    },
    { type: "chat" },
  );
}

/** A background for a step: a picture URL, else the card's art for that place and time, else a sky or the theme's gradient. */
function cfSceneBackground(step) {
  var v = String(step.bg || "");
  var url = /^(data:|blob:|https?:|\/)/.test(v) ? v : v ? cfAssets.background(v, step.time) : null;
  if (url) return "url('" + cfEsc(url).replace(/'/g, "%27") + "') center / cover no-repeat";
  if (step.time) return cfArt.sky(step.time);
  return step.color ? cfEsc(step.color) : "linear-gradient(160deg, var(--cf-surface2), var(--cf-bg))";
}

/**
 * Plays a scene in `el`. Options: { fill (cover el instead of a block of its own), once (a key:
 * play only the first time in this chat), skippable (default true), keep (leave the last frame
 * on screen), label, speed (ms per letter) }.
 * Returns { done, skip(), stop() }; done resolves to { skipped, stopped, seen, choice, choices }.
 */
function cfScenePlay(el, steps, o) {
  o = o || {};
  var result = { skipped: false, stopped: false, seen: false, choice: null, choices: [] };
  var problems = cfSceneCheck(steps);
  if (!el || problems.length) {
    if (problems.length && typeof console !== "undefined") console.warn("CF.scene: " + problems.join(" "));
    return { done: Promise.resolve(result), skip: cfNoop, stop: cfNoop };
  }
  if (o.once && cfSceneSeen(o.once)) {
    result.seen = true;
    return { done: Promise.resolve(result), skip: cfNoop, stop: cfNoop };
  }
  var doc = el.ownerDocument;
  var win = cfWin(el);
  var reduced = cfReducedMotion(win);
  var box = doc.createElement("div");
  box.className = "cf-scene" + (o.fill ? " fill" : "");
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", o.label || "Scene");
  box.tabIndex = 0;
  box.innerHTML =
    '<div class="cf-scene-bg"></div><div class="cf-scene-bg"></div><div class="cf-scene-shade"></div><div class="cf-scene-actors"></div>' +
    '<div class="cf-scene-title" aria-live="polite"></div><div class="cf-scene-talk" aria-live="polite"></div>' +
    (o.skippable === false ? "" : '<button type="button" class="cf-btn ghost cf-scene-skip">Skip</button>');
  if (o.fill && el !== doc.body && win.getComputedStyle && win.getComputedStyle(el).position === "static") el.style.position = "relative";
  el.appendChild(box);
  var $ = function (sel) { return box.querySelector(sel); };
  var actors = {};
  var bgFront = 0;
  var skipping = false;
  var ended = false;
  var waiter = null;
  var typing = null;
  var sleeping = null;
  var weather = cfNoop;
  var finish;
  var done = new Promise(function (resolve) { finish = resolve; });

  function dur(ms) {
    return skipping || reduced ? 0 : ms;
  }
  function wake() {
    if (typing) typing.skip();
    if (sleeping) sleeping();
    if (waiter) {
      var w = waiter;
      waiter = null;
      w();
    }
  }
  function sleep(ms) {
    ms = dur(ms);
    if (!ms) return Promise.resolve();
    return new Promise(function (resolve) {
      var t = win.setTimeout(function () { sleeping = null; resolve(); }, ms);
      sleeping = function () { win.clearTimeout(t); sleeping = null; resolve(); };
    });
  }
  function tap() {
    if (skipping || ended) return Promise.resolve();
    var more = doc.createElement("span");
    more.className = "cf-vn-more";
    more.setAttribute("aria-hidden", "true");
    more.textContent = "▼";
    var talkBox = $(".cf-scene-talk .cf-vn-box");
    if (talkBox) talkBox.appendChild(more);
    return new Promise(function (resolve) {
      waiter = function () {
        more.remove();
        resolve();
      };
    });
  }
  function fade(node, to, ms, from) {
    ms = dur(ms);
    var start = from !== undefined ? from : Number(node.style.opacity || 0);
    node.style.opacity = String(to);
    if (!ms) return Promise.resolve();
    return cfAnimate(node, [{ opacity: start }, { opacity: to }], { duration: ms, easing: "ease-out" });
  }

  function actorHtml(name, emotion, outfit) {
    var url = cfAssets.portrait(name, { emotion: emotion, outfit: outfit });
    return url
      ? '<img alt="' + cfEsc(name) + '" src="' + cfEsc(url) + '">'
      : '<span class="cf-scene-letter" role="img" aria-label="' + cfEsc(name) + '">' + cfEsc(String(name).charAt(0).toUpperCase()) + "</span>";
  }

  /** Puts a character's picture on an actor; without art, their initial, raised above the dialogue box. */
  function dress(actor, name, step) {
    actor.innerHTML = actorHtml(name, step.emotion, step.outfit);
    actor.classList.toggle("letter", !actor.querySelector("img"));
  }

  var run = {
    bg: function (step) {
      var layers = box.querySelectorAll(".cf-scene-bg");
      var next = layers[1 - bgFront];
      var prev = layers[bgFront];
      next.style.background = cfSceneBackground(step);
      bgFront = 1 - bgFront;
      var ms = step.fade == null ? 600 : Number(step.fade);
      return Promise.all([fade(next, 1, ms, 0), fade(prev, 0, ms)]);
    },
    show: function (step) {
      var name = String(step.show);
      var side = ["left", "right", "center"].indexOf(step.side) >= 0 ? step.side : "center";
      var actor = actors[name];
      if (actor) {
        // Already on stage: a new expression or place, crossfaded.
        actor.className = "cf-scene-actor " + side;
        return fade(actor, 0.25, 120).then(function () {
          dress(actor, name, step);
          return fade(actor, 1, 220);
        });
      }
      actor = doc.createElement("div");
      actor.className = "cf-scene-actor " + side;
      actor.setAttribute("data-name", name);
      dress(actor, name, step);
      actor.style.opacity = "0";
      $(".cf-scene-actors").appendChild(actor);
      actors[name] = actor;
      var from = step.from || (side === "right" ? "right" : side === "left" ? "left" : "bottom");
      var dx = from === "left" ? -40 : from === "right" ? 40 : 0;
      var dy = from === "bottom" ? 24 : 0;
      var ms = dur(step.ms || 450);
      actor.style.opacity = "1";
      if (!ms) return Promise.resolve();
      return cfAnimate(actor, [{ opacity: 0, transform: "translate(" + dx + "px, " + dy + "px)" }, { opacity: 1, transform: "none" }], { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)" });
    },
    hide: function (step) {
      var name = String(step.hide);
      var actor = actors[name];
      if (!actor) return Promise.resolve();
      delete actors[name];
      return fade(actor, 0, 300).then(function () { actor.remove(); });
    },
    say: async function (step) {
      var who = step.who ? String(step.who) : "";
      if (who && step.emotion && actors[who]) await run.show({ show: who, emotion: step.emotion, side: (actors[who].className.match(/left|right|center/) || ["center"])[0] });
      Object.keys(actors).forEach(function (n) { actors[n].classList.toggle("quiet", !!who && n !== who); });
      var talk = $(".cf-scene-talk");
      talk.innerHTML = cfUi.dialogue({ name: who, text: "" });
      var line = talk.querySelector(".cf-vn-text");
      var text = String(step.say);
      if (skipping) line.textContent = text;
      else {
        typing = cfFx.typewriter(line, text, { speed: step.speed || o.speed });
        await typing.done;
        typing = null;
      }
      if (step.auto != null) return sleep(Number(step.auto));
      return tap();
    },
    title: async function (step) {
      var node = $(".cf-scene-title");
      node.innerHTML = "<h1>" + cfEsc(step.title) + "</h1>" + (step.sub ? "<p>" + cfEsc(step.sub) + "</p>" : "");
      await fade(node, 1, 700, 0);
      if (step.stay) return;
      await sleep(step.hold == null ? 1600 : Number(step.hold));
      await fade(node, 0, 500);
    },
    fx: function (step) {
      if (step.fx === "weather" || step.fx === "particles") {
        weather();
        weather = step.fx === "weather" ? cfFx.weather(box, step.text || "", step) : cfFx.particles(box, step.kind, step);
        return Promise.resolve();
      }
      if (skipping) return Promise.resolve();
      return step.fx === "shake" ? cfFx.shake(box, step) : cfFx.flash(box, step);
    },
    wait: function (step) {
      return step.wait === "tap" ? tap() : sleep(Number(step.wait));
    },
    choice: function (step) {
      // A choice is the player's to make, so skipping stops here.
      skipping = false;
      var talk = $(".cf-scene-talk");
      var target = talk.querySelector(".cf-vn-box");
      if (!target) {
        talk.innerHTML = cfUi.dialogue({ name: "", text: step.prompt || "" });
        target = talk.querySelector(".cf-vn-box");
      }
      var list = doc.createElement("div");
      list.className = "cf-vn-choices";
      list.innerHTML = step.choice.map(function (c, i) {
        c = typeof c === "string" ? { label: c } : c;
        return cfUi.button(c.label, c).replace("<button", '<button data-cf-scene-choice="' + i + '"');
      }).join("");
      target.appendChild(list);
      var first = list.querySelector("button");
      if (first && first.focus) first.focus();
      return new Promise(function (resolve) {
        list.addEventListener("click", function (e) {
          var b = e.target.closest("[data-cf-scene-choice]");
          if (!b) return;
          var i = Number(b.getAttribute("data-cf-scene-choice"));
          var c = typeof step.choice[i] === "string" ? { label: step.choice[i] } : step.choice[i];
          var picked = { index: i, label: c.label, value: c.value !== undefined ? c.value : c.label };
          result.choice = picked;
          result.choices.push(picked);
          list.remove();
          resolve();
        });
      });
    },
    clear: function (step) {
      $(".cf-scene-talk").innerHTML = "";
      if (step.clear === "all") {
        Object.keys(actors).forEach(function (n) { actors[n].remove(); delete actors[n]; });
        $(".cf-scene-title").style.opacity = "0";
      }
      return Promise.resolve();
    },
  };

  function end(how) {
    if (ended) return;
    ended = true;
    weather();
    if (how === "stopped") result.stopped = true;
    if (o.once && !result.stopped) cfSceneMarkSeen(o.once).catch(cfNoop);
    var leave = how === "stopped" || !o.keep ? fade(box, 0, how === "stopped" ? 0 : 300).then(function () { box.remove(); }) : Promise.resolve();
    leave.then(function () { finish(result); });
  }

  box.addEventListener("click", function (e) {
    if (e.target.closest(".cf-scene-skip")) return api.skip();
    if (e.target.closest(".cf-vn-choices")) return;
    wake();
  });
  box.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && !e.target.closest("button")) {
      e.preventDefault();
      wake();
    } else if (e.key === "Escape") api.skip();
  });

  var api = {
    done: done,
    /** Jumps to the end (or to the next choice), showing where each step leaves things. */
    skip: function () {
      if (ended || skipping) return;
      skipping = true;
      result.skipped = true;
      wake();
    },
    /** Ends the scene now and takes it off the screen. */
    stop: function () {
      skipping = true;
      wake();
      end("stopped");
    },
  };

  (async function () {
    try {
      for (var i = 0; i < steps.length && !ended; i++) await run[cfSceneKind(steps[i])](steps[i]);
    } catch (e) {
      if (typeof console !== "undefined") console.error("CF.scene: " + (e && e.message));
    }
    end();
  })();
  return api;
}

var cfScene = {
  play: cfScenePlay,
  check: cfSceneCheck,
  /** Whether a scene played with { once: key } has played in this chat; with no key, the list. */
  seen: cfSceneSeen,
  steps: CF_SCENE_STEPS.slice(),
};
