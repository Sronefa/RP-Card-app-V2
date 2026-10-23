/** Stored co-writer data: per-project settings and per-card conversations. */
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
