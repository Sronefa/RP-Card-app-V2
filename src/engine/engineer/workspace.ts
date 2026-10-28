/**
 * The UI engineer's workspace: the engine config it works on, seen as files, and the edits its write
 * tools make. Edits are kept as the tool calls themselves, so a finished turn can be shown as one
 * proposal and replayed onto the engine as it is when the user accepts it (one undo step).
 */
import { ToolInputError } from "../../ai/toolError";
import type { ToolCall } from "../../ai/types";
import { BUILT_IN_SCREENS, coreModules, modulesOf, newModule } from "../modules/compile";
import { forkModule } from "../modules/fork";
import { addModules, cleanModule } from "../modules/pack";
import { SLOTS, type EngineModule, type ModuleRegex, type ModuleRule, type Slot } from "../modules/types";
import { newVar, themeOf, VAR_TYPES, type EngineConfig, type EngineVar, type VarType } from "../sheet";
import { cleanOverrides, FONTS, PRESET_IDS, TEXTURES, type PresetId, type ThemeTokens } from "../theme";

export const MODULE_FILES = ["html", "css", "js", "script"] as const;
export type ModuleFile = (typeof MODULE_FILES)[number];

const FILE_HELP: Record<ModuleFile, string> = {
  html: "the screen's starting markup",
  css: "the screen's styles",
  js: "the screen's script (runs with CF, app, root, settings)",
  script: "the card-script part (runs once per chat with CF, settings, hooks)",
};

// ---------------------------------------------------------------- input checks

type Input = Record<string, unknown>;

function str(input: Input, key: string, optional?: false): string;
function str(input: Input, key: string, optional: true): string | undefined;
function str(input: Input, key: string, optional = false): string | undefined {
  const v = input[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== "string") throw new ToolInputError(`"${key}" must be a string`);
  return v;
}

function num(input: Input, key: string): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ToolInputError(`"${key}" must be a number`);
  return v;
}

function bool(input: Input, key: string): boolean | undefined {
  const v = input[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new ToolInputError(`"${key}" must be true or false`);
  return v;
}

function strings(input: Input, key: string): string[] | undefined {
  const v = input[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new ToolInputError(`"${key}" must be a list of strings`);
  return v.map((s) => s.trim()).filter(Boolean);
}

const modulesIn = (config: EngineConfig) => config.modules ?? coreModules();

function findModule(config: EngineConfig, id: unknown): { index: number; module: EngineModule } {
  const modules = modulesIn(config);
  const index = modules.findIndex((m) => m.id === id);
  if (index < 0) throw new ToolInputError(`There's no module "${String(id)}". Modules: ${modules.map((m) => m.id).join(", ") || "none"}.`);
  return { index, module: modules[index] };
}

function editable(config: EngineConfig, id: unknown) {
  const found = findModule(config, id);
  if (found.module.core)
    throw new ToolInputError(
      `"${found.module.id}" is a core module: CardForge writes its code. Change its options with set_module_settings, or fork_module it to change its code.`,
    );
  return found;
}

const withModule = (config: EngineConfig, index: number, module: EngineModule): EngineConfig => ({
  ...config,
  modules: modulesIn(config).map((m, i) => (i === index ? module : m)),
});

const SLOT_IDS = Object.keys(SLOTS) as Slot[];

function slotOf(input: Input): Slot | undefined {
  const slot = str(input, "slot", true);
  if (slot === undefined) return undefined;
  if (!SLOT_IDS.includes(slot as Slot)) throw new ToolInputError(`"slot" must be one of ${SLOT_IDS.join(", ")}`);
  return slot as Slot;
}

function fileOf(input: Input): ModuleFile {
  const file = str(input, "file");
  if (!MODULE_FILES.includes(file as ModuleFile)) throw new ToolInputError(`"file" must be one of ${MODULE_FILES.join(", ")}`);
  return file as ModuleFile;
}

/** The sheet's own values ("sheet") or a module's. */
function valuesOwner(config: EngineConfig, owner: unknown): { vars: EngineVar[]; put: (vars: EngineVar[]) => EngineConfig } {
  if (owner === undefined || owner === "sheet") return { vars: config.vars, put: (vars) => ({ ...config, vars }) };
  const { index, module } = editable(config, owner);
  return { vars: module.vars, put: (vars) => withModule(config, index, { ...module, vars }) };
}

const sameValue = (v: EngineVar, group: string, name: string) =>
  v.group.trim().toLowerCase() === group.trim().toLowerCase() && v.name.trim().toLowerCase() === name.trim().toLowerCase();

// ---------------------------------------------------------------- write tools

/** Applies one write tool to the config. Throws ToolInputError for input the engineer should fix. */
export function applyOp(config: EngineConfig, call: ToolCall): { config: EngineConfig; summary: string } {
  const input = call.input;
  if ("__invalid_json" in input) throw new ToolInputError("The tool input was not valid JSON");
  switch (call.name) {
    case "create_module": {
      const id = str(input, "id").trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ToolInputError(`"id" must be lowercase letters, digits and dashes`);
      if (modulesIn(config).some((m) => m.id === id)) throw new ToolInputError(`A module "${id}" already exists`);
      const name = str(input, "name").trim() || id;
      const base = newModule(name);
      const slot = slotOf(input) ?? "overlay";
      const module: EngineModule = {
        ...base,
        id,
        slot,
        button: slot === "overlay" ? (str(input, "button", true) ?? base.button) : undefined,
        description: str(input, "description", true) ?? "",
        html: str(input, "html", true) ?? "",
        css: str(input, "css", true) ?? "",
        js: str(input, "js", true) ?? "",
        script: str(input, "script", true) ?? "",
      };
      return {
        config: { ...config, modules: [...modulesIn(config), module] },
        summary: `Create the ${SLOTS[slot].label.toLowerCase()} module "${name}"`,
      };
    }
    case "set_module": {
      const { index, module } = editable(config, input.module);
      const slot = slotOf(input) ?? module.slot;
      const next: EngineModule = {
        ...module,
        name: str(input, "name", true) ?? module.name,
        slot,
        button: input.button !== undefined ? str(input, "button") : module.button,
        description: str(input, "description", true) ?? module.description,
        requires: strings(input, "requires") ?? module.requires,
        tags: strings(input, "tags") ?? module.tags,
        enabled: bool(input, "enabled") ?? module.enabled,
      };
      return { config: withModule(config, index, next), summary: `Change the "${next.name}" module's settings` };
    }
    case "set_module_settings": {
      const { index, module } = findModule(config, input.module);
      const settings = input.settings;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new ToolInputError(`"settings" must be an object`);
      const merged = { ...module, settings: { ...module.settings, ...(settings as Record<string, unknown>) } };
      // A core module is rebuilt from its settings, which checks them.
      const next = module.core ? (cleanModule(merged) ?? merged) : merged;
      return { config: withModule(config, index, next), summary: `Change the "${module.name}" module's options` };
    }
    case "install_part": {
      const incoming = (Array.isArray(input.modules) ? input.modules : []).map(cleanModule).filter((m): m is EngineModule => !!m);
      const enable = new Set(Array.isArray(input.enable) ? input.enable.map(String) : []);
      if (!incoming.length && !enable.size) throw new ToolInputError("Use install_part through the tool: it fills the part from the card.");
      const current = modulesIn(config).map((m) => (enable.has(m.id) ? { ...m, enabled: true } : m));
      return { config: { ...config, modules: addModules(current, incoming) }, summary: `Install the ${str(input, "part") || incoming[0]?.name} part` };
    }
    case "add_built_in": {
      const screen = BUILT_IN_SCREENS.find((b) => b.core === input.screen);
      if (!screen) throw new ToolInputError(`"screen" must be "creator" or "phone"`);
      if (modulesIn(config).some((m) => m.core === screen.core || m.id === screen.core)) throw new ToolInputError(`The card already has a "${screen.core}" module`);
      const base = screen.make();
      const extra = input.settings && typeof input.settings === "object" && !Array.isArray(input.settings) ? (input.settings as Input) : {};
      const module = cleanModule({ ...base, settings: { ...base.settings, ...extra } }) ?? base;
      return { config: { ...config, modules: [...modulesIn(config), module] }, summary: `Add the built-in ${module.name.toLowerCase()}` };
    }
    case "fork_module": {
      const id = str(input, "module").trim();
      const app = str(input, "app", true)?.trim();
      let out;
      try {
        out = forkModule(config, id, app || undefined);
      } catch (e) {
        throw new ToolInputError((e as Error).message);
      }
      return {
        config: out.config,
        summary: app ? `Fork the phone's ${out.module.name} app into the module "${out.module.id}"` : `Fork the ${out.module.name} module to change its code`,
      };
    }
    case "delete_module": {
      const { index, module } = findModule(config, input.module);
      return {
        config: { ...config, modules: modulesIn(config).filter((_, i) => i !== index) },
        summary: `Remove the "${module.name}" module`,
      };
    }
    case "write_file": {
      const { index, module } = editable(config, input.module);
      const file = fileOf(input);
      return { config: withModule(config, index, { ...module, [file]: str(input, "content") }), summary: `Write ${module.id}/${file}` };
    }
    case "patch_file": {
      const { index, module } = editable(config, input.module);
      const file = fileOf(input);
      const find = str(input, "find");
      const before = module[file];
      if (!find) throw new ToolInputError(`"find" is empty`);
      const at = before.indexOf(find);
      if (at < 0)
        throw new ToolInputError(`The text to find isn't in ${module.id}/${file}. Read the module again and copy the text exactly.`);
      if (before.indexOf(find, at + 1) >= 0)
        throw new ToolInputError(`The text to find appears more than once in ${module.id}/${file}; include more of the lines around it.`);
      const after = before.slice(0, at) + str(input, "replace") + before.slice(at + find.length);
      return { config: withModule(config, index, { ...module, [file]: after }), summary: `Patch ${module.id}/${file}` };
    }
    case "set_value": {
      const owner = valuesOwner(config, input.module);
      const group = str(input, "group", true) ?? "";
      const name = str(input, "name").trim();
      if (!name || /[.[\]"'/~]/.test(name) || /[.[\]"'/~]/.test(group))
        throw new ToolInputError(`Names can't be empty or contain . [ ] / ~ or quotes`);
      if (/^[$_]/.test(name)) throw new ToolInputError(`Use "hidden" or "readOnly" instead of a "$" or "_" in the name`);
      const type = str(input, "type", true);
      if (type !== undefined && !(type in VAR_TYPES))
        throw new ToolInputError(`"type" must be one of ${Object.keys(VAR_TYPES).join(", ")}`);
      const old = owner.vars.find((v) => sameValue(v, group, name));
      const start = input.start;
      const fields: Partial<EngineVar> = {
        group: group.trim(),
        name,
        ...(type ? { type: type as VarType } : {}),
        ...(start !== undefined ? { start: Array.isArray(start) ? start.join(", ") : String(start) } : {}),
        ...(input.min !== undefined ? { min: num(input, "min") } : {}),
        ...(input.max !== undefined ? { max: num(input, "max") } : {}),
        ...(input.options !== undefined ? { options: strings(input, "options") } : {}),
        ...(input.rule !== undefined ? { rule: str(input, "rule") } : {}),
        ...(input.hidden !== undefined ? { hidden: bool(input, "hidden"), ...(bool(input, "hidden") ? { readOnly: false } : {}) } : {}),
        ...(input.readOnly !== undefined
          ? { readOnly: bool(input, "readOnly"), ...(bool(input, "readOnly") ? { hidden: false } : {}) }
          : {}),
        ...(input.pinned !== undefined ? { pinned: bool(input, "pinned") } : {}),
      };
      // A match keeps its own spelling: renaming would move the value in the state.
      const vars = old
        ? owner.vars.map((v) => (v === old ? { ...v, ...fields, group: v.group, name: v.name } : v))
        : [...owner.vars, newVar({ type: "text", start: "", ...fields })];
      const label = [group.trim(), name].filter(Boolean).join(".");
      return { config: owner.put(vars), summary: `${old ? "Change" : "Add"} the value ${label}` };
    }
    case "keep_light_backup": {
      // Written by convert_light_card, not called by the model directly.
      const tracker = (input.tracker ?? null) as NonNullable<EngineConfig["light"]>["tracker"];
      const stages = (input.stages ?? null) as NonNullable<EngineConfig["light"]>["stages"];
      return {
        config: { ...config, light: { tracker, stages } },
        summary: tracker ? "Keep the status tracker, to bring back if the engine is turned off" : "Turn the stages into tiers",
      };
    }
    case "remove_value": {
      const owner = valuesOwner(config, input.module);
      const group = str(input, "group", true) ?? "";
      const name = str(input, "name");
      const old = owner.vars.find((v) => sameValue(v, group, name));
      if (!old) throw new ToolInputError(`There's no value ${[group, name].filter(Boolean).join(".")} there`);
      return {
        config: owner.put(owner.vars.filter((v) => v !== old)),
        summary: `Remove the value ${[group, name].filter(Boolean).join(".")}`,
      };
    }
    case "add_rule": {
      const { index, module } = editable(config, input.module);
      const rule: ModuleRule = {
        comment: str(input, "name"),
        content: str(input, "content"),
        constant: bool(input, "constant") ?? true,
        keys: strings(input, "keys") ?? [],
        depth: num(input, "depth"),
        order: num(input, "order") ?? 100,
      };
      if (!rule.content.trim()) throw new ToolInputError(`"content" is empty`);
      if (rule.depth === 0) throw new ToolInputError("Depth 0 is kept for the player's message; use 1 or more");
      return {
        config: withModule(config, index, { ...module, rules: [...module.rules, rule] }),
        summary: `Add the rule "${rule.comment}" to ${module.id}`,
      };
    }
    case "remove_rule": {
      const { index, module } = editable(config, input.module);
      const n = num(input, "index");
      if (n === undefined || !module.rules[n]) throw new ToolInputError(`"index" must be 0 to ${module.rules.length - 1}`);
      return {
        config: withModule(config, index, { ...module, rules: module.rules.filter((_, i) => i !== n) }),
        summary: `Remove a rule from ${module.id}`,
      };
    }
    case "add_regex": {
      const { index, module } = editable(config, input.module);
      const find = str(input, "find");
      if (!/^\/.+\/[dgimsuy]*$/s.test(find)) throw new ToolInputError(`"find" must be written as /pattern/flags`);
      try {
        const m = /^\/(.+)\/([dgimsuy]*)$/s.exec(find)!;
        new RegExp(m[1], m[2]);
      } catch (e) {
        throw new ToolInputError(`"find" isn't a valid regex: ${(e as Error).message}`);
      }
      const only = str(input, "only", true) ?? "display";
      if (!["display", "prompt", "both"].includes(only)) throw new ToolInputError(`"only" must be display, prompt or both`);
      const regex: ModuleRegex = {
        name: str(input, "name", true) ?? "",
        find,
        replace: str(input, "replace"),
        ai: bool(input, "ai") ?? true,
        user: bool(input, "user") ?? false,
        only: only as ModuleRegex["only"],
        minDepth: num(input, "minDepth"),
      };
      return { config: withModule(config, index, { ...module, regex: [...module.regex, regex] }), summary: `Add a regex to ${module.id}` };
    }
    case "remove_regex": {
      const { index, module } = editable(config, input.module);
      const n = num(input, "index");
      if (n === undefined || !module.regex[n]) throw new ToolInputError(`"index" must be 0 to ${module.regex.length - 1}`);
      return {
        config: withModule(config, index, { ...module, regex: module.regex.filter((_, i) => i !== n) }),
        summary: `Remove a regex from ${module.id}`,
      };
    }
    case "set_theme": {
      const theme = themeOf(config);
      const preset = str(input, "preset", true);
      if (preset !== undefined && !PRESET_IDS.includes(preset as PresetId))
        throw new ToolInputError(`"preset" must be one of ${PRESET_IDS.join(", ")}`);
      const raw = input.tokens;
      if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw)))
        throw new ToolInputError(`"tokens" must be an object`);
      const tokens = { ...((raw ?? {}) as Partial<ThemeTokens>) };
      // Fonts and textures can be given by name.
      for (const key of ["font", "heading"] as const) if (typeof tokens[key] === "string" && FONTS[tokens[key]!]) tokens[key] = FONTS[tokens[key]!];
      if (typeof tokens.texture === "string" && TEXTURES[tokens.texture]) tokens.texture = TEXTURES[tokens.texture];
      const clean = cleanOverrides(tokens);
      const refused = Object.keys(tokens).filter((k) => !(k in clean));
      if (refused.length)
        throw new ToolInputError(
          `These tokens aren't usable: ${refused.join(", ")}. Colours are #hex, rgb() or hsl(); fonts and textures come from the design guide's lists (by name or exact value); no url() of your own.`,
        );
      const overrides = { ...theme.overrides, ...clean };
      for (const key of strings(input, "reset") ?? []) delete overrides[key as keyof ThemeTokens];
      return {
        config: { ...config, theme: { preset: (preset as PresetId | undefined) ?? theme.preset, overrides } },
        summary: "Change the card theme",
      };
    }
    case "set_panel": {
      const panel = { ...config.panel };
      const enabled = bool(input, "enabled");
      if (enabled !== undefined) panel.enabled = enabled;
      const title = str(input, "title", true);
      if (title !== undefined) panel.title = title;
      return { config: { ...config, panel }, summary: "Change the status panel" };
    }
    default:
      throw new ToolInputError(`Unknown tool ${call.name}`);
  }
}

/** Replays edits, in order, onto a config. Stops at the first that doesn't fit. */
export function replay(config: EngineConfig, calls: ToolCall[]): { config: EngineConfig; summaries: string[] } {
  const summaries: string[] = [];
  for (const call of calls) {
    const out = applyOp(config, call);
    config = out.config;
    summaries.push(out.summary);
  }
  return { config, summaries };
}

// ---------------------------------------------------------------- the config as files

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const valuesJson = (vars: EngineVar[]) =>
  pretty(
    vars.map((v) => {
      const out: Record<string, unknown> = { group: v.group, name: v.name, type: v.type, start: v.start };
      if (v.min !== undefined) out.min = v.min;
      if (v.max !== undefined) out.max = v.max;
      if (v.options?.length) out.options = v.options;
      if (v.hidden) out.hidden = true;
      if (v.readOnly) out.readOnly = true;
      if (v.pinned === false) out.pinned = false;
      out.rule = v.rule;
      return out;
    }),
  );

/** Everything the engineer can change, as named text files, for reading and for diffs. */
export function configFiles(config: EngineConfig): Record<string, string> {
  const files: Record<string, string> = {
    "sheet/values.json": valuesJson(config.vars),
    "theme.json": pretty(themeOf(config)),
    "panel.json": pretty({ enabled: config.panel.enabled, title: config.panel.title }),
  };
  for (const m of modulesOf(config)) {
    const base = `modules/${m.id}`;
    files[`${base}/manifest.json`] = pretty({
      name: m.name,
      slot: m.slot,
      ...(m.slot === "overlay" ? { button: m.button ?? "" } : {}),
      description: m.description,
      enabled: m.enabled,
      requires: m.requires,
      tags: m.tags,
      ...(m.core ? { core: m.core } : {}),
      settings: m.settings,
    });
    files[`${base}/values.json`] = valuesJson(m.vars);
    if (m.rules.length) files[`${base}/rules.json`] = pretty(m.rules);
    if (m.regex.length) files[`${base}/regex.json`] = pretty(m.regex);
    // A core module's code is CardForge's own; only its settings are the author's.
    if (!m.core) for (const f of MODULE_FILES) if (m[f]) files[`${base}/${f}`] = m[f];
  }
  return files;
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
}

/** What changed between two configs, file by file. */
export function diffConfigs(before: EngineConfig, after: EngineConfig): FileChange[] {
  const a = configFiles(before);
  const b = configFiles(after);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return paths.filter((p) => a[p] !== b[p]).map((path) => ({ path, before: a[path] ?? "", after: b[path] ?? "" }));
}

// ---------------------------------------------------------------- read tools

export function listModulesText(config: EngineConfig): string {
  const modules = modulesOf(config);
  if (!modules.length) return "No modules yet.";
  return modules
    .map((m) => {
      const size = MODULE_FILES.reduce((n, f) => n + m[f].length, 0);
      return `- ${m.id}: "${m.name}", ${SLOTS[m.slot].label}${m.slot === "overlay" ? ` (button "${m.button ?? ""}")` : ""}${m.enabled ? "" : ", off"}${m.core ? ", core" : ""}; ${m.vars.length} values, ${m.rules.length} rules, ${m.regex.length} regex, ${size} characters of code${m.description ? `. ${m.description}` : ""}`;
    })
    .join("\n");
}

export function readModuleText(config: EngineConfig, id: unknown): string {
  const { module } = findModule(config, id);
  const files = configFiles(config);
  const prefix = `modules/${module.id}/`;
  const parts = Object.keys(files)
    .filter((p) => p.startsWith(prefix))
    .map((p) => {
      const name = p.slice(prefix.length);
      const help = FILE_HELP[name as ModuleFile];
      return `<file name="${name}"${help ? ` about="${help}"` : ""}>\n${files[p]}\n</file>`;
    });
  const empty = module.core
    ? []
    : MODULE_FILES.filter((f) => !module[f]).map((f) => `<file name="${f}" about="${FILE_HELP[f]}">(empty)</file>`);
  return [
    `Module "${module.name}" (${module.id})${module.core ? ": a core module; its code is CardForge's, only its settings can change" : ""}`,
    ...parts,
    ...empty,
  ].join("\n\n");
}
