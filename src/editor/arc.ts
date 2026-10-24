/**
 * Story arc: plot beats as lorebook entries that move the story on their own in SillyTavern.
 *
 * Every beat is a constant entry in one inclusion group with "prioritize inclusion" on, and each
 * later beat has a longer delay (in chat messages) and a higher order. So only the latest beat the
 * chat has reached is ever in the prompt, and the story advances with no extension. A rules entry
 * tells the narrator how hard the story pushes back, who can die, and how secret to keep it.
 */
import type { CardDataV3, Lorebook, LorebookEntry } from "../card";
import { estimateTokens } from "../lib/tokens";
import { emptyBook, newEntry, withStPosition } from "./lorebook";

export const ARC_OPTIONS = {
  difficulty: {
    label: "Difficulty",
    values: {
      easy: ["Easy", "Obstacles are light and setbacks are short; {{user}} usually gets what they try for."],
      fair: ["Fair", "Obstacles are real but fair; plans can fail, and success takes effort and good choices."],
      hard: ["Hard", "The world pushes back hard: plans go wrong, help comes at a price, and {{user}} can genuinely fail."],
      brutal: ["Brutal", "The world is merciless: every gain costs something, enemies are smart, and failure is likely unless {{user}} plays well."],
    },
  },
  death: {
    label: "Death",
    values: {
      off: ["Off", "No one dies; danger ends in capture, injury or escape instead."],
      user: ["{{user}} can die", "{{user}} can die if they make fatal choices or lose a deadly fight; don't rescue them by coincidence. Named NPCs survive."],
      npcs: ["NPCs can die", "NPCs, including ones {{user}} cares about, can die for real; {{user}} survives, at a cost."],
      anyone: ["Anyone (permadeath)", "Anyone can die for real, {{user}} included. Death is permanent; when {{user}} dies, narrate it and end the story."],
    },
  },
  failure: {
    label: "Failure",
    values: {
      soft: ["Soft", "Failure is a detour: it costs time or opens a harder path, but the story goes on much the same."],
      lasting: ["Lasting", "Failure leaves marks: wounds, lost allies, lost items and closed doors stay lost."],
      defeat: ["Can end in defeat", "Failure can be final: if {{user}} fails the arc's key moments, the arc ends in defeat and you narrate what that means."],
    },
  },
  pacing: {
    label: "Pacing",
    values: {
      slow: ["Slow", "Let scenes breathe; each beat lasts about 30 messages."],
      steady: ["Steady", "Each beat lasts about 20 messages."],
      fast: ["Fast", "Each beat lasts about 12 messages; keep the pressure on."],
    },
  },
  endings: {
    label: "Endings",
    values: {
      fixed: ["One ending", "The arc builds toward one fixed ending."],
      branching: ["Branches", "How the arc ends depends on {{user}}'s choices; the last beat has more than one ending."],
    },
  },
  twists: {
    label: "Twists",
    values: {
      none: ["None", "No twists: the story is what it seems."],
      few: ["A few", "One or two twists that recolour what came before, set up with fair clues."],
      lots: ["A lot", "Several twists, including at least one betrayal by someone {{user}} trusts, each set up with fair clues."],
    },
  },
  antagonist: {
    label: "Antagonist",
    values: {
      none: ["None", "There is no single villain; the trouble comes from circumstances."],
      hidden: ["Hidden", "The antagonist works from the shadows; keep who they are hidden until the beat that reveals them, but let their actions be felt."],
      active: ["Active", "The antagonist is known and openly moves against {{user}}, adapting to what {{user}} does."],
    },
  },
  secrecy: {
    label: "Secrecy",
    values: {
      secret: ["Fully secret", "Never reveal or hint at upcoming beats; {{user}} discovers everything through events."],
      hints: ["Hints only", "Never state upcoming beats, but foreshadow them through details, rumours and omens."],
      visible: ["Fully visible", "{{user}} knows where the story is heading; play it out openly."],
    },
  },
} as const;

type Options = typeof ARC_OPTIONS;
export type ArcSettingKey = keyof Options;

export interface ArcSettings {
  difficulty: keyof Options["difficulty"]["values"];
  death: keyof Options["death"]["values"];
  failure: keyof Options["failure"]["values"];
  pacing: keyof Options["pacing"]["values"];
  endings: keyof Options["endings"]["values"];
  twists: keyof Options["twists"]["values"];
  antagonist: keyof Options["antagonist"]["values"];
  secrecy: keyof Options["secrecy"]["values"];
  /** Number of beats. */
  beats: number;
  /** Overrides the project's tone for this arc; empty follows the project. */
  tone: string;
}

export const DEFAULT_ARC_SETTINGS: ArcSettings = {
  difficulty: "fair",
  death: "off",
  failure: "lasting",
  pacing: "steady",
  endings: "branching",
  twists: "few",
  antagonist: "hidden",
  secrecy: "hints",
  beats: 6,
  tone: "",
};

export const MESSAGES_PER_BEAT: Record<ArcSettings["pacing"], number> = { slow: 30, steady: 20, fast: 12 };

export interface Beat {
  title: string;
  /** What happens. */
  summary: string;
  /** How the narrator should play it. */
  direction: string;
  /** What the antagonist does in this beat. */
  antagonist: string;
}

export interface Antagonist {
  name: string;
  role: string;
  age: string;
  look: string;
  voice: string;
  goal: string;
  methods: string;
  /** How they move against {{user}} as the story goes. */
  moves: string;
  secret: string;
  aliases: string;
}

export const ANTAGONIST_FIELDS: { key: keyof Antagonist; label: string; hint: string; multiline?: boolean }[] = [
  { key: "name", label: "Name", hint: "their name" },
  { key: "role", label: "Role", hint: "who they are in the world, a few words" },
  { key: "age", label: "Age", hint: "their age; an adult" },
  { key: "look", label: "Look", hint: "two or three striking physical details" },
  { key: "voice", label: "Voice", hint: "how they talk: rhythm, word choice, a sample line", multiline: true },
  { key: "goal", label: "Goal", hint: "what they want and why, in their own eyes", multiline: true },
  { key: "methods", label: "Methods", hint: "how they get things done: resources, allies, tactics, limits", multiline: true },
  { key: "moves", label: "Moves against {{user}}", hint: "how they move against {{user}} as the story goes, escalating", multiline: true },
  { key: "secret", label: "Secret", hint: "a secret or weakness {{user}} could find", multiline: true },
  { key: "aliases", label: "Other names", hint: "other names or titles, comma-separated" },
];

export interface Arc {
  settings: ArcSettings;
  title: string;
  premise: string;
  beats: Beat[];
  /** The ending, or the endings by choice when the arc branches. */
  ending: string;
  antagonist?: Antagonist;
  /** Kept out of sight in CardForge until the user reveals it. The card file still has it. */
  hidden: boolean;
}

const EXT = "cardforge";
type ArcKind = "arc-rules" | "arc-beat" | "arc-antagonist";

export const newArc = (): Arc => ({
  settings: { ...DEFAULT_ARC_SETTINGS },
  title: "",
  premise: "",
  beats: [],
  ending: "",
  hidden: true,
});

export function readArc(data: CardDataV3): Arc | undefined {
  return (data.extensions[EXT] as { arc?: Arc } | undefined)?.arc;
}

const arcKind = (e: LorebookEntry) => {
  const kind = (e.extensions[EXT] as { kind?: string } | undefined)?.kind;
  return kind?.startsWith("arc-") ? (kind as ArcKind) : undefined;
};
export const isArcEntry = (e: LorebookEntry) => !!arcKind(e);

/**
 * Tokens the always-on entries put in every prompt. The arc's beats are all constant, but only one
 * of them is in the prompt at a time, so only the longest counts.
 */
export function constantTokens(entries: LorebookEntry[]): number {
  let beat = 0;
  let rest = 0;
  for (const e of entries) {
    if (!e.enabled || !e.constant) continue;
    const tokens = estimateTokens(e.content);
    if (arcKind(e) === "arc-beat") beat = Math.max(beat, tokens);
    else rest += tokens;
  }
  return rest + beat;
}

/** True when the arc's entries should be kept out of sight in CardForge. */
export const arcHidden = (data: CardDataV3) => !!readArc(data)?.hidden;

const say = <K extends ArcSettingKey>(key: K, value: string) =>
  (ARC_OPTIONS[key].values as Record<string, readonly [string, string]>)[value]?.[1] ?? "";

export function rulesText(arc: Arc): string {
  const s = arc.settings;
  const lines = [
    `<story_arc_rules title="${arc.title}">`,
    `You are running a story arc. Follow the active <story_beat>: steer toward it through events, NPCs and consequences, never by narrating past {{user}}'s choices, and let {{user}}'s choices shape how it plays out.`,
    `Difficulty: ${say("difficulty", s.difficulty)}`,
    `Death: ${say("death", s.death)}`,
    `Failure: ${say("failure", s.failure)}`,
    `Twists: ${say("twists", s.twists)}`,
    `Antagonist: ${say("antagonist", s.antagonist)}`,
    `Secrecy: ${say("secrecy", s.secrecy)}`,
    s.tone.trim() && `Tone for this arc: ${s.tone.trim()}`,
    `</story_arc_rules>`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function beatText(arc: Arc, i: number): string {
  const b = arc.beats[i];
  const last = i === arc.beats.length - 1;
  return [
    `<story_beat n="${i + 1}" of="${arc.beats.length}" title="${b.title}">`,
    b.summary && `What happens: ${b.summary}`,
    b.direction && `How to play it: ${b.direction}`,
    b.antagonist && arc.antagonist && `${arc.antagonist.name}: ${b.antagonist}`,
    last && arc.ending && `${arc.settings.endings === "branching" ? "Endings" : "Ending"}: ${arc.ending}`,
    `</story_beat>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function antagonistText(a: Antagonist): string {
  return [
    `<antagonist name="${a.name}">`,
    `${a.name}${a.role ? ` (${a.role})` : ""}${a.age ? `, ${a.age}` : ""}`,
    a.look && `Look: ${a.look}`,
    a.voice && `Voice: ${a.voice}`,
    a.goal && `Goal: ${a.goal}`,
    a.methods && `Methods: ${a.methods}`,
    a.moves && `Moves against {{user}}: ${a.moves}`,
    a.secret && `Secret: ${a.secret}`,
    `</antagonist>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function atDepth(entry: LorebookEntry, depth: number, extra: Record<string, unknown> = {}): LorebookEntry {
  const e = withStPosition(entry, 4);
  return { ...e, extensions: { ...e.extensions, depth, role: 0, ...extra } };
}

/** Writes the arc into the card: its settings and its lorebook entries. `undefined` removes it. */
export function applyArc(data: CardDataV3, arc: Arc | undefined): CardDataV3 {
  const book: Lorebook = data.character_book ?? emptyBook();
  const kept = book.entries.filter((e) => !isArcEntry(e));
  const draft: Lorebook = { ...book, entries: kept };
  const ours: LorebookEntry[] = [];
  const add = (e: LorebookEntry) => {
    ours.push(e);
    draft.entries = [...draft.entries, e];
  };
  const tag = (kind: ArcKind) => ({ [EXT]: { kind } });

  if (arc && arc.beats.length) {
    add(
      atDepth(
        newEntry(draft, { comment: "Story arc: rules", constant: true, insertion_order: 190, content: rulesText(arc), extensions: tag("arc-rules") }),
        4,
      ),
    );
    const per = MESSAGES_PER_BEAT[arc.settings.pacing];
    arc.beats.forEach((_, i) =>
      add(
        atDepth(
          newEntry(draft, {
            comment: `Story arc: beat ${i + 1}`,
            constant: true,
            insertion_order: 200 + i,
            content: beatText(arc, i),
            extensions: tag("arc-beat"),
          }),
          4,
          { group: "story_arc", group_override: true, group_weight: 100, delay: i * per },
        ),
      ),
    );
    const a = arc.antagonist;
    if (a?.name.trim() && arc.settings.antagonist !== "none") {
      const keys = [a.name.trim(), ...a.aliases.split(",").map((k) => k.trim())].filter(Boolean);
      add(
        atDepth(
          newEntry(draft, {
            comment: "Story arc: antagonist",
            keys,
            // A hidden antagonist still acts every turn, so the narrator always knows their plan.
            constant: arc.settings.antagonist === "hidden",
            insertion_order: 195,
            content: antagonistText(a),
            extensions: tag("arc-antagonist"),
          }),
          4,
        ),
      );
    }
  }

  const extensions: Record<string, unknown> = { ...data.extensions };
  const cf = { ...(extensions[EXT] as Record<string, unknown> | undefined) };
  if (arc) cf.arc = arc;
  else delete cf.arc;
  if (Object.keys(cf).length) extensions[EXT] = cf;
  else delete extensions[EXT];

  const entries = [...kept, ...ours];
  return { ...data, extensions, character_book: entries.length || data.character_book ? { ...book, entries } : undefined };
}
