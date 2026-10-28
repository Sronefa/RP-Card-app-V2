// CardForge minigame toolkit (CF.game): the parts every small game needs, so a new one is a
// paragraph of rules and a few calls. A game has a frame (title, score, timer, Skip), a clock that
// only runs while it's played and on screen, input for taps, holds, swipes, keys and drag and drop,
// boards, sprites, timers and combos, seeded randomness for layouts, a difficulty read from the
// story, and an end that writes the result into the state and tells the model what happened.
//
// Runs in the card's Tavern Helper script with the engine core. The player can skip any game, or
// skip them all in the settings app; then the game ends at once with its skip result.

/** 0 (easy) to 1 (hard): a number, or a value of the state ({ path, min, max, invert }). */
function cfGameDifficulty(spec, messageId) {
  var clamp = function (n) {
    return Math.max(0, Math.min(1, n));
  };
  if (spec == null || spec === "") return 0.5;
  if (typeof spec === "number") return isFinite(spec) ? clamp(spec) : 0.5;
  if (typeof spec === "string") spec = { path: spec };
  var raw = cfRead(spec.path, messageId === undefined ? "latest" : messageId);
  var v = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !isFinite(v)) return spec.fallback !== undefined ? clamp(Number(spec.fallback)) : 0.5;
  var min = spec.min !== undefined ? Number(spec.min) : 0;
  var max = spec.max !== undefined ? Number(spec.max) : 100;
  var t = clamp((v - min) / (max - min || 1));
  return spec.invert ? 1 - t : t;
}

/** Whether two boxes ({ x, y, w, h }) overlap. */
function cfGameHit(a, b) {
  return !!a && !!b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

var CF_GAME_LABELS = { win: "Success", loss: "Failed", skip: "Skipped" };

function cfGameText(text, result) {
  if (typeof text === "function") return String(text(result) || "");
  return String(text || "").replace(/\{(\w+)\}/g, function (m, k) {
    return result[k] !== undefined ? String(result[k]) : m;
  });
}

/**
 * A game in `el`. Options: title, name (for the result's action), difficulty (see
 * cfGameDifficulty), seed, intro (scene steps), outcomes ({ win: { set, line, title }, loss, skip }),
 * report ("input", the default, "now" or "none"), result (false hides the result card),
 * auto (a function (game) => result used when the player skips games), skippable, close (the
 * result's button closes the hub screen).
 */
function cfGameCreate(el, o) {
  o = o || {};
  var doc = el.ownerDocument;
  var win = doc.defaultView || window;
  var messageId = o.messageId === undefined ? "latest" : o.messageId;
  var title = String(o.title || "Minigame");
  var box = doc.createElement("div");
  box.className = "cf-game";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", title);
  box.innerHTML =
    '<div class="cf-game-bar"><span class="cf-game-title">' + cfEsc(title) + '</span><span class="cf-game-hud" aria-live="polite"></span>' +
    (o.skippable === false ? "" : '<button type="button" class="cf-btn ghost cf-game-skip">Skip</button>') +
    '</div><div class="cf-game-stage" tabindex="-1"></div>';
  el.appendChild(box);
  var stage = box.querySelector(".cf-game-stage");
  var hud = box.querySelector(".cf-game-hud");

  var listeners = [];
  var tasks = [];
  var loops = [];
  var elapsed = 0;
  var last = 0;
  var frame = null;
  var autoPaused = false;
  var finish;
  var done = new Promise(function (resolve) {
    finish = resolve;
  });
  var rand = cfArtRng(o.seed !== undefined ? o.seed : title + ":" + Date.now() + ":" + Math.random());

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push(function () {
      target.removeEventListener(type, fn, opts);
    });
  }
  function hudSlot(cls) {
    var slot = hud.querySelector("." + cls);
    if (!slot) {
      slot = doc.createElement("span");
      slot.className = cls;
      hud.appendChild(slot);
    }
    return slot;
  }

  var raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (f) {
    return win.setTimeout(f, 16);
  };
  var caf = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : win.clearTimeout.bind(win);
  function tick() {
    frame = null;
    if (g.state !== "playing") return;
    if (!box.isConnected) return stopAll();
    var now = Date.now();
    var dt = Math.min(100, Math.max(0, now - last));
    last = now;
    elapsed += dt;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t.gone || elapsed < t.due) continue;
      if (t.every) t.due += t.every;
      else t.gone = true;
      t.fn(elapsed);
    }
    tasks = tasks.filter(function (t) {
      return !t.gone;
    });
    loops.slice().forEach(function (fn) {
      if (g.state === "playing") fn(dt, elapsed);
    });
    if (g.state === "playing") frame = raf(tick);
  }
  function run() {
    last = Date.now();
    if (frame === null) frame = raf(tick);
  }
  function stopAll() {
    if (frame !== null) caf(frame);
    frame = null;
    listeners.splice(0).forEach(function (off) {
      off();
    });
    tasks = [];
    loops = [];
  }

  var g = {
    el: box,
    stage: stage,
    hud: hud,
    title: title,
    state: "ready",
    score: 0,
    /** 0 (easy) to 1 (hard), from the options' difficulty. */
    difficulty: cfGameDifficulty(o.difficulty, messageId),
    /** Resolves with the result when the game ends. */
    done: done,
    /** The game clock in ms: it stops while paused or hidden. */
    time: function () {
      return elapsed;
    },
    /** A value between easy and hard by the difficulty: g.tune(8000, 3000) for a time limit. */
    tune: function (easy, hard) {
      return easy + (hard - easy) * g.difficulty;
    },
    rand: rand,
    int: function (a, b) {
      return a + Math.floor(rand() * (b - a + 1));
    },
    pick: function (list) {
      return list[Math.floor(rand() * list.length)];
    },
    shuffle: function (list) {
      var a = list.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    },

    /** Starts it: plays the intro scene first if there is one. The player's "skip games" setting ends it at once. */
    start: function () {
      if (g.state !== "ready") return Promise.resolve(g);
      if (cfSettings().minigames === "skip") {
        g.end(Object.assign({ outcome: "skip", auto: true }, typeof o.auto === "function" ? o.auto(g) || {} : {}));
        return Promise.resolve(g);
      }
      var begin = function () {
        if (g.state !== "ready") return g;
        g.state = "playing";
        box.classList.add("playing");
        run();
        if (typeof o.onStart === "function") o.onStart(g);
        return g;
      };
      if (o.intro && o.intro.length) {
        g.state = "intro";
        return cfScene.play(box, o.intro, { fill: true, label: title }).done.then(function () {
          g.state = "ready";
          return begin();
        });
      }
      return Promise.resolve(begin());
    },
    pause: function () {
      if (g.state !== "playing") return;
      g.state = "paused";
      box.classList.add("paused");
      if (frame !== null) caf(frame);
      frame = null;
    },
    resume: function () {
      if (g.state !== "paused") return;
      g.state = "playing";
      box.classList.remove("paused");
      run();
    },
    /** Runs fn(dt, time) every frame while the game is played. */
    loop: function (fn) {
      loops.push(fn);
      return function () {
        loops = loops.filter(function (f) {
          return f !== fn;
        });
      };
    },
    /** Runs fn after ms of game time (paused time doesn't count). */
    after: function (ms, fn) {
      var t = { due: elapsed + ms, fn: fn };
      tasks.push(t);
      return function () {
        t.gone = true;
      };
    },
    every: function (ms, fn) {
      var t = { due: elapsed + ms, every: Math.max(16, ms), fn: fn };
      tasks.push(t);
      return function () {
        t.gone = true;
      };
    },
    /** A countdown shown in the bar; at zero it calls onEnd, or ends the game as a loss. */
    timer: function (ms, to) {
      to = to || {};
      var total = ms;
      var end = elapsed + ms;
      var slot = hudSlot("cf-game-timer");
      slot.innerHTML = '<span class="cf-game-timer-bar"><i></i></span><b></b>';
      var bar = slot.querySelector("i");
      var label = slot.querySelector("b");
      var stopped = false;
      function draw() {
        var left = Math.max(0, end - elapsed);
        bar.style.transform = "scaleX(" + (left / total).toFixed(3) + ")";
        label.textContent = Math.ceil(left / 1000) + "s";
        slot.classList.toggle("low", left < total * 0.25);
        return left;
      }
      draw();
      var off = g.loop(function () {
        if (stopped) return;
        if (draw() <= 0) {
          stopped = true;
          off();
          if (typeof to.onEnd === "function") to.onEnd();
          else g.end({ outcome: "loss", reason: "time" });
        }
      });
      return {
        left: function () {
          return Math.max(0, end - elapsed);
        },
        add: function (more) {
          end += more;
          total = Math.max(total, end - elapsed);
          draw();
        },
        stop: function () {
          stopped = true;
          off();
        },
      };
    },
    /** Adds to the score shown in the bar. */
    addScore: function (n) {
      g.score += Number(n) || 0;
      hudSlot("cf-game-score").textContent = String(g.score);
      return g.score;
    },
    /** A combo counter shown in the bar: hit() and miss(); mult() for a score multiplier. */
    combo: function () {
      var slot = hudSlot("cf-game-combo");
      var c = {
        count: 0,
        best: 0,
        hit: function () {
          c.count++;
          c.best = Math.max(c.best, c.count);
          slot.textContent = c.count > 1 ? "×" + c.count : "";
          if (c.count > 1 && !cfReducedMotion(win)) cfAnimate(slot, [{ transform: "scale(1.35)" }, { transform: "none" }], { duration: 180, easing: "ease-out" });
          return c.count;
        },
        miss: function () {
          c.count = 0;
          slot.textContent = "";
        },
        mult: function () {
          return 1 + Math.floor(c.count / 5);
        },
      };
      return c;
    },
    /** A meter in the bar (CF.ui.meter): set(value). */
    meter: function (label, max) {
      var slot = hudSlot("cf-game-meter");
      var m = {
        value: 0,
        set: function (v) {
          m.value = v;
          slot.innerHTML = cfUi.meter({ label: label, value: v, max: max || 100 });
        },
      };
      m.set(0);
      return m;
    },

    // ------------------------------------------------ input (removed when the game ends)

    /** Taps (clicks, touches, Enter on a button) on target, or on its children matching a selector. */
    tap: function (target, selector, fn) {
      if (typeof selector === "function") {
        fn = selector;
        selector = null;
      }
      listen(target, "click", function (e) {
        if (g.state !== "playing") return;
        var hit = selector ? e.target.closest && e.target.closest(selector) : target;
        if (hit && (!selector || target.contains(hit))) fn(hit, e);
      });
    },
    /** Press and hold: { ms, progress(f), done(), cancel() }. Space or Enter hold on a focused target too. */
    hold: function (target, h) {
      var ms = h.ms || 800;
      var from = null;
      var off = null;
      function down(e) {
        if (g.state !== "playing" || from !== null) return;
        if (e.type === "keydown" && e.key !== " " && e.key !== "Enter") return;
        if (e.type === "keydown") e.preventDefault();
        from = elapsed;
        target.classList.add("holding");
        off = g.loop(function () {
          var f = Math.min(1, (elapsed - from) / ms);
          if (h.progress) h.progress(f);
          if (f >= 1) {
            stop();
            if (h.done) h.done();
          }
        });
      }
      function stop() {
        if (off) off();
        off = null;
        from = null;
        target.classList.remove("holding");
      }
      function up(e) {
        if (from === null) return;
        if (e.type === "keyup" && e.key !== " " && e.key !== "Enter") return;
        var f = Math.min(1, (elapsed - from) / ms);
        stop();
        if (f < 1 && h.cancel) h.cancel(f);
      }
      listen(target, "pointerdown", down);
      listen(target, "keydown", down);
      listen(target, "pointerup", up);
      listen(target, "pointerleave", up);
      listen(target, "pointercancel", up);
      listen(target, "keyup", up);
    },
    /** Swipes on target and the arrow keys: fn("up" | "down" | "left" | "right"). */
    swipe: function (target, fn) {
      var start = null;
      listen(target, "pointerdown", function (e) {
        start = { x: e.clientX, y: e.clientY };
      });
      listen(target, "pointerup", function (e) {
        if (!start || g.state !== "playing") return;
        var dx = e.clientX - start.x;
        var dy = e.clientY - start.y;
        start = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
        fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      });
      g.keys({
        ArrowUp: function () {
          fn("up");
        },
        ArrowDown: function () {
          fn("down");
        },
        ArrowLeft: function () {
          fn("left");
        },
        ArrowRight: function () {
          fn("right");
        },
      });
    },
    /** Keys while the game is played: { " ": fn, ArrowLeft: fn, a: fn }. */
    keys: function (map) {
      listen(doc, "keydown", function (e) {
        if (g.state !== "playing" || !map[e.key] || e.repeat) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        e.preventDefault();
        map[e.key](e);
      });
    },
    /**
     * Drag and drop: { items: selector, slots: selector, drop(item, slot) } inside the stage. Tapping an
     * item and then a slot does the same, for keyboards and screen readers.
     */
    drag: function (d) {
      var root = d.within || stage;
      var held = null;
      var picked = null;
      function select(item) {
        if (picked) picked.setAttribute("aria-pressed", "false");
        picked = item;
        if (item) item.setAttribute("aria-pressed", "true");
      }
      function dropOn(item, slot) {
        select(null);
        if (slot && item && d.drop) d.drop(item, slot);
      }
      listen(root, "pointerdown", function (e) {
        var item = e.target.closest && e.target.closest(d.items);
        if (!item || g.state !== "playing" || typeof e.clientX !== "number") return;
        held = { item: item, x: e.clientX, y: e.clientY, moved: false };
        if (item.setPointerCapture && e.pointerId !== undefined) {
          try {
            item.setPointerCapture(e.pointerId);
          } catch (err) {}
        }
      });
      listen(root, "pointermove", function (e) {
        if (!held) return;
        var dx = e.clientX - held.x;
        var dy = e.clientY - held.y;
        if (!held.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        held.moved = true;
        held.item.classList.add("dragging");
        held.item.style.transform = "translate(" + dx + "px," + dy + "px)";
      });
      listen(root, "pointerup", function (e) {
        if (!held) return;
        var h = held;
        held = null;
        h.item.classList.remove("dragging");
        h.item.style.transform = "";
        if (!h.moved) return;
        h.item.style.pointerEvents = "none";
        var under = doc.elementFromPoint ? doc.elementFromPoint(e.clientX, e.clientY) : null;
        h.item.style.pointerEvents = "";
        h.dragged = true;
        dropOn(h.item, under && under.closest ? under.closest(d.slots) : null);
        root.cfJustDragged = true;
      });
      listen(root, "click", function (e) {
        if (g.state !== "playing") return;
        if (root.cfJustDragged) {
          root.cfJustDragged = false;
          return;
        }
        var item = e.target.closest && e.target.closest(d.items);
        var slot = e.target.closest && e.target.closest(d.slots);
        if (item && item !== picked && (!slot || !picked)) return select(item);
        if (picked && slot) return dropOn(picked, slot);
        if (item === picked) select(null);
      });
    },

    // ------------------------------------------------ blocks

    /**
     * A board of cols × rows buttons in the stage (or o.el): cell(x, y) gives each one's HTML (or
     * { html, label }). Returns { el, cell(x, y), set(x, y, html, label), each(fn), onTap(fn(x, y, button)) }.
     */
    grid: function (b) {
      var host = b.el || stage;
      var board = doc.createElement("div");
      board.className = "cf-game-grid";
      board.setAttribute("role", "grid");
      if (b.label) board.setAttribute("aria-label", b.label);
      board.style.gridTemplateColumns = "repeat(" + b.cols + ", minmax(0, 1fr))";
      var html = "";
      for (var y = 0; y < b.rows; y++)
        for (var x = 0; x < b.cols; x++) {
          var c = b.cell ? b.cell(x, y) : "";
          var inner = c && typeof c === "object" ? c.html : c;
          var label = c && typeof c === "object" && c.label ? c.label : "Row " + (y + 1) + ", column " + (x + 1);
          html += '<button type="button" class="cf-game-cell" data-x="' + x + '" data-y="' + y + '" aria-label="' + cfEsc(label) + '">' + (inner || "") + "</button>";
        }
      board.innerHTML = html;
      host.appendChild(board);
      var api = {
        el: board,
        cell: function (cx, cy) {
          return board.querySelector('[data-x="' + cx + '"][data-y="' + cy + '"]');
        },
        set: function (cx, cy, inner, label) {
          var cell = api.cell(cx, cy);
          if (!cell) return null;
          cell.innerHTML = inner || "";
          if (label) cell.setAttribute("aria-label", label);
          return cell;
        },
        each: function (fn) {
          Array.prototype.forEach.call(board.children, function (cell) {
            fn(Number(cell.getAttribute("data-x")), Number(cell.getAttribute("data-y")), cell);
          });
        },
        onTap: function (fn) {
          g.tap(board, ".cf-game-cell", function (cell) {
            fn(Number(cell.getAttribute("data-x")), Number(cell.getAttribute("data-y")), cell);
          });
        },
      };
      return api;
    },
    /** A moving piece in the stage, in px: { x, y, w, h, html, cls }. step(dt) moves it by vx, vy (px a second). */
    sprite: function (s) {
      var node = doc.createElement("div");
      node.className = "cf-game-sprite" + (s.cls ? " " + s.cls : "");
      node.innerHTML = s.html || "";
      stage.appendChild(node);
      var sp = {
        el: node,
        x: s.x || 0,
        y: s.y || 0,
        w: s.w || 24,
        h: s.h || 24,
        vx: s.vx || 0,
        vy: s.vy || 0,
        place: function () {
          node.style.width = sp.w + "px";
          node.style.height = sp.h + "px";
          node.style.transform = "translate(" + sp.x.toFixed(1) + "px," + sp.y.toFixed(1) + "px)";
          return sp;
        },
        step: function (dt) {
          sp.x += (sp.vx * dt) / 1000;
          sp.y += (sp.vy * dt) / 1000;
          return sp.place();
        },
        hits: function (other) {
          return cfGameHit(sp, other);
        },
        remove: function () {
          node.remove();
        },
      };
      return sp.place();
    },

    /**
     * Ends the game with { outcome: "win" | "loss" | "skip", score, line, set, title }. The options'
     * outcomes fill in what's missing; `set` ({ path: value }) is written to the state with `line`
     * as its note, and the line goes to the model as a minigame action.
     */
    end: function (result) {
      if (g.state === "over") return done;
      g.state = "over";
      box.classList.remove("playing", "paused");
      box.classList.add("over");
      stopAll();
      var r = Object.assign({ outcome: "win", score: g.score }, result || {});
      var preset = (o.outcomes && o.outcomes[r.outcome]) || {};
      if (r.set === undefined && preset.set) r.set = typeof preset.set === "function" ? preset.set(r) : preset.set;
      if (r.line === undefined) r.line = preset.line !== undefined ? cfGameText(preset.line, r) : r.outcome === "skip" ? "{{user}} skipped " + title + "; the story decides how it goes." : "";
      else r.line = cfGameText(r.line, r);
      r.title = r.title || cfGameText(preset.title || CF_GAME_LABELS[r.outcome] || r.outcome, r);
      r.game = o.name || title;
      var writes = Promise.resolve();
      var changes = r.set ? (Array.isArray(r.set) ? r.set : Object.keys(r.set).map(function (k) { return [k, r.set[k]]; })) : [];
      if (changes.length)
        writes = cfPlayerSetMany(changes, r.line || title + ": " + r.outcome).catch(function (e) {
          console.warn("[CardForge] The game couldn't write its result.", e);
        });
      var report = o.report === undefined ? "input" : o.report;
      if (report !== "none" && r.line)
        writes = writes.then(function () {
          return cfSend("minigame", { game: r.game, outcome: r.outcome, score: r.score }, r.line, { now: report === "now" }).catch(function () {});
        });
      if (o.result !== false) {
        var card = doc.createElement("div");
        card.className = "cf-game-result " + cfEsc(r.outcome);
        card.setAttribute("role", "status");
        card.innerHTML =
          '<div class="cf-card cf-stack"><h2>' + cfEsc(r.title) + "</h2>" +
          (r.outcome !== "skip" && g.score ? '<p class="cf-game-final">' + cfEsc(r.score) + "</p>" : "") +
          (r.line ? '<p class="cf-muted">' + cfEsc(r.line.replace(/\{\{user\}\}/g, "You")) + "</p>" : "") +
          '<button type="button" class="cf-btn primary" data-cf-game-done' + (o.close ? " data-cf-close" : "") + ">" + cfEsc(o.close ? "Back to the story" : "Done") + "</button>" +
          "</div>";
        box.appendChild(card);
        card.addEventListener("click", function (e) {
          if (!o.close && e.target.closest && e.target.closest("[data-cf-game-done]")) card.remove();
        });
        if (!cfReducedMotion(win)) cfAnimate(card.firstChild, [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
      writes.then(function () {
        if (typeof o.onEnd === "function") o.onEnd(r, g);
        finish(r);
      });
      return done;
    },
  };

  var skip = box.querySelector(".cf-game-skip");
  if (skip)
    skip.addEventListener("click", function () {
      if (g.state !== "over") g.end(Object.assign({ outcome: "skip" }, typeof o.auto === "function" ? o.auto(g) || {} : {}));
    });
  // A hidden screen holds the game; it carries on when it's back.
  listen(doc, "visibilitychange", function () {
    if (doc.hidden && g.state === "playing") {
      autoPaused = true;
      g.pause();
    } else if (!doc.hidden && autoPaused) {
      autoPaused = false;
      g.resume();
    }
  });
  return g;
}

var cfGame = {
  create: cfGameCreate,
  difficulty: cfGameDifficulty,
  hit: cfGameHit,
  rng: cfArtRng,
};
