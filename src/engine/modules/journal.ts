/**
 * Shared part: the journal. The model notes the day's key events in Journal.Today as it plays (no
 * extra calls). When the day rolls over, the engine files them under that day, out of the state the
 * model reads every turn, and sends the last few days back as a short memory instead. With "write it
 * up" on (and the player's side calls allowed), a quiet side call turns each finished day into a
 * few sentences. The player reads it all in the journal screen.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export interface JournalSettings {
  title: string;
  button: string;
  /** Days sent back to the model as memory. */
  remember: number;
  /** Depth in the chat the memory goes in. */
  depth: number;
  /** A side call writes each finished day up as a short entry. */
  writeUp: boolean;
}

export const defaultJournalSettings = (): JournalSettings => ({ title: "Journal", button: "📖 Journal", remember: 3, depth: 4, writeUp: false });

const int = (v: unknown, fallback: number, min: number, max: number) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback);

export function journalSettings(raw: Record<string, unknown> | undefined): JournalSettings {
  const base = defaultJournalSettings();
  if (!raw) return base;
  return {
    title: typeof raw.title === "string" ? raw.title : base.title,
    button: typeof raw.button === "string" && raw.button.trim() ? raw.button : base.button,
    remember: int(raw.remember, base.remember, 0, 30),
    depth: int(raw.depth, base.depth, 1, 20),
    writeUp: raw.writeUp === true,
  };
}

/** About what one write-up costs: the day's lines and the instructions in, a few sentences out. */
export const WRITE_UP_TOKENS = 450;

// Runs in the card's script with CF, settings and hooks. Plain ES5 for any WebView.
const SCRIPT = String.raw`
var ID = "cardforge-journal";
function memory(stat) {
  var j = stat && stat.Journal;
  var past = j && Array.isArray(j.$Past) ? j.$Past : [];
  var keep = settings.remember > 0 ? past.slice(-settings.remember) : [];
  try {
    if (typeof uninjectPrompts === "function") uninjectPrompts([ID]);
    if (keep.length && typeof injectPrompts === "function")
      injectPrompts([{ id: ID, position: "in_chat", depth: settings.depth, role: "system", should_scan: false,
        content: "<journal>\nEarlier days, for continuity:\n" + keep.join("\n") + "\n</journal>" }]);
  } catch (e) {}
}
function writeUp(day, lines) {
  if (!settings.writeUp || !lines.length || CF.settings().sideCalls === false || typeof generateRaw !== "function") return;
  generateRaw({
    ordered_prompts: [
      { role: "system", content: "You keep {{user}}'s journal. Write the day as two to four plain sentences in the past tense, from {{user}}'s side, keeping every name, promise and discovery. No headings, no lists." },
      { role: "user", content: "Day " + day + ":\n- " + lines.join("\n- ") },
    ],
    should_silence: true,
  }).then(function (text) {
    text = String(text || "").trim();
    if (!text) return;
    var past = (CF.state.get("Journal.$Past") || []).slice();
    var at = past.findIndex(function (p) { return p.indexOf("Day " + day + ":") === 0; });
    if (at < 0) return;
    past[at] = "Day " + day + ": " + text.replace(/\s+/g, " ");
    return CF.state.set(["Journal", "$Past"], past);
  }).catch(function (e) { console.warn("[CardForge] The journal write-up failed.", e); });
}
hooks.afterUpdate(function (stat, before, info) {
  var j = stat.Journal && typeof stat.Journal === "object" ? stat.Journal : (stat.Journal = {});
  if (!Array.isArray(j.Today)) j.Today = [];
  if (!Array.isArray(j.$Past)) j.$Past = [];
  var day = stat.Time && Number(stat.Time.Day);
  var was = before && before.Time && Number(before.Time.Day);
  // A new day: the day's lines (with any from the reply that crossed midnight) are filed under it.
  if (day && was && day > was) {
    var lines = j.Today.slice();
    if (lines.length) {
      j.$Past = j.$Past.filter(function (p) { return p.indexOf("Day " + was + ":") !== 0; }).concat(["Day " + was + ": " + lines.join(" ")]);
      if (info && info.latest) setTimeout(function () { writeUp(was, lines); }, 0);
    }
    j.Today = [];
  }
  if (!info || info.latest) memory(stat);
  return stat;
});
`;

const JS = String.raw`
var esc = CF.ui.esc;
function render() {
  var j = app.state("Journal") || {};
  var today = Array.isArray(j.Today) ? j.Today : [];
  var past = Array.isArray(j.$Past) ? j.$Past.slice().reverse() : [];
  var day = app.state("Time.Day");
  var html = CF.ui.appBar(settings.title || "Journal") + '<div class="cf-appbody cf-stack">';
  html += '<section class="jr-day cf-card"><h3>' + (day ? "Today · Day " + esc(day) : "Today") + "</h3>" +
    (today.length ? "<ul>" + today.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" : '<p class="cf-small cf-muted">Nothing worth writing down yet.</p>') + "</section>";
  past.forEach(function (p) {
    var m = /^(Day \d+):\s*([\s\S]*)$/.exec(p);
    html += '<section class="jr-day cf-card"><h3>' + esc(m ? m[1] : "Earlier") + "</h3><p>" + esc(m ? m[2] : p) + "</p></section>";
  });
  root.innerHTML = '<div class="cf-app jr">' + html + "</div></div>";
}
render();
app.onState(render);
`;

const CSS = String.raw`
.jr-day h3 { font-family: var(--cf-heading); font-size: 1em; color: var(--cf-accent); margin-bottom: 6px; }
.jr-day ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.jr-day p { line-height: 1.55; }
`;

export function journalModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const s = journalSettings(raw);
  return {
    id: "journal",
    name: "Journal",
    version: "1.0.0",
    description: "The day's key events, filed by day and sent back as a short memory; optionally written up by a side call.",
    slot: "overlay",
    button: s.button,
    tags: ["built-in", "journal", "memory"],
    requires: ["time"],
    core: "journal",
    enabled,
    vars: [
      newVar({
        id: "journal-today",
        group: "Journal",
        name: "Today",
        type: "list",
        start: "",
        pinned: false,
        rule: "Today's key events, one short line each (a promise, a fight, a discovery, a first). Insert one only when something happens that matters later; the engine files them when the day ends.",
      }),
      newVar({ id: "journal-past", group: "Journal", name: "Past", type: "list", start: "", hidden: true, pinned: false, rule: "Finished days, filed by the engine." }),
    ],
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: s as unknown as Record<string, unknown>,
  };
}
