/** Stored co-writer data: per-project settings and per-card conversations. */
import type { StyleLock } from "../images/visual";
import type { ChatMessage, ToolCall } from "./types";

export type ContentMode = "normal" | "dark" | "unhinged";
export type InterviewDepth = "quick" | "standard" | "deep";
export type SuggestionLevel = "quiet" | "balanced" | "lots";

export interface CowriterSettings {
  contentMode: ContentMode;
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
  contentMode: "normal",
  tone: "",
  genre: "",
  depth: "standard",
  suggestions: "balanced",
  presetIds: [],
};

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
