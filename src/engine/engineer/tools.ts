/**
 * The UI engineer's tools: reading the engine and the docs, writing modules as files, and testing
 * the result on a hidden sandbox page. Writes change only the turn's draft; the finished turn
 * becomes one proposal.
 */
import { conversionOps, planConversion, planText } from "../convert";
import YAML from "yaml";
import type { CardDataV3 } from "../../card";
import { applyEdit, CARD_TOOLS, describeEdit, isWorldTool, planEdit, ToolInputError, WORLD_TOOLS } from "../../ai/tools";
import type { ToolCall, ToolDef, ToolResult } from "../../ai/types";
import { effectiveConfig, modulesOf } from "../modules/compile";
import type { SandboxLibs } from "../sandbox/sandbox";
import { applyEngine, scenarioOf, stateSchema, themeOf, varPath, VAR_TYPES, type EngineConfig } from "../sheet";
import { PRESET_IDS, themeBundle } from "../theme";
import { SLOTS, type EngineModule } from "../modules/types";
import { allParts, hasPart, installParts, partsText, searchParts } from "../parts/catalog";
import { docsIndex, examplesIndex, readDoc, readExample, searchDocsText, skillsIndex, type Skill } from "./knowledge";
import { findingsText, lintConfig, screenFindings, type Finding } from "./lint";
import type { EnginePreview, PreviewDevice } from "./preview";
import { applyOp, listModulesText, MODULE_FILES, readModuleText } from "./workspace";

const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
const int = (description: string) => ({ type: "integer", description });
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef["parameters"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const tool = (name: string, description: string, parameters: ToolDef["parameters"] = obj({})): ToolDef => ({
  name,
  description,
  parameters,
});

const moduleId = str("The module's id");
const fileParam = { type: "string", enum: [...MODULE_FILES], description: "html, css, js (the screen) or script (the card-script part)" };
const slotParam = {
  type: "string",
  enum: Object.keys(SLOTS),
  description: Object.entries(SLOTS)
    .map(([k, s]) => `${k}: ${s.label}`)
    .join("; "),
};
const screenParam = str(
  'Which screen: "chat", "panel" (the newest status panel), "overlay" (the open hub screen), "message:N", or part of a screen\'s name',
);

export const READ_TOOLS: ToolDef[] = [
  tool("list_modules", "List the card's modules: id, name, slot, size, values and rules."),
  tool(
    "read_module",
    "Read one module as files: manifest.json, values.json, rules.json, regex.json, html, css, js, script.",
    obj({ module: moduleId }, ["module"]),
  ),
  tool(
    "read_values",
    "Read every value in the game state (the sheet's and each module's) with its path, type, start and rule, and the sample state you set.",
  ),
  tool("read_theme", "Read the card theme: the preset, the user's overrides, and the resolved light and dark tokens."),
  tool("read_card", "Read the card's name, description, scenario and first message, for the setting and the characters' names."),
  tool(
    "read_light_card",
    "Read the card's light-card state (status tracker, relationship stages, mechanics, NPCs and places) and the values converting it would add. Read it before convert_light_card and tell the user the plan.",
  ),
];

/** Converting a light card. Not a WRITE_TOOLS op: it reads the card, then writes plain set_value ops. */
export const CONVERT_TOOLS: ToolDef[] = [
  tool(
    "convert_light_card",
    "Turn the light card's tracker, stages and mechanics into engine values, as part of your proposal. Only after the user confirmed the plan from read_light_card in this chat. The tracker is turned off on accept and comes back if the engine is turned off; the stages become tiers of the affection value.",
    obj(
      {
        confirmed: bool("True only when the user said yes to the plan in this chat"),
        people: bool("Also a value per NPC for where {{user}} stands with them"),
        places: bool("Also a location value with the places as its options"),
      },
      ["confirmed"],
    ),
  ),
];

export const KNOWLEDGE_TOOLS: ToolDef[] = [
  tool(
    "search_docs",
    "Search the engine docs. Returns matching sections with ids to read.",
    obj({ query: str("Words to look for, like 'app.send action' or 'meter delta'") }, ["query"]),
  ),
  tool(
    "read_doc",
    'Read a whole doc ("core-api") or one section ("core-api#reading-state").',
    obj({ id: str("A doc or section id") }, ["id"]),
  ),
  tool("list_skills", "List your skills: step-by-step playbooks for common jobs."),
  tool(
    "load_skill",
    "Read a skill. Load the one that matches the job before you start building.",
    obj({ id: str("The skill's id") }, ["id"]),
  ),
  tool("list_examples", "List the example modules you can copy patterns from."),
  tool(
    "list_parts",
    "List finished parts you can install: CardForge's (title screen, character creator, menu, people, events, journal, notifications, phone, time…) and the user's saved modules. Search by words or a tag.",
    obj({ query: str("Words to match, like 'relationships' or 'map'"), tag: str("A tag, like 'shared', 'npc' or 'screen'") }),
  ),
  tool(
    "read_part",
    "Read a part before installing it: what it does, what it needs, its settings filled from this card, its sample values, and what to tailor.",
    obj({ id: str("The part's id") }, ["id"]),
  ),
  tool("read_example", "Read an example module as files.", obj({ id: str("The example's id") }, ["id"])),
];

const valueProps = {
  module: str("\"sheet\" for the card's own values (the default), or a module id for the module's values"),
  group: str('The group, like "Player". Empty for a top-level value'),
  name: str("The value's name, without $ or _"),
};

export const WRITE_TOOLS: ToolDef[] = [
  tool(
    "create_module",
    "Create a module of your own. You can give its files now or write them after.",
    obj(
      {
        id: str("Lowercase id with dashes, like 'phone' or 'shop-app'"),
        name: str("Name the player sees"),
        slot: slotParam,
        button: str("For a hub screen (overlay): the button above the input box, like '📱 Phone'"),
        description: str("One sentence on what it does"),
        html: str("Starting markup"),
        css: str("Styles"),
        js: str("Screen script: runs as function (CF, app, root, settings)"),
        script: str("Card-script part: runs once per chat as function (CF, settings, hooks)"),
      },
      ["id", "name", "slot"],
    ),
  ),
  tool(
    "install_part",
    "Install a finished part with the parts it needs, filled from the card's world pages. Prefer this to building from scratch when a part fits; then tailor it (set_module_settings, or patch its files if it's the user's own).",
    obj({ id: str("The part's id"), settings: { type: "object", description: "Settings to start with, over the part's own (read_part shows them)" } }, ["id"]),
  ),
  tool(
    "add_built_in",
    "Add one of CardForge's built-in screens: the character creator (shows in the first message) or the phone (a hub screen with a lock screen, home screen and apps). Its code is CardForge's; change it with set_module_settings.",
    obj(
      {
        screen: { type: "string", enum: ["creator", "phone"], description: "Which screen" },
        settings: { type: "object", description: "Options to start with (read_example shows them)" },
      },
      ["screen"],
    ),
  ),
  tool(
    "set_module",
    "Change a module's manifest: name, slot, button, description, requires, tags or whether it's on.",
    obj(
      {
        module: moduleId,
        name: str("New name"),
        slot: slotParam,
        button: str("Hub button label"),
        description: str("One sentence"),
        requires: { type: "array", items: { type: "string" }, description: "Ids of modules this one needs" },
        tags: { type: "array", items: { type: "string" } },
        enabled: bool("Whether the module is on"),
      },
      ["module"],
    ),
  ),
  tool(
    "set_module_settings",
    "Merge options into a module's settings. This is the only way to change a core or built-in module (time, settings app, creator, phone).",
    obj({ module: moduleId, settings: { type: "object", description: "Options to merge in" } }, ["module", "settings"]),
  ),
  tool("delete_module", "Remove a module.", obj({ module: moduleId }, ["module"])),
  tool(
    "write_file",
    "Write a whole module file. Use for new files or rewrites; patch_file for small changes.",
    obj({ module: moduleId, file: fileParam, content: str("The complete file") }, ["module", "file", "content"]),
  ),
  tool(
    "patch_file",
    "Replace the exact text `find` with `replace` in a module file. `find` must appear exactly once: include enough of the lines around it.",
    obj({ module: moduleId, file: fileParam, find: str("Exact existing text"), replace: str("New text") }, [
      "module",
      "file",
      "find",
      "replace",
    ]),
  ),
  tool(
    "set_value",
    "Add a value to the game state, or change one (matched by group and name). Only the fields you give change.",
    obj(
      {
        ...valueProps,
        type: {
          type: "string",
          enum: Object.keys(VAR_TYPES),
          description: Object.entries(VAR_TYPES)
            .map(([k, t]) => `${k}: ${t.help}`)
            .join(" "),
        },
        start: { description: 'Starting value as text: "100", "calm", "yes", "a, b", "rope: 1, torch: 2"' },
        min: { type: "number" },
        max: { type: "number" },
        options: { type: "array", items: { type: "string" }, description: "For a choice" },
        rule: str("One sentence for the model: when and by how much it changes"),
        hidden: bool("The model never sees it ($)"),
        readOnly: bool("The model sees it but can't change it (_); scripts and the player can"),
        pinned: bool("Shown in the compact status panel"),
      },
      ["name"],
    ),
  ),
  tool("remove_value", "Remove a value.", obj(valueProps, ["name"])),
  tool(
    "add_rule",
    "Add a lorebook rule to a module: what its actions mean and how the model should play it.",
    obj(
      {
        module: moduleId,
        name: str("Short name"),
        content: str("The rule text"),
        constant: bool("Always sent (true), or only when a key appears (false)"),
        keys: { type: "array", items: { type: "string" }, description: 'Keys for a keyed rule, like app="shop"' },
        depth: int("Depth in the chat, 1 or more. Leave out to go with the update rules"),
        order: int("Order within the depth; higher is later and weighs more"),
      },
      ["module", "name", "content"],
    ),
  ),
  tool(
    "remove_rule",
    "Remove a module's rule by its index in rules.json.",
    obj({ module: moduleId, index: int("From 0") }, ["module", "index"]),
  ),
  tool(
    "add_regex",
    "Add a regex script to a module, to change how replies show or what the model reads.",
    obj(
      {
        module: moduleId,
        name: str("Short name"),
        find: str("/pattern/flags"),
        replace: str("Replacement; $1 for groups"),
        ai: bool("Runs on the model's replies (default true)"),
        user: bool("Runs on the player's messages"),
        only: {
          type: "string",
          enum: ["display", "prompt", "both"],
          description: "Change only what's shown, only what the model reads, or both",
        },
        minDepth: int("Only on messages at least this deep"),
      },
      ["module", "find", "replace"],
    ),
  ),
  tool(
    "remove_regex",
    "Remove a module's regex by its index in regex.json.",
    obj({ module: moduleId, index: int("From 0") }, ["module", "index"]),
  ),
  tool(
    "set_theme",
    "Change the card theme: the preset and token overrides. The design guide lists the tokens and allowed fonts.",
    obj(
      {
        preset: { type: "string", enum: PRESET_IDS },
        tokens: { type: "object", description: "Tokens to override, like { accent: '#c0392b', radius: 4 }" },
        reset: { type: "array", items: { type: "string" }, description: "Tokens to set back to the preset's" },
      },
      [],
    ),
  ),
  tool(
    "set_panel",
    "Turn the status panel under each reply on or off, or rename it.",
    obj({ enabled: bool("On or off"), title: str("Its title") }),
  ),
];

export const TEST_TOOLS: ToolDef[] = [
  tool(
    "set_sample_state",
    "Set sample values on the newest message for the next render, merged into the state the scenario left. Use it to see screens full, empty, at limits and with long names.",
    obj(
      {
        state: { type: "object", description: 'Values by group, like { "Player": { "Gold": 0, "Items": {} } }' },
        delta: { type: "object", description: 'Optional changes to show, by path: { "Player.Gold": [25, 40] }' },
        clear: bool("Drop all sample values instead"),
      },
      [],
    ),
  ),
  tool(
    "render_preview",
    "Run the draft card in the sandbox (the scenario, then your sample state) and look at it: a screenshot, every console error, and a short outline of each screen with sizes. Optionally open a hub screen first.",
    obj(
      {
        device: { type: "string", enum: ["phone", "desktop"], description: "phone is 390×760 (default), desktop 1280×800" },
        open: str('A module id to open as a hub screen, or "status" for the status panel screen'),
        fresh: bool("Start the chat over even if the card hasn't changed (default: keep clicks and turns)"),
      },
      [],
    ),
  ),
  tool(
    "click",
    "Click something on the running preview, by visible text or CSS selector, as the player would. Reports what it wrote in the input box. Render again to see the result.",
    obj({ screen: screenParam, text: str("Visible text of the button or item"), selector: str("A CSS selector, when text isn't enough") }),
  ),
  tool(
    "run_turn",
    "Play one turn on the running preview: the player's message, then a reply you write as the model would, with its <UpdateVariable> block. Reports the new state and what changed.",
    obj({ player: str("The player's message"), reply: str("The model's reply, story then the update block") }, ["player", "reply"]),
  ),
  tool(
    "lint",
    "Check the draft: network use, code that doesn't parse, missing values, actions without rules, script size, token cost, and, on a phone-sized page, sideways scrolling, contrast and small tap targets on every screen.",
    obj({ screens: bool("Also check the screens on a page (default true)") }),
  ),
];

/**
 * NPCs, places, items and shops the engineer needs (a contact, a shop, a map pin) go into the
 * card's world pages, as proposals in the co-writer chat rather than in the engine proposal.
 */
export const CARD_WORLD_TOOLS: ToolDef[] = WORLD_TOOLS.filter((t) => isWorldTool(t.name)).map((t) => ({
  ...t,
  description: `${t.description} It goes to the user as a proposal in the co-writer chat when your turn ends.`,
}));

/**
 * Card text the engine needs (a greeting that sets the scene for a value, a line in the description
 * about the status panel) goes to the co-writer chat as a proposal too, so the user sees it there.
 */
export const CARD_TEXT_TOOLS: ToolDef[] = CARD_TOOLS.filter((t) => t.name === "set_field" || t.name === "patch_field").map((t) => ({
  ...t,
  description: `${t.description} Card text only, never engine values or numbers the engine tracks. It goes to the user as a proposal in the co-writer chat when your turn ends.`,
}));

export const ENGINEER_TOOLS: ToolDef[] = [
  ...READ_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...WRITE_TOOLS,
  ...CONVERT_TOOLS,
  ...CARD_WORLD_TOOLS,
  ...CARD_TEXT_TOOLS,
  ...TEST_TOOLS,
];
export const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

export interface SampleState {
  state: Record<string, unknown>;
  delta?: Record<string, [unknown, unknown]>;
}

/** What one turn works on. Write tools change `draft` and add to `ops`. */
export interface EngineerContext {
  data: CardDataV3;
  draft: EngineConfig;
  ops: ToolCall[];
  skills: Skill[];
  sample?: SampleState;
  /** Set when the sample changed and the page doesn't show it yet. */
  sampleDirty?: boolean;
  preview?: EnginePreview;
  libs?: () => Promise<SandboxLibs>;
  /** The user's saved modules, which are parts too. */
  library?: EngineModule[];
  /** World entries to propose in the co-writer chat (add_npc and the like). */
  cardCalls?: ToolCall[];
  /** False when the model gets no screenshots (it can't see, or the user skipped them). */
  shots?: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (id: string, content: string, isError = false): ToolResult => ({ id, content, ...(isError ? { isError } : {}) });

function valuesText(ctx: EngineerContext): string {
  const full = effectiveConfig(ctx.draft);
  const owner = new Map<string, string>();
  for (const m of modulesOf(ctx.draft)) for (const v of m.vars) owner.set(v.id, m.id);
  const lines = full.vars
    .filter((v) => v.name.trim())
    .map((v) => {
      const bits = [v.type, `start ${JSON.stringify(v.start)}`];
      if (v.min !== undefined || v.max !== undefined) bits.push(`${v.min ?? "…"} to ${v.max ?? "…"}`);
      if (v.options?.length) bits.push(`options ${v.options.join(" / ")}`);
      if (v.hidden) bits.push("hidden");
      if (v.readOnly) bits.push("read-only");
      bits.push(`from ${owner.get(v.id) ?? "sheet"}`);
      return `- ${varPath(v).join(".")} (${bits.join(", ")})${v.rule.trim() ? `: ${v.rule.trim()}` : ""}`;
    });
  return [
    lines.length ? lines.join("\n") : "No values yet.",
    ctx.sample ? `Sample state you set:\n${YAML.stringify(ctx.sample)}` : "No sample state set: screens show the scenario's state.",
  ].join("\n\n");
}

function cardText(data: CardDataV3): string {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return [
    `Name: ${data.name}`,
    data.description && `Description:\n${cut(data.description, 2500)}`,
    data.scenario && `Scenario:\n${cut(data.scenario, 800)}`,
    data.first_mes && `First message:\n${cut(data.first_mes, 1200)}`,
    data.character_book?.entries.length
      ? `Lorebook entries: ${data.character_book.entries
          .map((e) => e.comment || e.keys[0])
          .filter(Boolean)
          .slice(0, 40)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function partText(ctx: EngineerContext, id: string): string {
  const parts = allParts(ctx.library);
  const part = parts.find((p) => p.id === id);
  if (!part) throw new ToolInputError(`There's no part "${id}". Parts:\n${partsText(parts, ctx.draft)}`);
  const module = part.make();
  let settings: Record<string, unknown> = { ...module.settings };
  delete settings.live;
  if (part.fill) settings = part.fill(settings, ctx.data);
  const code = module.core
    ? "Its code is CardForge's: change it through its settings (set_module_settings once installed)."
    : (["html", "css", "js", "script"] as const)
        .filter((f) => module[f].trim())
        .map((f) => `<file name="${f}">\n${module[f]}\n</file>`)
        .join("\n\n");
  return [
    `${part.name} (${part.id})${hasPart(ctx.draft, part.id) ? ", already in the card" : ""}: ${part.summary}`,
    `Slot: ${SLOTS[module.slot].label}${module.button ? `, hub button "${module.button}"` : ""}. Tags: ${part.tags.join(", ")}.${part.requires.length ? ` Installs with: ${part.requires.join(", ")}.` : ""}`,
    module.vars.length ? `Values it adds (with these settings may differ):\n${module.vars.map((v) => `- ${varPath(v).join(".")} (${v.type})`).join("\n")}` : "It adds no values.",
    `Settings, filled from this card:\n${YAML.stringify(settings)}`,
    part.sample ? `Sample values for set_sample_state:\n${YAML.stringify(part.sample)}` : "",
    `To tailor: ${part.tailor}`,
    code,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function ensurePage(ctx: EngineerContext, device: PreviewDevice, fresh = false) {
  if (!ctx.preview || !ctx.libs)
    throw new ToolInputError("The preview can't run here, so there's nothing to look at. Rely on lint and careful reading.");
  const libs = await ctx.libs();
  const reloaded = await ctx.preview.load({ data: applyEngine(ctx.data, ctx.draft), libs, device, scenario: scenarioOf(ctx.draft), fresh });
  if ((reloaded || ctx.sampleDirty) && ctx.sample) await ctx.preview.setSample(ctx.sample.state, ctx.sample.delta);
  ctx.sampleDirty = false;
  return ctx.preview;
}

function problemsText(problems: string[]) {
  return problems.length
    ? `Console errors and warnings:\n${problems
        .slice(0, 15)
        .map((p) => `- ${p}`)
        .join("\n")}${problems.length > 15 ? `\n…and ${problems.length - 15} more` : ""}`
    : "No console errors.";
}

async function render(ctx: EngineerContext, call: ToolCall): Promise<ToolResult> {
  const input = call.input;
  const device = input.device === "desktop" ? "desktop" : "phone";
  const preview = await ensurePage(ctx, device, input.fresh === true);
  await preview.close();
  if (typeof input.open === "string" && input.open.trim()) {
    const id = input.open.trim();
    if (id !== "status" && !modulesOf(ctx.draft).some((m) => m.id === id && m.enabled))
      throw new ToolInputError(`There's no module "${id}" that is on.`);
    await preview.open(id);
  }
  const shots = ctx.shots !== false;
  const shot = shots ? await preview.capture() : undefined;
  const screens = await preview.inspect();
  const { problems } = preview.take();
  const findings = screenFindings(screens, device);
  let budget = shots ? 140 : 240;
  const outline = screens
    .map((s) => {
      const lines = s.outline.slice(0, Math.max(0, budget));
      budget -= lines.length;
      return `${s.screen} (${s.width}×${s.height}):\n${lines.map((l) => `  ${l}`).join("\n") || "  (nothing)"}`;
    })
    .join("\n");
  const { width, height } = preview.size;
  return {
    id: call.id,
    content: [
      shot
        ? `Screenshot of the ${device} (${shot.width}×${shot.height}) attached.`
        : `No screenshot: a layout report of the ${device} (${width}×${height}) instead. Each line is an element, its text, its size and where it is (left,top in px); check that everything fits, lines up and reads well.`,
      problemsText(problems),
      findings.length
        ? `Layout problems:\n${findingsText(findings)}`
        : "No sideways scrolling, contrast, tap target, text size, overlap, empty image or hidden button problems.",
      `Screens:\n${outline}`,
    ].join("\n\n"),
    ...(shot ? { images: [{ mediaType: "image/png" as const, data: shot.image }] } : {}),
  };
}

async function lint(ctx: EngineerContext, call: ToolCall): Promise<ToolResult> {
  const findings: Finding[] = lintConfig(ctx.draft);
  const notes: string[] = [];
  if (call.input.screens !== false && ctx.preview && ctx.libs) {
    try {
      const preview = await ensurePage(ctx, "phone", true);
      await preview.close();
      findings.push(...screenFindings(await preview.inspect(), "phone"));
      const hub = [
        ...(ctx.draft.panel.enabled ? ["status"] : []),
        ...modulesOf(ctx.draft)
          .filter((m) => m.enabled && m.slot === "overlay")
          .map((m) => m.id),
      ];
      for (const id of hub) {
        await preview.open(id);
        findings.push(
          ...screenFindings(
            (await preview.inspect()).filter((s) => s.screen.startsWith("hub screen")),
            "phone",
          ),
        );
        await preview.close();
      }
      for (const p of preview.take().problems) findings.push({ level: "error", check: "console", message: p });
    } catch (e) {
      notes.push(`The screen checks couldn't run: ${(e as Error).message}`);
    }
  }
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  return text(call.id, [`${counts.error} errors, ${counts.warn} warnings.`, findingsText(findings), ...notes].join("\n\n"));
}

/** Runs one engineer tool call. Input mistakes come back as error results for the model to fix. */
export async function runEngineerTool(ctx: EngineerContext, call: ToolCall): Promise<ToolResult> {
  const input = call.input;
  try {
    switch (call.name) {
      case "list_modules":
        return text(call.id, listModulesText(ctx.draft));
      case "read_module":
        return text(call.id, readModuleText(ctx.draft, input.module));
      case "read_values":
        return text(call.id, valuesText(ctx));
      case "read_theme": {
        const theme = themeOf(ctx.draft);
        const bundle = themeBundle(theme);
        return text(
          call.id,
          YAML.stringify({ preset: theme.preset, overrides: theme.overrides, mode: bundle.mode, light: bundle.light, dark: bundle.dark }),
        );
      }
      case "read_card":
        return text(call.id, cardText(ctx.data));
      case "read_light_card":
        return text(
          call.id,
          `${planText(ctx.data, planConversion(ctx.data, { people: true, places: true }))}\n\nThe People and World values are optional. Tell the user the plan in a few lines and ask before calling convert_light_card.`,
        );
      case "convert_light_card": {
        if (input.confirmed !== true)
          throw new ToolInputError("Ask the user first: tell them the plan from read_light_card and wait for their yes.");
        const plan = planConversion(ctx.data, {
          people: input.people === true,
          places: input.places === true,
        });
        // Values the draft already has (from earlier this turn) are skipped.
        const have = new Set(ctx.draft.vars.map((v) => `${v.group}.${v.name}`.toLowerCase()));
        plan.values = plan.values.filter((v) => !have.has(`${v.group}.${v.name}`.toLowerCase()));
        const ops = conversionOps(plan, call.id);
        if (!ops.length) throw new ToolInputError("There's nothing to convert: no tracker, stages or mechanics values.");
        for (const op of ops) {
          ctx.draft = applyOp(ctx.draft, op).config;
          ctx.ops.push(op);
        }
        return text(
          call.id,
          `Converted: ${plan.values.length} values${plan.stages ? `, and the stages become tiers of ${plan.stages.variable} on accept` : ""}. ${plan.notes.join(" ")} Build on it (a panel, the hub) or stop to let the user review the proposal.`,
        );
      }
      case "search_docs":
        return text(call.id, searchDocsText(String(input.query ?? "")));
      case "read_doc": {
        const doc = readDoc(String(input.id ?? ""));
        return doc ? text(call.id, doc) : text(call.id, `There's no doc "${String(input.id)}". Docs:\n${docsIndex()}`, true);
      }
      case "list_skills":
        return text(call.id, skillsIndex(ctx.skills) || "No skills.");
      case "load_skill": {
        const skill = ctx.skills.find((s) => s.id === input.id);
        return skill
          ? text(call.id, skill.text)
          : text(call.id, `There's no skill "${String(input.id)}". Skills:\n${skillsIndex(ctx.skills)}`, true);
      }
      case "list_examples":
        return text(call.id, examplesIndex());
      case "read_example": {
        const example = readExample(String(input.id ?? ""));
        return example
          ? text(call.id, example)
          : text(call.id, `There's no example "${String(input.id)}". Examples:\n${examplesIndex()}`, true);
      }
      case "list_parts":
        return text(call.id, partsText(searchParts(allParts(ctx.library), String(input.query ?? ""), String(input.tag ?? "")), ctx.draft));
      case "read_part":
        return text(call.id, partText(ctx, String(input.id ?? "")));
      case "install_part": {
        const id = String(input.id ?? "");
        const parts = allParts(ctx.library);
        if (!parts.some((p) => p.id === id)) throw new ToolInputError(`There's no part "${id}". Parts:\n${partsText(parts, ctx.draft)}`);
        if (hasPart(ctx.draft, id)) throw new ToolInputError(`The card already has the "${id}" part. Change it with set_module_settings.`);
        if (input.settings !== undefined && !isObject(input.settings)) throw new ToolInputError(`"settings" must be an object`);
        const before = new Set((ctx.draft.modules ?? []).filter((m) => m.enabled).map((m) => m.id));
        let out;
        try {
          out = installParts(ctx.draft, ctx.data, [id], parts, input.settings ? { [id]: input.settings as Record<string, unknown> } : {});
        } catch (e) {
          throw new ToolInputError((e as Error).message);
        }
        const enable = (out.config.modules ?? []).filter((m) => m.enabled && !before.has(m.id) && !out.added.includes(m)).map((m) => m.id);
        // Kept with the installed modules themselves, so the proposal replays the same way.
        const op: ToolCall = { id: call.id, name: "install_part", input: { part: id, modules: out.added, enable } };
        ctx.draft = applyOp(ctx.draft, op).config;
        ctx.ops.push(op);
        return text(
          call.id,
          [
            `Installed ${out.added.map((m) => `${m.name} (${m.id})`).join(", ") || "nothing new"}${enable.length ? `; turned on ${enable.join(", ")}` : ""}.`,
            out.messageTags.length
              ? `It shows in the opening message: tell the user to press "Put it in the first message" in its settings on the Modules tab (or to add ${out.messageTags.join(" and ")} there themselves).`
              : "",
            out.notes.length ? `Tailor it to this card:\n${out.notes.map((n) => `- ${n}`).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      case "set_sample_state": {
        if (input.clear === true) {
          ctx.sample = undefined;
          ctx.sampleDirty = false;
          if (ctx.preview?.loaded) ctx.preview.unload();
          return text(call.id, "Sample state dropped. The next render starts over from the scenario.");
        }
        if (!isObject(input.state)) throw new ToolInputError(`"state" must be an object of values by group`);
        if (input.delta !== undefined && !isObject(input.delta))
          throw new ToolInputError(`"delta" must be an object of [before, after] pairs by path`);
        ctx.sample = { state: input.state, ...(input.delta ? { delta: input.delta as SampleState["delta"] } : {}) };
        ctx.sampleDirty = true;
        const checked = stateSchema(effectiveConfig(ctx.draft)).safeParse(input.state);
        const issues = checked.success
          ? ""
          : ` The schema would repair some of it: ${(checked.error?.issues ?? [])
              .map((i) => i.message)
              .slice(0, 5)
              .join("; ")}.`;
        return text(call.id, `Sample state set; the next render shows it.${issues}`);
      }
      case "add_npc":
      case "add_place":
      case "add_item":
      case "add_shop": 
      case "set_field":
      case "patch_field": {
        // Checked against the card with this turn's earlier additions, so names don't repeat.
        const calls = (ctx.cardCalls ??= []);
        const data = calls.reduce((d, c) => applyEdit(d, planEdit(d, c)), ctx.data);
        const edit = planEdit(data, call);
        calls.push(call);
        return text(call.id, `${describeEdit(edit)}: proposed to the user in the co-writer chat when your turn ends.`);
      }
      case "render_preview":
        return await render(ctx, call);
      case "click": {
        if (!ctx.preview?.loaded) throw new ToolInputError("Nothing is running yet. Call render_preview first.");
        const result = await ctx.preview.click({
          screen: typeof input.screen === "string" ? input.screen : undefined,
          text: typeof input.text === "string" ? input.text : undefined,
          selector: typeof input.selector === "string" ? input.selector : undefined,
        });
        const { problems } = ctx.preview.take();
        return text(
          call.id,
          [
            `Clicked ${result.clicked} on the ${result.screen}.`,
            result.input ? `The input box now holds:\n${result.input}` : "",
            problemsText(problems),
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      case "run_turn": {
        if (typeof input.player !== "string" || typeof input.reply !== "string")
          throw new ToolInputError(`"player" and "reply" must be strings`);
        const preview = await ensurePage(ctx, "phone");
        await preview.close();
        await preview.command({ type: "send", text: input.player });
        await preview.command({ type: "reply", text: input.reply });
        // The state report follows the reply.
        await new Promise((r) => setTimeout(r, 100));
        const latest = preview.chat.at(-1)?.variables as
          | { stat_data?: unknown; delta_data?: Record<string, [unknown, unknown]> }
          | undefined;
        const { problems, logs } = preview.take();
        const changes = Object.entries(latest?.delta_data ?? {}).map(
          ([k, [a, b]]) => `- ${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`,
        );
        return text(
          call.id,
          [
            `Turn played: message ${preview.latestId}.`,
            changes.length ? `Changes:\n${changes.join("\n")}` : "Nothing changed in the state.",
            `State now:\n${YAML.stringify(latest?.stat_data ?? {})}`,
            logs.length
              ? `Log:\n${logs
                  .slice(-10)
                  .map((l) => `- ${l}`)
                  .join("\n")}`
              : "",
            problemsText(problems),
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      case "lint":
        return await lint(ctx, call);
      default: {
        if (!WRITE_NAMES.has(call.name)) throw new ToolInputError(`Unknown tool ${call.name}`);
        const out = applyOp(ctx.draft, call);
        ctx.draft = out.config;
        ctx.ops.push(call);
        // Quick feedback on code that doesn't parse, so it's fixed before rendering.
        const touched = typeof input.module === "string" ? input.module : typeof input.id === "string" ? input.id : "";
        const broken = lintConfig(ctx.draft).filter((f) => f.check === "syntax" && touched && f.message.startsWith(`${touched}/`));
        return text(call.id, [`Done: ${out.summary}.`, ...broken.map((f) => f.message)].join("\n"));
      }
    }
  } catch (e) {
    if (e instanceof ToolInputError) return text(call.id, e.message, true);
    return text(call.id, `The tool failed: ${(e as Error).message}`, true);
  }
}

/** A short line for the activity list. */
export function describeCall(call: ToolCall): string {
  const i = call.input;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (call.name) {
    case "list_modules":
      return "Listed the modules";
    case "read_module":
      return `Read ${s(i.module)}`;
    case "read_values":
      return "Read the values";
    case "read_theme":
      return "Read the theme";
    case "read_card":
      return "Read the card";
    case "read_light_card":
      return "Read the light card";
    case "convert_light_card":
      return "Converted the light card";
    case "search_docs":
      return `Searched the docs for "${s(i.query)}"`;
    case "read_doc":
      return `Read ${s(i.id)}`;
    case "list_skills":
      return "Listed skills";
    case "load_skill":
      return `Loaded the ${s(i.id)} skill`;
    case "list_examples":
      return "Listed examples";
    case "read_example":
      return `Read the ${s(i.id)} example`;
    case "list_parts":
      return s(i.query) || s(i.tag) ? `Searched the parts for "${s(i.query) || s(i.tag)}"` : "Listed the parts";
    case "read_part":
      return `Read the ${s(i.id)} part`;
    case "install_part":
      return `Installed the ${s(i.id) || s(i.part)} part`;
    case "create_module":
      return `Created ${s(i.id)}`;
    case "add_built_in":
      return `Added the built-in ${s(i.screen) === "creator" ? "character creator" : s(i.screen)}`;
    case "write_file":
      return `Wrote ${s(i.module)}/${s(i.file)}`;
    case "patch_file":
      return `Patched ${s(i.module)}/${s(i.file)}`;
    case "set_value":
      return `Set the value ${[s(i.group), s(i.name)].filter(Boolean).join(".")}`;
    case "remove_value":
      return `Removed the value ${[s(i.group), s(i.name)].filter(Boolean).join(".")}`;
    case "set_sample_state":
      return i.clear ? "Cleared the sample state" : "Set sample state";
    case "render_preview":
      return `Rendered on ${s(i.device) || "phone"}${s(i.open) ? `, ${s(i.open)} open` : ""}`;
    case "click":
      return `Clicked ${s(i.text) ? `"${s(i.text)}"` : s(i.selector)}`;
    case "run_turn":
      return "Played a turn";
    case "lint":
      return "Ran the checks";
    default:
      return call.name.replace(/_/g, " ");
  }
}
