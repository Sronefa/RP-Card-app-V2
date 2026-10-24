/**
 * Card checker: finds problems that break a card in SillyTavern and things that make it weaker.
 * Rules follow the co-writer spec's writing principles.
 */
import { embeddedPath, type LorebookEntry } from "../card";
import type { CardRecord } from "../db/db";
import { estimateTokens } from "../lib/tokens";
import { PERMANENT_FIELDS, type GroupId } from "../features/editor/fields";
import { coverageRequest, findUncovered } from "./coverage";
import { entryTitle, isRegexKey, regexError } from "./lorebook";
import { findSlop, slopRequest } from "./slop";

export type IssueLevel = "error" | "warning" | "tip";

/** Where the user fixes the issue: an editor group, the lorebook (with entry index) or assets. */
export type IssueTarget =
  | { section: "editor"; group: GroupId }
  | { section: "lorebook"; entry?: number }
  | { section: "assets" };

export interface Issue {
  level: IssueLevel;
  message: string;
  target: IssueTarget;
  /** Only the user can fix it; the co-writer can't (images, tags, asset files). */
  manual?: boolean;
  /** Overused phrasing or a name without a lorebook entry; other issues come from the checks below. */
  kind?: "slop" | "coverage";
  /** What the Fix button asks the co-writer, when it isn't the message itself. */
  request?: string;
  /** For a name without a lorebook entry: the name, so an empty entry can be added for it. */
  stub?: string;
}

export interface CheckOptions {
  /** Look for these overused phrases. */
  slopPhrases?: string[];
  /** Look for names without lorebook entries. These entries (the project world's) count as covering them. */
  coverage?: { otherEntries: LorebookEntry[] };
}

/** Above this many permanent tokens a card crowds out chat history on small contexts. */
export const PERMANENT_TOKEN_WARNING = 2000;
/** A single lorebook entry longer than this is better split. */
export const LONG_ENTRY_TOKENS = 600;

const editor = (group: GroupId): IssueTarget => ({ section: "editor", group });

/** `{user}` or `<USER>`-style placeholders that SillyTavern does not replace. `{{user}}` and `<USER>`/`<BOT>` are fine. */
const BROKEN_MACRO = /(?<!\{)\{(char|user)\}(?!\})|\{\{\s+(char|user)\s*\}\}|\{\{\s*(char|user)\s+\}\}/gi;

const TEXT_FIELDS: { field: "description" | "personality" | "scenario" | "first_mes" | "mes_example" | "system_prompt" | "post_history_instructions"; label: string; group: GroupId }[] = [
  { field: "description", label: "Description", group: "description" },
  { field: "personality", label: "Personality", group: "personality" },
  { field: "scenario", label: "Scenario", group: "scenario" },
  { field: "first_mes", label: "First message", group: "greetings" },
  { field: "mes_example", label: "Example dialogues", group: "examples" },
  { field: "system_prompt", label: "System prompt", group: "prompts" },
  { field: "post_history_instructions", label: "Post-history instructions", group: "prompts" },
];

export function checkCard(record: CardRecord, options: CheckOptions = {}): Issue[] {
  const d = record.card.data;
  const issues: Issue[] = [];
  const add = (level: IssueLevel, message: string, target: IssueTarget, manual = target.section === "assets") =>
    issues.push({ level, message, target, ...(manual ? { manual } : {}) });
  const isWorld = record.kind === "world";

  // Basics
  if (!d.name.trim()) add("error", "The card has no name.", editor("basics"));
  if (!d.description.trim()) add("error", "The description is empty.", editor("description"));
  if (!d.first_mes.trim()) add("warning", "There is no first message, so the chat starts empty.", editor("greetings"));
  if (!record.image && !embeddedIcon(record)) add("tip", "The card has no image.", editor("basics"), true);
  if (d.tags.length === 0) add("tip", "Add a few tags so the card is easier to find.", editor("basics"), true);
  if (isWorld && !d.scenario.trim() && !d.first_mes.trim())
    add("warning", "A world card needs a scenario or a first message to show where the story starts.", editor("scenario"));

  // Size
  const permanent = PERMANENT_FIELDS.reduce((n, f) => n + estimateTokens(d[f]), 0);
  if (permanent > PERMANENT_TOKEN_WARNING)
    add(
      "warning",
      `About ${permanent} permanent tokens. Over ${PERMANENT_TOKEN_WARNING}, the card crowds out chat history on smaller models. Move background details to the lorebook.`,
      editor("description"),
    );

  // Text
  for (const { field, label, group } of TEXT_FIELDS) {
    const text = d[field];
    const broken = [...new Set(text.match(BROKEN_MACRO) ?? [])];
    if (broken.length > 0)
      add("error", `${label} has ${broken.join(", ")}, which SillyTavern won't replace. Use {{char}} and {{user}}.`, editor(group));
  }
  if (d.mes_example.trim() && !/^\s*<START>/i.test(d.mes_example))
    add("warning", "Example dialogues should start with <START>, or SillyTavern may read them as one block.", editor("examples"));
  if (/^\s*\{\{user\}\}:/im.test(d.first_mes))
    add("warning", "The first message has a {{user}}: line. The greeting shouldn't speak for the user.", editor("greetings"));
  [d.first_mes, ...d.alternate_greetings].forEach((text, i) => {
    if (unbalanced(text, "*"))
      add("tip", `${i === 0 ? "The first message" : `Alternate greeting ${i}`} has an odd number of asterisks.`, editor("greetings"));
  });
  d.alternate_greetings.forEach((text, i) => {
    if (!text.trim()) add("warning", `Alternate greeting ${i + 1} is empty.`, editor("greetings"));
  });
  const nevers = (d.personality + "\n" + d.description).match(/\bnever\b/gi)?.length ?? 0;
  if (nevers >= 3)
    add("tip", `"Never" appears ${nevers} times. Models follow positive instructions better: say what {{char}} does instead.`, editor("personality"));
  if (d.system_prompt.trim() && !/\{\{original\}\}/i.test(d.system_prompt))
    add("tip", "The system prompt replaces the user's own. Add {{original}} to keep theirs.", editor("prompts"));

  // Lorebook
  const entries = d.character_book?.entries ?? [];
  const seenKeys = new Map<string, number>();
  entries.forEach((entry, i) => {
    const target: IssueTarget = { section: "lorebook", entry: i };
    const title = `"${entryTitle(entry)}"`;
    if (!entry.enabled) return;
    if (!entry.content.trim()) add("warning", `Lorebook entry ${title} has no content.`, target);
    if (!entry.constant && entry.keys.filter((k) => k.trim()).length === 0)
      add("error", `Lorebook entry ${title} has no keys and isn't constant, so it never triggers.`, target);
    if (entry.selective && (entry.secondary_keys ?? []).length === 0)
      add("warning", `Lorebook entry ${title} needs secondary keys to trigger, but has none.`, target);
    for (const key of allKeys(entry)) {
      if (isRegexKey(key) || entry.use_regex) {
        const error = regexError(key);
        if (error) add("error", `Lorebook entry ${title} has an invalid regex key ${key}: ${error}`, target);
      } else if (key.trim().length > 0 && key.trim().length < 3) {
        add("tip", `Lorebook entry ${title} has the very short key "${key}", which may trigger inside other words.`, target);
      }
    }
    for (const key of entry.keys) {
      const k = entry.case_sensitive ? key : key.toLowerCase();
      const other = seenKeys.get(k);
      if (other !== undefined && other !== i)
        add("tip", `The key "${key}" is used by "${entryTitle(entries[other])}" and ${title}. Both trigger together.`, target);
      else seenKeys.set(k, i);
    }
    const tokens = estimateTokens(entry.content);
    if (tokens > LONG_ENTRY_TOKENS)
      add("tip", `Lorebook entry ${title} is about ${tokens} tokens. Shorter entries leave more room for chat.`, target);
  });
  const constantTokens = entries
    .filter((e) => e.enabled && e.constant)
    .reduce((n, e) => n + estimateTokens(e.content), 0);
  const budget = d.character_book?.token_budget;
  if (budget && constantTokens > budget)
    add("warning", `Constant lorebook entries use about ${constantTokens} tokens, over the book's budget of ${budget}.`, {
      section: "lorebook",
    });

  // Assets
  const assets = d.assets ?? [];
  for (const asset of assets) {
    const path = embeddedPath(asset.uri);
    if (path && !record.files[path])
      add("error", `The ${asset.type} asset "${asset.name}" points to a file that is missing.`, { section: "assets" });
  }
  const mains = new Map<string, number>();
  for (const a of assets) if (a.name === "main") mains.set(a.type, (mains.get(a.type) ?? 0) + 1);
  for (const [type, count] of mains)
    if (count > 1) add("warning", `${count} ${type} assets are named "main". Only one per type should be.`, { section: "assets" });

  // Writing quality
  if (options.slopPhrases)
    for (const hit of findSlop(d, options.slopPhrases))
      issues.push({
        level: "tip",
        kind: "slop",
        message: `${hit.where} uses "${hit.match}": "${hit.line}"`,
        target: hit.target,
        request: slopRequest(hit),
      });
  if (options.coverage)
    for (const { name, count } of findUncovered(d, options.coverage.otherEntries))
      issues.push({
        level: "tip",
        kind: "coverage",
        message: `"${name}" is mentioned ${count === 1 ? "once" : `${count} times`} but has no lorebook entry.`,
        target: { section: "lorebook" },
        request: coverageRequest([name]),
        stub: name,
      });

  const order: Record<IssueLevel, number> = { error: 0, warning: 1, tip: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

const allKeys = (e: LorebookEntry) => [...e.keys, ...(e.selective ? (e.secondary_keys ?? []) : [])];

function unbalanced(text: string, mark: string): boolean {
  return (text.split(mark).length - 1) % 2 === 1;
}

function embeddedIcon(record: CardRecord): boolean {
  return (record.card.data.assets ?? []).some((a) => {
    const path = a.type === "icon" ? embeddedPath(a.uri) : undefined;
    return !!path && !!record.files[path];
  });
}

export interface Health {
  /** 0 to 100. */
  score: number;
  problems: number;
  slop: number;
  uncovered: number;
  tips: number;
}

/**
 * One number for the card's state: problems cost the most, overused phrasing and missing lorebook
 * entries cost a little each, up to a cap so a long card isn't sunk by them alone.
 */
export function cardHealth(issues: Issue[]): Health {
  const count = (f: (i: Issue) => boolean) => issues.filter(f).length;
  const errors = count((i) => i.level === "error");
  const warnings = count((i) => i.level === "warning");
  const slop = count((i) => i.kind === "slop");
  const uncovered = count((i) => i.kind === "coverage");
  const tips = count((i) => i.level === "tip" && !i.kind);
  const penalty =
    errors * 15 + warnings * 6 + Math.min(tips * 2, 10) + Math.min(slop * 3, 20) + Math.min(uncovered * 3, 15);
  return { score: Math.max(0, 100 - penalty), problems: errors + warnings, slop, uncovered, tips };
}
