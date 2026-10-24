/**
 * Status tracker and relationship stage add-ons.
 *
 * The model ends every reply with a status block in a fixed format. CardForge writes, from the
 * tracker settings: a SillyTavern regex script that shows the block as HTML, one that drops old
 * blocks from the prompt, an always-on lorebook reminder of the format and update rules, and, for
 * relationship stages, one lorebook entry per stage keyed on the stage line in the block.
 * Cards with no add-on get none of this.
 */
import type { CardDataV3, Lorebook, LorebookEntry } from "../card";
import { newId } from "../lib/id";
import { emptyBook, newEntry, withStPosition } from "./lorebook";

export type FieldKind = "bar" | "number" | "text" | "list";

export interface TrackerField {
  id: string;
  label: string;
  kind: FieldKind;
  /** Starting value. For a bar, the current value; the bar's top is `max`. */
  start: string;
  max?: number;
  /** When and how the value changes. */
  rule: string;
  /** The add-on the field belongs to. */
  addon: AddonId;
}

export interface Stage {
  name: string;
  /** Lowest affection for this stage. */
  from: number;
  /** How {{char}} treats {{user}} at this stage. */
  attitude: string;
}

export interface TrackerConfig {
  /** The block's tag name: <status>…</status>. */
  tag: string;
  accent: string;
  fields: TrackerField[];
  /** Relationship stages, when that add-on is on. */
  stages?: Stage[];
  /** Ids of the regex scripts CardForge wrote, so they are replaced and not duplicated. */
  scriptIds: string[];
}

export type AddonId = "stats" | "inventory" | "relationship" | "custom";

export interface SillyTavernRegex {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  /** 1 user input, 2 AI output, 3 slash commands, 5 world info, 6 reasoning. */
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: number | boolean;
  minDepth: number | null;
  maxDepth: number | null;
}

const EXT = "cardforge";
/** Entries CardForge writes for the tracker carry this kind. */
const RULES = "tracker";
const STAGE = "stage";

export const ADDONS: Record<AddonId, { label: string; help: string; fields: (currency?: string) => Omit<TrackerField, "id" | "addon">[] }> = {
  stats: {
    label: "Stats",
    help: "Health and stamina bars for {{user}}.",
    fields: () => [
      { label: "Health", kind: "bar", start: "100", max: 100, rule: "Drops when {{user}} is hurt, rises slowly with rest or healing. At 0 {{user}} is out of the fight." },
      { label: "Stamina", kind: "bar", start: "100", max: 100, rule: "Drops with effort, comes back with rest and food." },
    ],
  },
  inventory: {
    label: "Inventory and money",
    help: "What {{user}} carries and how much money they have.",
    fields: (currency) => [
      {
        label: currency ? `Money (${currency})` : "Money",
        kind: "number",
        start: "20",
        rule: "Changes only when {{user}} pays, sells, finds or steals money. Use the prices from the lorebook.",
      },
      {
        label: "Inventory",
        kind: "list",
        start: "a knife, a waterskin",
        rule: "Add items {{user}} picks up or buys; remove items used up, sold or lost. Keep it short.",
      },
    ],
  },
  relationship: {
    label: "Relationship stages",
    help: "An affection meter, and {{char}}'s attitude toward {{user}} changing in stages.",
    fields: () => [
      {
        label: "Affection",
        kind: "bar",
        start: "10",
        max: 100,
        rule: "Moves a few points at a time with how {{user}} treats {{char}}; big moments move it more. Never jump more than 10 at once.",
      },
      { label: "Stage", kind: "text", start: "Strangers", rule: "" },
    ],
  },
  custom: {
    label: "Custom",
    help: "Start from an empty tracker and add your own fields.",
    fields: () => [{ label: "Mood", kind: "text", start: "calm", rule: "{{char}}'s mood in one or two words." }],
  },
};

export const DEFAULT_STAGES: Stage[] = [
  { name: "Strangers", from: 0, attitude: "{{char}} is guarded with {{user}}: polite at best, and keeps personal things to themself." },
  { name: "Acquaintances", from: 21, attitude: "{{char}} is at ease around {{user}}, jokes a little, and starts to share opinions." },
  { name: "Allies", from: 41, attitude: "{{char}} trusts {{user}}, has their back, and talks about what worries them." },
  { name: "Close", from: 61, attitude: "{{char}} seeks {{user}} out, shares secrets, and is openly warm." },
  { name: "Lovers", from: 81, attitude: "{{char}} is openly affectionate and devoted to {{user}}, in their own way." },
];

export function readTracker(data: CardDataV3): TrackerConfig | undefined {
  const ext = data.extensions[EXT] as { tracker?: TrackerConfig } | undefined;
  return ext?.tracker;
}

export const newTracker = (): TrackerConfig => ({ tag: "status", accent: "#a78bfa", fields: [], scriptIds: [] });

export function addAddon(config: TrackerConfig, addon: AddonId, currency?: string): TrackerConfig {
  const fields = ADDONS[addon].fields(currency).map((f) => ({ ...f, id: newId(), addon }));
  return {
    ...config,
    fields: [...config.fields, ...fields],
    ...(addon === "relationship" ? { stages: DEFAULT_STAGES.map((s) => ({ ...s })) } : {}),
  };
}

export function removeAddon(config: TrackerConfig, addon: AddonId): TrackerConfig {
  return {
    ...config,
    fields: config.fields.filter((f) => f.addon !== addon),
    ...(addon === "relationship" ? { stages: undefined } : {}),
  };
}

export const hasAddon = (config: TrackerConfig | undefined, addon: AddonId) =>
  !!config?.fields.some((f) => f.addon === addon);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The block the model writes, with sample values or placeholders. */
export function blockText(config: TrackerConfig, values?: Record<string, string>): string {
  const line = (f: TrackerField) => {
    const v = values?.[f.id] ?? (values ? f.start : placeholder(f));
    return f.kind === "bar" ? `${f.label}: ${v}/${f.max ?? 100}` : `${f.label}: ${v}`;
  };
  return [`<${config.tag}>`, ...config.fields.map(line), `</${config.tag}>`].join("\n");
}

function placeholder(f: TrackerField): string {
  if (f.kind === "bar" || f.kind === "number") return "[number]";
  if (f.kind === "list") return "[comma-separated items]";
  if (f.label === "Stage") return "[stage name]";
  return "[a few words]";
}

/** Finds the whole block, one capture group per value (two for a bar). */
export function findPattern(config: TrackerConfig): string {
  const lines = config.fields.map((f) => {
    const label = escapeRegex(f.label);
    if (f.kind === "bar") return `${label}:\\s*(-?\\d+)\\s*\\/\\s*(\\d+)`;
    if (f.kind === "number") return `${label}:\\s*(-?[\\d.,]+)`;
    return `${label}:[ \\t]*([^\\n]*?)`;
  });
  return `<${config.tag}>\\s*${lines.join("\\s*")}\\s*<\\/${config.tag}>`;
}

/** The HTML SillyTavern shows in place of the block. */
export function replaceHtml(config: TrackerConfig): string {
  const a = config.accent;
  let group = 0;
  const rows = config.fields.map((f) => {
    const label = `<span style="opacity:.75">${f.label}</span>`;
    if (f.kind === "bar") {
      const value = `$${++group}`;
      const max = `$${++group}`;
      return (
        `<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;gap:8px">${label}<span>${value}/${max}</span></div>` +
        `<div style="height:6px;border-radius:3px;background:rgba(127,127,127,.25);overflow:hidden">` +
        `<div style="height:6px;border-radius:3px;background:${a};width:calc(${value} / ${max} * 100%);max-width:100%"></div></div></div>`
      );
    }
    return `<div style="display:flex;justify-content:space-between;gap:8px;margin:4px 0">${label}<span style="text-align:right">$${++group}</span></div>`;
  });
  return `<div style="border:1px solid ${a}66;background:${a}14;border-radius:10px;padding:6px 10px;margin-top:8px;font-size:.9em">${rows.join("")}</div>`;
}

/** The regex scripts for the tracker: show the block as HTML, and keep only recent blocks in the prompt. */
export function trackerScripts(config: TrackerConfig): SillyTavernRegex[] {
  const [showId, trimId] = [config.scriptIds[0] ?? newId(), config.scriptIds[1] ?? newId()];
  const base = {
    trimStrings: [],
    placement: [2],
    disabled: false,
    runOnEdit: true,
    substituteRegex: 0,
    maxDepth: null,
  };
  return [
    {
      ...base,
      id: showId,
      scriptName: "CardForge: status block",
      findRegex: `/${findPattern(config)}/gs`,
      replaceString: replaceHtml(config),
      markdownOnly: true,
      promptOnly: false,
      minDepth: null,
    },
    {
      ...base,
      id: trimId,
      scriptName: "CardForge: old status blocks out of the prompt",
      findRegex: `/<${config.tag}>[\\s\\S]*?<\\/${config.tag}>/g`,
      replaceString: "",
      markdownOnly: false,
      promptOnly: true,
      // The latest blocks stay so the model can update them.
      minDepth: 3,
    },
  ];
}

const isOurs = (e: LorebookEntry, kind: string) => (e.extensions[EXT] as { kind?: string } | undefined)?.kind === kind;

/** Format and update rules, short, near the bottom of the prompt. */
export function rulesText(config: TrackerConfig): string {
  const rules = config.fields
    .map((f) => {
      if (f.label === "Stage" && config.stages?.length) {
        const ranges = stageRanges(config.stages)
          .map((s) => `${s.name} ${s.from}-${s.to}`)
          .join(", ");
        return `- Stage: set from Affection (${ranges}).`;
      }
      return f.rule.trim() && `- ${f.label}: ${f.rule.trim()}`;
    })
    .filter(Boolean);
  const starts = config.fields.map((f) => `${f.label} ${f.kind === "bar" ? `${f.start}/${f.max ?? 100}` : f.start}`).join("; ");
  return [
    `<status_rules>`,
    `End every reply with this block, updated for what just happened, exactly in this format:`,
    blockText(config),
    ...(rules.length ? ["Rules:", ...rules] : []),
    `If there is no block in the chat yet, start from: ${starts}.`,
    `</status_rules>`,
  ].join("\n");
}

export function stageRanges(stages: Stage[]) {
  const sorted = [...stages].sort((a, b) => a.from - b.from);
  return sorted.map((s, i) => ({ ...s, to: i + 1 < sorted.length ? Math.max(s.from, sorted[i + 1].from - 1) : 100 }));
}

function atDepth(entry: LorebookEntry, depth: number): LorebookEntry {
  const e = withStPosition(entry, 4);
  return { ...e, extensions: { ...e.extensions, depth, role: 0 } };
}

/** Writes the tracker into the card: config, regex scripts and lorebook entries. `undefined` removes it all. */
export function applyTracker(data: CardDataV3, config: TrackerConfig | undefined): CardDataV3 {
  let live = config && config.fields.length > 0 ? config : undefined;
  // The stage starts at the lowest stage.
  const first = live?.stages && stageRanges(live.stages)[0]?.name;
  if (live && first)
    live = {
      ...live,
      fields: live.fields.map((f) => (f.addon === "relationship" && f.label === "Stage" ? { ...f, start: first } : f)),
    };
  const old = readTracker(data);
  const oldIds = new Set(old?.scriptIds ?? []);
  const others = ((data.extensions.regex_scripts as SillyTavernRegex[] | undefined) ?? []).filter((s) => !oldIds.has(s.id));
  const scripts = live ? trackerScripts(live) : [];
  const saved = live ? { ...live, scriptIds: scripts.map((s) => s.id) } : undefined;

  const book: Lorebook = data.character_book ?? emptyBook();
  const kept = book.entries.filter((e) => !isOurs(e, RULES) && !isOurs(e, STAGE));
  const ours: LorebookEntry[] = [];
  if (saved) {
    const draft = { ...book, entries: kept };
    const add = (e: LorebookEntry) => {
      ours.push(e);
      draft.entries = [...draft.entries, e];
    };
    add(
      atDepth(
        newEntry(draft, {
          comment: "Status block rules",
          constant: true,
          insertion_order: 900,
          content: rulesText(saved),
          extensions: { [EXT]: { kind: RULES } },
        }),
        1,
      ),
    );
    for (const s of saved.stages && hasAddon(saved, "relationship") ? saved.stages : [])
      add(
        atDepth(
          newEntry(draft, {
            comment: `Stage: ${s.name}`,
            keys: [`Stage: ${s.name}`],
            content: `<relationship stage="${s.name}">\n${s.attitude}\n</relationship>`,
            extensions: { [EXT]: { kind: STAGE } },
          }),
          4,
        ),
      );
  }

  const extensions: Record<string, unknown> = { ...data.extensions };
  const cf = { ...(extensions[EXT] as Record<string, unknown> | undefined) };
  if (saved) cf.tracker = saved;
  else delete cf.tracker;
  if (Object.keys(cf).length) extensions[EXT] = cf;
  else delete extensions[EXT];
  if (others.length || scripts.length) extensions.regex_scripts = [...others, ...scripts];
  else delete extensions.regex_scripts;

  const entries = [...kept, ...ours];
  return {
    ...data,
    extensions,
    character_book: entries.length || data.character_book ? { ...book, entries } : undefined,
  };
}

/** Runs the card's display regex scripts on an AI reply, as SillyTavern would before showing it. */
export function previewReply(scripts: SillyTavernRegex[], text: string): string {
  let out = text;
  for (const s of scripts) {
    if (s.disabled || s.promptOnly || !s.placement.includes(2)) continue;
    const re = parseRegex(s.findRegex);
    if (re) out = out.replace(re, s.replaceString.replace(/\{\{match\}\}/gi, "$&"));
  }
  return out;
}

/** Parses SillyTavern's `/pattern/flags` (or a bare pattern). */
export function parseRegex(source: string): RegExp | undefined {
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(source);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(source, "g");
  } catch {
    return undefined;
  }
}

export function regexScripts(data: CardDataV3): SillyTavernRegex[] {
  return (data.extensions.regex_scripts as SillyTavernRegex[] | undefined) ?? [];
}

export function newScript(): SillyTavernRegex {
  return {
    id: newId(),
    scriptName: "New script",
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}
