/**
 * The Immersive Engine's variable sheet, and what it writes into the card.
 *
 * The sheet is the card's game state: named values in groups, each with a type, a start, limits
 * and a rule for when it changes. From it CardForge writes, the way MVU (MagVarUpdate) cards do:
 * - a Tavern Helper script with the engine core and a Zod schema of the sheet (clamps and repairs),
 * - an `[initvar]` lorebook entry with the starting values (disabled, read by the engine),
 * - an always-on `[mvu_update]` entry with the update rules and the `<UpdateVariable>` format,
 * - the current state at depth 1 through Tavern Helper's `{{format_message_variable::stat_data}}` macro,
 * - regex scripts that hide update blocks and show the status panel under each reply.
 * Keys starting with "_" are read-only for the AI, keys starting with "$" are hidden from it.
 */
import { z } from "zod";
import type { CardDataV3, Lorebook, LorebookEntry } from "../card";
import { emptyBook, newEntry, withStPosition } from "../editor/lorebook";
import { assetManifest, type ManifestEntry } from "../images/manifest";
import { stageRanges, type SillyTavernRegex, type TrackerConfig } from "../editor/trackers";
import { newId } from "../lib/id";
import { estimateTokens } from "../lib/tokens";
import { coreModules, effectiveConfig, enabledModules, moduleRegex, moduleRuntime } from "./modules/compile";
import type { EngineModule } from "./modules/types";
import { panelHtml } from "./panel";
import { ENGINE_VERSION, runtime, scriptSource, type StateSchema } from "./runtime";
import kitCss from "./runtime/kit.css?raw";
import { fontFaces, livingTheme, newTheme, themeBundle, themeVars, usedFonts, type CardTheme } from "./theme";

export type VarType = "number" | "text" | "toggle" | "choice" | "list" | "counts";

export const VAR_TYPES: Record<VarType, { label: string; help: string }> = {
  number: { label: "Number", help: "A number, with optional limits. With both limits it shows as a bar." },
  text: { label: "Text", help: "A few words, like a mood or a location." },
  toggle: { label: "Yes or no", help: "A flag, like whether a door is open." },
  choice: { label: "Choice", help: "One of a fixed list, like a relationship stage." },
  list: { label: "List", help: "Several short entries, like status effects." },
  counts: { label: "Counts", help: "Names with amounts, like an inventory: rope 1, arrows 20." },
};

export interface EngineVar {
  id: string;
  /** The group the value sits in, like "Player". Empty for a top-level value. */
  group: string;
  name: string;
  type: VarType;
  /** The starting value as typed: "100", "calm", "yes", "a, b", "rope: 1, arrows: 20". */
  start: string;
  min?: number;
  max?: number;
  /** For a choice. */
  options?: string[];
  /** When and how the value changes. */
  rule: string;
  /** "$" key: the AI never sees it. */
  hidden?: boolean;
  /** "_" key: the AI sees it but can't change it. */
  readOnly?: boolean;
  /** Shown in the compact status panel. */
  pinned?: boolean;
}

/** A tab of the expanded status panel: the groups of values it shows ("" is the values without a group). */
export interface PanelTab {
  label: string;
  groups: string[];
}

/** A button on the newest status panel: a prewritten message, or a slash command when it starts with "/". */
export interface PanelAction {
  label: string;
  text: string;
  /** Send it at once; otherwise it waits in the input box for the player to add to it. */
  now: boolean;
}

export interface EngineConfig {
  vars: EngineVar[];
  panel: { enabled: boolean; title: string; accent: string; tabs?: PanelTab[]; actions?: PanelAction[] };
  /** A short reminder of the format near the end of the prompt. */
  reminder: boolean;
  /** Ids CardForge wrote, so they are replaced and not duplicated. */
  scriptId: string;
  regexIds: string[];
  /** The sandbox's test turns, replayed after each change. */
  scenario?: ScenarioTurn[];
  /**
   * Set when the card was converted from a light card: its status tracker, brought back if the
   * engine is turned off, and its relationship stages, which become tiers when the conversion is accepted.
   */
  light?: {
    tracker: TrackerConfig | null;
    stages: { variable: string; tiers: { from: number; to: number; name: string; behavior: string }[] } | null;
  };
  /** Installed modules, the core ones included. Missing on cards from before modules. */
  modules?: EngineModule[];
  /** The card theme. Missing on cards from before themes: the panel's accent on the phone preset. */
  theme?: CardTheme;
  /**
   * Who writes the updates: the roleplay model at the end of each reply (the default), or a silent
   * side call after each reply, which keeps the reply pure prose.
   */
  updateMode?: UpdateMode;
  /**
   * Players can't switch who writes the updates in the settings app. Unlocked, a player can move a
   * card to the side call (or back) when their model handles one way better.
   */
  lockUpdateMode?: boolean;
}

export type UpdateMode = "reply" | "side";

export interface ScenarioTurn {
  role: "user" | "assistant";
  text: string;
}

const EXT = "cardforge";
const KIND = "engine";
export const NOTE =
  "⚙ Needs the Tavern Helper extension (JS-Slash-Runner) in SillyTavern: this card runs the CardForge engine. Allow its scripts when SillyTavern asks.";
export const PLACEHOLDER = "<StatusPlaceHolderImpl/>";

export function readEngine(data: CardDataV3): EngineConfig | undefined {
  return (data.extensions[EXT] as { engine?: EngineConfig } | undefined)?.engine;
}

export const newEngine = (): EngineConfig => ({
  vars: [],
  panel: { enabled: true, title: "Status", accent: "#a78bfa" },
  reminder: true,
  scriptId: newId(),
  regexIds: [],
  modules: coreModules(),
  theme: newTheme(),
});

/** The value a new engine starts with, so the sheet isn't empty. */
export const starterVar = (): EngineVar => newVar({ group: "Player", name: "Health", start: "100", min: 0, max: 100, rule: "Drops when {{user}} is hurt, rises with rest or healing." });

/** Whether a value is still the starter one, as the engine made it. */
export function isStarterVar(v: EngineVar): boolean {
  const a = { ...v, id: "" };
  const b = { ...starterVar(), id: "" };
  return JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
}

/** The card theme, or the one a card from before themes gets. */
export const themeOf = (config: EngineConfig): CardTheme => config.theme ?? newTheme(config.panel.accent);

export const newVar = (fields: Partial<EngineVar> = {}): EngineVar => ({
  id: newId(),
  group: "",
  name: "",
  type: "number",
  start: "0",
  rule: "",
  pinned: true,
  ...fields,
});

/** The key in the state, with its "$" or "_" prefix. */
export const varKey = (v: EngineVar) => `${v.hidden ? "$" : v.readOnly ? "_" : ""}${v.name.trim()}`;
export const varPath = (v: EngineVar) => (v.group.trim() ? [v.group.trim(), varKey(v)] : [varKey(v)]);
export const varLabel = (v: EngineVar) => (v.group.trim() ? `${v.group.trim()}.${v.name.trim()}` : v.name.trim());
const live = (config: EngineConfig) => config.vars.filter((v) => v.name.trim());

const splitList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The typed starting value. */
export function startValue(v: EngineVar): unknown {
  const s = v.start.trim();
  switch (v.type) {
    case "number": {
      const n = Number(s.replace(",", "."));
      const value = Number.isFinite(n) ? n : 0;
      return Math.min(v.max ?? Infinity, Math.max(v.min ?? -Infinity, value));
    }
    case "toggle":
      return /^(yes|true|on|1)$/i.test(s);
    case "choice":
      return v.options?.includes(s) ? s : (v.options?.[0] ?? s);
    case "list":
      return splitList(s);
    case "counts":
      return Object.fromEntries(
        splitList(s).map((part) => {
          const m = /^(.*?)\s*[:x×]\s*(-?\d+(?:\.\d+)?)$/i.exec(part);
          return m ? [m[1].trim(), Number(m[2])] : [part, 1];
        }),
      );
    default:
      return s;
  }
}

/** The starting state: groups of values. */
export function initialState(config: EngineConfig): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const v of live(config)) {
    const path = varPath(v);
    if (path.length === 2) {
      const group = (state[path[0]] ??= {}) as Record<string, unknown>;
      group[path[1]] = startValue(v);
    } else state[path[0]] = startValue(v);
  }
  return state;
}

const js = (value: unknown) => JSON.stringify(value);

function zodFor(v: EngineVar): string {
  const start = js(startValue(v));
  switch (v.type) {
    case "number": {
      const lo = v.min ?? null;
      const hi = v.max ?? null;
      const clamp =
        lo !== null || hi !== null
          ? `.transform(function (v) { return Math.min(${hi ?? "Infinity"}, Math.max(${lo ?? "-Infinity"}, v)); })`
          : "";
      return `z.coerce.number()${clamp}.prefault(${start})`;
    }
    case "toggle":
      return `z.preprocess(function (v) { return v === "true" || v === "yes" ? true : v === "false" || v === "no" ? false : v; }, z.boolean()).prefault(${start})`;
    case "choice":
      return v.options?.length ? `z.enum(${js(v.options)}).prefault(${start})` : `z.coerce.string().prefault(${start})`;
    case "list":
      return `z.array(z.coerce.string()).prefault(${start})`;
    case "counts":
      return `z.record(z.string(), z.coerce.number()).prefault(${start})`;
    default:
      return `z.coerce.string().prefault(${start})`;
  }
}

/** The Zod schema of the state, as the JavaScript the card's script runs (`z` is Tavern Helper's Zod). */
export function schemaSource(config: EngineConfig): string {
  const top: string[] = [];
  const groups = new Map<string, string[]>();
  for (const v of live(config)) {
    const path = varPath(v);
    const line = `${js(path.at(-1))}: ${zodFor(v)}`;
    if (path.length === 2) {
      if (!groups.has(path[0])) {
        groups.set(path[0], []);
        top.push(path[0]);
      }
      groups.get(path[0])!.push(line);
    } else top.push(line);
  }
  const fields = top.map((item) =>
    groups.has(item) ? `${js(item)}: z.object({\n    ${groups.get(item)!.join(",\n    ")}\n  }).prefault({})` : item,
  );
  return `function cfSchema() {\n  return z.object({\n  ${fields.join(",\n  ")}\n  }).prefault({});\n}`;
}

/** The schema itself, built with the same Zod version Tavern Helper ships, for checks in the app. */
export function stateSchema(config: EngineConfig): StateSchema {
  return new Function("z", `${schemaSource(config)}\nreturn cfSchema();`)(z) as StateSchema;
}

function describe(v: EngineVar): string {
  const bits: string[] = [VAR_TYPES[v.type].label.toLowerCase()];
  if (v.type === "number" && (v.min !== undefined || v.max !== undefined))
    bits.push(`${v.min ?? "no minimum"} to ${v.max ?? "no maximum"}`);
  if (v.type === "choice" && v.options?.length) bits.push(`one of: ${v.options.join(", ")}`);
  if (v.readOnly) bits.push("read-only, never change it");
  return bits.join(", ");
}

/** A JSON pointer for the format example. */
const pointer = (v: EngineVar) => "/" + varPath(v).map((k) => k.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

function exampleOps(config: EngineConfig): string[] {
  const vars = live(config).filter((v) => !v.hidden && !v.readOnly);
  const ops: string[] = [];
  const number = vars.find((v) => v.type === "number");
  if (number) ops.push(`{ "op": "delta", "path": "${pointer(number)}", "value": -5 }`);
  const text = vars.find((v) => v.type === "text" || v.type === "choice");
  if (text)
    ops.push(`{ "op": "replace", "path": "${pointer(text)}", "value": ${js(v0(text))} }`);
  const list = vars.find((v) => v.type === "list");
  if (list) ops.push(`{ "op": "insert", "path": "${pointer(list)}/-", "value": "a new entry" }`);
  const counts = vars.find((v) => v.type === "counts");
  if (counts) ops.push(`{ "op": "insert", "path": "${pointer(counts)}/rope", "value": 1 }`);
  const toggle = vars.find((v) => v.type === "toggle");
  if (toggle) ops.push(`{ "op": "replace", "path": "${pointer(toggle)}", "value": true }`);
  return ops;
}

function v0(v: EngineVar): string {
  if (v.type === "choice") return v.options?.[1] ?? v.options?.[0] ?? "new value";
  return "new value";
}

function ruleLines(config: EngineConfig, intro: string): string[] {
  const vars = live(config).filter((v) => !v.hidden);
  return [
    "<variable_rules>",
    intro,
    ...vars.map((v) => `- ${varPath(v).join(".")} (${describe(v)})${v.rule.trim() ? `: ${v.rule.trim()}` : ""}`),
    "</variable_rules>",
  ];
}

const OPS_HELP =
  'Use "delta" to raise or lower a number, "replace" for a new value, "insert" to add to a list (path ending in /-) or to counts (path ending in the name), "remove" to take an entry out. Paths start at the top of <game_state>.';

/** The `[mvu_update]` entry: what each value means, when it changes, and the block format. */
export function rulesText(config: EngineConfig): string {
  const ops = exampleOps(config);
  return [
    ...ruleLines(config, "The game state is in <game_state>. Keep it true to the story: change a value only when something in your reply changes it."),
    "<variable_format>",
    "End every reply, after the story, with this block:",
    "<UpdateVariable>",
    "<Analysis>",
    "At most 80 words: how much time passed, then each value checked against its rule, using only this reply. One short line per value that changed, and why.",
    "</Analysis>",
    "<JSONPatch>",
    "[",
    ...ops.map((op, i) => `  ${op}${i < ops.length - 1 ? "," : ""}`),
    "]",
    "</JSONPatch>",
    "</UpdateVariable>",
    OPS_HELP,
    "If nothing changed, write an empty list: [].",
    "The blocks from earlier replies are hidden from you on purpose, to save space; they were written and applied. Still end every reply with a new block.",
    "</variable_format>",
  ].join("\n");
}

/** What the side call answers with: the ops, as JSON (Tavern Helper's `json_schema`). */
export const SIDE_CALL_SCHEMA = {
  type: "object",
  properties: {
    analysis: { type: "string", description: "One short line per value that changed, and why." },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["replace", "delta", "insert", "remove", "move"] },
          path: { type: "string" },
          value: {},
          from: { type: "string" },
        },
        required: ["op", "path"],
      },
    },
  },
  required: ["analysis", "ops"],
};

/** The modules' rules, which say what their actions change. */
function moduleRuleLines(config: EngineConfig): string[] {
  const rules = enabledModules(config).flatMap((m) => m.rules.map((r) => r.content.trim()).filter(Boolean));
  return rules.length ? ["<module_rules>", ...rules, "</module_rules>"] : [];
}

/** The side call's instructions: the rules, and the JSON to answer with. */
export function sideCallPrompt(config: EngineConfig): string {
  const ops = exampleOps(config);
  return [
    "You keep the game state of a roleplay up to date. You get the state and the latest turn; you write no story.",
    ...ruleLines(config, "Change a value only when something in the latest turn changes it."),
    ...moduleRuleLines(config),
    "<answer_format>",
    'Answer with JSON only: {"analysis": "one short line per value that changed, and why", "ops": [ … ]}, where ops are JSON Patch operations like these:',
    `[${ops.join(", ")}]`,
    OPS_HELP,
    'If nothing changed, answer {"analysis": "", "ops": []}.',
    "</answer_format>",
  ].join("\n");
}

/** About how many tokens one side call costs: its instructions, the state, a reply and the answer. */
export function sideCallTokens(config: EngineConfig): number {
  const full = effectiveConfig(config);
  const REPLY = 450;
  const ANSWER = 150;
  return estimateTokens(sideCallPrompt(full)) + estimateTokens(runtime.cfYaml(runtime.cfForAi(initialState(full)))) + REPLY + ANSWER;
}

// Tavern Helper's macro: the latest state as YAML, without "$" fields.
export const STATE_TEXT = "<game_state>\n{{format_message_variable::stat_data}}\n</game_state>";
export const REMINDER_TEXT =
  "<format_reminder>Remember: after the story, end the reply with the <UpdateVariable> block.</format_reminder>";

/** The starting values as YAML, for the `[initvar]` entry. */
export const initvarText = (config: EngineConfig) => runtime.cfYaml(initialState(config));

/** JSON that can sit inside a script element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The bundled fonts the card uses, in its theme or its screens' code: only these are embedded. */
export function cardFonts(config: EngineConfig): string[] {
  const theme = themeBundle(themeOf(config));
  const code = enabledModules(config).flatMap((m) => [m.html, m.css, m.js]);
  return [...new Set([...theme.fonts, ...usedFonts(code)])];
}

/** The card settings the engine core reads: starting values, schema, modules, theme and kit. */
export function settingsSource(config: EngineConfig, charName = "", assets: ManifestEntry[] = []): string {
  const full = effectiveConfig(config);
  const theme = themeBundle(themeOf(config));
  const settings = {
    version: ENGINE_VERSION,
    initial: initialState(full),
    panel: config.panel.enabled,
    panelTitle: config.panel.title || "Status",
    panelDoc: config.panel.enabled ? panelHtml(config) : "",
    statusButton: `📊 ${config.panel.title || "Status"}`,
    theme: { preset: theme.preset, mode: theme.mode, light: themeVars(theme.light), dark: themeVars(theme.dark), fonts: fontFaces(cardFonts(config)), ...livingTheme(themeOf(config)) },
    kit: kitCss,
    modules: moduleRuntime(config),
    charName,
    assets,
    updateMode: config.updateMode === "side" ? "side" : "reply",
    lockMode: !!config.lockUpdateMode,
    // Always there: it writes the update after each reply in side mode, and stands in for a
    // reply's own update when that is missing or cut off.
    side: { prompt: sideCallPrompt(full), schema: SIDE_CALL_SCHEMA, tokens: sideCallTokens(config) },
  };
  return `var CF_CONFIG = ${scriptJson(settings)};\n${schemaSource(full)}`;
}

/** The hub buttons above SillyTavern's input box. */
export function hubButtons(config: EngineConfig): string[] {
  return [
    ...(config.panel.enabled ? [`📊 ${config.panel.title || "Status"}`] : []),
    ...enabledModules(config)
      .filter((m) => m.slot === "overlay" && m.button?.trim())
      .map((m) => m.button!.trim()),
  ];
}

/** Tavern Helper's card script, in its v4 storage format. */
export function tavernHelperScript(config: EngineConfig, charName = "", assets: ManifestEntry[] = []) {
  return {
    type: "script",
    enabled: true,
    name: "CardForge engine",
    id: config.scriptId,
    content: scriptSource(settingsSource(config, charName, assets)),
    info: `CardForge engine ${ENGINE_VERSION}: keeps the game state up to date after each reply, and runs the card's screens. Made with CardForge.`,
    button: { enabled: true, buttons: hubButtons(config).map((name) => ({ name, visible: true })) },
    data: {},
    export_with: { data: true, button: true },
  };
}

// Update blocks, and a greeting's own starting values.
const UPDATE_BLOCK = "/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>|<initvar>[\\s\\S]*?<\\/initvar>/gi";

/** Regex scripts: hide update blocks, keep them out of the prompt, and show the panel. */
export function engineRegex(config: EngineConfig): SillyTavernRegex[] {
  // Module regex ids start with "cf-" and are their own.
  const own = config.regexIds.filter((id) => !id.startsWith("cf-"));
  const ids = [0, 1, 2, 3].map((i) => own[i] ?? newId());
  const base = { trimStrings: [], disabled: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null };
  const scripts: SillyTavernRegex[] = [
    {
      ...base,
      id: ids[0],
      scriptName: "CardForge engine: hide update blocks",
      findRegex: UPDATE_BLOCK,
      replaceString: "",
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
    },
    {
      ...base,
      id: ids[1],
      scriptName: "CardForge engine: update blocks out of the prompt",
      findRegex: UPDATE_BLOCK,
      replaceString: "",
      placement: [2],
      markdownOnly: false,
      promptOnly: true,
    },
    {
      ...base,
      id: ids[2],
      scriptName: "CardForge engine: panel out of the prompt",
      findRegex: "/<StatusPlaceHolderImpl\\/>/g",
      replaceString: "",
      placement: [2],
      markdownOnly: false,
      promptOnly: true,
    },
  ];
  if (config.panel.enabled)
    scripts.push({
      ...base,
      id: ids[3],
      scriptName: "CardForge engine: status panel",
      findRegex: "/<StatusPlaceHolderImpl\\/>/g",
      replaceString: "```html\n" + panelHtml(config) + "\n```",
      placement: [2],
      markdownOnly: true,
      promptOnly: false,
    });
  return scripts;
}

const isOurs = (e: LorebookEntry) => (e.extensions[EXT] as { kind?: string } | undefined)?.kind === KIND;

function atDepth(entry: LorebookEntry, depth: number): LorebookEntry {
  const e = withStPosition(entry, 4);
  return { ...e, extensions: { ...e.extensions, depth, role: 0 } };
}

function withNote(notes: string, on: boolean): string {
  const without = notes.replace(NOTE, "").replace(/^\s+/, "");
  return on ? (without ? `${NOTE}\n\n${without}` : NOTE) : without;
}

type ScriptTree = { id?: string } & Record<string, unknown>;

/** Writes the engine into the card. `undefined` takes it all out again. */
export function applyEngine(data: CardDataV3, config: EngineConfig | undefined): CardDataV3 {
  const old = readEngine(data);
  const oldRegex = new Set(old?.regexIds ?? []);
  const regex = config ? [...engineRegex(config), ...moduleRegex(config)] : [];
  const saved = config ? { ...config, regexIds: regex.map((s) => s.id) } : undefined;
  const full = saved && effectiveConfig(saved);

  const otherRegex = ((data.extensions.regex_scripts as SillyTavernRegex[] | undefined) ?? []).filter((s) => !oldRegex.has(s.id));
  const helper = { ...(data.extensions.tavern_helper as { scripts?: ScriptTree[]; variables?: Record<string, unknown> } | undefined) };
  const otherScripts = (helper.scripts ?? []).filter((s) => s.id !== old?.scriptId && s.id !== saved?.scriptId);

  const book: Lorebook = data.character_book ?? emptyBook();
  const kept = book.entries.filter((e) => !isOurs(e));
  const ours: LorebookEntry[] = [];
  if (saved && full && live(saved).length + enabledModules(saved).length > 0) {
    const draft = { ...book, entries: kept };
    const add = (e: LorebookEntry) => {
      ours.push(e);
      draft.entries = [...draft.entries, e];
    };
    const mark = { [EXT]: { kind: KIND } };
    add(
      newEntry(draft, {
        comment: "[initvar] Starting values",
        enabled: false,
        content: initvarText(full),
        extensions: mark,
      }),
    );
    // With side calls the engine keeps these out of the story's prompt (they go to the side call
    // instead, so the reply stays pure prose); they're on the card so players can switch modes.
    add(
      withStPosition(
        newEntry(draft, {
          comment: "[mvu_update] Update rules",
          constant: true,
          insertion_order: 900,
          content: rulesText(full),
          extensions: mark,
        }),
        1,
      ),
    );
    // The state and the format reminder sit at depth 0, the last thing the model reads, so they
    // don't drift out of its attention in a long chat.
    add(atDepth(newEntry(draft, { comment: "Game state", constant: true, insertion_order: 950, content: STATE_TEXT, extensions: mark }), 0));
    for (const m of enabledModules(saved))
      for (const rule of m.rules) {
        const entry = newEntry(draft, {
          comment: `[${m.name}] ${rule.comment}`,
          constant: rule.constant,
          keys: rule.keys,
          insertion_order: rule.order,
          content: rule.content,
          extensions: mark,
        });
        add(rule.depth === undefined ? withStPosition(entry, 1) : atDepth(entry, rule.depth));
      }
    if (saved.reminder)
      add(
        atDepth(
          newEntry(draft, { comment: "[mvu_update] Format reminder", constant: true, insertion_order: 960, content: REMINDER_TEXT, extensions: mark }),
          0,
        ),
      );
  }

  const extensions: Record<string, unknown> = { ...data.extensions };
  const cf = { ...(extensions[EXT] as Record<string, unknown> | undefined) };
  if (saved) cf.engine = saved;
  else delete cf.engine;
  if (Object.keys(cf).length) extensions[EXT] = cf;
  else delete extensions[EXT];

  const allRegex = [...otherRegex, ...regex];
  if (allRegex.length) extensions.regex_scripts = allRegex;
  else delete extensions.regex_scripts;

  const scripts = saved ? [...otherScripts, tavernHelperScript(saved, data.name, assetManifest(data))] : otherScripts;
  if (scripts.length || Object.keys(helper.variables ?? {}).length) extensions.tavern_helper = { ...helper, scripts, variables: helper.variables ?? {} };
  else delete extensions.tavern_helper;

  const entries = [...kept, ...ours];
  return {
    ...data,
    creator_notes: withNote(data.creator_notes, !!saved),
    extensions,
    character_book: entries.length || data.character_book ? { ...book, entries } : undefined,
  };
}

/** True when the card runs the engine, so it needs Tavern Helper. */
export const usesEngine = (data: CardDataV3) => !!readEngine(data);

/** The status tracker's fields (and mechanics' tracked values) as engine variables. */
export function varsFromTracker(tracker: TrackerConfig): EngineVar[] {
  const groupOf = (addon: string) =>
    addon === "relationship" ? "Relationship" : addon === "mechanic" ? "Mechanics" : addon === "custom" ? "Status" : "Player";
  return tracker.fields.map((f) => {
    const base = { group: groupOf(f.addon), name: f.label.replace(/[.[\]"'/]/g, " ").trim(), rule: f.rule };
    if (f.addon === "relationship" && f.label === "Stage" && tracker.stages?.length) {
      const ranges = stageRanges(tracker.stages);
      return newVar({
        ...base,
        type: "choice",
        options: ranges.map((s) => s.name),
        start: ranges[0].name,
        rule: `Set from Affection: ${ranges.map((s) => `${s.name} ${s.from}-${s.to}`).join(", ")}.`,
      });
    }
    if (f.kind === "bar") return newVar({ ...base, type: "number", start: f.start, min: 0, max: f.max ?? 100 });
    if (f.kind === "number") return newVar({ ...base, type: "number", start: f.start });
    if (f.kind === "list") return newVar({ ...base, type: "list", start: f.start });
    return newVar({ ...base, type: "text", start: f.start });
  });
}


/** A reply that changes a value or two, in the format the rules ask for. */
export function sampleReply(config: EngineConfig): string {
  const match = /<UpdateVariable>[\s\S]*<\/UpdateVariable>/.exec(rulesText(config));
  return `{{char}} hands you the map.\n\n${match ? match[0].replace(/<Analysis>[\s\S]*?<\/Analysis>/, "<Analysis>A sample change.</Analysis>") : ""}`;
}

/** The sandbox scenario: the card's own, or one turn each way with the sample reply. */
export function scenarioOf(config: EngineConfig): ScenarioTurn[] {
  return config.scenario ?? [
    { role: "user", text: "I look around." },
    { role: "assistant", text: sampleReply(config) },
  ];
}
