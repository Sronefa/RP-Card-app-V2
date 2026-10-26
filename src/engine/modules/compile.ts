/**
 * Merging modules into one card: their values join the variable sheet, their rules become lorebook
 * entries, their regex joins the card's, and their screens and scripts ship inside the engine's
 * Tavern Helper script. Conflicts (two modules on one value path, one id or one hub button, a
 * missing dependency) are found here and shown to the author.
 */
import type { SillyTavernRegex } from "../../editor/trackers";
import { varLabel, varPath, type EngineConfig, type EngineVar } from "../sheet";
import { creatorModule } from "./creator";
import { eventsModule } from "./events";
import { journalModule } from "./journal";
import { menuModule } from "./menu";
import { notifyModule } from "./notify";
import { peopleModule, valueKey } from "./people";
import { phoneModule } from "./phone";
import { settingsAppModule } from "./settingsApp";
import { timeModule } from "./time";
import { titleModule } from "./title";
import type { EngineModule, ModuleRegex } from "./types";

/** The core modules every engine card starts with. */
export const coreModules = (): EngineModule[] => [timeModule(), settingsAppModule()];

/** The value that tells the model what the player changed by hand. */
// A plain object: this file and sheet.ts import each other, so nothing here runs sheet code on load.
export const PLAYER_EDITS: EngineVar = {
  id: "core-player-edits",
  group: "",
  name: "PlayerEdits",
  type: "list",
  start: "",
  readOnly: true,
  pinned: false,
  rule: "Values the player changed by hand in the game screens, newest last. They are true now: build on them, never undo them.",
};

/** Built-in screens an author can add from the Modules tab. They aren't in a new card. */
export const BUILT_IN_SCREENS = [
  { core: "creator" as const, make: () => creatorModule(), help: "The first message lets the player make their character, then Begin sends the opening." },
  { core: "phone" as const, make: () => phoneModule(), help: "A phone over the chat with a lock screen, home screen and apps the player uses to act." },
];

/** Overlay modules that show as apps on the phone's home screen. */
export const PHONE_APP_TAG = "phone-app";

/**
 * A core module is rebuilt from its settings, so cards get the current code. `all` is the card's
 * other modules, for the phone's extra apps.
 */
export function resolveModule(m: EngineModule, all: EngineModule[] = []): EngineModule {
  if (m.core === "time") return timeModule(m.settings, m.enabled);
  if (m.core === "settings") return settingsAppModule(m.settings, m.enabled);
  if (m.core === "creator") return creatorModule(m.settings, m.enabled);
  if (m.core === "phone") {
    const extra = all.filter((o) => o.enabled && o.slot === "overlay" && o.tags.includes(PHONE_APP_TAG)).map((o) => ({ id: o.id, name: o.name }));
    return phoneModule(m.settings, m.enabled, extra);
  }
  if (m.core === "title") return titleModule(m.settings, m.enabled);
  if (m.core === "menu") return menuModule(m.settings, m.enabled);
  if (m.core === "events") return eventsModule(m.settings, m.enabled);
  if (m.core === "journal") return journalModule(m.settings, m.enabled);
  if (m.core === "notify") return notifyModule(m.settings, m.enabled);
  if (m.core === "people") {
    // Values another module keeps (the phone's affection) are shared, not doubled.
    const taken = new Set(all.filter((o) => o !== m && o.enabled && o.core !== "people").flatMap((o) => resolveModule(o).vars.map(valueKey)));
    return peopleModule(m.settings, m.enabled, taken);
  }
  return m;
}

/** The card's modules, resolved. Cards from before modules get the core ones. */
export function modulesOf(config: EngineConfig): EngineModule[] {
  const all = config.modules ?? coreModules();
  return all.map((m) => resolveModule(m, all));
}

export const enabledModules = (config: EngineConfig) => modulesOf(config).filter((m) => m.enabled);

/** The sheet's values, then each enabled module's, then the player-edit log. */
export function effectiveVars(config: EngineConfig): EngineVar[] {
  return [...config.vars, ...enabledModules(config).flatMap((m) => m.vars), PLAYER_EDITS];
}

/** The config with every value the card keeps, for the schema, rules and starting values. */
export const effectiveConfig = (config: EngineConfig): EngineConfig => ({ ...config, vars: effectiveVars(config) });

export interface Conflict {
  /** The modules involved, by name ("Variable sheet" for the sheet itself). */
  between: string[];
  message: string;
}

/** What would break or overlap when the modules merge. */
export function moduleConflicts(config: EngineConfig): Conflict[] {
  const modules = modulesOf(config);
  const out: Conflict[] = [];
  const ids = new Map<string, string>();
  for (const m of modules) {
    const id = m.id.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) out.push({ between: [m.name], message: `"${m.id}" isn't a usable id: use lowercase letters, digits and dashes.` });
    if (ids.has(id)) out.push({ between: [ids.get(id)!, m.name], message: `Both use the id "${id}".` });
    else ids.set(id, m.name);
  }
  const enabled = modules.filter((m) => m.enabled);
  const paths = new Map<string, string>();
  const owners: [string, EngineVar[]][] = [["Variable sheet", config.vars], ...enabled.map((m) => [m.name, m.vars] as [string, EngineVar[]])];
  for (const [owner, vars] of owners) {
    for (const v of vars.filter((v) => v.name.trim())) {
      // "$" and "_" don't make a different value for the reader, so compare without them.
      const key = [v.group.trim(), v.name.trim()].filter(Boolean).join(".").toLowerCase();
      const other = paths.get(key);
      if (other && other !== owner) out.push({ between: [other, owner], message: `Both define the value ${varLabel(v)}.` });
      else paths.set(key, owner);
    }
  }
  const buttons = new Map<string, string>();
  for (const m of enabled.filter((m) => m.slot === "overlay")) {
    const label = (m.button ?? "").trim();
    if (!label) {
      out.push({ between: [m.name], message: "This hub screen has no button label, so players can't open it." });
      continue;
    }
    if (buttons.has(label)) out.push({ between: [buttons.get(label)!, m.name], message: `Both use the hub button "${label}".` });
    else buttons.set(label, m.name);
  }
  const finds = new Map<string, string>();
  for (const m of enabled) {
    for (const r of m.regex) {
      const other = finds.get(r.find);
      if (other && other !== m.name) out.push({ between: [other, m.name], message: `Both have a regex for ${r.find}.` });
      else finds.set(r.find, m.name);
    }
  }
  const enabledIds = new Set(enabled.map((m) => m.id));
  for (const m of enabled)
    for (const need of m.requires)
      if (!enabledIds.has(need)) out.push({ between: [m.name], message: `Needs the "${need}" module, which isn't installed and on.` });
  return out;
}

/**
 * The page a regex puts in a message for an inline module: it finds the engine core and mounts the
 * module. It goes into a regex replacement, so it has no "$" with a digit or "<", no "{{" and no
 * HTML entities.
 */
export function inlineDoc(moduleId: string): string {
  const id = JSON.stringify(moduleId);
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    // The root is marked, so a screen that also opens over the chat knows it's inside a message.
    '<body style="margin:0"><div id="cf-root" data-cf-inline="1"></div><script>',
    "(function () {",
    "  function core() { try { return window.CardForge || window.parent.CardForge; } catch (e) { return null; } }",
    `  var n = 0; (function go() { var CF = core(); if (CF) CF.mount(window, ${id}); else if (n++ < 100) setTimeout(go, 100); })();`,
    "})();",
    "</script></body></html>",
  ].join("\n");
}

const regexBase = { trimStrings: [], disabled: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null };

function toRegex(id: string, scriptName: string, r: ModuleRegex): SillyTavernRegex[] {
  const placement = [...(r.user ? [1] : []), ...(r.ai ? [2] : [])];
  const common = { ...regexBase, findRegex: r.find, replaceString: r.replace, placement, minDepth: r.minDepth ?? null };
  if (r.only === "both") return [{ ...common, id, scriptName, markdownOnly: false, promptOnly: false }];
  return [{ ...common, id, scriptName, markdownOnly: r.only === "display", promptOnly: r.only === "prompt" }];
}

const ACTION = '/<action app="([^"]*)"[^>]*>[\\s\\S]*?<\\/action>/gi';

/** The regex modules bring: their own, inline blocks, and the structured actions screens send. */
export function moduleRegex(config: EngineConfig): SillyTavernRegex[] {
  const out: SillyTavernRegex[] = [];
  for (const m of enabledModules(config)) {
    m.regex.forEach((r, i) => out.push(...toRegex(`cf-${m.id}-${i}`, `CardForge ${m.name}: ${r.name || `regex ${i + 1}`}`, r)));
    // A message module, or a hub screen that can also show inside a message (the phone).
    if (m.slot === "message" || (m.slot === "overlay" && m.settings.inline === true)) {
      const find = `/<cf-module id="${m.id}"\\s*\\/>/g`;
      out.push(
        ...toRegex(`cf-${m.id}-show`, `CardForge ${m.name}: show`, { name: "show", find, replace: "```html\n" + inlineDoc(m.id) + "\n```", ai: true, user: true, only: "display" }),
        ...toRegex(`cf-${m.id}-out`, `CardForge ${m.name}: out of the prompt`, { name: "out", find, replace: "", ai: true, user: true, only: "prompt" }),
      );
    }
  }
  // Actions from the screens: shown as a short line, and older ones left out of the prompt.
  out.push(
    ...toRegex("cf-action-show", "CardForge engine: show actions", { name: "show", find: ACTION, replace: "*⟶ $1*", ai: false, user: true, only: "display" }),
    ...toRegex("cf-action-old", "CardForge engine: older actions out of the prompt", { name: "old", find: ACTION, replace: "", ai: false, user: true, only: "prompt", minDepth: 2 }),
  );
  return out;
}

/** What the engine core needs of each module, for the card's script. */
export function moduleRuntime(config: EngineConfig) {
  return enabledModules(config).map((m) => ({
    id: m.id,
    name: m.name,
    slot: m.slot,
    button: m.button ?? "",
    html: m.html,
    css: m.css,
    js: m.js,
    script: m.script,
    settings: m.settings,
    enabled: true,
  }));
}

/** The values a module adds, as paths, for showing in the editor. */
export const modulePaths = (m: EngineModule) => m.vars.map((v) => varPath(v).join("."));

/** Starts a module of the author's own. */
export function newModule(name = "New module"): EngineModule {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    id: base || "module",
    name,
    version: "1.0.0",
    description: "",
    slot: "overlay",
    button: `✦ ${name}`,
    tags: [],
    requires: [],
    enabled: true,
    vars: [],
    rules: [],
    regex: [],
    html: "",
    css: "",
    js: 'root.innerHTML = CF.ui.appBar("' + name.replace(/"/g, "") + '") + \'<div class="cf-appbody"><p>Hello from this module.</p></div>\';',
    script: "",
    settings: {},
  };
}
