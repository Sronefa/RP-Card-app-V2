/**
 * Minigame templates for the UI engineer to read and adapt: each is a hub screen built on CF.game,
 * with its difficulty read from a value, its words in the module's settings and its result written
 * back into the story.
 */
import { newVar } from "../sheet";
import type { EngineModule, ModuleRule } from "../modules/types";

const base = (): Pick<EngineModule, "version" | "tags" | "requires" | "enabled" | "slot" | "html"> => ({
  version: "1.0.0",
  tags: ["example", "minigame"],
  requires: [],
  enabled: true,
  slot: "overlay",
  html: "",
});

/** The rule that tells the model what a minigame's result means. */
const resultRule = (): ModuleRule => ({
  comment: "Minigame results",
  content:
    '<action app="minigame">{"game":G,"outcome":O,"score":N}</action> and the line after it mean {{user}} just played the minigame G and it ended in O ("skip" means they skipped it: decide fairly from the story). Play the next reply on from that line; never replay the minigame or reverse its result.',
  constant: false,
  keys: ['app="minigame"'],
  depth: 2,
  order: 100,
});

const skill = (id: string, name: string, group: string, start = "3") =>
  newVar({ id, group, name, type: "number", start, min: 0, max: 10, rule: `{{user}}'s ${name.toLowerCase()} skill, 0 to 10: +1 when they practise it or are taught; it rarely changes.` });

const lockpicking: EngineModule = {
  ...base(),
  id: "lockpicking",
  name: "Lockpicking",
  description:
    "A lock with 3 to 6 pins: a pick sweeps back and forth, and the player taps (or presses Space) when it's in the bright spot. Three picks; a miss breaks one. The difficulty comes from Player.Lockpicking (more skill, fewer pins and a wider spot). Shows g.loop, g.tap, g.keys, g.tune and outcomes from settings.",
  button: "🔒 Pick the lock",
  vars: [skill("mg-lock", "Lockpicking", "Player")],
  rules: [resultRule()],
  regex: [],
  settings: { outcomes: { win: { line: "{{user}} picked the lock." }, loss: { line: "{{user}}'s last pick snapped; the lock held." } } },
  css: ".lp { display: flex; flex-direction: column; gap: 14px; padding: 16px; } .lp-pins { display: flex; align-items: center; gap: 6px; } .lp-pins i { width: 14px; height: 26px; border-radius: 4px; background: var(--cf-border); } .lp-pins i.set { background: var(--cf-good); } .lp-picks { margin-left: auto; } .lp-track { position: relative; height: 48px; border-radius: var(--cf-radius); background: var(--cf-surface); border: 1px solid var(--cf-border); overflow: hidden; } .lp-spot { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--cf-accent) 35%, transparent); } .lp-pick { position: absolute; left: 0; top: 6px; bottom: 6px; width: 4px; border-radius: 2px; background: var(--cf-text); } .lp-tap { min-height: 52px; }",
  js: `var g = app.game(root, {
  title: "Lockpicking",
  name: "lockpicking",
  close: true,
  // More skill makes it easier: invert.
  difficulty: { path: "Player.Lockpicking", min: 0, max: 10, invert: true },
  outcomes: settings.outcomes,
});
var pins = Math.round(g.tune(3, 6));
var zone = g.tune(0.3, 0.12); // the sweet spot's width
var speed = g.tune(0.5, 1.3); // sweeps a second
var picks = 3, pin = 0, pos = 0, dir = 1, spot = 0;
g.stage.innerHTML =
  '<div class="lp"><div class="lp-pins"></div>' +
  '<div class="lp-track"><span class="lp-spot"></span><span class="lp-pick"></span></div>' +
  '<p class="cf-small cf-muted">Tap when the pick is in the bright spot.</p>' +
  '<button type="button" class="cf-btn primary lp-tap">Set the pin</button></div>';
var track = g.stage.querySelector(".lp-track");
var spotEl = g.stage.querySelector(".lp-spot");
var pickEl = g.stage.querySelector(".lp-pick");
function drawPins() {
  var html = "";
  for (var i = 0; i < pins; i++) html += '<i class="' + (i < pin ? "set" : "") + '"></i>';
  g.stage.querySelector(".lp-pins").innerHTML = html + '<span class="lp-picks cf-small">Picks: ' + picks + "</span>";
}
function newPin() {
  spot = g.rand() * (1 - zone);
  spotEl.style.left = (spot * 100).toFixed(1) + "%";
  spotEl.style.width = (zone * 100).toFixed(1) + "%";
}
g.loop(function (dt) {
  pos += (dir * speed * dt) / 1000;
  if (pos > 1) { pos = 1; dir = -1; }
  if (pos < 0) { pos = 0; dir = 1; }
  pickEl.style.transform = "translateX(" + (pos * track.clientWidth).toFixed(1) + "px)";
});
function setPin() {
  if (pos >= spot && pos <= spot + zone) {
    pin++;
    g.addScore(10);
    if (pin >= pins) return g.end({ outcome: "win" });
    newPin();
  } else {
    picks--;
    CF.fx.shake(track, { strength: 5 });
    if (picks <= 0) return g.end({ outcome: "loss" });
  }
  drawPins();
}
g.tap(g.stage, ".lp-tap", setPin);
g.keys({ " ": setPin });
newPin();
drawPins();
g.start();`,
  script: "",
};

const hacking: EngineModule = {
  ...base(),
  id: "hacking",
  name: "Hacking",
  description:
    "A breach puzzle: a 4×4 matrix of codes and a sequence of 3 to 5 to find in order before the timer runs out; a wrong code costs 2 seconds. Difficulty from Player.Hacking. Shows g.grid with onTap, g.timer with add, seeded g.pick and g.shuffle.",
  button: "💻 Breach",
  vars: [skill("mg-hack", "Hacking", "Player")],
  rules: [resultRule()],
  regex: [],
  settings: { outcomes: { win: { line: "{{user}} breached the system with {score} points of trace to spare." }, loss: { line: "{{user}}'s breach timed out and the system locked them out." } } },
  css: ".hk { display: flex; flex-direction: column; gap: 8px; padding: 10px; } .hk-seq { display: flex; gap: 6px; flex-wrap: wrap; } .hk-seq span { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--cf-border); font-family: var(--cf-heading); } .hk-seq .now { border-color: var(--cf-accent); color: var(--cf-accent); } .hk-seq .done { opacity: 0.45; text-decoration: line-through; } .hk .cf-game-cell { font-family: var(--cf-heading); } .hk .cf-game-cell.used { opacity: 0.35; }",
  js: `var g = app.game(root, {
  title: "Breach",
  name: "hacking",
  close: true,
  difficulty: { path: "Player.Hacking", min: 0, max: 10, invert: true },
  outcomes: settings.outcomes,
});
var CODES = ["1C", "55", "7A", "BD", "E9", "FF"];
var board = [];
for (var i = 0; i < 16; i++) board.push(g.pick(CODES));
var len = Math.round(g.tune(3, 5));
var target = g.shuffle(board.map(function (c, i) { return i; })).slice(0, len).map(function (i) { return board[i]; });
var at = 0;
g.stage.innerHTML = '<div class="hk"><span class="cf-label">Sequence</span><div class="hk-seq"></div></div>';
function drawSeq() {
  g.stage.querySelector(".hk-seq").innerHTML = target.map(function (c, i) {
    return '<span class="' + (i < at ? "done" : i === at ? "now" : "") + '">' + c + "</span>";
  }).join("");
}
var grid = g.grid({
  el: g.stage.querySelector(".hk"),
  cols: 4,
  rows: 4,
  label: "Code matrix",
  cell: function (x, y) { return { html: board[y * 4 + x], label: "Code " + board[y * 4 + x] }; },
});
var timer = g.timer(Math.round(g.tune(25000, 12000)));
grid.onTap(function (x, y, cell) {
  if (cell.disabled) return;
  if (board[y * 4 + x] === target[at]) {
    cell.disabled = true;
    cell.classList.add("used");
    at++;
    g.addScore(Math.ceil(timer.left() / 1000));
    drawSeq();
    if (at >= target.length) g.end({ outcome: "win" });
  } else {
    timer.add(-2000);
    CF.fx.shake(cell, { strength: 4 });
  }
});
drawSeq();
g.start();`,
  script: "",
};

const cardGame: EngineModule = {
  ...base(),
  id: "card-game",
  name: "Card game: high or low",
  description:
    "High or low with a shuffled deck: guess whether the next card is higher or lower, 3 to 6 right in a row to win the bet. The bet is paid from Player.Coins either way, written with the result (g.end with set). Difficulty from Player.Gambling. Shows g.shuffle on a seeded deck, g.keys, a computed set and {placeholders} in the outcome lines.",
  button: "🃏 Cards",
  vars: [
    newVar({ id: "mg-coins", group: "Player", name: "Coins", type: "number", start: "50", min: 0, rule: "Coins {{user}} carries: + when paid or winning, − when spending or losing." }),
    skill("mg-gamble", "Gambling", "Player", "2"),
  ],
  rules: [resultRule()],
  regex: [],
  settings: {
    bet: 10,
    outcomes: { win: { line: "{{user}} won {bet} coins at high or low." }, loss: { line: "{{user}} lost {bet} coins at high or low." } },
  },
  css: ".hl { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; } .hl-card { width: 110px; aspect-ratio: 5 / 7; border-radius: 10px; background: var(--cf-surface); border: 1px solid var(--cf-border); box-shadow: var(--cf-shadow); display: grid; place-items: center; font-family: var(--cf-heading); } .hl-rank { font-size: 2.4em; line-height: 1; } .hl-suit { font-size: 1.6em; } .hl-suit.red { color: var(--cf-bad); } .hl .cf-row { width: 100%; } .hl .cf-row .cf-btn { flex: 1; min-height: 48px; justify-content: center; }",
  js: `var bet = Number(settings.bet) || 10;
var coins = Number(app.state("Player.Coins")) || 0;
var g = app.game(root, {
  title: "High or low",
  name: "card-game",
  close: true,
  difficulty: { path: "Player.Gambling", min: 0, max: 10, invert: true },
  outcomes: settings.outcomes,
});
var NAMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
var deck = [];
["♠", "♥", "♦", "♣"].forEach(function (s) { for (var r = 1; r <= 13; r++) deck.push({ r: r, s: s }); });
deck = g.shuffle(deck);
var need = Math.round(g.tune(3, 6));
var streak = 0;
var card = deck.pop();
g.stage.innerHTML =
  '<div class="hl"><div class="hl-card" aria-live="polite"></div><p class="cf-small cf-muted hl-need"></p>' +
  '<div class="cf-row"><button type="button" class="cf-btn" data-guess="lower">Lower</button><button type="button" class="cf-btn" data-guess="higher">Higher</button></div></div>';
function draw() {
  var red = card.s === "♥" || card.s === "♦";
  g.stage.querySelector(".hl-card").innerHTML = '<div><div class="hl-rank">' + NAMES[card.r] + '</div><div class="hl-suit' + (red ? " red" : "") + '">' + card.s + "</div></div>";
  g.stage.querySelector(".hl-card").setAttribute("aria-label", NAMES[card.r] + " of " + card.s);
  g.stage.querySelector(".hl-need").textContent = streak + " of " + need + " right · bet " + bet;
}
function guess(higher) {
  var next = deck.pop();
  var right = next.r === card.r || (next.r > card.r) === higher;
  card = next;
  draw();
  if (!right) return g.end({ outcome: "loss", bet: bet, set: { "Player.Coins": Math.max(0, coins - bet) } });
  streak++;
  g.addScore(10);
  if (streak >= need) g.end({ outcome: "win", bet: bet, set: { "Player.Coins": coins + bet } });
  else draw();
}
g.tap(g.stage, "[data-guess]", function (b) { guess(b.getAttribute("data-guess") === "higher"); });
g.keys({ ArrowUp: function () { guess(true); }, ArrowDown: function () { guess(false); } });
draw();
g.start();`,
  script: "",
};

const matching: EngineModule = {
  ...base(),
  id: "matching",
  name: "Matching puzzle",
  description:
    "Memory: 4 to 8 pairs of face-down cards on a board; turn two at a time to find the pairs before the timer ends. Difficulty from Player.Wits. Shows g.grid with set labels, g.after (game time, so a pause holds it), and a combo-free timer.",
  button: "🧩 Memory",
  vars: [skill("mg-wits", "Wits", "Player")],
  rules: [resultRule()],
  regex: [],
  settings: { outcomes: { win: { line: "{{user}} solved the puzzle." }, loss: { line: "{{user}} ran out of time on the puzzle." } } },
  css: ".mt .cf-game-cell { background: var(--cf-accent); color: var(--cf-bg); } .mt .cf-game-cell.shown { background: var(--cf-surface); color: var(--cf-accent); } .mt .cf-game-cell.found { background: color-mix(in srgb, var(--cf-good) 25%, var(--cf-surface)); color: var(--cf-good); } .mt .cf-icon { width: 1.4em; height: 1.4em; }",
  js: `var g = app.game(root, {
  title: "Memory",
  name: "matching",
  close: true,
  difficulty: { path: "Player.Wits", min: 0, max: 10, invert: true },
  outcomes: settings.outcomes,
});
g.stage.classList.add("mt");
var pairs = 2 * Math.round(g.tune(2, 4)); // 4, 6 or 8 pairs: whole rows of 4
var faces = g.shuffle(["star", "heart", "moon", "sun", "bolt", "fire", "gift", "shield", "compass", "skull"]).slice(0, pairs);
var deck = g.shuffle(faces.concat(faces));
var open = [], found = 0, busy = false;
var grid = g.grid({ cols: 4, rows: pairs / 2, label: "Cards", cell: function () { return { html: "", label: "Hidden card" }; } });
g.timer(Math.round(g.tune(60000, 35000)));
function hide(c) {
  c.cell.classList.remove("shown");
  c.cell.innerHTML = "";
  c.cell.setAttribute("aria-label", "Hidden card");
}
grid.onTap(function (x, y, cell) {
  if (busy || cell.classList.contains("shown")) return;
  var i = y * 4 + x;
  cell.classList.add("shown");
  cell.innerHTML = CF.ui.icon(deck[i]);
  cell.setAttribute("aria-label", deck[i]);
  open.push({ cell: cell, i: i });
  if (open.length < 2) return;
  var a = open[0], b = open[1];
  open = [];
  if (deck[a.i] === deck[b.i]) {
    found++;
    g.addScore(20);
    a.cell.classList.add("found");
    b.cell.classList.add("found");
    if (found === pairs) g.end({ outcome: "win" });
  } else {
    busy = true;
    g.after(700, function () { hide(a); hide(b); busy = false; });
  }
});
g.start();`,
  script: "",
};

const timedChoice: EngineModule = {
  ...base(),
  id: "timed-choice",
  name: "Timed choice",
  description:
    "A split-second decision: a question, two or three choices and a countdown (shorter when Story.Tension is high). The choice's own line goes to the model; running out of time sends the hesitation line. All the words are in the module's settings, for the co-writer to write. Shows g.timer with onEnd and custom outcomes.",
  button: "⏱️ Decide",
  vars: [newVar({ id: "mg-tension", group: "Story", name: "Tension", type: "number", start: "30", min: 0, max: 100, rule: "How tense the scene is, 0 to 100: up in danger and conflict, down when things calm." })],
  rules: [resultRule()],
  regex: [],
  settings: {
    question: "The rope bridge is giving way, and Mina is still on the far side.",
    choices: [
      { label: "Run for it", line: "{{user}} sprinted across as the bridge gave way behind them." },
      { label: "Reach for Mina", line: "{{user}} went back for Mina and grabbed her hand as the ropes snapped." },
      { label: "Cut the ropes", line: "{{user}} cut the ropes, leaving Mina on the far side." },
    ],
    timeout: "{{user}} froze, and the bridge fell before they moved.",
  },
  css: ".tc { display: flex; flex-direction: column; gap: 14px; padding: 16px; } .tc-q { margin: 0; font-size: 1.1em; } .tc .cf-btn { min-height: 48px; justify-content: flex-start; }",
  js: `var g = app.game(root, {
  title: "Decide",
  name: "timed-choice",
  close: true,
  difficulty: { path: "Story.Tension", min: 0, max: 100 },
});
var choices = settings.choices || [];
g.stage.innerHTML =
  '<div class="tc"><p class="tc-q">' + CF.ui.esc(settings.question) + '</p><div class="cf-stack">' +
  choices.map(function (c, i) { return '<button type="button" class="cf-btn" data-i="' + i + '">' + CF.ui.esc(c.label) + "</button>"; }).join("") +
  "</div></div>";
g.timer(Math.round(g.tune(9000, 3500)), {
  onEnd: function () { g.end({ outcome: "timeout", title: "Too slow", line: settings.timeout }); },
});
g.tap(g.stage, "[data-i]", function (b) {
  var c = choices[Number(b.getAttribute("data-i"))];
  g.end({ outcome: "choice", title: c.label, line: c.line, choice: c.label });
});
g.start();`,
  script: "",
};

const quickTime: EngineModule = {
  ...base(),
  id: "quick-time",
  name: "Quick-time event",
  description:
    "A quick-time event: six arrows flash one at a time; swipe, press the arrow key or tap the pad before it fades. Hits build a combo that multiplies the score; 3 to 5 hits win. Difficulty from Player.Reflexes (the window shrinks). Shows g.swipe (with the arrow keys), g.combo, g.loop timing on the game clock and g.after.",
  button: "⚡ React",
  vars: [skill("mg-reflex", "Reflexes", "Player")],
  rules: [resultRule()],
  regex: [],
  settings: { outcomes: { win: { line: "{{user}} reacted in time, {hits} of 6." }, loss: { line: "{{user}} was too slow, {hits} of 6." } } },
  css: ".qt { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px; } .qt-prompt { width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; font-size: 3em; background: var(--cf-surface); border: 2px solid var(--cf-border); } .qt-prompt.on { border-color: var(--cf-accent); color: var(--cf-accent); } .qt-prompt.hit { border-color: var(--cf-good); color: var(--cf-good); } .qt-prompt.miss { border-color: var(--cf-bad); color: var(--cf-bad); } .qt-pad { display: grid; grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(2, 52px); gap: 6px; } .qt-pad .cf-btn { min-height: 52px; font-size: 1.3em; justify-content: center; } .qt-pad [data-dir=up] { grid-column: 2; } .qt-pad [data-dir=left] { grid-column: 1; grid-row: 2; } .qt-pad [data-dir=down] { grid-column: 2; grid-row: 2; } .qt-pad [data-dir=right] { grid-column: 3; grid-row: 2; }",
  js: `var g = app.game(root, {
  title: "Quick time",
  name: "quick-time",
  close: true,
  difficulty: { path: "Player.Reflexes", min: 0, max: 10, invert: true },
  outcomes: settings.outcomes,
});
var ARROWS = { up: "↑", down: "↓", left: "←", right: "→" };
var total = 6, need = Math.round(g.tune(3, 5)), limit = g.tune(1600, 750);
var shown = 0, hits = 0, prompt = null;
var combo = g.combo();
g.stage.innerHTML =
  '<div class="qt"><div class="qt-prompt" aria-live="assertive"></div><p class="cf-small cf-muted">Swipe, press the arrow or tap it below.</p><div class="qt-pad">' +
  Object.keys(ARROWS).map(function (d) { return '<button type="button" class="cf-btn" data-dir="' + d + '" aria-label="' + d + '">' + ARROWS[d] + "</button>"; }).join("") +
  "</div></div>";
var face = g.stage.querySelector(".qt-prompt");
function next() {
  if (shown >= total) return g.end({ outcome: hits >= need ? "win" : "loss", hits: hits });
  var d = g.pick(Object.keys(ARROWS));
  shown++;
  prompt = { d: d, at: g.time() };
  face.textContent = ARROWS[d];
  face.className = "qt-prompt on";
}
function answer(d) {
  if (!prompt) return;
  var ok = d === prompt.d;
  prompt = null;
  face.className = "qt-prompt " + (ok ? "hit" : "miss");
  if (ok) {
    hits++;
    g.addScore(10 * combo.mult());
    combo.hit();
  } else combo.miss();
  g.after(400, next);
}
g.loop(function () {
  if (prompt && g.time() - prompt.at > limit) {
    prompt = null;
    combo.miss();
    face.className = "qt-prompt miss";
    g.after(400, next);
  }
});
g.swipe(g.stage, answer);
g.tap(g.stage, "[data-dir]", function (b) { answer(b.getAttribute("data-dir")); });
g.start().then(function () { g.after(600, next); });`,
  script: "",
};

export const MINIGAME_TEMPLATES: EngineModule[] = [lockpicking, hacking, cardGame, matching, timedChoice, quickTime];
