/**
 * Co-writer conversations about the open card: the main chat and the lorebook brainstorm. Each
 * sends messages, runs the model's tool calls as proposals, and applies the ones the user accepts.
 */
import { create } from "zustand";
import { getChat, loreChatKey, saveChat, deleteChat } from "../db/db";
import { useEditor } from "../editor/store";
import { newChat, type ChatRecord, type Proposal } from "../ai/records";
import { composeUserMessage, CRITIC_REQUEST, systemPrompt } from "../ai/prompts";
import { applyEdit, CARD_TOOLS, describeEdit, LORE_TOOLS, planEdit, ToolInputError } from "../ai/tools";
import type { ChatMessage, ModeId, ToolCall, ToolDef, ToolResult } from "../ai/types";
import { complete, gatherContext, isAbort, partsText } from "./engine";

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
  ) => Promise<void>;
  /** Has the critic read the card, then sends its notes to the co-writer to fix. */
  critique: () => Promise<void>;
  stop: () => void;
  decide: (proposalId: string, accept: boolean) => void;
  acceptAll: () => void;
  clear: () => Promise<void>;
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
    function runTools(chat: ChatRecord, calls: ToolCall[]): { chat: ChatRecord; results: ToolResult[] } {
      const data = useEditor.getState().record?.card.data;
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
          proposals.push({ id: call.id, number, call, status: "pending", summary: describeEdit(edit) });
          return {
            id: call.id,
            content:
              edit.kind === "pitch"
                ? `Shown to the user as idea ${number}.`
                : `Proposed to the user as edit ${number} (${describeEdit(edit)}). They will accept or reject it.`,
          };
        } catch (e) {
          if (e instanceof ToolInputError) return { id: call.id, content: e.message, isError: true };
          throw e;
        }
      });
      return { chat: { ...chat, proposals }, results };
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
        try {
          const parts = await gatherContext(record);
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
              tools: channel.tools,
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
              const ran = runTools(next, result.toolCalls);
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

      async addTurn(cardId, request, display, replies) {
        const key = channel.key(cardId);
        if (get().chat?.cardId !== key) await get().load(cardId);
        let chat = get().chat?.cardId === key ? get().chat! : ((await getChat(key)) ?? newChat(key));
        const messages: ChatMessage[] = [...chat.messages, { role: "user", text: request, display }];
        for (const r of replies) {
          const ran = runTools({ ...chat, messages }, r.toolCalls);
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
            if (accept && edit.kind !== "pitch") editor.replaceData(applyEdit(editor.record.card.data, edit));
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
