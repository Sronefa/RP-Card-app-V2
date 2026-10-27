/**
 * The co-writer's engine tools, for cards built for the Immersive Engine: it plans the variables,
 * their update rules and tiers, and gives each greeting its starting state. Like every card tool,
 * a call becomes a proposal.
 */
import YAML from "yaml";
import type { CardDataV3, LorebookEntry } from "../card";
import { emptyBook, newEntry } from "../editor/lorebook";
import { applyOp } from "../engine/engineer/workspace";
import { effectiveConfig } from "../engine/modules/compile";
import { newEngine, readEngine, varLabel, varPath, VAR_TYPES, type EngineConfig } from "../engine/sheet";
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

export const ENGINE_TOOL_NAMES = new Set(ENGINE_TOOLS.map((t) => t.name));

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
    default:
      return undefined;
  }
}
