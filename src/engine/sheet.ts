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
import { stageRanges, type SillyTavernRegex, type TrackerConfig } from "../editor/trackers";
import { newId } from "../lib/id";
import { ENGINE_VERSION, runtime, scriptSource, type StateSchema } from "./runtime";
import { panelHtml } from "./panel";

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

export interface EngineConfig {
  vars: EngineVar[];
  panel: { enabled: boolean; title: string; accent: string };
  /** A short reminder of the format near the end of the prompt. */
  reminder: boolean;
  /** Ids CardForge wrote, so they are replaced and not duplicated. */
  scriptId: string;
  regexIds: string[];
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
});

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

/** The `[mvu_update]` entry: what each value means, when it changes, and the block format. */
export function rulesText(config: EngineConfig): string {
  const vars = live(config).filter((v) => !v.hidden);
  const lines = vars.map((v) => `- ${varPath(v).join(".")} (${describe(v)})${v.rule.trim() ? `: ${v.rule.trim()}` : ""}`);
  const ops = exampleOps(config);
  return [
    "<variable_rules>",
    "The game state is in <game_state>. Keep it true to the story: change a value only when something in your reply changes it.",
    ...lines,
    "</variable_rules>",
    "<variable_format>",
    "End every reply, after the story, with this block:",
    "<UpdateVariable>",
    "<Analysis>",
    "One short line per value that changed, and why.",
    "</Analysis>",
    "<JSONPatch>",
    "[",
    ...ops.map((op, i) => `  ${op}${i < ops.length - 1 ? "," : ""}`),
    "]",
    "</JSONPatch>",
    "</UpdateVariable>",
    'Use "delta" to raise or lower a number, "replace" for a new value, "insert" to add to a list (path ending in /-) or to counts (path ending in the name), "remove" to take an entry out. Paths start at the top of <game_state>.',
    "If nothing changed, write an empty list: [].",
    "</variable_format>",
  ].join("\n");
}

// Tavern Helper's macro: the latest state as YAML, without "$" fields.
export const STATE_TEXT = "<game_state>\n{{format_message_variable::stat_data}}\n</game_state>";
export const REMINDER_TEXT =
  "<format_reminder>Remember: after the story, end the reply with the <UpdateVariable> block.</format_reminder>";

/** The starting values as YAML, for the `[initvar]` entry. */
export const initvarText = (config: EngineConfig) => runtime.cfYaml(initialState(config));

/** The card settings the engine core reads: starting values and schema. */
export function settingsSource(config: EngineConfig): string {
  const settings = { version: ENGINE_VERSION, initial: initialState(config), panel: config.panel.enabled };
  return `var CF_CONFIG = ${JSON.stringify(settings)};\n${schemaSource(config)}`;
}

/** Tavern Helper's card script, in its v4 storage format. */
export function tavernHelperScript(config: EngineConfig) {
  return {
    type: "script",
    enabled: true,
    name: "CardForge engine",
    id: config.scriptId,
    content: scriptSource(settingsSource(config)),
    info: `CardForge engine ${ENGINE_VERSION}: keeps the game state up to date after each reply. Made with CardForge.`,
    button: { enabled: true, buttons: [] },
    data: {},
    export_with: { data: true, button: true },
  };
}

// Update blocks, and a greeting's own starting values.
const UPDATE_BLOCK = "/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>|<initvar>[\\s\\S]*?<\\/initvar>/gi";

/** Regex scripts: hide update blocks, keep them out of the prompt, and show the panel. */
export function engineRegex(config: EngineConfig): SillyTavernRegex[] {
  const ids = [0, 1, 2, 3].map((i) => config.regexIds[i] ?? newId());
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
  const regex = config ? engineRegex(config) : [];
  const saved = config ? { ...config, regexIds: regex.map((s) => s.id) } : undefined;

  const otherRegex = ((data.extensions.regex_scripts as SillyTavernRegex[] | undefined) ?? []).filter((s) => !oldRegex.has(s.id));
  const helper = { ...(data.extensions.tavern_helper as { scripts?: ScriptTree[]; variables?: Record<string, unknown> } | undefined) };
  const otherScripts = (helper.scripts ?? []).filter((s) => s.id !== old?.scriptId && s.id !== saved?.scriptId);

  const book: Lorebook = data.character_book ?? emptyBook();
  const kept = book.entries.filter((e) => !isOurs(e));
  const ours: LorebookEntry[] = [];
  if (saved && live(saved).length) {
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
        content: initvarText(saved),
        extensions: mark,
      }),
    );
    add(
      withStPosition(
        newEntry(draft, {
          comment: "[mvu_update] Update rules",
          constant: true,
          insertion_order: 900,
          content: rulesText(saved),
          extensions: mark,
        }),
        1,
      ),
    );
    add(atDepth(newEntry(draft, { comment: "Game state", constant: true, insertion_order: 950, content: STATE_TEXT, extensions: mark }), 1));
    if (saved.reminder)
      add(
        atDepth(
          newEntry(draft, { comment: "[mvu_update] Format reminder", constant: true, insertion_order: 960, content: REMINDER_TEXT, extensions: mark }),
          1,
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

  const scripts = saved ? [...otherScripts, tavernHelperScript(saved)] : otherScripts;
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

