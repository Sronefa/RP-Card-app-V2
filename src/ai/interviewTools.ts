/**
 * Tools for the interview, the gap analysis, the story bible and the answer brainstorm.
 * Unlike the card tools they don't edit the card: they hand structured results to the app.
 */
import { newId } from "../lib/id";
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
