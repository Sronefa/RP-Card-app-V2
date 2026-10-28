/**
 * What the co-writer is told. The system prompt stays the same for a whole chat; the card,
 * project settings and linked cards go into the user's message whenever they change.
 */
import type { CardDataV3 } from "../card";
import type { CardKind, CardRecord, PersonaRecord } from "../db/db";
import { ARC_OPTIONS, arcHidden, type ArcSettingKey, type ArcSettings } from "../editor/arc";
import { entryTitle } from "../editor/lorebook";
import { LOGIC_NAMES } from "../editor/mechanics";
import { BUILT_IN_SKILLS } from "../engine/engineer/knowledge";
import { effectiveConfig } from "../engine/modules/compile";
import { readEngine, varLabel, varPath } from "../engine/sheet";
import { engineFeaturesText, tiersEntryOf } from "./engineTools";
import { KINDS, pageMeta, worldFieldsText } from "../editor/world";
import { estimateTokens } from "../lib/tokens";
import { YOU_DECIDE, type CowriterSettings, type DarkLevel, type ProseSettings, type UnhingedLevel, type InterviewDepth, type InterviewRound } from "./records";
import { EDITABLE_FIELDS } from "./tools";
import type { ModeId } from "./types";

const BASE = `You are CardForge's co-writer. You help the user write a SillyTavern character card (Character Card V3): a character card, or a world card where the world itself is the character that narrates and plays every NPC. The user doesn't write prose: you write every word that goes into the card, and they steer.

How SillyTavern uses a card:
- description, personality and scenario are sent with every message, so every token there costs context forever. Put what matters most first.
- first_mes and the alternate greetings set the tone and length of replies; the model mirrors them hard.
- mes_example shows voice, speech tics and formatting, not plot. Each example starts with <START>.
- Lorebook entries are sent only when one of their keys appears in recent messages. They hold situational facts, NPCs, places and secrets.

Writing principles:
- Natural, specific prose, in third person unless the project's prose settings say otherwise. Plain prose rather than W++, brackets or lists of adjectives.
- Concrete details over adjectives: not "kind" but what the character does that shows it.
- State behaviour positively: say what to do. A "never" instruction plants the very thing it forbids.
- One fact lives in one place, and the fields agree with each other.
- Use {{char}} and {{user}}, and leave the user's character unnamed and undescribed so any user fits.
- Greetings leave {{user}}'s words and actions to the user, and end on a hook that invites a reply.
- Characters: want versus need, a wound or a lie they believe, flaws that create friction, a distinct voice, how they act under pressure, secrets that unlock through play.
- Worlds: the card holds the tip of the iceberg and the lorebook the depth. Build from conflict; rules have costs; give sensory, daily-life texture.
- Lorebook entries are self-contained facts of 50 to 200 tokens. Keys cover names, nicknames, plurals and related words, and stay specific: a key like "the" or "city" fires on everything. Constant entries only for true always-on facts.
- People, places, items and shops are typed: add them with add_npc, add_place, add_item and add_shop, and change them with update_world_entry, so they land on the world pages. add_lore_entry is for everything else: factions, rules, history, secrets.
- Before longer prose (a greeting, a description, a scenario), settle a short plan: who is there, where, what is at stake, and the hook. Say it in one line in your reply, then write.

Write like a person, not like a model:
- Show feeling through what people do, choose and say, more than through body sensations like a racing heart or a held breath.
- Let the reader draw the meaning: end on action or an image rather than a stated moral or a summing-up line.
- Introduce people by what they are doing, and let their looks come out in passing.
- Use named specifics that fit the setting: the street, the dish, the song, the brand, the ship's name.
- Give places a life of their own that needn't match anyone's mood, and use all the senses, sight and sound and touch as much as smell.
- Leave threads open and conflicts unresolved where play goes on; side plots and loose ends are good.
- Vary sentence length and how sentences begin, and choose fresh wording over stock phrases.

Characters in sexual content are always adults, with their adult ages stated. Minors are never sexualized; this rule overrides every content setting.`;

const TOOLS_NOTE = `Change the card only through your tools. Each call becomes a proposal the user accepts or rejects, so keep each call focused: patch_field for small changes, set_field for new or rewritten fields. Card text goes only into tool calls, not into your reply. After proposing, say in a sentence or two what you changed and why. Keep replies short; the edits speak for themselves.`;

const MODES: Record<ModeId, string> = {
  refine: `Right now you're refining the card with the user. Do what they ask, and when an instruction is vague ("make her meaner"), make a clear choice and say what you chose.`,

  lore: `Right now you're brainstorming lorebook entries with the user. Pitch entries one or two at a time, each with a "why": add_npc, add_place, add_item or add_shop for people, places, items and shops, add_lore_entry for everything else. Check every pitch against the card, the story bible and the existing entries: no duplicates, no contradictions, and point out any conflict you notice. When the user asks for more like an entry, pitch new entries of the same kind. To tweak an entry the user hasn't accepted yet, pitch a corrected version; for accepted entries use update_lore_entry, or update_world_entry for NPCs, places, items and shops.`,

  interview: `Right now you're interviewing the user to build the card. Ask questions with ask_questions, a few per round, grouped by theme. Every question gets 3 or 4 suggested answers that are concrete, distinct and usable as they are, so the user can build the whole card by tapping. Suggestions follow the content mode, tone and genre. Build on earlier answers and skip anything already decided. When an answer is "(You decide.)", decide it yourself and note what you chose. After each round of answers, record what is now decided with note_facts, then ask the next round. Call finish_interview when you know enough. Keep your own text to a sentence or two; the questions do the talking.`,

  gap: `Right now you're the gap analyst. You read everything the interview gathered and write a short memo with write_memo: what a good card still needs, which answers are too vague to write from, which facts contradict each other, and what the story could use (a rival, a secret, a reason to stay, a hook for the first scene). Be specific and brief. Mark the memo clean only when nothing important is left open.`,

  draft: `Right now you're drafting the card from the interview. Write only what you're asked for in this step, using the story bible and the interview as the source of truth: stay consistent with them, and fill small gaps with choices that fit. Use your tools for every word; don't write card text in your reply.`,

  suggest: `Right now you're brainstorming the answer to one interview question with the user. Pitch 4 or 5 varied ideas with suggest_answers, from the expected to the surprising. Riff on the ideas the user likes and combine them when asked. When the user settles on something, write it up with final_answer. Follow the content settings: Dark, Horror and Dead dove push darker answers; Unhinged and Absolutely unhinged actively push explicit NSFW answers.`,

  image: `Right now you write prompts for image generators, to illustrate the card. Describe only what can be seen: appearance, body, clothing, expression, pose, setting, lighting, composition and art style. Image models don't know the characters' names, so describe them instead of naming them, and leave out {{char}} and {{user}}. Follow the requested format and style exactly. Follow the content settings: with Unhinged on, explicit nudity and sex are fine when asked for, and Absolutely unhinged leans every image sexual; Horror leans toward dread and wrongness. Characters are always adults and look it. Hand in the result with write_image_prompt.`,

  planner: `Right now you sort the card's greetings for the greeting planner. For each greeting, pick the mood, the place and the stage of the relationship between {{char}} and {{user}} that fit it best, using only the values the user gave. If no place list is given, name the places yourself in two or three words each and reuse the same name for the same place. Hand in the result with sort_greetings.`,

  world: `Right now you're filling in the world's pages: NPCs, places, money, items and shops, each kept as a lorebook entry. Pitch what the user asks for with the pitch tool, filling every field. Fit the card, the story bible and what already exists: no duplicates, no contradictions, and reuse names the card already mentions before inventing new ones. Keep each field short and concrete; NPC voices must sound different from each other and from {{char}}. Follow the content mode and tone. Characters in sexual content are adults.`,

  arc: `Right now you're plotting a story arc for the card: a run of beats the narrator will steer toward, one after another, as the chat goes on. Follow the arc settings exactly; they are the user's rules for difficulty, death, failure, twists and the antagonist. Each beat is a situation that pressures {{user}} and leaves {{user}}'s actions to their choices. Beats escalate, pay off what earlier beats set up, and plant fair clues for every twist. Fit the card, the story bible and the lorebook: reuse the NPCs, places and factions that exist before inventing new ones. When you build an antagonist, make them a person with reasons, not a cartoon: a goal they believe in, real resources, limits, and a weakness {{user}} can find. Follow the content mode and tone. Characters in sexual content are adults, with ages stated.`,

  mechanics: `Right now you're the Game Wizard: you turn a mechanic the user describes in plain words into a rules module baked into the card as a lorebook entry, so it works in SillyTavern with no extension. There are no dice; the narrator decides outcomes from the rules and the story. Write modules that follow these attention practices:
- Rules go in-chat at a depth, not at the top of the prompt. Core rules sit at depth 3 or 4; a module for something happening right now (a fight, a ritual) sits at depth 1 or 2. Depth 0 is the user's message, so modules go deeper.
- Keep each module 50 to 200 tokens with one XML tag of its own (lower case, underscores). Use the same names the status block and other modules use for shared values.
- State rules positively and concretely: what the narrator does, with numbers where values change. Give a one-line example of correct output instead of a list of "never".
- Few modules are always on. Anything situational is keyed on the words that bring it up, sticky for as long as it stays relevant, and put in an inclusion group with the other modes (exploration, combat, social) so only one is in the prompt at a time.
- A higher priority puts the module later within its depth, where it gets the most attention; give the most important rule the highest.
- Values that change (HP, mana, gold, corruption) are tracked: list them so they appear in the status block, and refer to them by the same label in the rules.
Fit the card, the story bible and the existing modules, and stay consistent with them. Follow the content mode and tone. Characters in sexual content are adults.`,

  editor: `Right now you're the line editor. You get one piece of card text and return it edited line by line with the polish tool. Fix filler and padding, flat rhythm (vary sentence length and openings), weak verbs and stacked adjectives, clichés and stock phrases, and any slip from the project's point of view and tense. Fix the habits that mark AI fiction: stated morals and summing-up lines, feelings told through body sensations, smell leaned on more than the other senses, settings that mirror the mood, people introduced by a description paragraph, tidy resolutions. Change lines, not content: keep every fact, name, event, macro ({{char}}, {{user}}), <START> marker and the formatting convention, and keep the length within about a tenth. Follow the content settings: dark or explicit material stays as dark and explicit. List each kind of change you made in a few words.`,

  rewrite: `Right now you're rewriting one piece of card text the way the user asks: a revision from their feedback, or other versions that take a different approach. The user's request decides how much changes, including length. Keep the card's facts, names, macros ({{char}}, {{user}}), <START> markers and formatting convention unless the request is about them. Follow the project's prose and content settings.`,

  judge: `Right now you're judging versions of the same card text. Rank them by how well each would play in a roleplay: a strong hook, a distinct voice, room for {{user}} to act, concrete detail, no stock phrasing. Give each a short reason.`,

  engineer: `Right now you're the UI engineer: you build the card's engine screens with your tools.`,

  worker: `Right now you're the UI engineer's worker: you build one task of the card's engine screens with your tools.`,

  // The playtest modes send the card's own prompts, never the co-writer's.
  playtest: "",
  player: "",
  sidecall: "",

  critic: `Right now you're the critic. Read the card as the roleplay model that will play it, and list the concrete problems: vague or generic writing, contradictions between fields, greetings that speak or act for {{user}}, negative instructions, wasted permanent tokens, weak hooks, a voice that doesn't come through, lore that duplicates the card. Number the problems, name the field for each, and say what would fix it. At most ten, most important first. Don't rewrite the card yourself. If it is in good shape, say so in a sentence.`,
};

/** Modes that edit the card through tool calls. */
const EDITING_MODES: ModeId[] = ["refine", "lore", "draft"];

export function systemPrompt(mode: ModeId): string {
  return [BASE, MODES[mode], EDITING_MODES.includes(mode) && TOOLS_NOTE].filter(Boolean).join("\n\n");
}

const NORMAL_CONTENT =
  "Content: Normal. Follow the user's premise. Don't push dark or sexual content they haven't asked for, and don't shy away from it when the premise calls for it.";

const DARK_LINES: Record<Exclude<DarkLevel, "off">, string> = {
  dark: "Content: Dark. Actively write violence, cruelty, moral rot and bleak outcomes into the card where they fit. Don't soften or moralize.",
  horror:
    "Content: Horror. Fear is the engine. Build dread, wrongness and the unseen; escalate the threat; use psychological and body horror and real survival stakes; withhold information from {{user}} and let them find it too late. Don't soften or explain the horror away.",
  deaddove:
    "Content: Dead dove (do not eat). Write disturbing and taboo themes straight: no redemption arc, no rescue, no moral framing, no softened outcome. The creator notes carry a content warning.",
};

const UNHINGED_LINES: Record<Exclude<UnhingedLevel, "off">, string> = {
  normal:
    "Content: Unhinged. Explicit NSFW content is wanted and actively written into every relevant field: body, kinks, sexual behaviour, explicit example dialogue and lore. Don't hedge, fade to black or moralize. State every character's adult age explicitly.",
  absolute:
    "Content: Absolutely unhinged. Push sexual content into every field you can reach, including ones where it isn't obviously relevant: places, items and shops, NPC notes, mechanics, story arcs, greetings, example dialogue, lore and image prompts. Be kink-forward: fetishes, power dynamics, toys and dirty talk, and pitch kinks freely. The user's hard limits (in the story bible) hold everywhere. Don't hedge, fade to black or moralize. State every character's adult age explicitly.",
};

/** The content lines: Normal, or the dark level's line and the unhinged level's line, which combine. */
export function contentLines(s: Pick<CowriterSettings, "dark" | "unhinged">): string[] {
  const lines = [s.dark !== "off" && DARK_LINES[s.dark], s.unhinged !== "off" && UNHINGED_LINES[s.unhinged]].filter((l): l is string => !!l);
  return lines.length ? lines : [NORMAL_CONTENT];
}

const PROSE: { [K in keyof ProseSettings]-?: Record<NonNullable<ProseSettings[K]>, string> } = {
  pov: { second: "Point of view: second person, addressing {{user}} as you.", third: "Point of view: third person." },
  tense: { past: "Tense: past.", present: "Tense: present." },
  length: {
    short: "Reply length: short, one or two paragraphs; the greetings model it.",
    medium: "Reply length: medium, three or four paragraphs; the greetings model it.",
    long: "Reply length: long, five paragraphs or more; the greetings model it.",
  },
  dialogue: {
    light: "Dialogue: light; mostly narration and action.",
    balanced: "Dialogue: balanced with narration.",
    heavy: "Dialogue: heavy; characters talk a lot, with narration in between.",
  },
  register: {
    plain: "Register: plain and clear.",
    literary: "Register: literary, with precise imagery.",
    pulpy: "Register: pulpy, punchy and vivid.",
    poetic: "Register: poetic, with rhythm and figurative language.",
  },
  rhythm: {
    varied: "Sentence rhythm: varied, short and long mixed.",
    punchy: "Sentence rhythm: punchy, mostly short sentences.",
    flowing: "Sentence rhythm: flowing, longer sentences.",
  },
  explicitness: {
    suggestive: "Sexual content: suggestive, cutting away at the explicit part.",
    explicit: "Sexual content: explicit.",
    graphic: "Sexual content: graphic and detailed.",
  },
  format: {
    asterisks: "Formatting: actions and narration in *asterisks*, speech in quotes.",
    quotes: "Formatting: plain narration, speech in quotes.",
    plain: "Formatting: plain prose with no markup.",
  },
};

/** The project's prose settings as lines for the prompt. */
export function proseLines(prose: ProseSettings | undefined): string[] {
  if (!prose) return [];
  return (Object.keys(PROSE) as (keyof ProseSettings)[])
    .map((k) => {
      const v = prose[k];
      return v ? (PROSE[k] as Record<string, string>)[v] : undefined;
    })
    .filter((l): l is string => !!l);
}

const SUGGESTIONS = {
  quiet: "Suggestions: only pitch ideas when the user asks for them.",
  balanced: "Suggestions: when you see a clear opportunity, end with one pitch.",
  lots: "Suggestions: pitch freely, two or three ideas per reply (secrets, hooks, NPCs, twists, greetings).",
};

/** The built-in guide to writing engine cards; the user can edit it as a UI engineer skill. */
export const ENGINE_GUIDE = BUILT_IN_SKILLS.find((s) => s.id === "engine-card-writing")?.text ?? "";

export function settingsContext(
  settings: CowriterSettings,
  presets: { name: string; text: string }[],
  engineGuide = ENGINE_GUIDE,
): string {
  const lines = [
    ...contentLines(settings),
    ...proseLines(settings.prose),
    settings.engineMode &&
      `This card is built for the Immersive Engine (an MVU card: a variable sheet the model updates each reply, shown in panels and screens). Write for it from the start with the engine tools (add_variable, set_update_rule, write_tiers, set_greeting_state), following this guide:\n${engineGuide}`,
    settings.engineMode &&
      "You and the UI engineer hand each other work. When something you write should show on a screen (a new NPC the player could text, a shop's goods, a place for the map, a stat worth a meter), file it for the engineer with ask_engineer; the user approves it in the inbox. When the engine's screens need words (a living screen's content pack, a minigame's outcome lines, a cutscene, a mood's name, a portrait's expressions), write them with write_live_pack, write_minigame_lines, write_scene, name_mood and list_expressions. A message that starts with \"A task from\" was approved by the user: do it.",
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
        .map((e) => {
          const world = pageMeta(e);
          const head = `[id ${String(e.id)}] ${world ? `${KINDS[world.kind].label}: ` : ""}${entryTitle(e)}${e.constant ? " (constant)" : ""}${e.enabled ? "" : " (disabled)"}`;
          return world
            ? `${head}\n${worldFieldsText(world)}`
            : `${head}\nkeys: ${e.keys.join(", ") || "(none)"}\n${e.content}`;
        })
        .join("\n\n") || "(empty)"),
  );
  const engine = readEngine(data);
  if (engine) {
    const vars = effectiveConfig(engine).vars.filter((v) => v.name.trim());
    out.push(
      `## engine values (the Immersive Engine is on; the prose shows their effects, not their numbers)\n` +
        (vars
          .map((v) => {
            const range = v.min !== undefined || v.max !== undefined ? `, ${v.min ?? "…"} to ${v.max ?? "…"}` : "";
            const marks = v.hidden ? ", hidden $" : v.readOnly ? ", read-only _" : "";
            const tiers = v.type === "number" ? (tiersEntryOf(data, varLabel(v)) ? ", has tiers" : ", no tiers yet") : "";
            return `- ${varPath(v).join(".")} (${v.type}, starts at ${v.start || "nothing"}${range}${marks}${tiers})${v.rule.trim() ? `: ${v.rule.trim()}` : ""}`;
          })
          .join("\n") || "(none yet)"),
    );
    const features = engineFeaturesText(engine);
    if (features) out.push(`## engine screens that need words (write them with the engine writing tools)\n${features}`);
  }
  if (arcHidden(data))
    out.push(
      "The story arc entries are secret from the user: use them to keep the card consistent, and keep their content out of everything the user reads.",
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

export function bibleContext(bible: string): string {
  return `The story bible, the source of truth for this card. Don't contradict it.\n\n${bible.trim()}`;
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

// Interview

const THEMES: Record<CardKind, string[]> = {
  character: [
    "Core concept",
    "Look",
    "Personality and voice",
    "History, wants and wounds",
    "Relationship and stance toward {{user}}",
    "Behaviour under pressure",
    "Secrets and layers",
    "Opening scene",
  ],
  world: [
    "Premise and tone",
    "Rules and their costs (magic, technology, law)",
    "Factions and conflict",
    "Places",
    "Notable people",
    "Daily life and texture",
    "The narrator's voice",
    "Entry points for {{user}}",
  ],
};

const DARK_THEME: Record<Exclude<DarkLevel, "off">, string> = {
  dark: "Dark themes: violence, cruelty, what goes wrong",
  horror: "Horror: what is feared, what is wrong here, what is hidden from {{user}}, and how the threat escalates",
  deaddove: "Dead dove: the disturbing or taboo themes to write straight, with no rescue or redemption",
};

const UNHINGED_THEME: Record<Exclude<UnhingedLevel, "off">, string> = {
  normal: "Sex: bodies, kinks, sexual behaviour and dynamics (adults only, ages stated)",
  absolute: "Kinks and hard limits: the user's kink list (fetishes, power dynamics, toys, dirty talk) and the hard limits the card respects everywhere (adults only, ages stated)",
};

const DEPTH_PLAN: Record<InterviewDepth, string> = {
  quick:
    "Depth: Quick. Ask a single round of 5 to 8 questions covering the most important themes. The card is drafted right after this round, so make every question count.",
  standard:
    "Depth: Standard. About three rounds of 3 to 5 questions, theme by theme. Call finish_interview when you have enough for a strong card.",
  deep: "Depth: Deep. Cover every theme thoroughly, 3 to 5 questions per round, as many rounds as it takes, digging into specifics. Call finish_interview when every theme is settled.",
};

/** The request that starts an interview. */
export function interviewKickoff(kind: CardKind, settings: CowriterSettings, premise: string): string {
  const themes = [...THEMES[kind]];
  if (settings.dark !== "off") themes.splice(themes.length - 1, 0, DARK_THEME[settings.dark]);
  // Absolutely unhinged asks for the kink list and hard limits up front, so every later answer respects them.
  if (settings.unhinged === "absolute") themes.splice(1, 0, UNHINGED_THEME.absolute);
  else if (settings.unhinged === "normal") themes.splice(themes.length - 1, 0, UNHINGED_THEME.normal);
  // Engine cards plan their variables early, right after the core concept.
  if (settings.engineMode)
    themes.splice(1, 0, "Game state: what the engine should track (about six core numbers at most) and what each tier of them means for how characters behave");
  return [
    `Interview me to build a ${kind === "world" ? "world card" : "character card"}.`,
    premise.trim() ? `My idea: ${premise.trim()}` : "I have no idea yet: help me find one with your first questions.",
    `Themes to cover:\n${themes.map((t) => `- ${t}`).join("\n")}`,
    DEPTH_PLAN[settings.depth],
  ].join("\n\n");
}

/** The user's answers to one round, as the interviewer receives them. */
export function answersText(round: InterviewRound): string {
  return round.questions
    .map((q) => `Q: ${q.question}\nA: ${round.answers[q.id]?.trim() || YOU_DECIDE}`)
    .join("\n\n");
}

/** Every answered question so far. */
export function transcript(rounds: InterviewRound[]): string {
  return rounds
    .filter((r) => r.submitted)
    .map(answersText)
    .join("\n\n");
}

export const factsText = (facts: string[]) => facts.map((f) => `- ${f}`).join("\n");

export function gapRequest(kind: CardKind, settings: CowriterSettings, rounds: InterviewRound[], facts: string[]): string {
  return [
    `<settings>\n${settingsContext(settings, [])}\n</settings>`,
    `<interview>\n${transcript(rounds)}\n</interview>`,
    facts.length ? `<decided_facts>\n${factsText(facts)}\n</decided_facts>` : "",
    `This is the interview for a ${kind === "world" ? "world card" : "character card"}. Write the gap analysis memo with write_memo.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function digDeeperRequest(memo: string): string {
  return `A gap analysis of the interview so far found this:\n\n${memo}\n\nAsk one round of targeted follow-up questions (with suggested answers) that settle these points. Record anything you can already decide with note_facts.`;
}

export const BIBLE_REQUEST = `The interview is over. Write the story bible with write_story_bible: every decided fact, grouped into sections, specific and consistent. Where an answer was left to you, decide it now. This becomes the source of truth for writing the card.`;

/** Steps of drafting a card. Each step is its own call, so every part gets full attention. */
export const DRAFT_GROUPS: { id: string; label: string; brief: Record<CardKind, string> }[] = [
  {
    id: "core",
    label: "description, personality and scenario",
    brief: {
      character:
        "Write name, description, personality and scenario with set_field. The description comes first and matters most: identity, look, personality shown through behaviour, voice, wants and wounds. Personality is a short summary. The scenario is the starting situation with {{user}}.",
      world:
        "Write name, description, personality and scenario with set_field. Name is the world's name. The description sets the premise, the rules and their costs, the tone and the narrator's role: it narrates, plays every NPC, and leaves {{user}}'s actions to the user. Personality is the narrator's voice and style. The scenario is the starting situation. Keep the details of places, factions and people for the lorebook.",
    },
  },
  {
    id: "greetings",
    label: "greetings",
    brief: {
      character:
        "Write first_mes with set_field, then two alternate greetings with add_greeting, each a different opening situation. Leave {{user}}'s words and actions to the user; end on a hook; match the reply length you want back.",
      world:
        "Write first_mes with set_field, then two alternate greetings with add_greeting: different entry points into the world (arriving as a stranger, mid-crisis, somewhere ordinary). Leave {{user}}'s words and actions to the user; end on a hook.",
    },
  },
  {
    id: "examples",
    label: "example dialogues",
    brief: {
      character:
        "Write two or three example dialogues with add_example_dialogue. They show voice, speech tics and formatting, not plot.",
      world:
        "Write two example dialogues with add_example_dialogue that show the narrator's voice and how NPCs speak, not plot.",
    },
  },
  {
    id: "lore",
    label: "lorebook",
    brief: {
      character:
        "Add 3 to 6 lorebook entries for things that matter only sometimes: people with add_npc, places with add_place, history and secrets with add_lore_entry. Don't repeat what the description says.",
      world:
        "Add 6 to 12 lorebook entries: notable people with add_npc, places with add_place, factions, rules and history with add_lore_entry. Each self-contained, with good keys.",
    },
  },
];

/** The request for one drafting step, given the source facts and the card as drafted so far. */
export function draftRequest(groupId: string, kind: CardKind, source: string, card: string, engine = false): string {
  const group = draftGroups(engine).find((g) => g.id === groupId)!;
  return [
    `<source>\n${source}\n</source>`,
    `<card_so_far>\n${card}\n</card_so_far>`,
    `This step: ${group.brief[kind]}`,
    engine && group.id !== "engine" && ENGINE_DRAFT_NOTE[group.id],
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The first step of an engine card's draft: the variables, before any prose. */
const ENGINE_GROUP = {
  id: "engine",
  label: "variables",
  brief: {
    character:
      "Plan the game state before any prose. Add the core values with add_variable (about six numbers at most, plus the states and lists the story needs), each with a concrete update rule; then give every core number its tiers and threshold events with write_tiers. Use fixed names (protagonist, the character's name) rather than {{user}}.",
    world:
      "Plan the game state before any prose. Add the core values with add_variable (about six numbers at most, plus the world's states, the protagonist's and the main NPCs' records), each with a concrete update rule; then give every core number its tiers and threshold events with write_tiers. Use fixed names rather than {{user}}.",
  } as Record<CardKind, string>,
};

const ENGINE_DRAFT_NOTE: Record<string, string> = {
  core: "This is an engine card: the prose shows what values mean through behaviour, not their numbers, and keep tier behaviour out of the description; the tiers entries hold it.",
  greetings:
    "This is an engine card: after writing the greetings, give each one (0 is the first message) its starting state with set_greeting_state, the values that differ from the defaults at that opening.",
  examples: "This is an engine card: no stats or numbers in the dialogue.",
  lore: "This is an engine card: entries hold facts and behaviour; current values live in the engine.",
};

/** The drafting steps, with the variables first for an engine card. */
export const draftGroups = (engine: boolean) => (engine ? [ENGINE_GROUP, ...DRAFT_GROUPS] : DRAFT_GROUPS);

/** What the draft is written from: the story bible, or the interview when there is none. */
export function draftSource(bible: string | undefined, rounds: InterviewRound[], facts: string[]): string {
  if (bible?.trim()) return `Story bible:\n${bible.trim()}`;
  return [
    `Interview:\n${transcript(rounds)}`,
    facts.length ? `Decided facts:\n${factsText(facts)}` : "",
    `Where an answer is "${YOU_DECIDE}", decide it yourself.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const CRITIC_REQUEST = "Review this card.";

/** The opening message of a brainstorm on one interview question. */
export function brainstormKickoff(question: string, suggestions: string[], known: string): string {
  return [
    known && `<what_we_know>\n${known}\n</what_we_know>`,
    `The question: ${question}`,
    suggestions.length ? `Suggestions already offered:\n${suggestions.map((s) => `- ${s}`).join("\n")}` : "",
    "Pitch fresh ideas for the answer.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Personas

/** A card summarized as the starting point for a persona. */
export function personaSourceText(record: CardRecord): string {
  const d = record.card.data;
  const entries = d.character_book?.entries ?? [];
  return [
    `<source_card kind="${record.kind === "world" ? "world card" : "character card"}" name="${d.name}">`,
    d.description && `Description: ${d.description}`,
    d.scenario && `Scenario: ${d.scenario}`,
    d.first_mes && `First message: ${d.first_mes}`,
    entries.length > 0 && `Lorebook: ${entries.map(entryTitle).join(", ")}`,
    `</source_card>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const PERSONA_FOCUS =
  "A persona is the character the user plays, so the user brings the personality. Focus on what others can see and what {{user}} can do: appearance (build, face, hair, clothing, marks), capabilities (skills, training, powers, gear, resources) and their place in the world (role, standing, a few background facts). Keep manner to a single line at most, and leave out inner thoughts and feelings.";

export function personaKickoff(premise: string, source?: string): string {
  return [
    "Interview me to build a persona: the character I play in SillyTavern, not a character card. A persona is short and sent with every message, so only what other characters would notice or need to know matters.",
    PERSONA_FOCUS,
    source &&
      `${source}\nBuild the persona to fit this card: someone who belongs in its world and has a reason to be in its scenario. Suggestions should come from the card's places, factions and situation.`,
    premise.trim() ? `My idea: ${premise.trim()}` : "I have no idea yet: help me find one.",
    "Ask a single round of 4 to 6 questions with ask_questions: name, appearance, clothing and gear, what they can do, and their role and standing in the world. At most one question on manner, none on deeper personality. Don't ask about the story itself.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function personaWriteRequest(answers: string, source?: string): string {
  return [
    source,
    `<interview>\n${answers}\n</interview>`,
    `Write the persona with write_persona. The description is 100 to 300 tokens of natural third-person prose that refers to the persona as {{user}}: appearance first, then capabilities and gear, then their role and a line of background${source ? " tied to the card" : ""}. ${PERSONA_FOCUS} Adults only, with the age stated. Where an answer is "${YOU_DECIDE}", decide it yourself.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Image prompts

export const FRAMINGS = {
  portrait: "a head-and-shoulders portrait",
  "full body": "a full-body shot",
  scene: "a scene with the subject in their surroundings",
  landscape: "a wide landscape or establishing shot with no main character",
} as const;
export type Framing = keyof typeof FRAMINGS;

export function imagePromptRequest(opts: {
  subject: string;
  setting?: string;
  contentMode: string;
  style: { name: string; format: "tags" | "prose"; style: string; prefix: string; negative: string; notes: string };
  framing: Framing;
  instructions: string;
}): string {
  const { style } = opts;
  const format =
    style.format === "tags"
      ? "Format: a Stable Diffusion / NovelAI prompt. Comma-separated booru-style tags, most important first: subject count, then appearance, clothing, expression, pose, setting, lighting. The negative prompt is also comma-separated tags."
      : "Format: a natural-language prompt for models like Flux, DALL-E or Midjourney. One vivid paragraph of plain sentences. The negative prompt is a short comma-separated list of things to avoid.";
  return [
    `<subject>\n${opts.subject}\n</subject>`,
    opts.setting && `<setting>\n${opts.setting}\n</setting>`,
    `Content: ${opts.contentMode}.`,
    format,
    `Art style "${style.name}": ${style.style || "your choice"}.`,
    style.prefix && `Start the prompt with exactly: ${style.prefix}`,
    style.negative && `The negative prompt must include: ${style.negative}`,
    style.notes && `Also: ${style.notes}`,
    `Framing: ${FRAMINGS[opts.framing]}.`,
    opts.instructions.trim() && `The user asks: ${opts.instructions.trim()}`,
    "Write the image prompt with write_image_prompt.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Asks the lorebook brainstorm to fit a character card into this world. */
export function bringInRequest(character: string): string {
  return `<character_card>\n${character}\n</character_card>\n\nBring this character into this world. First, in a few short lines: where they fit (place, role, standing), their ties to people and factions already in the world, and what in their card clashes with the world and how you'd adapt it. Then pitch lorebook entries one or two at a time, starting with the character's own entry as an NPC (add_npc), then their ties, places and secrets. Keep them recognisable; adapt names, places and details that don't fit, and say what you changed. I'll steer before accepting.`;
}

/** Asks the planner to sort the greetings onto the user's axes. */
export function greetingSortRequest(greetings: string[], axes: { moods: string[]; places: string[]; stages: string[] }): string {
  return [
    greetings.map((g, i) => `<greeting index="${i}">\n${g}\n</greeting>`).join("\n\n"),
    `Moods: ${axes.moods.join(", ")}`,
    axes.places.length ? `Places: ${axes.places.join(", ")}` : "Places: name them yourself.",
    `Relationship stages: ${axes.stages.join(", ")}`,
    "Sort every greeting with sort_greetings.",
  ].join("\n\n");
}

/** Asks the co-writer chat for greetings that fill gaps in the planner grid. */
export function greetingFillRequest(cells: { mood: string; stage: string; place?: string }[], engine = false): string {
  const list = cells.map((c) => `- mood: ${c.mood}; relationship stage: ${c.stage}; place: ${c.place ?? "a place no other greeting uses"}`);
  return [
    `Write ${cells.length === 1 ? "an alternate greeting" : `${cells.length} alternate greetings`} for openings the card doesn't have yet, one add_greeting each:`,
    list.join("\n"),
    "Each greeting sets up its own situation with a hook, matches the first message in voice and length, and leaves {{user}}'s words and actions to the user. The relationship stage is where {{char}} and {{user}} stand when the scene opens.",
    engine
      ? "This is an engine card: give each new greeting its starting state with set_greeting_state, so the values (relationship, place, mood) match where the scene opens."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const REMIXES = {
  au: { label: "Alternate universe", ask: "Which universe?", placeholder: "e.g. modern-day college, space station, 1920s noir" },
  darker: { label: "Darker", ask: "Anything specific?", placeholder: "e.g. she made the deal with the demon" },
  older: { label: "Older", ask: "How much older?", placeholder: "e.g. twenty years later, in her fifties" },
  genderswap: { label: "Genderswap", ask: "Anything specific?", placeholder: "e.g. keep the name" },
  custom: { label: "Your own", ask: "What changes?", placeholder: "e.g. she never left the convent" },
} as const;
export type RemixKind = keyof typeof REMIXES;

/** Asks the co-writer chat to turn a copied card into a remix of the original. */
export function remixRequest(name: string, kind: RemixKind, details: string): string {
  const what = {
    au: `an alternate-universe version of ${name}, set in ${details || "a different setting you choose"}`,
    darker: `a darker version of ${name}${details ? `: ${details}` : ""}`,
    older: `an older version of ${name}${details ? `: ${details}` : ", some years later"}`,
    genderswap: `a genderswapped version of ${name}${details ? ` (${details})` : ""}`,
    custom: `a version of ${name} where ${details || "something important went differently"}`,
  }[kind];
  return [
    `This card is a copy of ${name}. Turn it into ${what}.`,
    "Keep {{char}}'s voice: the same way of speaking, humour, habits and core personality, changed only where the remix itself changes them. Rewrite every field that needs it, the greetings and the example dialogues, and update or replace lorebook entries that no longer fit. Start with the description, then go field by field.",
    "Characters in sexual content are adults, with their ages stated.",
  ].join("\n\n");
}

/** Asks for world page pitches of one kind. */
export function worldPitchRequest(opts: { many: string; existing: string[]; count: number; ask: string }): string {
  return [
    opts.existing.length ? `Already on this page: ${opts.existing.join(", ")}.` : "This page is empty so far.",
    opts.ask.trim()
      ? `Pitch ${opts.count} ${opts.many}. The user asks: ${opts.ask.trim()}`
      : `Pitch ${opts.count} ${opts.many} this world needs, starting with any the card mentions that aren't on the page yet.`,
  ].join("\n\n");
}

/** Asks the co-writer to file plain lorebook entries under the world pages. */
export function sortLorebookRequest(entries: { id: string; title: string; keys: string[]; content: string }[]): string {
  return [
    entries
      .map((e) => `<entry id="${e.id}" title="${e.title.replace(/"/g, "'")}" keys="${e.keys.join(", ").replace(/"/g, "'")}">\n${e.content}\n</entry>`)
      .join("\n\n"),
    "These lorebook entries were written as plain text. File each one with file_world: npc for a single person, location for a single place, item for an item or service, shop for a shop or trader, other for anything else (factions, groups, rules, events, history, several things at once). For npc, location, item and shop, fill the fields from the entry: keep every fact it states, in the field it fits, and put the rest in notes (details for a place). Don't invent anything. The name is what the entry is about; other names and keys it should trigger on go in aliases.",
  ].join("\n\n");
}

/** Asks the co-writer to put names a turn mentioned onto the world pages. */
export function mentionScanRequest(names: string[], newText: string): string {
  return `<proposed_edits>\n${newText}\n</proposed_edits>\n\nThe card and the edits proposed for it mention ${names.map((n) => `"${n}"`).join(", ")}, with no lorebook entry yet. Add each one with file_world: an NPC for a person, a place, an item or a shop, or other for anything else. Fill the fields from what the card says about them; where it says nothing, keep the field short and consistent with the card, or leave it empty.`;
}

/** Asks for the NPCs the card already establishes, to fill the NPC page from it. */
export function npcScanRequest(existing: string[]): string {
  return [
    existing.length ? `Already on the NPC page: ${existing.join(", ")}.` : "The NPC page is empty so far.",
    "Find every character the card already establishes besides {{char}} and {{user}}: in the description, personality, scenario, greetings, example dialogues, lorebook entries, the story bible and the project's world. Pitch each one not on the page yet with the pitch tool, filling the fields from what the card says about them. Where the card says nothing, keep the field short and consistent with the card, or leave it empty; don't invent new people. Unnamed but recurring figures (the innkeeper, the captain) count, named by their role. If there are none, pitch nothing.",
  ].join("\n\n");
}

/** Opens the currency interview. */
export function currencyKickoff(idea: string): string {
  return [
    "Interview me to build this world's currency and economy. Money is a real part of play here, so it has to be concrete and usable.",
    idea.trim() ? `My idea: ${idea.trim()}` : "I have no idea yet: suggest what fits the world.",
    "Ask a single round of 5 or 6 questions with ask_questions covering the basics: the coin itself (name, metal or material, look, denominations and how they convert), what a day's wage is and what everyday things cost, who issues money and how scarce it is, and how people deal in it (barter, credit, debt, banks, forgery, foreign coin). Suggestions must fit the card and the world.",
  ].join("\n\n");
}

/** Asks for the currency, from the interview. */
export function currencyWriteRequest(answers: string): string {
  return `<interview>\n${answers}\n</interview>\n\nWrite the currency with the pitch tool: one currency, every field filled, with concrete numbers. Give a handful of reference prices (a meal, a night's lodging, a weapon, a horse) in the wages field. Where an answer is "${YOU_DECIDE}", decide it yourself.`;
}

export const ITEM_PRICES = ["cheap", "low", "average", "high", "expensive", "mixed"] as const;
export const ITEM_QUALITIES = ["poor", "average", "fine", "masterwork", "mixed"] as const;
export const ITEM_RARITIES = ["common", "uncommon", "rare", "unique", "mixed"] as const;

export interface BulkItemSettings {
  what: string;
  count: number;
  price: (typeof ITEM_PRICES)[number];
  quality: (typeof ITEM_QUALITIES)[number];
  rarity: (typeof ITEM_RARITIES)[number];
  service: boolean;
  /** Where they're sold; empty lets the co-writer pick. */
  shop: string;
  notes: string;
}

/** Asks for a batch of items or services made to the user's settings. */
export function bulkItemsRequest(o: BulkItemSettings, existing: string[]): string {
  const mixed = (v: string, what: string) => (v === "mixed" ? `a spread of ${what}` : `${v} ${what}`);
  return [
    existing.length ? `Already on the page: ${existing.join(", ")}.` : "",
    `Make ${o.count} ${o.service ? "services" : "items"}: ${o.what.trim() || "whatever this world's markets need"}.`,
    [
      `Price: ${o.price === "mixed" ? "a spread from cheap to expensive" : `${o.price} for the world`}, in the world's currency, against its wages and existing prices.`,
      `Quality: ${mixed(o.quality, "quality")}.`,
      `Rarity: ${mixed(o.rarity, "rarity")}.`,
      o.service
        ? 'They are services (something done for {{user}}, like healing or lodging), so set type to "service".'
        : 'They are goods, so set type to "item".',
      o.shop.trim() ? `Sold at: ${o.shop.trim()}.` : "Say who sells each one, using the world's shops where they fit.",
      o.notes.trim() && `Also: ${o.notes.trim()}`,
    ]
      .filter(Boolean)
      .join("\n"),
    `Pitch exactly ${o.count} with the pitch tool, every field filled. Each needs a distinct name and a concrete effect; no duplicates of what's already on the page.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Story arcs

/** The arc settings, spelled out for the co-writer. */
export function arcSettingsText(settings: ArcSettings): string {
  const lines = (Object.keys(ARC_OPTIONS) as ArcSettingKey[]).map((key) => {
    const opt = ARC_OPTIONS[key];
    const [label, rule] = (opt.values as Record<string, readonly [string, string]>)[settings[key] as string];
    return `- ${opt.label}: ${label}. ${rule}`;
  });
  return [
    `<arc_settings>`,
    ...lines,
    `- Beats: ${settings.beats}`,
    settings.tone.trim() ? `- Tone for this arc: ${settings.tone.trim()}` : `- Tone: follow the project's tone.`,
    `</arc_settings>`,
  ].join("\n");
}

/** Asks for the whole arc. */
export function arcWriteRequest(settings: ArcSettings, antagonist: string, ask: string): string {
  return [
    arcSettingsText(settings),
    antagonist && `<antagonist>\n${antagonist}\n</antagonist>`,
    ask.trim() && `What I want from this arc: ${ask.trim()}`,
    `Plot the story arc and hand it in with write_arc: a title, a premise of two or three sentences, exactly ${settings.beats} beats and the ending. Each beat has a short title, what happens (the situation and what's at stake), how the narrator should play it (pressure, clues, what NPCs do), and${antagonist ? " what the antagonist does in it" : ` an empty antagonist field`}. The first beat starts from the card's scenario.${settings.endings === "branching" ? " The ending lists two or three endings and the choices that lead to each." : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Opens the antagonist interview. */
export function antagonistKickoff(settings: ArcSettings, idea: string): string {
  return [
    arcSettingsText(settings),
    "Interview me to build the antagonist of this story arc: the person who moves against {{user}}.",
    idea.trim() ? `My idea: ${idea.trim()}` : "I have no idea yet: help me find one that fits the card.",
    "Ask a single round of 5 or 6 questions with ask_questions: who they are, what they want and why, their methods and resources, how they move against {{user}} as the story goes, and their secret or weakness. Suggestions must fit the card and the arc settings.",
  ].join("\n\n");
}

/** Asks for the antagonist, from the interview or with no interview at all. */
export function antagonistWriteRequest(settings: ArcSettings, answers: string): string {
  return [
    arcSettingsText(settings),
    answers ? `<interview>\n${answers}\n</interview>` : "The user leaves the antagonist entirely to you and won't read it before playing, so surprise them.",
    `Write the antagonist with write_antagonist, filling every field. They are an adult; state their age. Where an answer is "${YOU_DECIDE}", decide it yourself.`,
  ].join("\n\n");
}

// Mechanics

/** Opens the Game Wizard's questions about a mechanic. */
export function mechanicKickoff(description: string, existing: string): string {
  return [
    existing && `<existing_modules>\n${existing}\n</existing_modules>`,
    `The mechanic I want: ${description.trim()}`,
    "Ask a single round of 3 to 5 questions with ask_questions about what you need to write it well: how values start and change, what happens at the limits, when it matters in the story, and how it ties into what already exists. Skip anything the description or the card already answers.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Asks for the module itself. */
export function moduleWriteRequest(opts: {
  description: string;
  answers: string;
  existing: string;
  images: string[];
  conflicts?: string;
}): string {
  return [
    opts.existing && `<existing_modules>\n${opts.existing}\n</existing_modules>`,
    `The mechanic: ${opts.description.trim()}`,
    opts.answers && `<interview>\n${opts.answers}\n</interview>`,
    opts.images.length > 0 &&
      `Images in the card the module can show (by name): ${opts.images.join(", ")}. Use them only where they clearly fit; otherwise leave images empty.`,
    opts.conflicts && `Your last version contradicted the existing modules:\n${opts.conflicts}\nWrite it again so it fits them.`,
    `Write the module with write_module, choosing its trigger setup yourself. Logic is how the secondary keys combine with the keys: ${LOGIC_NAMES.join(", ")}. Where an answer is "${YOU_DECIDE}", decide it yourself.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Asks whether a module contradicts the others, or whether the modules contradict each other. */
export function conflictCheckRequest(existing: string, candidate?: string): string {
  return [
    existing ? `<existing_modules>\n${existing}\n</existing_modules>` : "There are no other modules yet.",
    candidate && `<new_module>\n${candidate}\n</new_module>`,
    candidate
      ? "Check the new module against the existing modules, the status tracker and the card."
      : "Check these modules against each other, the status tracker and the card.",
    "Report every rule that contradicts another (different numbers for the same value, rules that can't both hold, two tags or labels for the same thing) with report_conflicts. Only real contradictions, not style. An empty list means they fit.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
