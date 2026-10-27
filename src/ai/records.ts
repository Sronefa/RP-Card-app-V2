/** Stored co-writer data: per-project settings and per-card conversations. */
import type { StyleLock } from "../images/visual";
import type { ChatMessage, ToolCall } from "./types";

/** The old single content mode, read only to migrate projects saved before the two levels. */
export type ContentMode = "normal" | "dark" | "unhinged";
/** How dark the writing goes. Off with unhinged off is Normal. */
export type DarkLevel = "off" | "dark" | "horror" | "deaddove";
/** How much sex the writing pushes. Combines with any dark level. */
export type UnhingedLevel = "off" | "normal" | "absolute";

/** How the prose reads. Missing values leave the choice to the co-writer. */
export interface ProseSettings {
  pov?: "second" | "third";
  tense?: "past" | "present";
  /** Target length of the character's replies, which the greetings set. */
  length?: "short" | "medium" | "long";
  dialogue?: "light" | "balanced" | "heavy";
  register?: "plain" | "literary" | "pulpy" | "poetic";
  rhythm?: "varied" | "punchy" | "flowing";
  /** For NSFW projects. */
  explicitness?: "suggestive" | "explicit" | "graphic";
  format?: "asterisks" | "quotes" | "plain";
}
export type InterviewDepth = "quick" | "standard" | "deep";
export type SuggestionLevel = "quiet" | "balanced" | "lots";

export interface CowriterSettings {
  /** Legacy: projects saved before the dark and unhinged levels. */
  contentMode?: ContentMode;
  dark: DarkLevel;
  unhinged: UnhingedLevel;
  prose?: ProseSettings;
  /** Style samples from the library the co-writer imitates in this project. */
  styleSampleIds?: string[];
  /** Craft packs turned on by hand, besides the ones the genre and tone load. */
  craftPackIds?: string[];
  /** Run the prose editor over every drafted edit. */
  autoPolish?: boolean;
  /** Show the co-writer reference examples of strong card writing; on unless turned off. */
  referenceExamples?: boolean;
  /** One of the listed tones, or the user's own words. Empty means no preference. */
  tone: string;
  genre: string;
  depth: InterviewDepth;
  suggestions: SuggestionLevel;
  /** Prompt-library presets layered on top of the co-writer's own prompt. */
  presetIds: string[];
  /** "Built for the Immersive Engine": the co-writer writes for an MVU engine card from the start. */
  engineMode?: boolean;
  /** The project's art direction for every image prompt. */
  styleLock?: StyleLock;
}

export const DEFAULT_COWRITER: CowriterSettings = {
  dark: "off",
  unhinged: "off",
  tone: "",
  genre: "",
  depth: "standard",
  suggestions: "balanced",
  presetIds: [],
};

/** A project's stored co-writer settings with defaults filled in; old content modes become levels. */
export function withCowriterDefaults(stored?: Partial<CowriterSettings>): CowriterSettings {
  const { contentMode, ...rest } = stored ?? {};
  return {
    ...DEFAULT_COWRITER,
    ...rest,
    dark: rest.dark ?? (contentMode === "dark" ? "dark" : "off"),
    unhinged: rest.unhinged ?? (contentMode === "unhinged" ? "normal" : "off"),
  };
}

export const DARK_LABELS: Record<DarkLevel, string> = { off: "Off", dark: "Dark", horror: "Horror", deaddove: "Dead dove" };
export const UNHINGED_LABELS: Record<UnhingedLevel, string> = { off: "Off", normal: "Unhinged", absolute: "Absolutely unhinged" };

/** "Normal", "Horror", "Unhinged" or both, e.g. "Horror + Absolutely unhinged". */
export function contentLabel(s: Pick<CowriterSettings, "dark" | "unhinged">): string {
  const parts = [s.dark !== "off" && DARK_LABELS[s.dark], s.unhinged !== "off" && UNHINGED_LABELS[s.unhinged]].filter(Boolean);
  return parts.join(" + ") || "Normal";
}

export type ProposalStatus = "pending" | "accepted" | "rejected" | "failed";

/** An edit the co-writer proposed through a tool call, waiting for the user's decision. */
export interface Proposal {
  /** The tool call's id. */
  id: string;
  /** Numbered per chat, so the user and the co-writer can refer to "edit 3". */
  number: number;
  call: ToolCall;
  status: ProposalStatus;
  /** One-line description, as planned when proposed and when decided. */
  summary?: string;
  /** Why an accepted edit couldn't be applied, e.g. the text it patched has changed. */
  error?: string;
  /** Overused phrases rewritten before the user saw it. */
  fixed?: string[];
  /** The prose editor's changes, once polished. */
  polished?: string[];
}

export interface ChatRecord {
  cardId: string;
  messages: ChatMessage[];
  proposals: Proposal[];
  /** What the co-writer last saw of each context part, so unchanged parts aren't sent again. */
  sentContext: Record<string, string>;
  /** Decisions on proposals that haven't been reported to the co-writer yet. */
  unreported: string[];
  updatedAt: number;
}

export const newChat = (cardId: string): ChatRecord => ({
  cardId,
  messages: [],
  proposals: [],
  sentContext: {},
  unreported: [],
  updatedAt: Date.now(),
});

/** One interview question, with ready-made answers the user can pick. */
export interface Question {
  id: string;
  /** Theme it belongs to, e.g. "Personality and voice". */
  theme: string;
  question: string;
  suggestions: string[];
}

/** The answer sent when the user leaves a question to the co-writer. */
export const YOU_DECIDE = "(You decide.)";

export interface InterviewRound {
  /** Id of the ask_questions call that asked this round. */
  callId: string;
  questions: Question[];
  /** Answers by question id. Missing or empty means "you decide". */
  answers: Record<string, string>;
  submitted: boolean;
}

/** The gap analysis: what the interview hasn't settled yet. */
export interface GapMemo {
  missing: string[];
  vague: string[];
  contradictions: string[];
  /** What the story could use: a rival, a secret, a reason to stay. */
  opportunities: string[];
  /** Nothing important left open. */
  clean: boolean;
}

/**
 * Where the interview is. The co-writer works through `questions`, `gap`, `bible` and `draft`
 * on its own; the others wait for the user.
 */
export type InterviewStage = "questions" | "asking" | "gap" | "memo" | "bible" | "review" | "draft" | "done";

export interface InterviewRecord {
  cardId: string;
  /** Interview depth when it started, so changing the setting doesn't upset a running interview. */
  depth: InterviewDepth;
  stage: InterviewStage;
  /** The conversation with the interviewer. */
  messages: ChatMessage[];
  rounds: InterviewRound[];
  /** Rounds asked since the interview started or since the last gap memo. */
  phaseRounds: number;
  /** "What I know so far". */
  facts: string[];
  memos: GapMemo[];
  /** The story bible: every decided fact, the source of truth for drafting. */
  bible?: string;
  /** Edits drafted so far, kept so a failed group can be retried without redoing the others. */
  draft: { groups: string[]; calls: ToolCall[] };
  updatedAt: number;
}

export const newInterview = (cardId: string, depth: InterviewDepth): InterviewRecord => ({
  cardId,
  depth,
  stage: "questions",
  messages: [],
  rounds: [],
  phaseRounds: 0,
  facts: [],
  memos: [],
  draft: { groups: [], calls: [] },
  updatedAt: Date.now(),
});
