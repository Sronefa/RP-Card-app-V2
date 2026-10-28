/**
 * Co-writer conversations about the open card: the main chat and the lorebook brainstorm. Each
 * sends messages, runs the model's tool calls as proposals, and applies the ones the user accepts.
 */
import { create } from "zustand";
import type { CardDataV3 } from "../card";
import { getChat, loreChatKey, saveChat, deleteChat, type CardRecord } from "../db/db";
import { useEditor } from "../editor/store";
import { newChat, type ChatRecord, type Proposal } from "../ai/records";
import { composeUserMessage, CRITIC_REQUEST, systemPrompt } from "../ai/prompts";
import { applyEdit, CARD_TOOLS, describeEdit, LORE_TOOLS, planEdit, ToolInputError } from "../ai/tools";
import type { ChatMessage, ModeId, ToolCall, ToolDef, ToolResult } from "../ai/types";
import { aKind, KINDS, plainFields, type TypedKind } from "../editor/world";
import { useUsage } from "../ai/usage";
import { complete, gatherContext, isAbort, partsText, projectSettings } from "./engine";
import { ENGINE_TOOLS, ENGINE_WRITING_TOOLS } from "../ai/engineTools";
import { askFor, fileNewGaps } from "../app/handoff";
import { readEngine } from "../engine/sheet";
import { addCall } from "./worldScan";
import { logChange } from "./changeLog";
import { cleanCalls, polishText, textOf, whereOf, withText } from "./polish";
import { useAiSettings } from "../ai/settings";
import { DEFAULT_SLOP_PHRASES } from "../editor/slop";
import { newId } from "../lib/id";
import { trackPhrases } from "../editor/phraseStats";
import { countFeedback, feedbackLabel, reasonLabel, reviseText } from "./learn";
import { rankVariants, writeVariants } from "./variants";

/** Most model calls in one turn (each tool round is one call). */
const MAX_ROUNDS = 6;

interface Channel {
  mode: ModeId;
  tools: ToolDef[];
  /** Where the chat is stored, by card id. */
  key: (cardId: string) => string;
}

export interface ChatState {
  chat?: ChatRecord;
  busy: boolean;
  /** Text of the reply being streamed. */
  streaming: string;
  error?: string;
  /** Text in the message box, kept when the panel is hidden. */
  draft: string;
  setDraft: (draft: string) => void;
  load: (cardId: string) => Promise<void>;
  /** Sends a message. `display` is what the chat shows, when it differs from the request. */
  send: (request: string, display?: string) => Promise<void>;
  /**
   * Adds edits written elsewhere (the interview's draft) to the chat as proposals, as if the
   * co-writer had made them here in reply to `request`.
   */
  addTurn: (
    cardId: string,
    request: string,
    display: string,
    replies: { text: string; toolCalls: ToolCall[] }[],
    /** The card, when it isn't the open one (the engineer working in the background). */
    data?: CardDataV3,
  ) => Promise<void>;
  /** Has the critic read the card, then sends its notes to the co-writer to fix. */
  critique: () => Promise<void>;
  stop: () => void;
  decide: (proposalId: string, accept: boolean) => void;
  /** Files a pending plain lore entry under a world page instead (an NPC, place, item or shop). */
  retype: (proposalId: string, kind: TypedKind) => void;
  acceptAll: () => void;
  clear: () => Promise<void>;
  /** Runs the prose editor over a pending proposal's text. */
  polish: (proposalId: string) => Promise<void>;
  /** Proposes a polished version of a card field. */
  polishField: (field: string, label: string) => Promise<void>;
  /** Rewrites a pending proposal with a feedback chip. */
  revise: (proposalId: string, feedback: string) => Promise<void>;
  /** Records why the user rejected a proposal. */
  giveReason: (proposalId: string, reason: string) => void;
  /** Writes other versions of a pending proposal's text. */
  writeVariants: (proposalId: string) => Promise<void>;
  /** Has the judge rank a proposal's variants. */
  rankVariants: (proposalId: string) => Promise<void>;
  /** Puts a variant's text, or lines merged from several, in the proposal. */
  useVariant: (proposalId: string, text: string, label: string) => void;
  /** Marks an accepted edit's hand changes as dealt with. */
  markLearned: (proposalId: string) => void;
}

/** Files an ask_engineer call as a task in the inbox, and answers the co-writer. */
function askEngineer(cardId: string, call: ToolCall): ToolResult {
  const title = typeof call.input.title === "string" ? call.input.title.trim() : "";
  const brief = typeof call.input.brief === "string" ? call.input.brief.trim() : "";
  if (!title || !brief) return { id: call.id, content: 'Give the task a "title" and a "brief".', isError: true };
  const source = typeof call.input.source === "string" && call.input.source.trim() ? { label: call.input.source.trim() } : undefined;
  void askFor(cardId, "engineer", "cowriter", title, brief, source).catch(() => undefined);
  return { id: call.id, content: `Filed for the UI engineer: "${title}". It waits for the user's approval in the inbox; when approved, the engineer builds it in the background.` };
}

function createChatStore(channel: Channel) {
  let controller: AbortController | undefined;
  return create<ChatState>((set, get) => {
    /** Saves the chat and shows it, if it is still the open card's chat. */
    function commit(chat: ChatRecord) {
      chat = { ...chat, updatedAt: Date.now() };
      if (get().chat?.cardId === chat.cardId) set({ chat });
      void saveChat(chat);
      return chat;
    }

    /** Keeps decisions the user made while a reply was still coming in. */
    function withLatestDecisions(chat: ChatRecord): ChatRecord {
      const current = get().chat;
      if (current?.cardId !== chat.cardId) return chat;
      const decided = new Map(current.proposals.filter((p) => p.status !== "pending").map((p) => [p.id, p]));
      return {
        ...chat,
        proposals: chat.proposals.map((p) => decided.get(p.id) ?? p),
        unreported: current.unreported,
      };
    }

    /** Turns the model's tool calls into proposals, and tells the model what happened to each. */
    function runTools(
      chat: ChatRecord,
      calls: ToolCall[],
      fixed: Record<string, string[]> = {},
      data = useEditor.getState().record?.card.data,
    ): { chat: ChatRecord; results: ToolResult[] } {
      const proposals = [...chat.proposals];
      const results = calls.map((call): ToolResult => {
        if (!data)
          return {
            id: call.id,
            content: "The card isn't open, so nothing was changed.",
            isError: true,
          };
        try {
          const edit = planEdit(data, call);
          const number = proposals.length + 1;
          const fixes = fixed[call.id]?.length ? fixed[call.id] : undefined;
          proposals.push({ id: call.id, number, call, status: "pending", summary: describeEdit(edit), ...(fixes ? { fixed: fixes } : {}) });
          return {
            id: call.id,
            content:
              (edit.kind === "pitch"
                ? `Shown to the user as idea ${number}.`
                : `Proposed to the user as edit ${number} (${describeEdit(edit)}). They will accept or reject it.`) +
              (fixes ? ` The line editor rewrote overused phrasing first: ${fixes.map((f) => `"${f}"`).join(", ")}. Write fresher wording next time.` : ""),
          };
        } catch (e) {
          if (e instanceof ToolInputError) return { id: call.id, content: e.message, isError: true };
          throw e;
        }
      });
      return { chat: { ...chat, proposals }, results };
    }

    /** Runs a model call on one pending proposal while the chat shows it is busy. */
    async function onProposal(proposalId: string, work: (p: Proposal, record: CardRecord, signal: AbortSignal) => Promise<void>) {
      const record = useEditor.getState().record;
      const proposal = get().chat?.proposals.find((p) => p.id === proposalId);
      if (!record || !proposal || proposal.status !== "pending" || get().busy) return;
      set({ busy: true, error: undefined });
      try {
        controller = new AbortController();
        await work(proposal, record, controller.signal);
      } catch (e) {
        if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
      } finally {
        controller = undefined;
        set({ busy: false });
      }
    }

    /** Changes one proposal, with a note for the co-writer when there is one. */
    function updateProposal(proposalId: string, change: (p: Proposal) => Proposal, note?: string) {
      const chat = get().chat;
      if (!chat) return;
      commit({
        ...chat,
        proposals: chat.proposals.map((p) => (p.id === proposalId ? change(p) : p)),
        unreported: note ? [...chat.unreported, note] : chat.unreported,
      });
    }

    return {
      busy: false,
      streaming: "",
      draft: "",
      setDraft: (draft) => set({ draft }),

      async load(cardId) {
        const key = channel.key(cardId);
        if (get().chat?.cardId === key) return;
        get().stop();
        set({ chat: newChat(key), error: undefined, streaming: "" });
        const stored = await getChat(key);
        if (stored && get().chat?.cardId === key) set({ chat: stored });
      },

      async send(request, display = request) {
        const record = useEditor.getState().record;
        let chat = get().chat;
        if (!record || !chat || chat.cardId !== channel.key(record.id) || get().busy) return;
        // Busy right away, so a second tap can't send twice while the context is gathered.
        set({ busy: true, error: undefined, streaming: "" });
        useUsage.getState().startTurn("cowriter");
        try {
          const parts = await gatherContext(record);
          const engineAware = !!readEngine(record.card.data) || !!(await projectSettings(record.projectId)).settings.engineMode;
          const tools = engineAware
            ? [...channel.tools, ...ENGINE_TOOLS, ...(readEngine(record.card.data) ? ENGINE_WRITING_TOOLS : [])]
            : channel.tools;
          // Decisions made while the context was gathered are in the latest chat.
          chat = get().chat?.cardId === chat.cardId ? get().chat! : chat;
          const composed = composeUserMessage(request, parts, chat.sentContext, chat.unreported);
          chat = commit({
            ...chat,
            messages: [...chat.messages, { role: "user", text: composed.text, display }],
            sentContext: composed.sent,
            unreported: [],
          });

          controller = new AbortController();
          for (let round = 0; round < MAX_ROUNDS; round++) {
            const result = await complete(channel.mode, {
              system: systemPrompt(channel.mode),
              messages: chat.messages,
              tools,
              signal: controller.signal,
              onText: (delta) => set({ streaming: get().streaming + delta }),
            });
            const reply: ChatMessage = {
              role: "assistant",
              text: result.text,
              toolCalls: result.toolCalls,
              raw: result.raw,
            };
            let next: ChatRecord = {
              ...withLatestDecisions(chat),
              messages: [...chat.messages, reply],
            };
            if (result.toolCalls.length > 0) {
              const ai = useAiSettings.getState().settings;
              const cleaned =
                ai.slopRewrite === false
                  ? { calls: result.toolCalls, fixed: {} }
                  : await cleanCalls(record, result.toolCalls, ai.slopPhrases ?? DEFAULT_SLOP_PHRASES, controller.signal);
              // A task for the UI engineer goes to the inbox, not into a proposal.
              const asks = new Map(cleaned.calls.filter((c) => c.name === "ask_engineer").map((c) => [c.id, askEngineer(record.id, c)]));
              const ran = runTools(next, cleaned.calls.filter((c) => !asks.has(c.id)), cleaned.fixed);
              ran.results = cleaned.calls.map((c) => asks.get(c.id) ?? ran.results.find((r) => r.id === c.id)!);
              // What the model wrote before any rewrite, so its habits are counted.
              void trackPhrases(result.toolCalls.map(textOf).filter((t): t is string => !!t), record.projectId);
              next = {
                ...ran.chat,
                messages: [...ran.chat.messages, { role: "tool", results: ran.results }],
              };
            }
            chat = commit(next);
            set({ streaming: "" });
            if (result.stop === "refusal") {
              set({
                error: "The model declined this request. Rephrase it, or pick another model in Settings.",
              });
              break;
            }
            if (result.stop === "max_tokens") {
              set({
                error: "The reply was cut off because it hit the model's length limit.",
              });
              break;
            }
            // With tools, the model gets the results and may continue; JSON edits end the turn.
            if (!(result.useTools && result.stop === "tool_use" && result.toolCalls.length > 0)) break;
          }
        } catch (e) {
          if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
        } finally {
          controller = undefined;
          set({ busy: false, streaming: "" });
        }
      },

      async addTurn(cardId, request, display, replies, data) {
        const key = channel.key(cardId);
        // Only the open card's chat is switched to; a card worked on in the background gets its stored chat.
        const isOpen = useEditor.getState().record?.id === cardId;
        if (isOpen && get().chat?.cardId !== key) await get().load(cardId);
        let chat = get().chat?.cardId === key ? get().chat! : ((await getChat(key)) ?? newChat(key));
        const messages: ChatMessage[] = [...chat.messages, { role: "user", text: request, display }];
        for (const r of replies) {
          const ran = runTools({ ...chat, messages }, r.toolCalls, {}, isOpen ? undefined : data);
          chat = ran.chat;
          // Another conversation wrote these, so there is no provider content to echo back.
          messages.push({
            role: "assistant",
            text: r.text,
            toolCalls: r.toolCalls,
          });
          if (r.toolCalls.length) messages.push({ role: "tool", results: ran.results });
        }
        commit({ ...chat, messages });
      },

      async polish(proposalId) {
        await onProposal(proposalId, async (proposal, record, signal) => {
          const text = textOf(proposal.call);
          if (!text) return;
          const polished = await polishText(record, text, whereOf(proposal.call), signal);
          updateProposal(
            proposalId,
            (p) => ({ ...p, call: withText(p.call, polished.text), polished: polished.changes }),
            `The user had the line editor polish edit ${proposal.number}; it is still waiting for their decision.`,
          );
        });
      },

      async revise(proposalId, feedback) {
        await onProposal(proposalId, async (proposal, record, signal) => {
          const text = textOf(proposal.call);
          if (!text) return;
          const revised = await reviseText(record, text, whereOf(proposal.call), [feedback], signal);
          updateProposal(
            proposalId,
            (p) => ({ ...p, call: withText(p.call, revised.text), revised: [...(p.revised ?? []), feedback] }),
            `The user had edit ${proposal.number} revised: ${feedbackLabel(feedback).toLowerCase()}. It is still waiting for their decision. Keep this preference in mind.`,
          );
          void countFeedback(feedback);
        });
      },

      giveReason(proposalId, reason) {
        const proposal = get().chat?.proposals.find((p) => p.id === proposalId);
        if (!proposal || proposal.status !== "rejected") return;
        updateProposal(
          proposalId,
          (p) => ({ ...p, reason }),
          `The user rejected edit ${proposal.number} because: ${reasonLabel(reason).toLowerCase()}. Keep this in mind for what you write next.`,
        );
        void countFeedback(reason);
      },

      async writeVariants(proposalId) {
        await onProposal(proposalId, async (proposal, record, signal) => {
          const variants = await writeVariants(record, { ...proposal.call, input: { ...proposal.call.input } }, signal);
          // The first draft is the text as it is now, even after a polish or revision.
          updateProposal(proposalId, (p) => ({ ...p, variants }));
        });
      },

      async rankVariants(proposalId) {
        await onProposal(proposalId, async (proposal, _record, signal) => {
          if (!proposal.variants?.length) return;
          const ranked = await rankVariants(proposal.variants, signal);
          updateProposal(proposalId, (p) => ({ ...p, variants: ranked }));
        });
      },

      useVariant(proposalId, text, label) {
        const proposal = get().chat?.proposals.find((p) => p.id === proposalId);
        if (!proposal || proposal.status !== "pending" || !text.trim()) return;
        updateProposal(
          proposalId,
          (p) => ({ ...p, call: withText(p.call, text) }),
          `The user put ${label} in edit ${proposal.number}; it is still waiting for their decision.`,
        );
      },

      markLearned(proposalId) {
        updateProposal(proposalId, (p) => ({ ...p, learned: true }));
      },

      async polishField(field, label) {
        const record = useEditor.getState().record;
        const text = record?.card.data[field as keyof typeof record.card.data];
        if (!record || typeof text !== "string" || !text.trim() || get().busy) return;
        await get().load(record.id);
        set({ busy: true, error: undefined });
        try {
          controller = new AbortController();
          const polished = await polishText(record, text, `the ${label}`, controller.signal);
          set({ busy: false });
          await get().addTurn(record.id, `Polish the ${label}.`, `Polish the ${label}`, [
            {
              text: polished.changes.length ? `Line edits: ${polished.changes.join("; ")}.` : "Line edits to the whole text.",
              toolCalls: [{ id: newId(), name: "set_field", input: { field, text: polished.text } }],
            },
          ]);
        } catch (e) {
          if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
        } finally {
          controller = undefined;
          set({ busy: false });
        }
      },

      async critique() {
        const record = useEditor.getState().record;
        if (!record || get().chat?.cardId !== channel.key(record.id) || get().busy) return;
        set({ busy: true, error: undefined, streaming: "" });
        let notes = "";
        try {
          controller = new AbortController();
          const parts = await gatherContext(record);
          const result = await complete("critic", {
            system: systemPrompt("critic"),
            messages: [{ role: "user", text: `${partsText(parts)}\n\n${CRITIC_REQUEST}` }],
            tools: [],
            signal: controller.signal,
            onText: (delta) => set({ streaming: get().streaming + delta }),
          });
          notes = result.text.trim();
          if (!notes) set({ error: "The critic had nothing to say. Try again, or pick another model." });
        } catch (e) {
          if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
        } finally {
          controller = undefined;
          set({ busy: false, streaming: "" });
        }
        if (notes)
          await get().send(
            `The critic read the card as the roleplay model would and found:\n\n${notes}\n\nFix the problems worth fixing with your tools.`,
            `Fix what the critic found:\n\n${notes}`,
          );
      },

      stop() {
        controller?.abort();
      },

      decide(proposalId, accept) {
        const chat = get().chat;
        const proposal = chat?.proposals.find((p) => p.id === proposalId);
        if (!chat || !proposal || proposal.status !== "pending") return;
        const editor = useEditor.getState();
        let status: Proposal["status"] = accept ? "accepted" : "rejected";
        let error: string | undefined;
        let summary = proposal.summary ?? proposal.call.name;
        if (editor.record) {
          try {
            // Re-plan against the card as it is now: earlier edits may have changed it.
            const edit = planEdit(editor.record.card.data, proposal.call);
            summary = describeEdit(edit);
            if (accept && edit.kind !== "pitch") {
              const before = editor.record.card.data;
              const after = applyEdit(before, edit);
              editor.replaceData(after);
              // What the edit should show on a screen goes to the UI engineer as tasks.
              void fileNewGaps(editor.record.id, before, after, "cowriter").catch(() => undefined);
              void logChange(editor.record.id, "cowriter", [summary]);
            }
          } catch (e) {
            if (!(e instanceof ToolInputError)) throw e;
            if (accept) {
              status = "failed";
              error = e.message;
            }
          }
        }
        const proposals = chat.proposals.map((p) => (p.id === proposalId ? { ...p, status, error, summary } : p));
        const note =
          status === "failed"
            ? `Edit ${proposal.number} (${summary}) couldn't be applied: ${error}`
            : `${proposal.call.name === "pitch" ? "Idea" : "Edit"} ${proposal.number} (${summary}): ${status}`;
        commit({ ...chat, proposals, unreported: [...chat.unreported, note] });
      },

      retype(proposalId, kind) {
        const chat = get().chat;
        const proposal = chat?.proposals.find((p) => p.id === proposalId);
        if (!chat || !proposal || proposal.status !== "pending" || proposal.call.name !== "add_lore_entry") return;
        const input = proposal.call.input;
        const keys = Array.isArray(input.keys) ? input.keys.filter((k): k is string => typeof k === "string") : [];
        const fields = plainFields(kind, String(input.title ?? ""), keys, String(input.content ?? ""));
        if (typeof input.why === "string") fields.why = input.why;
        const call = { ...addCall(kind, fields), id: proposal.call.id };
        const label = KINDS[kind].label;
        commit({
          ...chat,
          proposals: chat.proposals.map((p) => (p.id === proposalId ? { ...p, call, summary: `Add ${label} "${fields.name}"` } : p)),
          unreported: [
            ...chat.unreported,
            `The user filed edit ${proposal.number} ("${fields.name}") as ${aKind(kind)} on the world pages; it is still waiting for their decision.`,
          ],
        });
      },

      acceptAll() {
        for (const p of get().chat?.proposals ?? [])
          if (p.status === "pending" && p.call.name !== "pitch") get().decide(p.id, true);
      },

      async clear() {
        const chat = get().chat;
        if (!chat || get().busy) return;
        await deleteChat(chat.cardId);
        set({ chat: newChat(chat.cardId), error: undefined });
      },
    };
  });
}

/** The main co-writer chat. */
export const useCowriter = createChatStore({
  mode: "refine",
  tools: CARD_TOOLS,
  key: (id) => id,
});

/** The lorebook brainstorm. */
export const useLoreChat = createChatStore({
  mode: "lore",
  tools: LORE_TOOLS,
  key: loreChatKey,
});
