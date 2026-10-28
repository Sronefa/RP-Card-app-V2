/**
 * Checks on the engine the UI engineer builds, so it can fix problems before the user sees them.
 * The static checks read the config; the screen checks (overflow, contrast, tap targets) come from
 * the preview page and are turned into findings here.
 */
import { estimateTokens } from "../../lib/tokens";
import { originalOf, originalUpdated } from "../modules/fork";
import { effectiveConfig, modulesOf } from "../modules/compile";
import type { EngineModule } from "../modules/types";
import { runtime, sceneCheck, scriptSource } from "../runtime";
import { rulesText, settingsSource, themeOf, varPath, type EngineConfig } from "../sheet";
import { cleanMoods, cleanPortraits } from "../theme";
import type { ScreenReport } from "../sandbox/sandbox";

export interface Finding {
  level: "error" | "warn" | "info";
  check:
    | "network"
    | "syntax"
    | "size"
    | "values"
    | "actions"
    | "tokens"
    | "theme"
    | "overflow"
    | "contrast"
    | "targets"
    | "text size"
    | "overlap"
    | "images"
    | "hidden"
    | "console"
    | "motion"
    | "scene"
    | "module";
  message: string;
}

/** The card script's size above which phones start to feel it. */
export const SCRIPT_BUDGET = 400 * 1024;
/** Always-on rules above this many tokens a turn get a warning. */
export const TOKEN_BUDGET = 1500;

const NETWORK: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bimport\s*\(/, "import()"],
  [/<script[^>]*\bsrc\s*=/i, "<script src>"],
  [/<link[^>]*\bhref\s*=\s*["']?https?:/i, "<link href>"],
  [/@import\b/, "@import"],
  [/url\(\s*["']?(?:https?:)?\/\//i, "url() of an outside address"],
  [/["'`]https?:\/\/[^"'`\s]+/, "an http(s) address"],
];

const CODE_FILES = ["html", "css", "js", "script"] as const;

/** Paths a screen or script reads with app.state, CF.state.get or app.set. */
export function statePaths(code: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:app\.state|CF\.state\.get|CardForge\.state\.get|app\.set|CF\.state\.set)\(\s*(["'])([^"'\n]+)\1/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.add(m[2]);
  return [...out];
}

/** App names a module sends actions as. */
export function actionNames(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:\bapp\.send\(\s*|\bsend\s*:\s*|data-cf-send\s*=\s*\\?["'])(["']?)([\w-]+)\1/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.add(m[2]);
  return [...out];
}

function knownPaths(config: EngineConfig) {
  const vars = effectiveConfig(config).vars.filter((v) => v.name.trim());
  return vars.map((v) => ({ path: varPath(v).join("."), open: v.type === "counts" || v.type === "list" }));
}

/** Whether a path names a value, a group of values, or an entry inside a list or counts value. */
function pathKnown(path: string, known: { path: string; open: boolean }[]) {
  let parts: string[];
  try {
    parts = runtime.cfPath(path);
  } catch {
    return true;
  }
  const p = parts.join(".");
  return known.some((k) => k.path === p || k.path.startsWith(`${p}.`) || (k.open && p.startsWith(`${k.path}.`)));
}

function syntaxError(m: EngineModule, file: "js" | "script"): string | undefined {
  if (!m[file].trim()) return;
  try {
    if (file === "js") new Function("CF", "app", "root", "settings", m[file]);
    else new Function("CF", "settings", "hooks", m[file]);
  } catch (e) {
    return (e as Error).message;
  }
}

const LAYOUT_PROPS = /(?:^|[;{\s])(?:top|left|right|bottom|width|height|margin(?:-\w+)?)\s*:/;

/** Whether CSS animates or transitions a layout property. */
export function animatesLayout(css: string): boolean {
  if (/transition(?:-property)?\s*:[^;}]*\b(?:width|height|top|left|right|bottom|margin|all)\b/.test(css)) return true;
  const frames = /@keyframes[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g;
  for (let m = frames.exec(css); m; m = frames.exec(css)) if (LAYOUT_PROPS.test(m[1])) return true;
  return false;
}

/** Values a module reads that don't exist, and actions it sends that no rule explains. */
function readFindings(m: EngineModule, known: { path: string; open: boolean }[], ruleText: string): Finding[] {
  const out: Finding[] = [];
  const code = m.html + "\n" + m.js + "\n" + m.script;
  for (const path of statePaths(code))
    if (!pathKnown(path, known))
      out.push({
        level: "error",
        check: "values",
        message: `${m.id} reads "${path}", but the sheet and modules have no such value. Add it with set_value, or fix the path.`,
      });
  for (const name of actionNames(code))
    if (!ruleText.includes(`app="${name}"`))
      out.push({
        level: "warn",
        check: "actions",
        message: `${m.id} sends <action app="${name}"> but no rule tells the model what it means. Add one with add_rule.`,
      });
  return out;
}

/** Checks that need no page: code, values, actions, size and token cost. */
export function lintConfig(config: EngineConfig): Finding[] {
  const out: Finding[] = [];
  const modules = modulesOf(config).filter((m) => m.enabled);
  const known = knownPaths(config);
  const ruleText = modules.flatMap((m) => m.rules.flatMap((r) => [r.content, ...r.keys])).join("\n");

  for (const m of modules) {
    if (m.core) continue;
    // Scenes kept in a module's settings ({ scenes: { intro: [steps] } }) must play.
    const scenes = m.settings?.scenes;
    if (scenes && typeof scenes === "object" && !Array.isArray(scenes))
      for (const [name, steps] of Object.entries(scenes))
        for (const problem of sceneCheck(steps)) out.push({ level: "error", check: "scene", message: `${m.id} scene "${name}": ${problem}` });
    // A fork's untouched files are CardForge's code: only what the card changed is checked.
    const pristine = m.fork ? originalOf(m.fork.core, m.fork.settings) : undefined;
    const where = (f: string) => `${m.id}/${f}`;
    for (const f of CODE_FILES) {
      const code = m[f];
      if (!code || (pristine && pristine[f] === code)) continue;
      for (const [re, what] of NETWORK)
        if (re.test(code))
          out.push({
            level: "error",
            check: "network",
            message: `${where(f)} uses ${what}. Cards run offline: nothing may load from the network. Inline it, or use app.asset() for card images.`,
          });
      if (f === "css" && animatesLayout(code))
        out.push({
          level: "warn",
          check: "motion",
          message: `${where(f)} animates layout (width, height, top, left or margin), which stutters on phones. Animate transform and opacity instead.`,
        });
      if ((f === "js" || f === "script") && /\.animate\s*\(|requestAnimationFrame\s*\(/.test(code) && !/\bfx\.reduced\s*\(|prefers-reduced-motion/.test(code))
        out.push({
          level: "warn",
          check: "motion",
          message: `${where(f)} animates from script without checking for less motion. Use CF.fx (which honors the player's Motion setting), or skip the animation when CF.fx.reduced(root) is true.`,
        });
      if (/<\/script/i.test(code))
        out.push({
          level: "error",
          check: "syntax",
          message: `${where(f)} contains a literal "</script", which ends the card script early. Write "<\\/script" instead.`,
        });
      if (f === "css" && /:[^;{}]*#[0-9a-f]{3,8}(?![\w-])[^{]*?[;}]/i.test(code.replace(/var\([^)]*\)/g, "")))
        out.push({
          level: "warn",
          check: "theme",
          message: `${where(f)} has fixed colours. Use the theme variables (var(--cf-text), var(--cf-accent)…) so the screen follows the card theme and light or dark mode.`,
        });
    }
    for (const f of ["js", "script"] as const) {
      const error = syntaxError(m, f);
      if (error) out.push({ level: "error", check: "syntax", message: `${where(f)} doesn't parse: ${error}` });
    }
    // What CardForge's own code already does isn't the fork's to fix.
    const inherited = new Set(pristine ? readFindings({ ...m, html: pristine.html, js: pristine.js, script: pristine.script }, known, ruleText).map((f) => f.message) : []);
    out.push(...readFindings(m, known, ruleText).filter((f) => !inherited.has(f.message)));
    if (m.slot === "overlay" && !m.button?.trim())
      out.push({ level: "warn", check: "module", message: `${m.id} is a hub screen without a button, so the player can't open it.` });
    if (m.slot !== "script" && !m.html.trim() && !m.js.trim())
      out.push({ level: "warn", check: "module", message: `${m.id} has no html or js, so its screen is empty.` });
    for (const r of m.rules)
      if (r.depth === 0)
        out.push({
          level: "error",
          check: "module",
          message: `${m.id}'s rule "${r.comment}" is at depth 0, which is the player's message.`,
        });
    if (pristine && originalUpdated(m))
      out.push({
        level: "info",
        check: "module",
        message: `${m.id} is a fork of CardForge's ${m.fork!.core}, which has been updated since. The fork keeps its own code; tell the user if they want the original's changes.`,
      });
  }

  // Moods and portraits that follow the state must follow values that exist.
  const theme = themeOf(config);
  const follows = [
    ...cleanMoods(theme.moods).map((m) => ({ what: `The ${m.name} mood`, path: m.path })),
    ...cleanPortraits(theme.portraits).flatMap((b) =>
      [b.emotion, b.outfit, b.hurt?.path].filter((p): p is string => !!p).map((path) => ({ what: `${b.name}'s portrait`, path })),
    ),
  ];
  for (const f of follows)
    if (!pathKnown(f.path, known))
      out.push({ level: "error", check: "values", message: `${f.what} follows "${f.path}", but the sheet and modules have no such value. Add it with set_value, or fix the path.` });

  const size = scriptSource(settingsSource(config)).length;
  const kb = Math.round(size / 1024);
  if (size > SCRIPT_BUDGET)
    out.push({
      level: "warn",
      check: "size",
      message: `The card script is ${kb} KB, over the ${SCRIPT_BUDGET / 1024} KB budget. Phones load it every time the chat opens: trim code or split rarely used screens out.`,
    });
  else out.push({ level: "info", check: "size", message: `The card script is ${kb} KB of ${SCRIPT_BUDGET / 1024} KB.` });

  const always =
    rulesText(effectiveConfig(config)) + modules.flatMap((m) => m.rules.filter((r) => r.constant).map((r) => r.content)).join("\n");
  const tokens = estimateTokens(always);
  out.push({
    level: tokens > TOKEN_BUDGET ? "warn" : "info",
    check: "tokens",
    message: `Always-on rules cost about ${tokens} tokens a turn${tokens > TOKEN_BUDGET ? `, over ${TOKEN_BUDGET}. Shorten value rules, or key situational rules so they're sent only when needed` : ""}.`,
  });
  return out;
}

/** Findings from the preview's inspection of each screen. */
export function screenFindings(screens: ScreenReport[], device: string): Finding[] {
  const out: Finding[] = [];
  for (const s of screens) {
    for (const o of s.overflow)
      out.push({ level: "error", check: "overflow", message: `${s.screen} on ${device}: scrolls sideways, ${o}.` });
    for (const c of s.contrast)
      out.push({
        level: "warn",
        check: "contrast",
        message: `${s.screen} on ${device}: low contrast ${c} (needs 4.5:1, or 3:1 for large text).`,
      });
    for (const t of s.smallTargets)
      out.push({ level: "warn", check: "targets", message: `${s.screen} on ${device}: tap target ${t}, smaller than 30×30.` });
    for (const t of s.smallText ?? [])
      out.push({ level: "warn", check: "text size", message: `${s.screen} on ${device}: text ${t}, too small to read on a phone (12px or more).` });
    for (const o of s.overlaps ?? []) out.push({ level: "warn", check: "overlap", message: `${s.screen} on ${device}: ${o}.` });
    for (const i of s.emptyImages ?? []) out.push({ level: "warn", check: "images", message: `${s.screen} on ${device}: image ${i}.` });
    for (const b of s.hiddenButtons ?? []) out.push({ level: "warn", check: "hidden", message: `${s.screen} on ${device}: button ${b}.` });
  }
  return out;
}

export function findingsText(findings: Finding[]): string {
  if (!findings.length) return "No problems found.";
  const order = { error: 0, warn: 1, info: 2 };
  return [...findings]
    .sort((a, b) => order[a.level] - order[b.level])
    .map((f) => `- ${f.level === "error" ? "ERROR" : f.level === "warn" ? "warning" : "note"} [${f.check}] ${f.message}`)
    .join("\n");
}
