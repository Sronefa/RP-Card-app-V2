/**
 * What the co-writer is told. The system prompt stays the same for a whole chat; the card,
 * project settings and linked cards go into the user's message whenever they change.
 */
import type { CardDataV3 } from "../card";
import type { CardKind, CardRecord, PersonaRecord } from "../db/db";
import { entryTitle } from "../editor/lorebook";
import { estimateTokens } from "../lib/tokens";
import type { CowriterSettings } from "./records";
import { EDITABLE_FIELDS } from "./tools";
import type { ModeId } from "./types";

const BASE = `You are CardForge's co-writer. You help the user write a SillyTavern character card (Character Card V3): a character card, or a world card where the world itself is the character that narrates and plays every NPC. The user doesn't write prose: you write every word that goes into the card, and they steer.

How SillyTavern uses a card:
- description, personality and scenario are sent with every message, so every token there costs context forever. Put what matters most first.
- first_mes and the alternate greetings set the tone and length of replies; the model mirrors them hard.
- mes_example shows voice, speech tics and formatting, not plot. Each example starts with <START>.
- Lorebook entries are sent only when one of their keys appears in recent messages. They hold situational facts, NPCs, places and secrets.

Writing principles:
- Natural, specific prose in third person. No W++, brackets or lists of adjectives.
- Concrete details over adjectives: not "kind" but what the character does that shows it.
- State behaviour positively. Avoid "never" instructions; they plant the very thing.
- One fact lives in one place, and fields never contradict each other.
- Use {{char}} and {{user}}; never name or describe the user's character.
- Greetings never speak or act for {{user}}, and end on a hook that invites a reply.
- Characters: want versus need, a wound or a lie they believe, flaws that create friction, a distinct voice, how they act under pressure, secrets that unlock through play.
- Worlds: the card holds the tip of the iceberg and the lorebook the depth. Build from conflict; rules have costs; give sensory, daily-life texture.
- Lorebook entries are self-contained facts of 50 to 200 tokens. Keys cover names, nicknames, plurals and related words, and are never generic ("the", "city"). Constant entries only for true always-on facts.

Characters in sexual content are always adults. Never sexualize minors.`;

const TOOLS_NOTE = `Change the card only through your tools. Each call becomes a proposal the user accepts or rejects, so keep each call focused: patch_field for small changes, set_field for new or rewritten fields. Never paste card text into your reply instead of calling a tool. After proposing, say in a sentence or two what you changed and why. Keep replies short; the edits speak for themselves.`;

const MODES: Partial<Record<ModeId, string>> = {
  refine: `Right now you're refining the card with the user. Do what they ask, and when an instruction is vague ("make her meaner"), make a clear choice and say what you chose.`,
};

export function systemPrompt(mode: ModeId): string {
  return [BASE, MODES[mode] ?? MODES.refine, TOOLS_NOTE].join("\n\n");
}

const CONTENT_MODES = {
  normal:
    "Content mode: Normal. Follow the user's premise. Don't push dark or sexual content they haven't asked for, and don't shy away from it when the premise calls for it.",
  dark: "Content mode: Dark. Actively write violence, horror, cruelty, moral rot and bleak outcomes into the card where they fit. Don't soften or moralize.",
  unhinged:
    "Content mode: Unhinged. Explicit NSFW content is wanted and actively written into every relevant field: body, kinks, sexual behaviour, explicit example dialogue and lore. Don't hedge, fade to black or moralize. State every character's adult age explicitly.",
};

const SUGGESTIONS = {
  quiet: "Suggestions: only pitch ideas when the user asks for them.",
  balanced: "Suggestions: when you see a clear opportunity, end with one pitch.",
  lots: "Suggestions: pitch freely, two or three ideas per reply (secrets, hooks, NPCs, twists, greetings).",
};

export function settingsContext(settings: CowriterSettings, presets: { name: string; text: string }[]): string {
  const lines = [
    CONTENT_MODES[settings.contentMode],
    settings.tone && `Tone: ${settings.tone}.`,
    settings.genre && `Setting and genre: ${settings.genre}.`,
    SUGGESTIONS[settings.suggestions],
  ].filter(Boolean);
  for (const p of presets) lines.push(`\nThe user's preset "${p.name}":\n${p.text}`);
  return lines.join("\n");
}

const TEXT_FIELDS = Object.keys(EDITABLE_FIELDS) as (keyof typeof EDITABLE_FIELDS)[];

/** The card as the co-writer sees it, with lorebook entry ids for its tools. */
export function cardContext(data: CardDataV3, kind: CardKind): string {
  const out: string[] = [`Card type: ${kind === "world" ? "world card" : "character card"}`];
  for (const field of TEXT_FIELDS) {
    const value = data[field] ?? "";
    out.push(`## ${field} (~${estimateTokens(value)} tokens)\n${value || "(empty)"}`);
  }
  out.push(`## tags\n${data.tags.join(", ") || "(none)"}`);
  out.push(
    `## alternate_greetings\n${data.alternate_greetings.map((g, i) => `[${i + 1}]\n${g}`).join("\n\n") || "(none)"}`,
  );
  if (data.group_only_greetings.length)
    out.push(`## group_only_greetings\n${data.group_only_greetings.map((g, i) => `[${i + 1}]\n${g}`).join("\n\n")}`);
  const entries = data.character_book?.entries ?? [];
  out.push(
    `## lorebook (${entries.length} entries)\n` +
      (entries
        .map(
          (e) =>
            `[id ${String(e.id)}] ${entryTitle(e)}${e.constant ? " (constant)" : ""}${e.enabled ? "" : " (disabled)"}\nkeys: ${e.keys.join(", ") || "(none)"}\n${e.content}`,
        )
        .join("\n\n") || "(empty)"),
  );
  return out.join("\n\n");
}

/** The project's world card, summarized for a character card, so facts stay consistent. */
export function worldContext(world: CardRecord): string {
  const d = world.card.data;
  const entries = d.character_book?.entries ?? [];
  return [
    `World card "${d.name}":`,
    d.description,
    d.scenario && `Scenario: ${d.scenario}`,
    entries.length > 0 && `Lorebook entries in the world: ${entries.map(entryTitle).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function personasContext(personas: PersonaRecord[]): string {
  return personas.map((p) => `${p.name}: ${p.description || "(no description)"}`).join("\n");
}

/**
 * The text sent for a user message: the context parts that changed since the co-writer last
 * saw them, then the user's request.
 */
export function composeUserMessage(
  request: string,
  parts: { key: string; title: string; text: string }[],
  sent: Record<string, string>,
  decisions: string[],
): { text: string; sent: Record<string, string> } {
  const next = { ...sent };
  const blocks: string[] = [];
  for (const part of parts) {
    if (sent[part.key] === part.text) continue;
    blocks.push(`<${part.key} title="${part.title}">\n${part.text}\n</${part.key}>`);
    next[part.key] = part.text;
  }
  if (decisions.length) blocks.push(`<decisions>\n${decisions.join("\n")}\n</decisions>`);
  blocks.push(request);
  return { text: blocks.join("\n\n"), sent: next };
}
