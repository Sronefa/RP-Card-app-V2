/**
 * Playtest prompts: what SillyTavern would send the roleplay model for this card and chat, built
 * from the card (its fields, lorebook and prompt regex), the running chat with its game state, and
 * what the card's scripts injected. It follows SillyTavern's default chat-completion order: main
 * prompt, lore before the character, the character, lore after, persona and examples; then the
 * chat with lore and injections at their depths; then post-history instructions and the jailbreak.
 *
 * Also the auto-player's prompt (a second model playing {{user}}), and Tavern Helper's generate
 * and generateRaw calls from the card's scripts.
 */
import type { ChatMessage } from "../../ai/types";
import type { CardDataV3, LorebookEntry } from "../../card";
import type { SillyTavernRegex } from "../../editor/trackers";
import { estimateTokens } from "../../lib/tokens";
import { runtime } from "../runtime";
import { readEngine } from "../sheet";
import type { GenerateOptions, InjectedPrompt, SandboxMessage } from "../sandbox/sandbox";

export interface Persona {
  name: string;
  description: string;
}

export interface PromptInput {
  data: CardDataV3;
  chat: SandboxMessage[];
  injected?: InjectedPrompt[];
  persona: Persona;
  /** The user's active jailbreak, sent last. */
  jailbreak?: string;
  /** Who writes the game-state updates in this chat, when the player switched it in the settings app. */
  updateMode?: "reply" | "side";
}

export interface BuiltPrompt {
  system: string;
  messages: ChatMessage[];
  tokens: number;
  /** The lorebook entries that went in, by name, for the log. */
  lore: string[];
}

type Role = "system" | "user" | "assistant";
interface Turn {
  role: Role;
  text: string;
}

const DEFAULT_MAIN = "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.";

const charName = (data: CardDataV3) => data.nickname || data.name || "Character";

/** The latest game state a message carries, at or before the end of the chat. */
export function latestState(chat: SandboxMessage[]): unknown {
  for (let i = chat.length - 1; i >= 0; i--) {
    const s = (chat[i].variables as { stat_data?: unknown }).stat_data;
    if (s !== undefined) return s;
  }
  return undefined;
}

/** SillyTavern's and Tavern Helper's macros, as far as a card's prompt uses them. */
export function macros(text: string, data: CardDataV3, persona: Persona, chat: SandboxMessage[]): string {
  const char = charName(data);
  return text
    .replace(/\{\{\/\/[\s\S]*?\}\}/g, "")
    .replace(/\{\{format_(?:message|chat)_variable::([^}]+)\}\}/g, (_, path: string) => {
      const vars = { ...chat.at(-1)?.variables, stat_data: latestState(chat) } as Record<string, unknown>;
      const value = String(path)
        .trim()
        .split(".")
        .reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), vars);
      return value === undefined ? "" : runtime.cfYaml(runtime.cfForAi(value)).trimEnd();
    })
    .replace(/\{\{(?:getvar|getglobalvar)::[^}]*\}\}/g, "")
    .replace(/\{\{newline\}\}/gi, "\n")
    .replace(/\{\{trim\}\}/gi, "")
    .replace(/\{\{char\}\}/gi, char)
    .replace(/\{\{user\}\}/gi, persona.name)
    .replace(/<BOT>/g, char)
    .replace(/<USER>/g, persona.name);
}

function parseRegex(source: string): RegExp | null {
  const match = /^\/([\s\S]*)\/([a-z]*)$/.exec(source || "");
  try {
    return match ? new RegExp(match[1], match[2]) : new RegExp(source, "g");
  } catch {
    return null;
  }
}

/** The card's regex that change what the model is sent (not the display-only ones). */
export function promptRegex(text: string, isUser: boolean, depth: number, scripts: SillyTavernRegex[]): string {
  for (const script of scripts) {
    if (script.disabled || script.markdownOnly) continue;
    if (!(script.placement ?? []).includes(isUser ? 1 : 2)) continue;
    if (typeof script.minDepth === "number" && script.minDepth >= 0 && depth < script.minDepth) continue;
    if (typeof script.maxDepth === "number" && script.maxDepth >= 0 && depth > script.maxDepth) continue;
    const re = parseRegex(script.findRegex);
    if (!re) continue;
    text = text.replace(re, (...args: unknown[]) => {
      const named = typeof args.at(-1) === "object" ? (args.pop() as Record<string, string>) : undefined;
      const groups = args.slice(0, -2) as string[];
      let out = String(script.replaceString ?? "")
        .replace(/\{\{match\}\}/gi, groups[0])
        .replace(/\$(\d+)|\$<([^>]+)>/g, (_, n?: string, name?: string) => (n !== undefined ? groups[Number(n)] : named?.[name!]) ?? "");
      for (const t of script.trimStrings ?? []) if (t) out = out.split(t).join("");
      return out;
    });
  }
  return text;
}

const position = (e: LorebookEntry): number => {
  const p = e.extensions.position;
  if (typeof p === "number") return p;
  return e.position === "before_char" ? 0 : 1;
};

function keyMatches(key: string, text: string, caseSensitive: boolean): boolean {
  const k = key.trim();
  if (!k) return false;
  const re = /^\/(.+)\/([a-z]*)$/s.exec(k);
  if (re) {
    try {
      return new RegExp(re[1], re[2]).test(text);
    } catch {
      return false;
    }
  }
  return caseSensitive ? text.includes(k) : text.toLowerCase().includes(k.toLowerCase());
}

/** The entries SillyTavern would turn on for this scan text: always-on ones and those a key matches. */
export function activeLore(entries: LorebookEntry[], scanText: string): LorebookEntry[] {
  return entries
    .filter((e) => {
      if (!e.enabled || !e.content.trim()) return false;
      if (e.constant) return true;
      const cs = !!e.case_sensitive;
      if (!e.keys.some((k) => keyMatches(k, scanText, cs))) return false;
      const second = e.selective ? (e.secondary_keys ?? []).filter((k) => k.trim()) : [];
      if (!second.length) return true;
      const hits = second.filter((k) => keyMatches(k, scanText, cs)).length;
      const logic = Number(e.extensions.selectiveLogic ?? 0);
      if (logic === 1) return hits < second.length; // not all
      if (logic === 2) return hits === 0; // none
      if (logic === 3) return hits === second.length; // all
      return hits > 0; // any
    })
    .sort((a, b) => a.insertion_order - b.insertion_order);
}

const ROLES: Role[] = ["system", "user", "assistant"];

/** Puts turns into provider messages: same roles merged, system notes joined to a user turn, a user turn first. */
function toMessages(turns: Turn[]): ChatMessage[] {
  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const role = t.role === "assistant" ? "assistant" : "user";
    const last = merged.at(-1);
    if (last && last.role === role) last.text += `\n\n${text}`;
    else merged.push({ role, text });
  }
  if (merged[0]?.role !== "user") merged.unshift({ role: "user", text: "[The roleplay begins.]" });
  return merged.map((m) => (m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", text: m.text, toolCalls: [] }));
}

/** The chat as the model reads it: macros and prompt regex applied, oldest first. */
function historyTurns(input: PromptInput, limit?: number): Turn[] {
  const scripts = (input.data.extensions.regex_scripts as SillyTavernRegex[] | undefined) ?? [];
  const chat = input.chat.filter((m) => m.role !== "system");
  const shown = limit === undefined ? chat : chat.slice(Math.max(0, chat.length - limit));
  return shown.map((m, i) => {
    const depth = shown.length - 1 - i;
    const isUser = m.role === "user";
    return { role: isUser ? "user" : "assistant", text: promptRegex(macros(m.message, input.data, input.persona, input.chat), isUser, depth, scripts) };
  });
}

/** Notes put at a depth: 0 after the last message, 1 before it, and so on. */
function atDepths(history: Turn[], notes: { depth: number; turn: Turn }[]): Turn[] {
  const out = [...history];
  // Deepest first, so the indexes of shallower ones stay right.
  for (const n of [...notes].sort((a, b) => b.depth - a.depth)) {
    const at = Math.max(0, out.length - Math.max(0, n.depth));
    out.splice(at, 0, n.turn);
  }
  return out;
}

interface Parts {
  main: string;
  before: string;
  description: string;
  personality: string;
  scenario: string;
  after: string;
  persona: string;
  examples: string;
  depthLore: { depth: number; turn: Turn }[];
  lore: string[];
}

function cardParts(input: PromptInput): Parts {
  const { data, persona, chat } = input;
  const m = (t: string) => macros(t, data, persona, chat).trim();
  const book = data.character_book;
  const scanDepth = book?.scan_depth ?? 2;
  const scanMessages = chat.filter((c) => c.role !== "system").slice(-Math.max(1, scanDepth));
  const scanText = [
    ...scanMessages.map((c) => macros(c.message, data, persona, chat)),
    ...(input.injected ?? []).filter((p) => p.should_scan).map((p) => p.content),
  ].join("\n");
  // With the side call writing the updates, the engine keeps its update rules out of the story's
  // prompt (as the card script does in SillyTavern).
  const engine = readEngine(data);
  const side = ((engine?.lockUpdateMode ? undefined : input.updateMode) ?? engine?.updateMode) === "side";
  const active = activeLore(book?.entries ?? [], scanText).filter((e) => !side || !/^\[mvu_update\]/i.test(e.comment ?? ""));
  const lore = (pos: number[]) =>
    active
      .filter((e) => pos.includes(position(e)))
      .map((e) => m(e.content))
      .filter(Boolean)
      .join("\n\n");
  const depthLore = active
    .filter((e) => position(e) === 4)
    .map((e) => {
      const role = ROLES[Number(e.extensions.role ?? 0)] ?? "system";
      return { depth: typeof e.extensions.depth === "number" ? e.extensions.depth : 4, turn: { role, text: m(e.content) } };
    });
  const examples = m(data.mes_example)
    .split(/<START>/i)
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    main: m(data.system_prompt.trim() ? data.system_prompt.replace(/\{\{original\}\}/gi, DEFAULT_MAIN) : DEFAULT_MAIN),
    before: lore([0]),
    description: m(data.description),
    personality: data.personality.trim() ? `${charName(data)}'s personality: ${m(data.personality)}` : "",
    scenario: data.scenario.trim() ? `Scenario: ${m(data.scenario)}` : "",
    after: lore([1, 2, 3, 5, 6]),
    persona: persona.description.trim() ? `${persona.name}: ${m(persona.description)}` : "",
    examples: examples.length ? `Example dialogue:\n${examples.join("\n\n")}` : "",
    depthLore,
    lore: active.map((e) => e.comment || e.name || e.keys[0] || "entry"),
  };
}

const injectedNotes = (input: PromptInput) =>
  (input.injected ?? [])
    .filter((p) => p.position === "in_chat" && p.content.trim())
    .map((p) => ({ depth: p.depth, turn: { role: (ROLES.includes(p.role) ? p.role : "system") as Role, text: macros(p.content, input.data, input.persona, input.chat) } }));

function finish(system: string, turns: Turn[], lore: string[]): BuiltPrompt {
  const messages = toMessages(turns);
  const tokens = estimateTokens(system) + messages.reduce((n, msg) => n + estimateTokens(msg.role === "tool" ? "" : msg.text), 0);
  return { system, messages, tokens, lore };
}

/** The roleplay model's prompt for the next reply. */
export function replyPrompt(input: PromptInput): BuiltPrompt {
  const p = cardParts(input);
  const system = [p.main, p.before, p.description, p.personality, p.scenario, p.after, p.persona, p.examples].filter(Boolean).join("\n\n");
  const history = atDepths(historyTurns(input), [...p.depthLore, ...injectedNotes(input)]);
  const tail = [macros(input.data.post_history_instructions, input.data, input.persona, input.chat).trim(), input.jailbreak?.trim()].filter(Boolean).join("\n\n");
  if (history.at(-1)?.role === "assistant" || !history.length) history.push({ role: "user", text: "[Continue the roleplay.]" });
  if (tail) history.push({ role: "system", text: tail });
  return finish(system, history, p.lore);
}

const JSON_NOTE = (schema: unknown) =>
  `Answer with JSON only, no other text, matching this JSON Schema:\n${JSON.stringify(schema)}`;

/** A card script's generate or generateRaw call, as SillyTavern would build it. */
export function scriptPrompt(input: PromptInput, purpose: "generate" | "generateRaw", options: GenerateOptions): BuiltPrompt {
  const p = cardParts(input);
  const limit = typeof options.max_chat_history === "number" ? options.max_chat_history : undefined;
  const userInput = options.user_input ? macros(options.user_input, input.data, input.persona, input.chat) : "";
  const injects = (options.injects ?? []).map((i) => ({
    depth: i.depth ?? 0,
    turn: { role: (ROLES.includes(i.role as Role) ? i.role : "system") as Role, text: macros(i.content, input.data, input.persona, input.chat) },
  }));
  const named: Record<string, () => Turn[]> = {
    main: () => [{ role: "system", text: p.main }],
    world_info_before: () => [{ role: "system", text: p.before }],
    char_description: () => [{ role: "system", text: p.description }],
    char_personality: () => [{ role: "system", text: p.personality }],
    scenario: () => [{ role: "system", text: p.scenario }],
    world_info_after: () => [{ role: "system", text: p.after }],
    persona_description: () => [{ role: "system", text: p.persona }],
    dialogue_examples: () => [{ role: "system", text: p.examples }],
    chat_history: () => atDepths(historyTurns(input, limit), [...p.depthLore, ...injectedNotes(input), ...injects]),
    user_input: () => [{ role: "user", text: userInput }],
  };
  const order: (string | { role: string; content: string })[] =
    purpose === "generateRaw" && options.ordered_prompts?.length
      ? options.ordered_prompts
      : ["main", "world_info_before", "char_description", "char_personality", "scenario", "world_info_after", "persona_description", "dialogue_examples", "chat_history", "user_input"];
  const turns = order.flatMap((item): Turn[] =>
    typeof item === "string"
      ? (named[item]?.() ?? [])
      : [{ role: (ROLES.includes(item.role as Role) ? item.role : "system") as Role, text: macros(String(item.content ?? ""), input.data, input.persona, input.chat) }],
  );
  // The system turns before the first message make the system prompt; later ones join the chat.
  const first = turns.findIndex((t) => t.role !== "system" && t.text.trim());
  const lead = first < 0 ? turns : turns.slice(0, first);
  const rest = first < 0 ? [] : turns.slice(first);
  const system = [...lead.map((t) => t.text.trim()).filter(Boolean), options.json_schema?.value ? JSON_NOTE(options.json_schema.value) : ""].filter(Boolean).join("\n\n");
  if (!rest.length || rest.at(-1)?.role === "assistant") rest.push({ role: "user", text: "[Continue.]" });
  return finish(system, rest, p.lore);
}

/** Text the auto-player reads: no update blocks, no screens, no HTML. */
const plainForPlayer = (text: string) =>
  text
    .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, "")
    .replace(/```html[\s\S]*?```/gi, "")
    .replace(/<cf-module[^>]*\/>/gi, "")
    .replace(/<StatusPlaceHolderImpl\/>/g, "")
    .replace(/<action app="([^"]*)"[^>]*>([\s\S]*?)<\/action>/gi, "[on the $1 app: $2]")
    .trim();

/** The auto-player's prompt: a second model writes {{user}}'s next message, to stress-test the card. */
export function playerPrompt(input: PromptInput, goal = ""): BuiltPrompt {
  const { data, persona, chat } = input;
  const m = (t: string) => macros(t, data, persona, chat).trim();
  const system = [
    `You are playing ${persona.name} in a roleplay with ${charName(data)}, to playtest the card. Write only ${persona.name}'s next message: one to three sentences of what ${persona.name} says and does, in first person. Never write for ${charName(data)} or narrate the outcome.`,
    "Keep the story moving and use the game: go places, buy and use things, text people, make choices that should change the game state. Vary what you try.",
    goal.trim() ? `This playtest's focus: ${goal.trim()}` : "",
    persona.description.trim() ? `About ${persona.name}: ${m(persona.description)}` : "",
    data.scenario.trim() ? `Scenario: ${m(data.scenario)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  // The roles flip: the character's replies are what the player answers.
  const turns: Turn[] = chat
    .filter((c) => c.role !== "system")
    .map((c) => ({ role: c.role === "user" ? "assistant" : "user", text: plainForPlayer(macros(c.message, data, persona, chat)) }));
  if (turns.at(-1)?.role !== "user") turns.push({ role: "user", text: "[Write your next message.]" });
  return finish(system, turns, []);
}
