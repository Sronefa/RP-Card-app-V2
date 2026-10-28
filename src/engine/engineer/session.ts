/**
 * The UI engineer's conversation about the open card. Each message starts a turn: the lead engineer
 * plans and hands tasks to a worker, one at a time, who builds and tests on a draft of the engine in
 * its own context. When the lead stops, everything the workers changed becomes one proposal. Accepting replays the edits onto the engine as it is then, in one
 * save, so one undo takes it all back.
 */
import { finishConversion } from "../convert";
import { changesText, logChange, readChanges } from "../../cowriter/changeLog";
import { create } from "zustand";
import { engineerSettings, modelInfo, resolveModel, useAiSettings } from "../../ai/settings";
import { formatTokens, meterOf, totalTokens, useUsage } from "../../ai/usage";
import { ToolInputError } from "../../ai/tools";
import type { ChatMessage, ToolCall } from "../../ai/types";
import { complete, isAbort } from "../../cowriter/engine";
import { deleteChat, engineerChatKey, getCard, getRecord, listCards, saveRecord } from "../../db/db";
import { useActivity, type Outcome } from "../../app/activity";
import { askFor, fileNewGaps } from "../../app/handoff";
import { useEditor } from "../../editor/store";
import { newId } from "../../lib/id";
import { loadSandboxLibs, type SandboxLibs } from "../sandbox/sandbox";
import { applyEngine, readEngine, type EngineConfig } from "../sheet";
import { skillsWith } from "./knowledge";
import { lintConfig } from "./lint";
import { EnginePreview } from "./preview";
import { engineSummary, engineerSystemPrompt, workerSystemPrompt } from "./prompt";
import { useCowriter } from "../../cowriter/store";
import { runEngineerTool, type EngineerContext, type SampleState } from "./tools";
import { isLeadTool, LEAD_TOOLS, runWorker, type WorkerRun } from "./worker";
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
  /** When the engineer last saw the co-writer's changes to the card. */
  changesSeen?: number;
  /** Each worker's task and steps, by the lead's run_worker call id, for the activity list. */
  workerRuns?: Record<string, WorkerRun>;
  updatedAt: number;
}

/** After a conversion, the co-writer offers each greeting its own starting values. */
async function offerStartingStates(cardId: string) {
  await useCowriter
    .getState()
    .addTurn(
      cardId,
      "The UI engineer converted this light card to the Immersive Engine and the user accepted it. Offer to give each greeting its starting state.",
      "From the UI engineer: the card runs on the Immersive Engine now",
      [
        {
          text: "The card runs on the engine now. Each greeting can start from its own values, so a reunion opening can begin warmer than a first meeting. Want me to propose a starting state for each greeting?",
          toolCalls: [],
        },
      ],
    )
    .catch(() => undefined);
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
  /** True while a turn runs, on any card. */
  busy: boolean;
  /** The card the running turn works on, which needn't be the open one. */
  runningCardId?: string;
  streaming: string;
  /** Model calls so far in this turn. */
  round: number;
  /** The worker running right now, with what it's writing. */
  worker?: WorkerRun & { streaming: string };
  error?: string;
  draft: string;
  setDraft: (draft: string) => void;
  /** Skip screenshots for now: render_preview sends a text layout report instead. */
  skipShots: boolean;
  setSkipShots: (skip: boolean) => void;
  load: (cardId: string) => Promise<void>;
  /** Queues a message to the open card's engineer; resolves when its turn has run. */
  send: (request: string) => Promise<void>;
  /** Queues a turn on any card (an approved task); `label` is what the activity list shows. */
  queue: (cardId: string, cardName: string, label: string, request: string) => Promise<Outcome>;
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

  /** One turn of the lead and its workers on a card, open or not. Its chat and proposal are saved either way. */
  async function runTurn(cardId: string, request: string): Promise<Outcome> {
    const key = engineerChatKey(cardId);
    const opened = useEditor.getState().record;
    const record = opened?.id === cardId ? opened : await getCard(cardId);
    let chat: EngineerChat = get().chat?.cardId === key ? get().chat! : ((await getRecord<EngineerChat>(key)) ?? newEngineerChat(cardId));
    const config = record && readEngine(record.card.data);
    if (!record) return { status: "failed", detail: "The card was deleted." };
    if (!config) return { status: "failed", detail: "The engine is off on this card." };
    let error: string | undefined;
    let made: number | undefined;
    let aborted = false;
    const fail = (message: string) => {
      error = message;
      if (get().chat?.cardId === key) set({ error: message });
    };
    set({ busy: true, runningCardId: cardId, streaming: "", round: 0, ...(get().chat?.cardId === key ? { error: undefined } : {}) });
    await useAiSettings.getState().load();
    const settings = useAiSettings.getState().settings;
    const { effort, maxRounds, maxTokens, tokenLimit } = engineerSettings(settings);
    const skills = skillsWith(settings.engineerSkills);
    // The worker renders and looks at screenshots, so its model decides.
    const model = resolveModel(settings, "worker");
    const blind = model && modelInfo(settings, model.choice).vision === false;
    const shots = !blind && !get().skipShots;
    useUsage.getState().startTurn("engineer");

    // An open proposal is built on: the new turn starts from it, and its proposal replaces it.
    const open = chat.proposals.find((p) => p.status === "pending");
    let start: { config: EngineConfig; calls: ToolCall[] } = { config, calls: [] };
    const notes = [...chat.unreported];
    const cowriter = changesText(await readChanges(record.id), "cowriter", chat.changesSeen ?? 0);
    if (cowriter) notes.push(`The co-writer changed the card since your last turn (the user accepted these):\n${cowriter}`);
    if (!shots)
      notes.push(
        `No screenshots this turn (${blind ? "this model can't see images" : "the user turned them off"}): render_preview sends a text layout report instead. Check its outline, sizes and problem lists carefully.`,
      );
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
    const world =
      record.kind === "character"
        ? (await listCards(record.projectId).catch(() => [])).find((c) => c.kind === "world")?.card.data
        : undefined;
    const ctx: EngineerContext = {
      data: record.card.data,
      world,
      draft: start.config,
      ops: [...start.calls],
      skills,
      sample: chat.sample,
      sampleDirty: !!chat.sample,
      preview,
      libs: preview ? sandboxLibs : undefined,
      library: await loadModuleLibrary().catch(() => []),
      cardId: record.id,
      shots,
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
      changesSeen: Date.now(),
    });

    controller = new AbortController();
    const system = engineerSystemPrompt(skills);
    const workerSystem = workerSystemPrompt(skills);
    const overLimit = () => {
      const used = totalTokens(meterOf(useUsage.getState(), "engineer").turn);
      return tokenLimit > 0 && used >= tokenLimit
        ? `The engineer paused at ${formatTokens(used)} tokens, your limit for one message. Its work so far is in the proposal; ask it to carry on, or raise the limit.`
        : undefined;
    };
    try {
      for (let round = 0; ; round++) {
        if (round >= maxRounds) {
          fail(`The engineer stopped after ${maxRounds} model calls, the loop limit. Its work so far is in the proposal; ask it to carry on, or raise the limit.`);
          break;
        }
        const limited = round > 0 ? overLimit() : undefined;
        if (limited) {
          fail(limited);
          break;
        }
        set({ round: round + 1 });
        const result = await complete("engineer", {
          system,
          messages: chat.messages,
          tools: LEAD_TOOLS,
          effort,
          maxTokens,
          signal: controller.signal,
          onText: (delta) => set({ streaming: get().streaming + delta }),
        });
        if (!result.useTools) {
          fail("The UI engineer needs a model that can call tools. Pick another one for it in Settings.");
          break;
        }
        chat = commit({
          ...chat,
          messages: [...chat.messages, { role: "assistant", text: result.text, toolCalls: result.toolCalls, raw: result.raw }],
        });
        set({ streaming: "" });
        if (result.toolCalls.length) {
          const results = [];
          const runs: Record<string, WorkerRun> = {};
          for (const call of result.toolCalls) {
            if (controller.signal.aborted) break;
            if (call.name === "run_worker") {
              const { run, ...out } = await runWorker(ctx, call, {
                skills,
                system: workerSystem,
                effort,
                maxTokens,
                maxRounds,
                signal: controller.signal,
                notes: shots ? [] : [notes.find((n) => n.startsWith("No screenshots"))!],
                limit: overLimit,
                onRun: (r) => set({ worker: { ...r, streaming: "" } }),
                onText: (delta) => {
                  const w = get().worker;
                  if (w) set({ worker: { ...w, streaming: w.streaming + delta } });
                },
              });
              runs[call.id] = run;
              set({ worker: undefined });
              results.push(out);
            } else if (isLeadTool(call.name)) results.push(await runEngineerTool(ctx, call));
            else
              results.push({
                id: call.id,
                content: `${call.name} is a worker's tool. Hand the building to a worker with run_worker.`,
                isError: true,
              });
          }
          // Calls cut off by Stop still need an answer, or the chat can't continue.
          for (const call of result.toolCalls.slice(results.length))
            results.push({ id: call.id, content: "Stopped by the user.", isError: true });
          chat = commit({
            ...chat,
            sample: ctx.sample,
            messages: [...chat.messages, { role: "tool", results }],
            ...(Object.keys(runs).length ? { workerRuns: { ...chat.workerRuns, ...runs } } : {}),
          });
        }
        if (result.stop === "refusal") {
          fail("The model declined this request. Rephrase it, or pick another model in Settings.");
          break;
        }
        if (result.stop === "max_tokens") {
          fail("The reply was cut off at the length limit.");
          break;
        }
        if (controller.signal.aborted || !(result.stop === "tool_use" && result.toolCalls.length)) break;
      }
    } catch (e) {
      if (!isAbort(e)) fail((e as Error).message || "Something went wrong");
    } finally {
      aborted = !!controller?.signal.aborted;
      controller = undefined;
      preview?.dispose();
      // Whatever was built, even when stopped, becomes the proposal.
      const changes = diffConfigs(config, ctx.draft);
      if (ctx.ops.length && changes.length) {
        const findings = lintConfig(ctx.draft);
        made = chat.proposals.length + 1;
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
      if (ctx.tasks?.length) {
        for (const t of ctx.tasks) await askFor(record.id, "cowriter", "engineer", t.title, t.brief).catch(() => undefined);
        const n = ctx.tasks.length;
        const latest = get().chat?.cardId === chat.cardId ? get().chat! : chat;
        chat = commit({
          ...latest,
          unreported: [...latest.unreported, `Your ${n === 1 ? "task for the co-writer is" : `${n} tasks for the co-writer are`} waiting for the user's approval in the inbox.`],
        });
      }
      if (ctx.cardCalls?.length) {
        const n = ctx.cardCalls.length;
        await useCowriter
          .getState()
          .addTurn(
            record.id,
            `The UI engineer proposed ${n === 1 ? "this change" : "these changes"} to the card while working on: ${request}`,
            `From the UI engineer: ${n === 1 ? "a change" : `${n} changes`} to the card`,
            [{ text: "", toolCalls: ctx.cardCalls }],
            record.card.data,
          )
          .catch(() => undefined);
        const latest = get().chat?.cardId === chat.cardId ? get().chat! : chat;
        commit({
          ...latest,
          unreported: [
            ...latest.unreported,
            `Your ${n === 1 ? "card change is" : `${n} card changes are`} waiting for the user in the co-writer chat.`,
          ],
        });
      }
      set({ busy: false, runningCardId: undefined, streaming: "", round: 0, worker: undefined });
    }
    if (aborted) return { status: "stopped" };
    if (made)
      return {
        status: error ? "needs-user" : "done",
        detail: `proposal ${made} is in the inbox${error ? `, but ${error.charAt(0).toLowerCase()}${error.slice(1)}` : "."}`,
      };
    if (error) return { status: "failed", detail: error };
    return { status: "done", detail: "it answered in the engineer chat." };
  }

  return {
    busy: false,
    streaming: "",
    round: 0,
    draft: "",
    setDraft: (draft) => set({ draft }),
    skipShots: false,
    setSkipShots: (skipShots) => set({ skipShots }),

    async load(cardId) {
      const key = engineerChatKey(cardId);
      if (get().chat?.cardId === key) return;
      // A running turn goes on in the background; only the chat on screen changes.
      set({ chat: newEngineerChat(cardId), error: undefined });
      const stored = await getRecord<EngineerChat>(key);
      if (stored && get().chat?.cardId === key) set({ chat: stored });
    },

    async send(request) {
      const record = useEditor.getState().record;
      const chat = get().chat;
      if (!record || !chat || chat.cardId !== engineerChatKey(record.id)) return;
      if (!readEngine(record.card.data)) {
        set({ error: "Turn the engine on first." });
        return;
      }
      set({ error: undefined });
      await useActivity
        .getState()
        .enqueue({ kind: "engineer", cardId: record.id, cardName: record.card.data.name, label: request }, () => runTurn(record.id, request));
    },

    async queue(cardId, cardName, label, request) {
      const name = cardName || (await getCard(cardId))?.card.data.name || "";
      return useActivity.getState().enqueue({ kind: "engineer", cardId, cardName: name, label }, () => runTurn(cardId, request));
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
          const converted = proposal.calls.some((c) => c.name === "keep_light_backup");
          const after = finishConversion(applyEngine(data, replay(config, proposal.calls).config));
          editor.replaceData(after);
          // What the change needs in words goes to the co-writer as tasks.
          if (editor.record) void fileNewGaps(editor.record.id, data, after, "engineer").catch(() => undefined);
          if (converted && editor.record) void offerStartingStates(editor.record.id);
          if (editor.record) void logChange(editor.record.id, "engineer", proposal.summaries);
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
