/**
 * Library part: the choice menu. At a moment that matters the model ends its reply with
 * <cf-module id="choices"/> and puts two to four options in Choices.Options; the block shows them as
 * buttons, with an optional countdown for tense moments. A tap sends the choice as an action at once.
 * Older menus stay as a record of what was offered.
 */
import { newVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface ChoicesSettings {
  /** Seconds to choose; 0 for no timer. */
  timer: number;
  /** Sent when the timer runs out. */
  timeout: string;
  /** Let the player type their own answer too. */
  own: boolean;
  /** When the model offers a menu: "key" moments only, or "often". */
  frequency: "key" | "often";
}

export const defaultChoicesSettings = (): ChoicesSettings => ({
  timer: 0,
  timeout: "I hesitate too long, and the moment decides for me.",
  own: true,
  frequency: "key",
});

export function choicesSettings(raw: Record<string, unknown> | undefined): ChoicesSettings {
  const base = defaultChoicesSettings();
  if (!raw) return base;
  return {
    timer: Number.isFinite(Number(raw.timer)) ? Math.max(0, Math.min(120, Math.round(Number(raw.timer)))) : base.timer,
    timeout: typeof raw.timeout === "string" ? raw.timeout : base.timeout,
    own: raw.own !== false,
    frequency: raw.frequency === "often" ? "often" : "key",
  };
}

function choicesRules(s: ChoicesSettings): ModuleRule[] {
  const when =
    s.frequency === "often"
      ? "When {{user}} faces a decision, end the reply with"
      : "Only at a moment that matters (a confession, a dilemma, a fork in the story), end the reply with";
  return [
    {
      comment: "Choice menu",
      content: `${when} <cf-module id="choices"/> on its own line, and in the same reply's update block replace /Choices/Options with 2 to 4 short options in {{user}}'s voice. Don't write {{user}}'s choice yourself.`,
      constant: true,
      keys: [],
      depth: 2,
      order: 100,
    },
    {
      comment: "Choice made",
      content: '<action app="choices"> is the option {{user}} picked ({"pick":X}) or {"timeout":true} when they ran out of time. Continue from it.',
      constant: false,
      keys: ['app="choices"'],
      depth: 2,
      order: 100,
    },
  ];
}

const JS = String.raw`
var esc = CF.ui.esc;
var opts = app.state("Choices.Options");
opts = Array.isArray(opts) ? opts.filter(Boolean).slice(0, 6) : [];
// Only the newest menu can be answered; older ones are a record.
var live = app.messageId === "latest" || app.messageId >= CF.state.latestId();
var done = false, timer = null, left = settings.timer;
function pick(payload, text) {
  if (done) return;
  done = true;
  if (timer) clearInterval(timer);
  draw(text);
  app.send("choices", payload, text, { now: true }).catch(function (e) { done = false; app.toast("Couldn't send: " + e.message); draw(); });
}
function draw(chosen) {
  if (!opts.length) { root.innerHTML = ""; return; }
  var on = live && !done;
  root.innerHTML = '<div class="ch' + (on ? "" : " old") + '" role="group" aria-label="Choices">' +
    (on && settings.timer ? '<div class="ch-timer" aria-hidden="true"><i style="animation-duration:' + settings.timer + 's"></i></div><span class="ch-left cf-small" aria-live="polite">' + left + "s</span>" : "") +
    opts.map(function (o, i) {
      return '<button type="button" class="ch-opt' + (chosen === o ? " picked" : "") + '" data-pick="' + i + '"' + (on ? "" : " disabled") + '><span class="ch-n">' + (i + 1) + "</span><span>" + esc(o) + "</span></button>";
    }).join("") +
    (on && settings.own ? '<form class="ch-own" data-own><input class="cf-input" name="text" placeholder="Or say something else" aria-label="Your own answer" autocomplete="off"><button type="submit" class="cf-btn">Say it</button></form>' : "") +
    "</div>";
}
root.addEventListener("click", function (e) {
  var b = e.target.closest("[data-pick]");
  if (b && !b.disabled) { var o = opts[Number(b.getAttribute("data-pick"))]; return pick({ pick: o }, o); }
  var s = e.target.closest("[data-own] [type=submit]");
  if (s) { e.preventDefault(); own(s.closest("[data-own]")); }
});
root.addEventListener("submit", function (e) { var f = e.target.closest("[data-own]"); if (f) { e.preventDefault(); own(f); } });
function own(form) {
  var text = form.querySelector("[name=text]").value.trim();
  if (text) pick({ pick: text }, text);
}
draw();
if (live && settings.timer && opts.length) {
  timer = setInterval(function () {
    left--;
    var el = root.querySelector(".ch-left");
    if (el) el.textContent = left + "s";
    if (left <= 0) pick({ timeout: true }, settings.timeout);
  }, 1000);
}
`;

const CSS = String.raw`
.ch { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.ch-opt { font: inherit; color: var(--cf-text); text-align: left; display: flex; align-items: center; gap: 10px; padding: 10px 14px; min-height: 48px; border-radius: calc(var(--cf-radius) + 4px); border: 1px solid var(--cf-border); background: var(--cf-surface); cursor: pointer; box-shadow: var(--cf-shadow); transition: transform .12s, border-color .12s, background .12s; animation: ch-in .35s ease both; }
.ch-opt:nth-of-type(2) { animation-delay: .06s; } .ch-opt:nth-of-type(3) { animation-delay: .12s; } .ch-opt:nth-of-type(4) { animation-delay: .18s; }
.ch-opt:hover:not(:disabled), .ch-opt:focus-visible { border-color: var(--cf-accent); transform: translateX(3px); }
.ch-opt:disabled { cursor: default; opacity: .55; box-shadow: none; }
.ch-opt.picked { opacity: 1; border-color: var(--cf-accent); background: color-mix(in srgb, var(--cf-accent) 14%, var(--cf-surface)); }
.ch-n { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: .8em; font-weight: 700; background: var(--cf-accent); color: #fff; }
.ch.old .ch-n { background: var(--cf-surface2); color: var(--cf-muted); }
.ch-timer { height: 4px; border-radius: 999px; background: var(--cf-surface2); overflow: hidden; }
.ch-timer i { display: block; height: 100%; background: var(--cf-accent); transform-origin: left; animation: ch-time linear forwards; }
.ch-left { align-self: flex-end; color: var(--cf-muted); margin-top: -6px; }
.ch-own { display: flex; gap: 6px; }
.ch-own .cf-input { flex: 1; min-width: 0; }
@keyframes ch-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ch-time { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) { .ch-opt { animation: none; transition: none; } }
`;

export function choicesModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = choicesSettings(raw);
  return {
    id: "choices",
    name: "Choice menu",
    version: "1.0.0",
    description: "Buttons at key moments, with an optional timer; the choice is sent as an action.",
    slot: "message",
    tags: ["built-in", "choices", "inline", "vn"],
    requires: [],
    core: "choices",
    enabled,
    vars: [newVar({ id: "choices-options", group: "Choices", name: "Options", type: "list", start: "", pinned: false, rule: "The options of the latest choice menu, replaced each time one is shown." })],
    rules: choicesRules(settings),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: settings as unknown as Record<string, unknown>,
  };
}
