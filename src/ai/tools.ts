/**
 * The co-writer's tools. The model edits the card only through these, so a small change stays
 * small. A call doesn't change the card directly: it becomes a proposal the user accepts or rejects.
 */
import type { CardDataV3, LorebookEntry } from "../card";
import { emptyBook, entryTitle, newEntry } from "../editor/lorebook";
import { aKind, fieldsFor, KINDS, pageMeta, syncCast, worldEntry, worldMeta, type WorldKind } from "../editor/world";
import { applyEngine } from "../engine/sheet";
import { planEngineEdit, type EngineEdit } from "./engineTools";
import { ToolInputError } from "./toolError";
import type { ToolCall, ToolDef } from "./types";

/** Card text fields the co-writer may write. */
export const EDITABLE_FIELDS = {
  name: "Name",
  nickname: "Nickname",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "First message",
  mes_example: "Example dialogues",
  system_prompt: "System prompt",
  post_history_instructions: "Post-history instructions",
  creator_notes: "Creator notes",
} as const;

export type EditableField = keyof typeof EDITABLE_FIELDS;
const FIELD_NAMES = Object.keys(EDITABLE_FIELDS) as EditableField[];

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[]): ToolDef["parameters"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const fieldParam = { type: "string", enum: FIELD_NAMES, description: "The card field" };
const keysParam = { type: "array", items: { type: "string" }, description: "Trigger keywords: name, nicknames, plurals, related words" };

/** The typed world tools and the kind each one adds. */
export const WORLD_TOOL_KINDS = {
  add_npc: "npc",
  add_place: "location",
  add_item: "item",
  add_shop: "shop",
} as const satisfies Record<string, WorldKind>;
type WorldTool = keyof typeof WORLD_TOOL_KINDS;
export const isWorldTool = (name: string): name is WorldTool => name in WORLD_TOOL_KINDS;

const WORLD_WHAT: Record<WorldTool, string> = {
  add_npc: "a person other than {{char}} and {{user}}: anyone with a name or a recurring role",
  add_place: "a place: a city, district, building, room or landmark",
  add_item: "an item or a service, with its price",
  add_shop: "a shop, stall or trader",
};

function worldTool(name: WorldTool): ToolDef {
  const def = KINDS[WORLD_TOOL_KINDS[name]];
  return {
    name,
    description: `Add ${WORLD_WHAT[name]}. It lands on the ${def.plural} page as a lorebook entry written from these fields, so use this instead of add_lore_entry for ${def.many}.`,
    parameters: obj(
      {
        why: str("One sentence for the user: why this matters to the story"),
        ...Object.fromEntries(def.fields.map((f) => [f.key, str(f.hint)])),
      },
      ["name"],
    ),
  };
}

export const WORLD_TOOLS: ToolDef[] = [
  ...(Object.keys(WORLD_TOOL_KINDS) as WorldTool[]).map(worldTool),
  {
    name: "update_world_entry",
    description:
      "Change an NPC, place, item or shop by its id. Give only the fields that change; the entry's text and keys are rewritten from the fields.",
    parameters: obj(
      {
        id: str("The entry's id, as listed in the card"),
        fields: {
          type: "object",
          description: "The fields to change, by the names listed with the entry (name, role, look, voice, notes...)",
          additionalProperties: { type: "string" },
        },
      },
      ["id", "fields"],
    ),
  },
];

export const CARD_TOOLS: ToolDef[] = [
  {
    name: "set_field",
    description: "Replace the whole text of a card field. Use for new or fully rewritten fields.",
    parameters: obj({ field: fieldParam, text: str("The complete new text") }, ["field", "text"]),
  },
  {
    name: "patch_field",
    description:
      "Change part of a field: replaces the exact text `find` with `replace`. `find` must appear exactly once; include enough surrounding words to make it unique. Prefer this for small edits.",
    parameters: obj({ field: fieldParam, find: str("Exact existing text"), replace: str("New text") }, ["field", "find", "replace"]),
  },
  {
    name: "add_greeting",
    description: "Add an alternate greeting (another opening the user can swipe to).",
    parameters: obj(
      { text: str("The greeting"), group_only: { type: "boolean", description: "Only for group chats" } },
      ["text"],
    ),
  },
  {
    name: "update_greeting",
    description: "Replace an alternate greeting, by its number in the card (1 is the first alternate greeting).",
    parameters: obj({ number: { type: "integer", minimum: 1 }, text: str("The new greeting") }, ["number", "text"]),
  },
  {
    name: "add_example_dialogue",
    description: "Append one example dialogue block to mes_example. It shows voice and formatting, not plot.",
    parameters: obj({ text: str("Lines like `{{user}}: ...` and `{{char}}: ...`; <START> is added for you") }, ["text"]),
  },
  {
    name: "add_lore_entry",
    description: "Add a lorebook entry: a self-contained fact sheet sent only when a key appears in the chat.",
    parameters: obj(
      {
        title: str("Short title"),
        why: str("One sentence for the user: why this entry matters to the story"),
        keys: keysParam,
        content: str("The entry, written as fact, 50 to 200 tokens"),
        constant: { type: "boolean", description: "Always sent, even without a key. Only for true always-on facts." },
      },
      ["title", "keys", "content"],
    ),
  },
  {
    name: "update_lore_entry",
    description: "Change a lorebook entry by its id. Only the given properties change.",
    parameters: obj(
      {
        id: str("The entry's id, as listed in the card"),
        title: str("New title"),
        keys: keysParam,
        content: str("New content"),
        constant: { type: "boolean" },
        enabled: { type: "boolean" },
      },
      ["id"],
    ),
  },
  {
    name: "delete_lore_entry",
    description: "Delete a lorebook entry by its id.",
    parameters: obj({ id: str("The entry's id, as listed in the card") }, ["id"]),
  },
  ...WORLD_TOOLS,
  {
    name: "pitch",
    description:
      "Suggest an idea the user can accept with one tap: a secret, plot hook, NPC, faction, greeting, twist. Doesn't change the card.",
    parameters: obj({ title: str("A few words"), idea: str("The idea in one to three sentences") }, ["title", "idea"]),
  },
];

const tool = (name: string) => CARD_TOOLS.find((t) => t.name === name)!;
const ADD_WORLD = Object.keys(WORLD_TOOL_KINDS);

/** Tools for drafting a card from scratch: whole fields and new items only. */
export const DRAFT_TOOLS = ["set_field", "add_greeting", "add_example_dialogue", "add_lore_entry", ...ADD_WORLD].map(tool);

/** Tools for the lorebook brainstorm. */
export const LORE_TOOLS = [
  "add_lore_entry",
  "update_lore_entry",
  "delete_lore_entry",
  ...ADD_WORLD,
  "update_world_entry",
  "pitch",
].map(tool);

/** A tool call checked against the card and turned into a change. */
export type Edit =
  | { kind: "field"; field: EditableField; before: string; after: string }
  | { kind: "greeting"; list: "alternate_greetings" | "group_only_greetings"; index: number; before: string; after: string }
  | {
      kind: "lore";
      action: "add" | "update" | "delete";
      title: string;
      before?: LorebookEntry;
      after?: LorebookEntry;
      /** Set for an NPC, place, item or shop. */
      world?: WorldKind;
    }
  | { kind: "pitch"; title: string; idea: string }
  | EngineEdit;

export { ToolInputError };

const isString = (v: unknown): v is string => typeof v === "string";

function needString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (!isString(v)) throw new ToolInputError(`"${key}" must be a string`);
  return v;
}

function needField(input: Record<string, unknown>): EditableField {
  const f = input.field;
  if (!isString(f) || !FIELD_NAMES.includes(f as EditableField))
    throw new ToolInputError(`"field" must be one of ${FIELD_NAMES.join(", ")}`);
  return f as EditableField;
}

function needKeys(input: Record<string, unknown>): string[] | undefined {
  const k = input.keys;
  if (k === undefined) return undefined;
  if (!Array.isArray(k) || !k.every(isString)) throw new ToolInputError(`"keys" must be a list of strings`);
  return k.map((s) => s.trim()).filter(Boolean);
}

function findEntry(data: CardDataV3, id: unknown): number {
  const entries = data.character_book?.entries ?? [];
  const index = entries.findIndex((e) => String(e.id) === String(id));
  if (index < 0) throw new ToolInputError(`No lorebook entry with id ${String(id)}`);
  return index;
}

/** Works out what a tool call would change. Throws ToolInputError for invalid input. */
export function planEdit(data: CardDataV3, call: ToolCall): Edit {
  const input = call.input;
  if ("__invalid_json" in input) throw new ToolInputError("The tool input was not valid JSON");
  switch (call.name) {
    case "set_field": {
      const field = needField(input);
      return { kind: "field", field, before: data[field] ?? "", after: needString(input, "text") };
    }
    case "patch_field": {
      const field = needField(input);
      const find = needString(input, "find");
      const before = data[field] ?? "";
      if (!find) throw new ToolInputError(`"find" is empty`);
      const at = before.indexOf(find);
      if (at < 0) throw new ToolInputError(`The text to find isn't in ${field}`);
      if (before.indexOf(find, at + 1) >= 0) throw new ToolInputError(`The text to find appears more than once in ${field}`);
      const after = before.slice(0, at) + needString(input, "replace") + before.slice(at + find.length);
      return { kind: "field", field, before, after };
    }
    case "add_greeting": {
      const list = input.group_only === true ? "group_only_greetings" : "alternate_greetings";
      return { kind: "greeting", list, index: data[list].length, before: "", after: needString(input, "text") };
    }
    case "update_greeting": {
      const n = input.number;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > data.alternate_greetings.length)
        throw new ToolInputError(`"number" must be between 1 and ${data.alternate_greetings.length}`);
      return {
        kind: "greeting",
        list: "alternate_greetings",
        index: n - 1,
        before: data.alternate_greetings[n - 1],
        after: needString(input, "text"),
      };
    }
    case "add_example_dialogue": {
      const text = needString(input, "text").trim();
      const block = /^<START>/i.test(text) ? text : `<START>\n${text}`;
      const before = data.mes_example;
      return { kind: "field", field: "mes_example", before, after: before.trim() ? `${before.trimEnd()}\n${block}` : block };
    }
    case "add_lore_entry": {
      const book = data.character_book ?? emptyBook();
      const title = needString(input, "title");
      const entry = newEntry(book, {
        comment: title,
        name: title,
        keys: needKeys(input) ?? [],
        content: needString(input, "content"),
        constant: input.constant === true,
      });
      return { kind: "lore", action: "add", title, after: entry };
    }
    case "add_npc":
    case "add_place":
    case "add_item":
    case "add_shop": {
      const book = data.character_book ?? emptyBook();
      const world = WORLD_TOOL_KINDS[call.name];
      const fields = fieldsFor(world, input);
      if (!fields.name) throw new ToolInputError(`"name" must be a non-empty string`);
      const twin = book.entries.find(
        (e) => worldMeta(e)?.kind === world && worldMeta(e)!.fields.name?.trim().toLowerCase() === fields.name.toLowerCase(),
      );
      if (twin)
        throw new ToolInputError(
          `There's already ${aKind(world)} named ${fields.name} (id ${String(twin.id)}); change it with update_world_entry`,
        );
      return { kind: "lore", action: "add", title: fields.name, after: worldEntry(book, world, fields), world };
    }
    case "update_world_entry": {
      const book = data.character_book!;
      const before = book.entries[findEntry(data, input.id)];
      const meta = pageMeta(before);
      if (!meta) throw new ToolInputError(`Entry ${String(input.id)} isn't an NPC, place, item or shop; use update_lore_entry`);
      const world = meta.kind;
      const changes = input.fields;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new ToolInputError(`"fields" must be an object`);
      const known = new Set(KINDS[world].fields.map((f) => f.key));
      const unknown = Object.keys(changes).filter((k) => !known.has(k));
      if (unknown.length)
        throw new ToolInputError(`A ${KINDS[world].label} has no ${unknown.join(", ")}. Its fields: ${[...known].join(", ")}`);
      const fields = { ...meta.fields };
      for (const [k, v] of Object.entries(changes)) {
        if (typeof v !== "string") throw new ToolInputError(`"${k}" must be a string`);
        fields[k] = v.trim();
      }
      if (!fields.name) throw new ToolInputError(`"name" can't be empty`);
      const after = worldEntry(book, world, fields, before);
      return { kind: "lore", action: "update", title: fields.name, before, after, world };
    }
    case "update_lore_entry": {
      const before = data.character_book!.entries[findEntry(data, input.id)];
      const meta = pageMeta(before);
      if (meta && ["title", "keys", "content"].some((k) => input[k] !== undefined))
        throw new ToolInputError(
          `Entry ${String(input.id)} is ${aKind(meta.kind)}: its text and keys are written from its fields, so change them with update_world_entry`,
        );
      const after: LorebookEntry = { ...before };
      if (input.title !== undefined) after.comment = after.name = needString(input, "title");
      const keys = needKeys(input);
      if (keys) after.keys = keys;
      if (input.content !== undefined) after.content = needString(input, "content");
      if (typeof input.constant === "boolean") after.constant = input.constant;
      if (typeof input.enabled === "boolean") after.enabled = input.enabled;
      return { kind: "lore", action: "update", title: entryTitle(after), before, after };
    }
    case "delete_lore_entry": {
      const before = data.character_book!.entries[findEntry(data, input.id)];
      const world = pageMeta(before)?.kind;
      return { kind: "lore", action: "delete", title: entryTitle(before), before, ...(world ? { world } : {}) };
    }
    case "pitch":
      return { kind: "pitch", title: needString(input, "title"), idea: needString(input, "idea") };
    default: {
      const engine = planEngineEdit(data, call);
      if (engine) return engine;
      throw new ToolInputError(`Unknown tool ${call.name}`);
    }
  }
}

/** Applies a planned edit to the card data. Re-plan against the current card before applying. */
export function applyEdit(data: CardDataV3, edit: Edit): CardDataV3 {
  switch (edit.kind) {
    case "field":
      return { ...data, [edit.field]: edit.field === "nickname" && !edit.after ? undefined : edit.after };
    case "greeting": {
      const list = [...data[edit.list]];
      list[edit.index] = edit.after;
      return { ...data, [edit.list]: list };
    }
    case "lore": {
      const book = data.character_book ?? emptyBook();
      let entries = book.entries;
      if (edit.action === "add") entries = [...entries, edit.after!];
      if (edit.action === "update") entries = entries.map((e) => (e.id === edit.before!.id ? edit.after! : e));
      if (edit.action === "delete") entries = entries.filter((e) => e.id !== edit.before!.id);
      return { ...data, character_book: edit.world === "npc" ? syncCast({ ...book, entries }) : { ...book, entries } };
    }
    case "pitch":
      return data;
    case "engine":
      return applyEngine(data, edit.after);
    case "tiers": {
      const book = data.character_book ?? emptyBook();
      const entries = edit.before
        ? book.entries.map((e) => (e.id === edit.before!.id ? edit.after : e))
        : [...book.entries, edit.after];
      return { ...data, character_book: { ...book, entries } };
    }
    case "greetingState":
      if (edit.greeting === 0) return { ...data, first_mes: edit.after };
      return { ...data, alternate_greetings: data.alternate_greetings.map((g, i) => (i === edit.greeting - 1 ? edit.after : g)) };
  }
}

/** One line describing an edit, for the user and for the co-writer. */
export function describeEdit(edit: Edit): string {
  switch (edit.kind) {
    case "field":
      return `${edit.before ? "Change" : "Write"} ${EDITABLE_FIELDS[edit.field].toLowerCase()}`;
    case "greeting":
      return `${edit.before ? "Change" : "Add"} ${edit.list === "group_only_greetings" ? "group greeting" : "alternate greeting"} ${edit.index + 1}`;
    case "lore":
      return `${edit.action === "add" ? "Add" : edit.action === "update" ? "Change" : "Delete"} ${edit.world ? KINDS[edit.world].label : "lore entry"} "${edit.title}"`;
    case "pitch":
      return `Idea: ${edit.title}`;
    case "engine":
      return edit.summary;
    case "tiers":
      return `${edit.before ? "Change" : "Write"} the tiers of ${edit.variable}`;
    case "greetingState":
      return `Starting state for ${edit.greeting === 0 ? "the first message" : `greeting ${edit.greeting}`}`;
  }
}
