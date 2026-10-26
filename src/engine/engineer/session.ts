/**
 * The UI engineer's conversation about the open card. Each message starts a turn: the engineer
 * reads, writes and tests in a loop on a draft of the engine, and when it stops, everything it
 * changed becomes one proposal. Accepting replays the edits onto the engine as it is then, in one
 * save, so one undo takes it all back.
 */
import { create } from "zustand";
import { engineerSettings, useAiSettings } from "../../ai/settings";
import { ToolInputError } from "../../ai/tools";
import type { ChatMessage, ToolCall } from "../../ai/types";
import { complete, isAbort } from "../../cowriter/engine";
import { deleteChat, engineerChatKey, getRecord, saveRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { newId } from "../../lib/id";
import { loadSandboxLibs, type SandboxLibs } from "../sandbox/sandbox";
import { applyEngine, readEngine, type EngineConfig } from "../sheet";
import { skillsWith } from "./knowledge";
import { lintConfig } from "./lint";
import { EnginePreview } from "./preview";
import { engineSummary, engineerSystemPrompt } from "./prompt";
import { ENGINEER_TOOLS, runEngineerTool, type EngineerContext, type SampleState } from "./tools";
import { diffConfigs, replay, type FileChange } from "./workspace";
import { loadModuleLibrary } from "../../features/engine/moduleLibrary";

export type EngineerProposalStatus = "pending" | "accepted" | "rejected" | "failed" | "replaced";

export interface EngineerProposal {
  id: string;
  number: number;
  /** The write tool calls, in order. */
  calls: ToolCall[];
  summaries: string[];
  /** What changed, file by file, against the engine when the turn started. */
  changes: FileChange[];
  status: EngineerProposalStatus;
  error?: string;
  /** Errors and warnings the checks found when it was made. */
  errors: number;
  warnings: number;
  /** Shown after this many messages. */
  at: number;
}

export interface EngineerChat {
  cardId: string;
  messages: ChatMessage[];
  proposals: EngineerProposal[];
  sample?: SampleState;
  /** Decisions the engineer hasn't been told about. */
  unreported: string[];
  updatedAt: number;
}

export const newEngineerChat = (cardId: string): EngineerChat => ({
  cardId: engineerChatKey(cardId),
  messages: [],
  proposals: [],
  unreported: [],
  updatedAt: Date.now(),
});

interface EngineerState {
  chat?: EngineerChat;
  busy: boolean;
  streaming: string;
  /** Model calls so far in this turn. */
  round: number;
  error?: string;
  draft: string;
  setDraft: (draft: string) => void;
  load: (cardId: string) => Promise<void>;
  send: (request: string) => Promise<void>;
  stop: () => void;
  decide: (proposalId: string, accept: boolean) => void;
  clear: () => Promise<void>;
}

/** Screenshots from earlier turns are dropped: they cost tokens and the engineer has moved on. */
function withoutOldImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "tool" && m.results.some((r) => r.images?.length)
      ? {
          ...m,
          results: m.results.map((r) =>
            r.images?.length ? { ...r, images: undefined, content: `${r.content}\n(The screenshot was shown at the time.)` } : r,
          ),
        }
      : m,
  );
}

let libs: Promise<SandboxLibs> | undefined;
const sandboxLibs = () =>
  (libs ??= loadSandboxLibs().catch((e) => {
    libs = undefined;
    throw e;
  }));

/** Test hooks: replaces the preview page the engineer looks at. */
export const engineerHooks: { preview?: () => EnginePreview | undefined } = {};

export const useEngineer = create<EngineerState>((set, get) => {
  let controller: AbortController | undefined;

  function commit(chat: EngineerChat) {
    chat = { ...chat, updatedAt: Date.now() };
    if (get().chat?.cardId === chat.cardId) set({ chat });
    void saveRecord(chat);
    return chat;
  }

  return {
    busy: false,
    streaming: "",
    round: 0,
    draft: "",
    setDraft: (draft) => set({ draft }),

    async load(cardId) {
      const key = engineerChatKey(cardId);
      if (get().chat?.cardId === key) return;
      get().stop();
      set({ chat: newEngineerChat(cardId), error: undefined, streaming: "" });
      const stored = await getRecord<EngineerChat>(key);
      if (stored && get().chat?.cardId === key) set({ chat: stored });
    },

    async send(request) {
      const record = useEditor.getState().record;
      let chat = get().chat;
      const config = record && readEngine(record.card.data);
      if (!record || !chat || chat.cardId !== engineerChatKey(record.id) || get().busy) return;
      if (!config) {
        set({ error: "Turn the engine on first." });
        return;
      }
      set({ busy: true, error: undefined, streaming: "", round: 0 });
      await useAiSettings.getState().load();
      const settings = useAiSettings.getState().settings;
      const { effort, maxRounds, maxTokens } = engineerSettings(settings);
      const skills = skillsWith(settings.engineerSkills);

      // An open proposal is built on: the new turn starts from it, and its proposal replaces it.
      const open = chat.proposals.find((p) => p.status === "pending");
      let start: { config: EngineConfig; calls: ToolCall[] } = { config, calls: [] };
      const notes = [...chat.unreported];
      if (open) {
        try {
          start = { config: replay(config, open.calls).config, calls: open.calls };
          notes.push(
            `Proposal ${open.number} is still open; you're building on it, and your changes this turn join it in one new proposal.`,
          );
        } catch (e) {
          if (!(e instanceof ToolInputError)) throw e;
          notes.push(
            `Proposal ${open.number} no longer fits the engine (${e.message}), so it was dropped. Start from the engine as it is.`,
          );
        }
      }

      const preview = engineerHooks.preview ? engineerHooks.preview() : typeof document !== "undefined" ? new EnginePreview() : undefined;
      const ctx: EngineerContext = {
        data: record.card.data,
        draft: start.config,
        ops: [...start.calls],
        skills,
        sample: chat.sample,
        sampleDirty: !!chat.sample,
        preview,
        libs: preview ? sandboxLibs : undefined,
        library: await loadModuleLibrary().catch(() => []),
      };
      const text = [
        `<engine>\n${engineSummary(ctx.draft, record.card.data.name)}\n</engine>`,
        notes.length ? `<notes>\n${notes.map((n) => `- ${n}`).join("\n")}\n</notes>` : "",
        request,
      ]
        .filter(Boolean)
        .join("\n\n");
      chat = commit({
        ...chat,
        messages: [...withoutOldImages(chat.messages), { role: "user", text, display: request }],
        proposals: chat.proposals.map((p) => (p === open ? { ...p, status: "replaced" } : p)),
        unreported: [],
      });

      controller = new AbortController();
      const system = engineerSystemPrompt(skills);
      try {
        for (let round = 0; ; round++) {
          if (round >= maxRounds) {
            set({
              error: `The engineer stopped after ${maxRounds} model calls, the loop limit. Its work so far is in the proposal; ask it to carry on, or raise the limit.`,
            });
            break;
          }
          set({ round: round + 1 });
          const result = await complete("engineer", {
            system,
            messages: chat.messages,
            tools: ENGINEER_TOOLS,
            effort,
            maxTokens,
            signal: controller.signal,
            onText: (delta) => set({ streaming: get().streaming + delta }),
          });
          if (!result.useTools) {
            set({ error: "The UI engineer needs a model that can call tools. Pick another one for it in Settings." });
            break;
          }
          chat = commit({
            ...chat,
            messages: [...chat.messages, { role: "assistant", text: result.text, toolCalls: result.toolCalls, raw: result.raw }],
          });
          set({ streaming: "" });
          if (result.toolCalls.length) {
            const results = [];
            for (const call of result.toolCalls) {
              if (controller.signal.aborted) break;
              results.push(await runEngineerTool(ctx, call));
            }
            // Calls cut off by Stop still need an answer, or the chat can't continue.
            for (const call of result.toolCalls.slice(results.length))
              results.push({ id: call.id, content: "Stopped by the user.", isError: true });
            chat = commit({ ...chat, sample: ctx.sample, messages: [...chat.messages, { role: "tool", results }] });
          }
          if (result.stop === "refusal") {
            set({ error: "The model declined this request. Rephrase it, or pick another model in Settings." });
            break;
          }
          if (result.stop === "max_tokens") {
            set({ error: "The reply was cut off at the length limit." });
            break;
          }
          if (controller.signal.aborted || !(result.stop === "tool_use" && result.toolCalls.length)) break;
        }
      } catch (e) {
        if (!isAbort(e)) set({ error: (e as Error).message || "Something went wrong" });
      } finally {
        controller = undefined;
        preview?.dispose();
        // Whatever was built, even when stopped, becomes the proposal.
        const changes = diffConfigs(config, ctx.draft);
        if (ctx.ops.length && changes.length) {
          const findings = lintConfig(ctx.draft);
          const proposal: EngineerProposal = {
            id: newId(),
            number: chat.proposals.length + 1,
            calls: ctx.ops,
            summaries: replay(config, ctx.ops).summaries,
            changes,
            status: "pending",
            errors: findings.filter((f) => f.level === "error").length,
            warnings: findings.filter((f) => f.level === "warn").length,
            at: chat.messages.length,
          };
          chat = commit({
            ...(get().chat?.cardId === chat.cardId ? get().chat! : chat),
            sample: ctx.sample,
            proposals: [...chat.proposals, proposal],
          });
        } else commit({ ...chat, sample: ctx.sample });
        set({ busy: false, streaming: "", round: 0 });
      }
    },

    stop() {
      controller?.abort();
    },

    decide(proposalId, accept) {
      const chat = get().chat;
      const proposal = chat?.proposals.find((p) => p.id === proposalId);
      if (!chat || !proposal || proposal.status !== "pending") return;
      let status: EngineerProposalStatus = accept ? "accepted" : "rejected";
      let error: string | undefined;
      if (accept) {
        const editor = useEditor.getState();
        const data = editor.record?.card.data;
        const config = data && readEngine(data);
        try {
          if (!data || !config) throw new ToolInputError("The engine is off.");
          editor.replaceData(applyEngine(data, replay(config, proposal.calls).config));
        } catch (e) {
          if (!(e instanceof ToolInputError)) throw e;
          status = "failed";
          error = e.message;
        }
      }
      const note =
        status === "failed"
          ? `Proposal ${proposal.number} couldn't be applied: ${error}`
          : `The user ${status} proposal ${proposal.number}${status === "accepted" ? "; it is in the engine now" : "; the engine is as it was before it"}.`;
      commit({
        ...chat,
        proposals: chat.proposals.map((p) => (p.id === proposalId ? { ...p, status, error } : p)),
        unreported: [...chat.unreported, note],
      });
    },

    async clear() {
      const chat = get().chat;
      if (!chat || get().busy) return;
      await deleteChat(chat.cardId);
      set({ chat: { ...newEngineerChat(""), cardId: chat.cardId }, error: undefined });
    },
  };
});
