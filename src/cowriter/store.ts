/**
 * The co-writer conversation for the open card: sending messages, running the model's tool calls
 * as proposals, and applying the ones the user accepts.
 */
import { create } from "zustand";
import { getChat, getProject, listCards, listPersonas, saveChat, deleteChat } from "../db/db";
import { useEditor } from "../editor/store";
import { DEFAULT_COWRITER, newChat, type ChatRecord, type Proposal } from "../ai/records";
import { cardContext, composeUserMessage, personasContext, settingsContext, systemPrompt, worldContext } from "../ai/prompts";
import { createProvider, modelKey, resolveModel, useAiSettings } from "../ai/settings";
import { applyEdit, CARD_TOOLS, describeEdit, planEdit, ToolInputError } from "../ai/tools";
import { ToolsUnsupportedError, type ChatMessage, type ToolCall, type ToolResult } from "../ai/types";

/** Most model calls in one turn (each tool round is one call). */
const MAX_ROUNDS = 6;

interface CowriterState {
  chat?: ChatRecord;
  busy: boolean;
  /** Text of the reply being streamed. */
  streaming: string;
  error?: string;
  /** Text in the message box, kept when the panel is hidden. */
  draft: string;
  setDraft: (draft: string) => void;
  load: (cardId: string) => Promise<void>;
  send: (request: string) => Promise<void>;
  stop: () => void;
  decide: (proposalId: string, accept: boolean) => void;
  acceptAll: () => void;
  clear: () => Promise<void>;
}

let controller: AbortController | undefined;

const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError");

export const useCowriter = create<CowriterState>((set, get) => {
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
      if (!data) return { id: call.id, content: "The card isn't open, so nothing was changed.", isError: true };
      try {
        const edit = planEdit(data, call);
        const number = proposals.length + 1;
        proposals.push({ id: call.id, number, call, status: "pending" });
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
      if (get().chat?.cardId === cardId) return;
      get().stop();
      set({ chat: newChat(cardId), error: undefined, streaming: "" });
      const stored = await getChat(cardId);
      if (stored && get().chat?.cardId === cardId) set({ chat: stored });
    },

    async send(request) {
      const record = useEditor.getState().record;
      let chat = get().chat;
      if (!record || !chat || chat.cardId !== record.id || get().busy) return;
      // Busy right away, so a second tap can't send twice while the context is gathered.
      set({ busy: true, error: undefined, streaming: "" });
      try {
        await useAiSettings.getState().load();
        let settings = useAiSettings.getState().settings;
        const resolved = resolveModel(settings, "refine");
        if (!resolved) {
          set({ error: "Choose a model in Settings first." });
          return;
        }

        const project = await getProject(record.projectId);
        const cw = { ...DEFAULT_COWRITER, ...project?.cowriter };
        const presets = settings.presets.filter((p) => cw.presetIds.includes(p.id));
        const world =
          record.kind === "character" ? (await listCards(record.projectId)).find((c) => c.kind === "world") : undefined;
        const personas = (await listPersonas()).filter((p) => project?.personaIds.includes(p.id));
        const parts = [
          { key: "settings", title: "Project settings", text: settingsContext(cw, presets) },
          { key: "card", title: "The card as it is now", text: cardContext(record.card.data, record.kind) },
          ...(world ? [{ key: "world", title: "The project's world", text: worldContext(world) }] : []),
          ...(personas.length ? [{ key: "personas", title: "The user's personas", text: personasContext(personas) }] : []),
        ];
        // Decisions made while the context was gathered are in the latest chat.
        chat = get().chat?.cardId === chat.cardId ? get().chat! : chat;
        const composed = composeUserMessage(request, parts, chat.sentContext, chat.unreported);
        chat = commit({
          ...chat,
          messages: [...chat.messages, { role: "user", text: composed.text, display: request }],
          sentContext: composed.sent,
          unreported: [],
        });

        controller = new AbortController();
        const provider = createProvider(resolved.config);
        let useTools = resolved.useTools;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let result;
          try {
            result = await provider.complete({
              model: resolved.choice.model,
              system: systemPrompt("refine"),
              messages: chat.messages,
              tools: CARD_TOOLS,
              useTools,
              signal: controller.signal,
              onText: (delta) => set({ streaming: get().streaming + delta }),
            });
          } catch (e) {
            if (!(e instanceof ToolsUnsupportedError) || !useTools) throw e;
            // Remember that this model can't call tools, and ask again with JSON edits.
            useTools = false;
            settings = useAiSettings.getState().settings;
            await useAiSettings.getState().update({ noToolModels: [...settings.noToolModels, modelKey(resolved.choice)] });
            set({ streaming: "" });
            round--;
            continue;
          }
          const reply: ChatMessage = { role: "assistant", text: result.text, toolCalls: result.toolCalls, raw: result.raw };
          let next: ChatRecord = { ...withLatestDecisions(chat), messages: [...chat.messages, reply] };
          if (result.toolCalls.length > 0) {
            const ran = runTools(next, result.toolCalls);
            next = { ...ran.chat, messages: [...ran.chat.messages, { role: "tool", results: ran.results }] };
          }
          chat = commit(next);
          set({ streaming: "" });
          if (result.stop === "refusal") {
            set({ error: "The model declined this request. Rephrase it, or pick another model in Settings." });
            break;
          }
          if (result.stop === "max_tokens") {
            set({ error: "The reply was cut off because it hit the model's length limit." });
            break;
          }
          // With tools, the model gets the results and may continue; JSON edits end the turn.
          if (!(useTools && result.stop === "tool_use" && result.toolCalls.length > 0)) break;
        }
      } catch (e) {
        if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
      } finally {
        controller = undefined;
        set({ busy: false, streaming: "" });
      }
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
      let summary = proposal.call.name;
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
      const proposals = chat.proposals.map((p) => (p.id === proposalId ? { ...p, status, error } : p));
      const note =
        status === "failed"
          ? `Edit ${proposal.number} (${summary}) couldn't be applied: ${error}`
          : `${proposal.call.name === "pitch" ? "Idea" : "Edit"} ${proposal.number} (${summary}): ${status}`;
      commit({ ...chat, proposals, unreported: [...chat.unreported, note] });
    },

    acceptAll() {
      for (const p of get().chat?.proposals ?? []) if (p.status === "pending" && p.call.name !== "pitch") get().decide(p.id, true);
    },

    async clear() {
      const chat = get().chat;
      if (!chat || get().busy) return;
      await deleteChat(chat.cardId);
      set({ chat: newChat(chat.cardId), error: undefined });
    },
  };
});
