/**
 * Tools for the interview, the gap analysis, the story bible and the answer brainstorm.
 * Unlike the card tools they don't edit the card: they hand structured results to the app.
 */
import { newId } from "../lib/id";
import { ANTAGONIST_FIELDS, type Antagonist, type Beat } from "../editor/arc";
import { cleanModule, LOGIC_NAMES, type MechanicModule, type TrackedValue } from "../editor/mechanics";
import { KINDS, type WorldKind } from "../editor/world";
import type { GapMemo, Question } from "./records";
import type { ToolCall, ToolDef } from "./types";

const str = (description: string) => ({ type: "string", description });
const list = (description: string) => ({ type: "array", items: { type: "string" }, description });
const obj = (properties: Record<string, unknown>, required: string[]): ToolDef["parameters"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ASK_QUESTIONS: ToolDef = {
  name: "ask_questions",
  description:
    "Ask the user the next round of interview questions. Each question gets 3 or 4 suggested answers that are concrete, distinct and ready to use as they are. The user picks one, writes their own, or leaves it to you.",
  parameters: obj(
    {
      questions: {
        type: "array",
        items: obj(
          {
            theme: str("The theme, e.g. Core concept, Personality and voice, History, Relationships, World rules, Opening scene"),
            question: str("One clear question"),
            suggestions: list("3 or 4 suggested answers, each one or two sentences"),
          },
          ["theme", "question", "suggestions"],
        ),
      },
    },
    ["questions"],
  ),
};

export const NOTE_FACTS: ToolDef = {
  name: "note_facts",
  description:
    "Record facts that are now decided, for the user's \"what I know so far\" list. Short, specific statements. Only new facts; correct an old one by noting the corrected version.",
  parameters: obj({ facts: list("New decided facts") }, ["facts"]),
};

export const FINISH_INTERVIEW: ToolDef = {
  name: "finish_interview",
  description: "Call when you know enough to write the whole card. The interview moves on.",
  parameters: obj({}, []),
};

export const WRITE_MEMO: ToolDef = {
  name: "write_memo",
  description: "Hand in the gap analysis memo. Each item is one short sentence.",
  parameters: obj(
    {
      missing: list("Things a good card needs that aren't decided yet"),
      vague: list("Answers too vague to write from"),
      contradictions: list("Facts that clash with each other"),
      opportunities: list("What the story could use: a rival, a secret, a reason to stay, a hook"),
      clean: { type: "boolean", description: "True when nothing important is missing, vague or contradictory" },
    },
    ["missing", "vague", "contradictions", "opportunities", "clean"],
  ),
};

export const WRITE_BIBLE: ToolDef = {
  name: "write_story_bible",
  description: "Hand in the story bible: every decided fact, grouped by section.",
  parameters: obj(
    {
      sections: {
        type: "array",
        items: obj({ title: str("Section title"), facts: list("Decided facts, one per item") }, ["title", "facts"]),
      },
    },
    ["sections"],
  ),
};

/** The interviewer's tools. The bible tool is always offered so the tool list never changes mid-conversation. */
export const INTERVIEW_TOOLS = [ASK_QUESTIONS, NOTE_FACTS, FINISH_INTERVIEW, WRITE_BIBLE];

export const SUGGEST_ANSWERS: ToolDef = {
  name: "suggest_answers",
  description: "Pitch answer ideas for the question. Each is ready to use as the answer.",
  parameters: obj(
    {
      ideas: {
        type: "array",
        items: obj({ title: str("A few words"), answer: str("The answer as it would be given, one to four sentences") }, [
          "title",
          "answer",
        ]),
      },
    },
    ["ideas"],
  ),
};

export const FINAL_ANSWER: ToolDef = {
  name: "final_answer",
  description: "Write up the final answer the user settled on, ready to use.",
  parameters: obj({ answer: str("The answer, one to four sentences") }, ["answer"]),
};

export const BRAINSTORM_TOOLS = [SUGGEST_ANSWERS, FINAL_ANSWER];

// Reading tool input. Models sometimes send slightly wrong shapes, so read leniently.

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function readQuestions(call: ToolCall): Question[] {
  const raw = Array.isArray(call.input.questions) ? (call.input.questions as Record<string, unknown>[]) : [];
  return raw
    .filter((q) => q && typeof q === "object" && text(q.question))
    .map((q) => ({ id: newId(), theme: text(q.theme), question: text(q.question), suggestions: strings(q.suggestions) }));
}

export const readFacts = (call: ToolCall) => strings(call.input.facts);

export function readMemo(call: ToolCall): GapMemo {
  const i = call.input;
  const memo = {
    missing: strings(i.missing),
    vague: strings(i.vague),
    contradictions: strings(i.contradictions),
    opportunities: strings(i.opportunities),
  };
  const empty = !memo.missing.length && !memo.vague.length && !memo.contradictions.length;
  return { ...memo, clean: i.clean === true || empty };
}

export function readBible(call: ToolCall): string {
  const sections = Array.isArray(call.input.sections) ? (call.input.sections as Record<string, unknown>[]) : [];
  return sections
    .filter((s) => s && typeof s === "object")
    .map((s) => `## ${text(s.title) || "Notes"}\n${strings(s.facts).map((f) => `- ${f}`).join("\n")}`)
    .join("\n\n");
}

export function readIdeas(call: ToolCall): { title: string; answer: string }[] {
  if (call.name === FINAL_ANSWER.name) {
    const answer = text(call.input.answer);
    return answer ? [{ title: "Final answer", answer }] : [];
  }
  const raw = Array.isArray(call.input.ideas) ? (call.input.ideas as Record<string, unknown>[]) : [];
  return raw
    .filter((i) => i && typeof i === "object" && text(i.answer))
    .map((i) => ({ title: text(i.title), answer: text(i.answer) }));
}

/** The memo as text, for the user and for the interviewer. */
export function memoText(memo: GapMemo): string {
  const part = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : "");
  return [
    part("Missing", memo.missing),
    part("Vague", memo.vague),
    part("Contradictions", memo.contradictions),
    part("Could use", memo.opportunities),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const WRITE_PERSONA: ToolDef = {
  name: "write_persona",
  description: "Hand in the finished persona.",
  parameters: obj(
    {
      name: str("The persona's name"),
      description: str("The persona description, 100 to 300 tokens"),
    },
    ["name", "description"],
  ),
};

export function readPersona(call: ToolCall): { name: string; description: string } {
  return { name: text(call.input.name), description: text(call.input.description) };
}

export const WRITE_IMAGE_PROMPT: ToolDef = {
  name: "write_image_prompt",
  description: "Hand in the image prompt.",
  parameters: obj({ positive: str("The prompt"), negative: str("The negative prompt") }, ["positive", "negative"]),
};

export function readImagePrompt(call: ToolCall): { positive: string; negative: string } {
  return { positive: text(call.input.positive), negative: text(call.input.negative) };
}

export const SORT_GREETINGS: ToolDef = {
  name: "sort_greetings",
  description: "Hand in the mood, place and relationship stage of every greeting.",
  parameters: obj(
    {
      greetings: {
        type: "array",
        items: obj(
          {
            index: { type: "integer", description: "The greeting's index" },
            mood: str("One of the moods"),
            place: str("One of the places, or a short place name"),
            stage: str("One of the relationship stages"),
          },
          ["index", "mood", "place", "stage"],
        ),
      },
    },
    ["greetings"],
  ),
};

export interface GreetingTag {
  mood: string;
  place: string;
  stage: string;
}

export function readGreetingTags(call: ToolCall): Map<number, GreetingTag> {
  const out = new Map<number, GreetingTag>();
  const items = Array.isArray(call.input.greetings) ? call.input.greetings : [];
  for (const item of items as Record<string, unknown>[]) {
    const index = Number(item?.index);
    if (!Number.isInteger(index)) continue;
    out.set(index, { mood: text(item.mood), place: text(item.place), stage: text(item.stage) });
  }
  return out;
}

/** The pitch tool for one world page; every field is a string. */
export function pitchWorldTool(kind: WorldKind): ToolDef {
  const def = KINDS[kind];
  return {
    name: "pitch",
    description: `Pitch ${def.many} for the user to add.`,
    parameters: obj(
      {
        items: {
          type: "array",
          items: obj(
            Object.fromEntries(def.fields.map((f) => [f.key, str(f.hint)])),
            def.fields.map((f) => f.key),
          ),
        },
      },
      ["items"],
    ),
  };
}

export function readWorldPitches(call: ToolCall, kind: WorldKind): Record<string, string>[] {
  const items = Array.isArray(call.input.items) ? (call.input.items as Record<string, unknown>[]) : [];
  return items
    .map((item) => Object.fromEntries(KINDS[kind].fields.map((f) => [f.key, text(item?.[f.key])])))
    .filter((f) => f.name);
}

export const WRITE_ARC: ToolDef = {
  name: "write_arc",
  description: "Hand in the story arc.",
  parameters: obj(
    {
      title: str("The arc's title"),
      premise: str("What the arc is about, two or three sentences"),
      beats: {
        type: "array",
        items: obj(
          {
            title: str("A short title for the beat"),
            summary: str("What happens: the situation and what's at stake, two or three sentences"),
            direction: str("How the narrator plays it: pressure, clues, what NPCs do; never what {{user}} does"),
            antagonist: str("What the antagonist does in this beat, or empty"),
          },
          ["title", "summary", "direction", "antagonist"],
        ),
      },
      ending: str("The ending, or the endings and the choices that lead to each"),
    },
    ["title", "premise", "beats", "ending"],
  ),
};

export function readArcDraft(call: ToolCall): { title: string; premise: string; beats: Beat[]; ending: string } {
  const beats = Array.isArray(call.input.beats) ? (call.input.beats as Record<string, unknown>[]) : [];
  return {
    title: text(call.input.title),
    premise: text(call.input.premise),
    beats: beats
      .map((b) => ({
        title: text(b?.title),
        summary: text(b?.summary),
        direction: text(b?.direction),
        antagonist: text(b?.antagonist),
      }))
      .filter((b) => b.title || b.summary),
    ending: text(call.input.ending),
  };
}

export const WRITE_ANTAGONIST: ToolDef = {
  name: "write_antagonist",
  description: "Hand in the antagonist.",
  parameters: obj(
    Object.fromEntries(ANTAGONIST_FIELDS.map((f) => [f.key, str(f.hint)])),
    ANTAGONIST_FIELDS.map((f) => f.key),
  ),
};

export function readAntagonist(call: ToolCall): Antagonist {
  return Object.fromEntries(ANTAGONIST_FIELDS.map((f) => [f.key, text(call.input[f.key])])) as unknown as Antagonist;
}

const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

export const WRITE_MODULE: ToolDef = {
  name: "write_module",
  description: "Hand in the mechanics module.",
  parameters: obj(
    {
      name: str("A short name, e.g. Mana"),
      tag: str("The XML tag: lower case with underscores, e.g. mana"),
      summary: str("What the module does, in one line"),
      rules: str("The rules, positive and concrete, 50 to 200 tokens, without the tag"),
      example: str("A one-line example of correct narrator output following the rules"),
      activation: { type: "string", enum: ["always", "keyed"], description: "always: in every prompt. keyed: only when its keys come up" },
      keys: list("Words in the chat that bring the module up; empty when always on"),
      secondary_keys: list("Optional words that refine the keys"),
      logic: { type: "string", enum: LOGIC_NAMES, description: "How secondary keys combine with the keys" },
      depth: int("Depth in the chat: 3 or 4 for core rules, 1 or 2 for something happening right now; never 0"),
      sticky: int("Messages the module stays after its keys come up, 0 for none"),
      cooldown: int("Messages before it can come up again after it ends, 0 for none"),
      group: str("Inclusion group shared with the other modes (e.g. mode), or empty"),
      exclude_recursion: bool("True if other lorebook entries must not bring it up"),
      prevent_recursion: bool("True if its text must not bring up other entries"),
      priority: int("1 to 5; higher sits later in its depth and gets more attention"),
      tracked: {
        type: "array",
        description: "Values to track in the status block; empty if none",
        items: obj(
          {
            label: str("The value's label, e.g. Mana"),
            kind: { type: "string", enum: ["bar", "number", "text", "list"], description: "bar has a maximum" },
            start: str("The starting value"),
            max: int("The maximum, for a bar; 0 otherwise"),
            rule: str("When and how it changes, one line"),
          },
          ["label", "kind", "start", "max", "rule"],
        ),
      },
      images: {
        type: "array",
        description: "Images from the card to show, by name; usually empty",
        items: obj({ name: str("The image's name"), when: str("When to show it") }, ["name", "when"]),
      },
    },
    [
      "name",
      "tag",
      "summary",
      "rules",
      "example",
      "activation",
      "keys",
      "secondary_keys",
      "logic",
      "depth",
      "sticky",
      "cooldown",
      "group",
      "exclude_recursion",
      "prevent_recursion",
      "priority",
      "tracked",
      "images",
    ],
  ),
};

/** The module from write_module. Images are matched to the card's assets by name. */
export function readModule(call: ToolCall, assets: { uri: string; name: string }[]): MechanicModule {
  const i = call.input;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return cleanModule({
    name: text(i.name),
    tag: text(i.tag),
    summary: text(i.summary),
    rules: text(i.rules),
    example: text(i.example),
    activation: i.activation === "always" ? "always" : "keyed",
    keys: strings(i.keys),
    secondaryKeys: strings(i.secondary_keys),
    logic: Math.max(0, LOGIC_NAMES.indexOf(text(i.logic))),
    depth: Number(i.depth),
    sticky: Number(i.sticky),
    cooldown: Number(i.cooldown),
    group: text(i.group),
    excludeRecursion: i.exclude_recursion === true,
    preventRecursion: i.prevent_recursion === true,
    priority: Number(i.priority),
    tracked: arr(i.tracked).map((t) => ({
      label: text(t.label),
      kind: text(t.kind) as TrackedValue["kind"],
      start: text(t.start),
      max: Number(t.max) || undefined,
      rule: text(t.rule),
    })),
    images: arr(i.images).flatMap((img) => {
      const asset = assets.find((a) => a.name.toLowerCase() === text(img.name).toLowerCase());
      return asset ? [{ uri: asset.uri, when: text(img.when) }] : [];
    }),
  });
}

export const REPORT_CONFLICTS: ToolDef = {
  name: "report_conflicts",
  description: "Report contradictions between the rules. An empty list means they fit together.",
  parameters: obj(
    {
      conflicts: {
        type: "array",
        items: obj(
          {
            modules: list("The names of the modules involved"),
            problem: str("What contradicts what, in one sentence"),
            fix: str("How to fix it, in one sentence"),
          },
          ["modules", "problem", "fix"],
        ),
      },
    },
    ["conflicts"],
  ),
};

export interface Conflict {
  modules: string[];
  problem: string;
  fix: string;
}

export function readConflicts(call: ToolCall): Conflict[] {
  const items = Array.isArray(call.input.conflicts) ? (call.input.conflicts as Record<string, unknown>[]) : [];
  return items.map((c) => ({ modules: strings(c?.modules), problem: text(c?.problem), fix: text(c?.fix) })).filter((c) => c.problem);
}
