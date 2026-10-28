/**
 * The co-writer's engine tools, for cards built for the Immersive Engine: it plans the variables,
 * their update rules and tiers, and gives each greeting its starting state. Like every card tool,
 * a call becomes a proposal.
 */
import YAML from "yaml";
import type { CardDataV3, LorebookEntry } from "../card";
import { emptyBook, newEntry } from "../editor/lorebook";
import { applyOp } from "../engine/engineer/workspace";
import { effectiveConfig, modulesOf } from "../engine/modules/compile";
import { liveFeedsOf } from "../engine/modules/live";
import { sceneCheck } from "../engine/runtime";
import { newEngine, readEngine, themeOf, varLabel, varPath, VAR_TYPES, type EngineConfig } from "../engine/sheet";
import { cleanMoods, cleanPortraits } from "../engine/theme";
import { ToolInputError } from "./toolError";
import type { ToolCall, ToolDef } from "./types";

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[]): ToolDef["parameters"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ENGINE_TOOLS: ToolDef[] = [
  {
    name: "add_variable",
    description:
      "Add a value to the engine's variable sheet (it turns the engine on if it's off). Plan the core numbers first: about six at most, each with tiers (write_tiers).",
    parameters: obj(
      {
        group: str('Who or what it belongs to, like "protagonist", "Mira" or "World". Never {{user}}.'),
        name: str("The value's name, a fixed word or two"),
        type: { type: "string", enum: Object.keys(VAR_TYPES), description: "number, text, toggle, choice, list or counts" },
        start: str('The default starting value as text: "20", "calm", "yes", "a, b"'),
        min: { type: "number" },
        max: { type: "number" },
        options: { type: "array", items: { type: "string" }, description: "For a choice" },
        rule: str(
          'The update rule: the trigger, the size of the change ("+3 to +6"), when it does not change, when entries are removed, and the cap on a list. Empty for read-only values.',
        ),
        hidden: { type: "boolean", description: "A $ field the model never sees, for secret progress" },
        read_only: { type: "boolean", description: "A _ constant the model sees but never changes" },
        why: str("One sentence for the user: what this tracks and why"),
      },
      ["name", "type", "start"],
    ),
  },
  {
    name: "set_update_rule",
    description: "Rewrite a value's update rule.",
    parameters: obj({ variable: str('The value, as "Group.Name" or "Name"'), rule: str("The whole new rule") }, ["variable", "rule"]),
  },
  {
    name: "write_tiers",
    description:
      "Write the tiers of a number: named ranges and how characters behave in each, plus events that fire when a threshold is crossed. They become a lorebook entry, so the description never has to describe every value.",
    parameters: obj(
      {
        variable: str('The number, as "Group.Name"'),
        tiers: {
          type: "array",
          items: obj(
            { from: { type: "number" }, to: { type: "number" }, name: str("The tier's name"), behavior: str("How characters act in this range, concretely") },
            ["from", "to", "name", "behavior"],
          ),
        },
        events: {
          type: "array",
          items: obj({ at: str('The threshold, like "reaches 80" or "drops to 0"'), event: str("What happens, once") }, ["at", "event"]),
        },
      },
      ["variable", "tiers"],
    ),
  },
  {
    name: "set_greeting_state",
    description:
      "Give a greeting its own starting state: the values that differ from the defaults at that opening, as an <initvar> patch at the end of the greeting. Every greeting gets one, the same way.",
    parameters: obj(
      {
        greeting: { type: "integer", minimum: 0, description: "0 for the first message, 1 for the first alternate greeting, and so on" },
        state: {
          type: "object",
          description: 'The changed values by group, like { "Mira": { "Affection": 35 }, "World": { "Location": "the docks" } }',
        },
      },
      ["greeting", "state"],
    ),
  },
];

/** Writing for the engine's screens and handing build work to the UI engineer. */
export const ENGINE_WRITING_TOOLS: ToolDef[] = [
  {
    name: "ask_engineer",
    description:
      "File a task for the UI engineer when what you wrote should show on a screen: a new NPC who should be a phone contact, a shop whose goods belong in the shop app, a place for the map, a stat that needs a meter. It waits for the user's approval in the inbox, then the engineer builds it in the background from your brief and the lore it names. Don't use it for words: write those yourself.",
    parameters: obj(
      {
        title: str("One line for the inbox, like 'Add Mina as a phone contact'"),
        brief: str("What the screen should show or do, and why, in plain words"),
        source: str("The lorebook entry, value or greeting it comes from, by name"),
      },
      ["title", "brief"],
    ),
  },
  {
    name: "write_live_pack",
    description:
      "Write the content pack of a living screen (a feed the model writes during play: an NPC's texts, a news feed): the voice, tone, format and length its background writer follows, and fallback lines in that voice for when the call fails. It doesn't turn the feed on.",
    parameters: obj(
      {
        module: str("The module the feed is on"),
        feed: str("The feed's id"),
        voice: str("Who writes and how: 'Mina texting: lowercase, quick, teasing; an emoji only when flustered'"),
        tone: str("Their attitude now: 'warm, a little jealous'"),
        format: str("The shape of one item: 'a text message to {{user}}', 'a headline, a dash, one sentence'"),
        length: str("How long one item is: 'one or two short lines'"),
        fallback: { type: "array", items: { type: "string" }, description: "Two or three lines in that voice, like 'Mina: you up?'" },
      },
      ["module", "feed", "voice", "format"],
    ),
  },
  {
    name: "write_scene",
    description:
      "Write a cutscene for a module's scene director (its settings.scenes): a list of steps. Steps: { bg: 'place' } or { bg: { time: 'night' } }, { show: 'Mina', side: 'left'|'right'|'center', emotion }, { hide: 'Mina' }, { say: 'line', who: 'Mina' }, { title: 'Chapter 1', sub }, { fx: 'shake'|'flash'|'rain'|'snow' }, { wait: 800 }, { choice: [{ label, value }] }, { clear: true }. Keep it short: five to twelve steps.",
    parameters: obj(
      {
        module: str("The module that plays it"),
        name: str("The scene's name, like 'intro'"),
        steps: { type: "array", items: { type: "object" }, description: "The steps, in order" },
      },
      ["module", "name", "steps"],
    ),
  },
  {
    name: "write_minigame_lines",
    description:
      "Write a minigame's outcome lines: what the story is told when {{user}} wins, loses or skips. {score} and the module's settings (like {bet}) can be used. One sentence each, in the story's voice.",
    parameters: obj(
      { module: str("The minigame's module"), win: str("The win line"), loss: str("The loss line"), skip: str("The skip line, optional") },
      ["module", "win", "loss"],
    ),
  },
  {
    name: "name_mood",
    description: "Name a theme mood the player will feel (night, danger, a curse) and describe in one sentence how the story feels while it's on.",
    parameters: obj(
      { mood: str("The mood's current name"), name: str("Its new name, one or two words"), description: str("One sentence: how the story feels then") },
      ["mood", "name", "description"],
    ),
  },
  {
    name: "list_expressions",
    description:
      "List the expressions (and outfits) a character's portrait needs art for, the ones the story uses most: neutral first, five to eight in all. They go on the Image Studio's shot list.",
    parameters: obj(
      {
        name: str("The character"),
        emotions: { type: "array", items: { type: "string" }, description: "Expressions, like neutral, happy, flustered, angry, hurt" },
        outfits: { type: "array", items: { type: "string" }, description: "Outfits, like Casual, Uniform" },
      },
      ["name", "emotions"],
    ),
  },
];

export const ENGINE_TOOL_NAMES = new Set([...ENGINE_TOOLS, ...ENGINE_WRITING_TOOLS].map((t) => t.name));

/** The engine screens that need words, for the co-writer's view of the card. */
export function engineFeaturesText(config: EngineConfig): string {
  const modules = modulesOf(config).filter((m) => m.enabled);
  const lines: string[] = [];
  for (const { module: m, feed } of liveFeedsOf(modules))
    lines.push(
      `- living screen ${feed.id} on module ${m.id} ("${feed.name}", ${feed.enabled ? "on" : "off"}): ${feed.pack.voice.trim() || feed.pack.format.trim() ? `voice "${feed.pack.voice}", tone "${feed.pack.tone}", format "${feed.pack.format}", length "${feed.pack.length}"` : "no content pack yet"}`,
    );
  for (const m of modules) {
    if (!m.core && /\b(?:app\.game|CF\.game\.create)\(/.test(m.js)) {
      const o = (m.settings?.outcomes ?? {}) as Record<string, { line?: string } | undefined>;
      lines.push(`- minigame ${m.id} ("${m.name}"): win "${o.win?.line ?? ""}", loss "${o.loss?.line ?? ""}"${o.skip?.line ? `, skip "${o.skip.line}"` : ""}`);
    }
    const scenes = m.settings?.scenes;
    if (scenes && typeof scenes === "object" && !Array.isArray(scenes))
      lines.push(`- scenes on ${m.id}: ${Object.entries(scenes).map(([n, steps]) => `${n} (${Array.isArray(steps) ? steps.length : 0} steps)`).join(", ")}`);
  }
  const theme = themeOf(config);
  for (const mood of cleanMoods(theme.moods)) lines.push(`- mood "${mood.name}" (follows ${mood.path})${mood.description ? `: ${mood.description}` : ", no description yet"}`);
  for (const b of cleanPortraits(theme.portraits))
    lines.push(`- portrait of ${b.name}: ${b.emotions?.length ? `expressions ${b.emotions.join(", ")}` : b.emotion ? `expression from ${b.emotion}` : "no expressions listed yet"}${b.outfits?.length ? `; outfits ${b.outfits.join(", ")}` : ""}`);
  return lines.join("\n");
}

function engineOp(data: CardDataV3, name: string, input: Record<string, unknown>, id: string): Extract<EngineEdit, { kind: "engine" }> {
  const config = readEngine(data);
  if (!config) throw new ToolInputError("The engine is off on this card");
  const out = applyOp(config, { id, name, input });
  return { kind: "engine", summary: out.summary, before: config, after: out.config };
}

function moduleNamed(config: EngineConfig, id: unknown) {
  const m = modulesOf(config).find((x) => x.id === id);
  if (!m) throw new ToolInputError(`There's no module "${String(id)}". Modules: ${modulesOf(config).map((x) => x.id).join(", ")}`);
  return m;
}

const text = (input: Record<string, unknown>, key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");

export type EngineEdit =
  | { kind: "engine"; summary: string; before?: EngineConfig; after: EngineConfig }
  | { kind: "tiers"; variable: string; before?: LorebookEntry; after: LorebookEntry }
  | { kind: "greetingState"; greeting: number; before: string; after: string };

const EXT = "cardforge";

/** The tiers entry of a value, if it has one. */
export const tiersEntryOf = (data: CardDataV3, variable: string) =>
  (data.character_book?.entries ?? []).find((e) => {
    const m = e.extensions[EXT] as { kind?: string; variable?: string } | undefined;
    return m?.kind === "tiers" && m.variable?.toLowerCase() === variable.toLowerCase();
  });

export const isTiersEntry = (e: LorebookEntry) => (e.extensions[EXT] as { kind?: string } | undefined)?.kind === "tiers";

function findVar(config: EngineConfig, label: string) {
  const vars = effectiveConfig(config).vars;
  const v = vars.find((x) => varLabel(x).toLowerCase() === label.trim().toLowerCase());
  if (!v) throw new ToolInputError(`There's no value "${label}". Values: ${vars.map(varLabel).join(", ") || "none yet"}`);
  return v;
}

/** Every value's path in the state, "Group.Name" with its $ or _ mark. */
const statePaths = (config: EngineConfig) => new Set(effectiveConfig(config).vars.map((v) => varPath(v).join(".")));

function flatten(value: unknown, prefix: string[] = []): string[] {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const path = [...prefix, k];
      return v && typeof v === "object" && !Array.isArray(v) && path.length < 2 ? flatten(v, path) : [path.join(".")];
    });
  return [prefix.join(".")];
}

const INITVAR = /\n*<initvar>[\s\S]*?<\/initvar>\s*$/i;

/** The greeting's text without its starting state, and the state block it has. */
export function splitGreetingState(text: string): { prose: string; state?: string } {
  const m = /<initvar>([\s\S]*?)<\/initvar>\s*$/i.exec(text);
  return { prose: text.replace(INITVAR, ""), state: m?.[1].trim() };
}

/** Works out an engine tool call, or undefined for other tools. */
export function planEngineEdit(data: CardDataV3, call: ToolCall): EngineEdit | undefined {
  const input = call.input;
  switch (call.name) {
    case "add_variable": {
      const config = readEngine(data) ?? newEngine();
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const group = typeof input.group === "string" ? input.group.trim() : "";
      if (/\{\{/.test(name + group)) throw new ToolInputError("Variable names are fixed words, like protagonist; never {{user}} or {{char}}");
      const label = [group, name].filter(Boolean).join(".");
      if (effectiveConfig(config).vars.some((v) => varLabel(v).toLowerCase() === label.toLowerCase()))
        throw new ToolInputError(`There's already a value ${label}; change its rule with set_update_rule`);
      if (input.read_only === true && typeof input.rule === "string" && input.rule.trim())
        throw new ToolInputError("Read-only values get no update rule; leave rule empty");
      const { read_only, why: _why, ...rest } = input;
      const op = { id: call.id, name: "set_value", input: { ...rest, group, name, ...(read_only !== undefined ? { readOnly: read_only } : {}) } };
      const out = applyOp(config, op);
      return { kind: "engine", summary: `Add value ${label}`, before: readEngine(data), after: out.config };
    }
    case "set_update_rule": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off; add values with add_variable first");
      const v = findVar(config, String(input.variable ?? ""));
      if (!config.vars.includes(v)) throw new ToolInputError(`${varLabel(v)} belongs to a module; ask the UI engineer to change it`);
      if (v.readOnly) throw new ToolInputError(`${varLabel(v)} is read-only, so it has no update rule`);
      if (typeof input.rule !== "string" || !input.rule.trim()) throw new ToolInputError(`"rule" must be the whole new rule`);
      const after = { ...config, vars: config.vars.map((x) => (x === v ? { ...x, rule: (input.rule as string).trim() } : x)) };
      return { kind: "engine", summary: `Change the rule of ${varLabel(v)}`, before: config, after };
    }
    case "write_tiers": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off; add the value with add_variable first");
      const v = findVar(config, String(input.variable ?? ""));
      if (v.type !== "number") throw new ToolInputError(`${varLabel(v)} isn't a number; tiers are for numbers`);
      const tiers = Array.isArray(input.tiers) ? (input.tiers as Record<string, unknown>[]) : [];
      if (!tiers.length) throw new ToolInputError(`"tiers" needs at least one tier`);
      const events = Array.isArray(input.events) ? (input.events as Record<string, unknown>[]) : [];
      const label = varLabel(v);
      const content = [
        `<tiers value="${label}">`,
        ...tiers.map((t) => `${Number(t.from)} to ${Number(t.to)}, ${String(t.name ?? "").trim()}: ${String(t.behavior ?? "").trim()}`),
        ...events.map((e) => `When it ${String(e.at ?? "").trim()}: ${String(e.event ?? "").trim()}`),
        `</tiers>`,
      ].join("\n");
      const book = data.character_book ?? emptyBook();
      const before = tiersEntryOf(data, label);
      const after: LorebookEntry = before
        ? { ...before, content }
        : newEntry(book, {
            comment: `Tiers: ${label}`,
            constant: true,
            insertion_order: 150,
            content,
            extensions: { [EXT]: { kind: "tiers", variable: label } },
          });
      return { kind: "tiers", variable: label, before, after };
    }
    case "set_greeting_state": {
      const n = input.greeting;
      const count = data.alternate_greetings.length;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > count)
        throw new ToolInputError(`"greeting" must be 0 (the first message) to ${count}`);
      const before = n === 0 ? data.first_mes : data.alternate_greetings[n - 1];
      if (!before.trim()) throw new ToolInputError(`${n === 0 ? "The first message" : `Greeting ${n}`} is empty; write it first`);
      const state = input.state;
      if (!state || typeof state !== "object" || Array.isArray(state)) throw new ToolInputError(`"state" must be an object of values by group`);
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off; add values with add_variable first");
      const known = statePaths(config);
      const unknown = flatten(state).filter((p) => !known.has(p));
      if (unknown.length) throw new ToolInputError(`No such values: ${unknown.join(", ")}. Values: ${[...known].join(", ")}`);
      const yaml = YAML.stringify(state).trim();
      const after = `${splitGreetingState(before).prose.trimEnd()}\n\n<initvar>\n${yaml}\n</initvar>`;
      return { kind: "greetingState", greeting: n, before, after };
    }
    case "write_live_pack": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off on this card");
      const m = moduleNamed(config, input.module);
      const feed = (m.live ?? []).find((f) => f.id === input.feed);
      if (!feed) throw new ToolInputError(`${m.id} has no feed "${String(input.feed)}". Its feeds: ${(m.live ?? []).map((f) => f.id).join(", ") || "none"}`);
      const pack = { voice: text(input, "voice"), tone: text(input, "tone") || feed.pack.tone, format: text(input, "format"), length: text(input, "length") || feed.pack.length };
      const fallback = Array.isArray(input.fallback) ? input.fallback.filter((l): l is string => typeof l === "string") : undefined;
      const edit = engineOp(data, "set_live_feed", { module: m.id, id: feed.id, pack, ...(fallback ? { fallback } : {}) }, call.id);
      return { ...edit, summary: `Write the content pack for ${feed.name}` };
    }
    case "write_scene": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off on this card");
      const m = moduleNamed(config, input.module);
      const name = text(input, "name");
      if (!name) throw new ToolInputError(`"name" is required`);
      const problems = sceneCheck(input.steps);
      if (problems.length) throw new ToolInputError(`The scene doesn't play: ${problems.join("; ")}`);
      const scenes = { ...((m.settings?.scenes as Record<string, unknown> | undefined) ?? {}), [name]: input.steps };
      const edit = engineOp(data, "set_module_settings", { module: m.id, settings: { scenes } }, call.id);
      return { ...edit, summary: `Write the "${name}" scene for ${m.name}` };
    }
    case "write_minigame_lines": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off on this card");
      const m = moduleNamed(config, input.module);
      if (!/\b(?:app\.game|CF\.game\.create)\(/.test(m.js)) throw new ToolInputError(`${m.id} isn't a minigame`);
      const old = (m.settings?.outcomes ?? {}) as Record<string, Record<string, unknown>>;
      const outcomes = { ...old };
      for (const k of ["win", "loss", "skip"]) {
        const line = text(input, k);
        if (line) outcomes[k] = { ...old[k], line };
      }
      if (!text(input, "win") || !text(input, "loss")) throw new ToolInputError(`"win" and "loss" lines are required`);
      const edit = engineOp(data, "set_module_settings", { module: m.id, settings: { outcomes } }, call.id);
      return { ...edit, summary: `Write the outcome lines for ${m.name}` };
    }
    case "name_mood": {
      const config = readEngine(data);
      if (!config) throw new ToolInputError("The engine is off on this card");
      const theme = themeOf(config);
      const moods = cleanMoods(theme.moods);
      const was = moods.find((x) => x.name.toLowerCase() === text(input, "mood").toLowerCase());
      if (!was) throw new ToolInputError(`There's no mood "${text(input, "mood")}". Moods: ${moods.map((x) => x.name).join(", ") || "none"}`);
      const name = text(input, "name");
      if (!name) throw new ToolInputError(`"name" is required`);
      if (moods.some((x) => x !== was && x.name.toLowerCase() === name.toLowerCase())) throw new ToolInputError(`There's already a mood named ${name}`);
      const next = moods.map((x) => (x === was ? { ...x, name, description: text(input, "description") } : x));
      return { kind: "engine", summary: `Name the ${was.name} mood "${name}"`, before: config, after: { ...config, theme: { ...theme, moods: next } } };
    }
    case "list_expressions": {
      const list = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).filter((x): x is string => typeof x === "string") : undefined);
      const edit = engineOp(data, "set_portrait", { name: text(input, "name"), emotions: list("emotions") ?? [], ...(list("outfits") ? { outfits: list("outfits") } : {}) }, call.id);
      return { ...edit, summary: `List ${text(input, "name")}'s expressions` };
    }
    default:
      return undefined;
  }
}
