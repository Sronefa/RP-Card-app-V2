/**
 * The interview pipeline for the open card: question rounds, gap analysis and digging deeper,
 * the story bible, then drafting the card one field group at a time. The draft lands in the
 * co-writer chat as proposals. How many passes run depends on the project's interview depth.
 */
import { create } from "zustand";
import { useUi } from "../app/store";
import {
  ASK_QUESTIONS,
  FINISH_INTERVIEW,
  INTERVIEW_TOOLS,
  NOTE_FACTS,
  readBible,
  readFacts,
  readMemo,
  readQuestions,
  WRITE_BIBLE,
  WRITE_MEMO,
  memoText,
} from "../ai/interviewTools";
import {
  answersText,
  BIBLE_REQUEST,
  cardContext,
  digDeeperRequest,
  DRAFT_GROUPS,
  draftRequest,
  draftSource,
  gapRequest,
  interviewKickoff,
  settingsContext,
  systemPrompt,
} from "../ai/prompts";
import { newInterview, type InterviewRecord, type InterviewStage } from "../ai/records";
import { applyEdit, DRAFT_TOOLS, planEdit, ToolInputError } from "../ai/tools";
import type { ChatMessage, CompletionResult, ToolCall, ToolResult } from "../ai/types";
import type { CardDataV3 } from "../card";
import { deleteInterview, getInterview, saveInterview, type CardRecord } from "../db/db";
import { useEditor } from "../editor/store";
import { complete, isAbort, projectSettings } from "./engine";
import { useCowriter } from "./store";

/** Most question rounds before the interview moves on, at the start and after each gap memo. */
const ROUND_LIMITS = { quick: 1, standard: 4, deep: 10 } as const;
const DIG_ROUNDS = 1;
/** Most gap-analysis loops on Deep. */
const MAX_MEMOS = 4;

/** Stages the co-writer works through on its own. */
const MACHINE_STAGES: InterviewStage[] = ["questions", "gap", "bible", "draft"];

interface InterviewState {
  interview?: InterviewRecord;
  busy: boolean;
  /** What the co-writer is doing right now. */
  status: string;
  streaming: string;
  error?: string;
  load: (cardId: string) => Promise<void>;
  /** Starts a new interview, with the user's idea if they have one. */
  start: (premise: string) => Promise<void>;
  setAnswer: (questionId: string, answer: string) => void;
  /** Sends the current round's answers. With `finish`, no more questions are asked in this phase. */
  submit: (finish?: boolean) => Promise<void>;
  digDeeper: () => Promise<void>;
  /** Stops the gap analysis and writes the story bible. */
  enough: () => Promise<void>;
  setBible: (bible: string) => void;
  draft: () => Promise<void>;
  /** Continues whatever the co-writer was doing, e.g. after an error. */
  run: () => Promise<void>;
  stop: () => void;
  reset: () => Promise<void>;
}

let controller: AbortController | undefined;

function check(result: CompletionResult) {
  if (result.stop === "refusal") throw new Error("The model declined this request. Try again, or pick another model in Settings.");
  if (result.stop === "max_tokens") throw new Error("The reply was cut off because it hit the model's length limit.");
}

const reply = (result: CompletionResult): ChatMessage => ({
  role: "assistant",
  text: result.text,
  toolCalls: result.toolCalls,
  raw: result.raw,
});

/** Results for every call in a reply; `answers` is the result of the ask_questions call. */
function results(calls: ToolCall[], answers?: { callId: string; text: string }): ChatMessage[] {
  if (!calls.length) return [];
  const out = calls.map(
    (c): ToolResult => ({
      id: c.id,
      content:
        c.id === answers?.callId
          ? answers.text
          : c.name === NOTE_FACTS.name
            ? "Noted."
            : c.name === WRITE_BIBLE.name
              ? "Saved."
              : "OK.",
    }),
  );
  return [{ role: "tool", results: out }];
}

/** What comes after the question rounds, given the depth and how many gap memos there are. */
function afterQuestions(iv: InterviewRecord): InterviewStage {
  if (iv.depth === "quick") return "draft";
  if (iv.depth === "standard") return iv.memos.length === 0 ? "gap" : "bible";
  return iv.memos.length < MAX_MEMOS ? "gap" : "bible";
}

/** The card with the draft's edits so far applied, so later steps build on earlier ones. */
function withDraft(data: CardDataV3, calls: ToolCall[]): CardDataV3 {
  for (const call of calls) {
    try {
      data = applyEdit(data, planEdit(data, call));
    } catch (e) {
      if (!(e instanceof ToolInputError)) throw e;
    }
  }
  return data;
}

export const useInterview = create<InterviewState>((set, get) => {
  /** Saves the interview and shows it, if its card is still open. */
  function commit(iv: InterviewRecord) {
    iv = { ...iv, updatedAt: Date.now() };
    if (get().interview?.cardId === iv.cardId) set({ interview: iv });
    void saveInterview(iv);
    return iv;
  }

  const onText = (delta: string) => set({ streaming: get().streaming + delta });

  async function askStep(iv: InterviewRecord): Promise<InterviewRecord> {
    set({ status: iv.rounds.length ? "Reading your answers…" : "Preparing questions…" });
    const result = await complete("interview", {
      system: systemPrompt("interview"),
      messages: iv.messages,
      tools: INTERVIEW_TOOLS,
      signal: controller?.signal,
      onText,
    });
    check(result);
    const facts = result.toolCalls.filter((c) => c.name === NOTE_FACTS.name).flatMap(readFacts);
    const ask = result.toolCalls.find((c) => c.name === ASK_QUESTIONS.name);
    const questions = ask ? readQuestions(ask) : [];
    const next = { ...iv, messages: [...iv.messages, reply(result)], facts: [...iv.facts, ...facts] };
    if (ask && questions.length) {
      return {
        ...next,
        stage: "asking",
        rounds: [...iv.rounds, { callId: ask.id, questions, answers: {}, submitted: false }],
        phaseRounds: iv.phaseRounds + 1,
      };
    }
    const finished = result.toolCalls.some((c) => c.name === FINISH_INTERVIEW.name);
    if (!finished && !iv.rounds.some((r) => r.submitted))
      throw new Error("The co-writer didn't ask any questions. Try again, or pick another model in Settings.");
    return { ...next, messages: [...next.messages, ...results(result.toolCalls)], stage: afterQuestions(iv) };
  }

  async function gapStep(iv: InterviewRecord, record: CardRecord): Promise<InterviewRecord> {
    set({ status: "Looking for gaps…" });
    const { settings } = await projectSettings(record.projectId);
    const result = await complete("gap", {
      system: systemPrompt("gap"),
      messages: [{ role: "user", text: gapRequest(record.kind, settings, iv.rounds, iv.facts) }],
      tools: [WRITE_MEMO],
      signal: controller?.signal,
      onText,
    });
    check(result);
    const call = result.toolCalls.find((c) => c.name === WRITE_MEMO.name);
    const memo = call
      ? readMemo(call)
      : { missing: result.text ? [result.text] : [], vague: [], contradictions: [], opportunities: [], clean: !result.text };
    return { ...iv, memos: [...iv.memos, memo], stage: "memo" };
  }

  async function bibleStep(iv: InterviewRecord): Promise<InterviewRecord> {
    set({ status: "Writing the story bible…" });
    const messages: ChatMessage[] = [...iv.messages, { role: "user", text: BIBLE_REQUEST }];
    const result = await complete("interview", {
      system: systemPrompt("interview"),
      messages,
      tools: INTERVIEW_TOOLS,
      signal: controller?.signal,
      onText,
    });
    check(result);
    const call = result.toolCalls.find((c) => c.name === WRITE_BIBLE.name);
    const bible = call ? readBible(call) : result.text;
    if (!bible.trim()) throw new Error("The co-writer didn't write a story bible. Try again.");
    return {
      ...iv,
      messages: [...messages, reply(result), ...results(result.toolCalls)],
      bible,
      stage: "review",
    };
  }

  async function draftStep(iv: InterviewRecord, record: CardRecord): Promise<InterviewRecord> {
    const { settings, presets } = await projectSettings(record.projectId);
    const source = draftSource(iv.bible, iv.rounds, iv.facts);
    for (const [i, group] of DRAFT_GROUPS.entries()) {
      if (iv.draft.groups.includes(group.id)) continue;
      set({ status: `Drafting the ${group.label} (${i + 1} of ${DRAFT_GROUPS.length})…`, streaming: "" });
      const card = cardContext(withDraft(record.card.data, iv.draft.calls), record.kind);
      const text = `<settings>\n${settingsContext(settings, presets)}\n</settings>\n\n${draftRequest(group.id, record.kind, source, card)}`;
      const result = await complete("draft", {
        system: systemPrompt("draft"),
        messages: [{ role: "user", text }],
        tools: DRAFT_TOOLS,
        signal: controller?.signal,
        onText,
      });
      check(result);
      // Saved after each step, so a failure later on doesn't redo the steps already written.
      iv = commit({ ...iv, draft: { groups: [...iv.draft.groups, group.id], calls: [...iv.draft.calls, ...result.toolCalls] } });
    }
    const count = iv.draft.calls.length;
    await useCowriter
      .getState()
      .addTurn(record.id, "Draft the card from the interview.", "Draft the card from the interview", [
        {
          text: count
            ? `Here's the first draft, written from the ${iv.bible ? "story bible" : "interview"}: ${count} edits. Accept them all or one by one, then tell me what to change.`
            : "I couldn't draft anything this time.",
          toolCalls: iv.draft.calls,
        },
      ]);
    useUi.getState().setCowriterTab("chat");
    return { ...iv, stage: "done" };
  }

  /** The interview if it belongs to the open card and nothing else is running. */
  function ready() {
    const record = useEditor.getState().record;
    const iv = get().interview;
    if (!record || !iv || iv.cardId !== record.id || get().busy) return undefined;
    return { record, iv };
  }

  return {
    busy: false,
    status: "",
    streaming: "",

    async load(cardId) {
      if (get().interview?.cardId === cardId) return;
      get().stop();
      set({ interview: undefined, error: undefined, streaming: "" });
      const stored = await getInterview(cardId);
      if (useEditor.getState().record?.id === cardId) set({ interview: stored });
    },

    async start(premise) {
      const record = useEditor.getState().record;
      if (!record || get().busy) return;
      const { settings } = await projectSettings(record.projectId);
      const iv = newInterview(record.id, settings.depth);
      iv.messages = [{ role: "user", text: interviewKickoff(record.kind, settings, premise) }];
      set({ interview: commit(iv), error: undefined });
      await get().run();
    },

    setAnswer(questionId, answer) {
      const iv = get().interview;
      const round = iv?.rounds.at(-1);
      if (!iv || !round || round.submitted) return;
      const rounds = [...iv.rounds.slice(0, -1), { ...round, answers: { ...round.answers, [questionId]: answer } }];
      commit({ ...iv, rounds });
    },

    async submit(finish = false) {
      const r = ready();
      const round = r?.iv.rounds.at(-1);
      const last = r?.iv.messages.at(-1);
      if (!r || r.iv.stage !== "asking" || !round || last?.role !== "assistant") return;
      const { iv } = r;
      const limit = iv.memos.length ? DIG_ROUNDS : ROUND_LIMITS[iv.depth];
      const next: InterviewRecord = {
        ...iv,
        messages: [...iv.messages, ...results(last.toolCalls, { callId: round.callId, text: answersText(round) })],
        rounds: [...iv.rounds.slice(0, -1), { ...round, submitted: true }],
      };
      next.stage = finish || iv.phaseRounds >= limit ? afterQuestions(next) : "questions";
      commit(next);
      await get().run();
    },

    async digDeeper() {
      const r = ready();
      const memo = r?.iv.memos.at(-1);
      if (!r || r.iv.stage !== "memo" || !memo) return;
      commit({
        ...r.iv,
        messages: [...r.iv.messages, { role: "user", text: digDeeperRequest(memoText(memo)) }],
        stage: "questions",
        phaseRounds: 0,
      });
      await get().run();
    },

    async enough() {
      const r = ready();
      if (!r || r.iv.stage !== "memo") return;
      commit({ ...r.iv, stage: "bible" });
      await get().run();
    },

    setBible(bible) {
      const iv = get().interview;
      if (iv) commit({ ...iv, bible });
    },

    async draft() {
      const r = ready();
      if (!r || r.iv.stage !== "review") return;
      commit({ ...r.iv, stage: "draft", draft: { groups: [], calls: [] } });
      await get().run();
    },

    async run() {
      const r = ready();
      if (!r) return;
      let { iv } = r;
      set({ busy: true, error: undefined, streaming: "" });
      controller = new AbortController();
      try {
        while (MACHINE_STAGES.includes(iv.stage)) {
          // The user may have moved to another card meanwhile; its record is no longer ours to touch.
          const record = useEditor.getState().record;
          if (record?.id !== iv.cardId) break;
          set({ streaming: "" });
          if (iv.stage === "questions") iv = await askStep(iv);
          else if (iv.stage === "gap") iv = await gapStep(iv, record);
          else if (iv.stage === "bible") iv = await bibleStep(iv);
          else iv = await draftStep(iv, record);
          iv = commit(iv);
        }
      } catch (e) {
        if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
      } finally {
        controller = undefined;
        set({ busy: false, status: "", streaming: "" });
      }
    },

    stop() {
      controller?.abort();
    },

    async reset() {
      const iv = get().interview;
      if (!iv) return;
      get().stop();
      await deleteInterview(iv.cardId);
      set({ interview: undefined, error: undefined });
    },
  };
});
