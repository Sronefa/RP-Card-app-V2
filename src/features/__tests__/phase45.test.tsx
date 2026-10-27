import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActivity, type Outcome } from "../../app/activity";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useToasts } from "../../components/toast";
import { createCard, createProject, engineerChatKey, getRecord, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { engineerHooks, useEngineer, type EngineerChat } from "../../engine/engineer/session";
import { ActivityChip } from "../activity/ActivityChip";
import { EngineView } from "../engine/EngineView";

const script = vi.hoisted(() => ({
  replies: [] as (CompletionResult | (() => Promise<CompletionResult>))[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      return typeof next === "function" ? next() : next;
    },
  }),
}));

const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.requests.length}-${i}-${name}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});

const toasts = () => useToasts.getState().toasts.map((t) => t.text);

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  engineerHooks.preview = () => undefined;
  useActivity.setState({ items: [] });
  useToasts.setState({ toasts: [] });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useEngineer.setState({ chat: undefined, busy: false, runningCardId: undefined, streaming: "", error: undefined, draft: "" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "anthropic", name: "Claude", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "strong" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
    },
  });
});

describe("the background queue", () => {
  it("runs jobs one at a time in order, takes waiting ones out, and gives notices", async () => {
    const order: string[] = [];
    let finishFirst!: (o: Outcome) => void;
    const store = useActivity.getState();
    const a = store.enqueue({ kind: "engineer", cardId: "1", cardName: "Mina", label: "Build a shop" }, () => {
      order.push("a");
      return new Promise<Outcome>((r) => (finishFirst = r));
    });
    const b = store.enqueue({ kind: "engineer", cardId: "2", cardName: "Rook", label: "Add a map" }, async () => {
      order.push("b");
      return { status: "needs-user", detail: "it paused at your token limit." };
    });
    const c = store.enqueue({ kind: "engineer", cardId: "2", cardName: "Rook", label: "Never mind" }, async () => {
      order.push("c");
      return { status: "done" };
    });
    expect(useActivity.getState().items.map((i) => i.status)).toEqual(["running", "queued", "queued"]);
    useActivity.getState().cancel(useActivity.getState().items[2].id);
    expect(await c).toEqual({ status: "stopped" });

    finishFirst({ status: "done", detail: "proposal 1 is in the inbox." });
    await a;
    expect(await b).toMatchObject({ status: "needs-user" });
    expect(order).toEqual(["a", "b"]);
    expect(toasts()).toEqual(["Engineer on Mina is done: proposal 1 is in the inbox.", "Engineer on Rook needs you: it paused at your token limit."]);

    render(<ActivityChip />);
    fireEvent.click(screen.getByRole("button", { name: "Background work: 2 finished" }));
    const finished = within(screen.getByRole("region", { name: "Finished" }));
    expect(finished.getByText("Needs you: it paused at your token limit.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    // Once seen, the chip goes away until something new happens.
    expect(screen.queryByRole("button", { name: /Background work/ })).toBeNull();
  });
});

describe("the engineer in the background", () => {
  it("keeps building on one card while another is open, queues that card's message, and lands the proposal in the first card's chat", async () => {
    const project = await createProject("P");
    const mina = await createCard(project.id, "character");
    const rook = await createCard(project.id, "character");
    await useEditor.getState().open(rook.id);
    useEditor.getState().setField("name", "Rook");
    render(
      <>
        <ActivityChip />
        <EngineView />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    await useEditor.getState().open(mina.id);
    useEditor.getState().setField("name", "Mina");
    fireEvent.click(await screen.findByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("tab", { name: "Engineer" }));

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    script.replies = [
      async () => {
        await gate;
        return reply("", [["run_worker", { task: "Build the bank" }]]);
      },
      reply("", [["create_module", { id: "bank", name: "Bank", slot: "overlay", button: "🏦 Bank" }]]),
      reply("Built."),
      reply("The bank is ready."),
      reply("Rook has no screens yet."),
    ];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Make a bank app" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("button", { name: /Background work: Engineer: step 1, planning/ })).toBeInTheDocument();

    // The user opens another card: the turn goes on, and that card's message waits in line.
    await act(() => useEditor.getState().open(rook.id));
    fireEvent.click(await screen.findByRole("tab", { name: "Engineer" }));
    await waitFor(() => expect(useEngineer.getState().chat?.cardId).toBe(engineerChatKey(rook.id)));
    expect(await screen.findByText(/The engineer is working on Mina right now/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "What screens are there?" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    expect(within(await screen.findByRole("list", { name: "Waiting in line" })).getByText("Waiting: What screens are there?")).toBeInTheDocument();

    release();
    await waitFor(() => expect(useActivity.getState().items.every((i) => i.status === "done")).toBe(true));
    const minaChat = await getRecord<EngineerChat>(engineerChatKey(mina.id));
    expect(minaChat!.proposals).toHaveLength(1);
    expect(minaChat!.messages.at(-1)).toMatchObject({ role: "assistant", text: "The bank is ready." });
    // Rook's turn ran after, on Rook's own chat.
    expect(await screen.findByText("Rook has no screens yet.")).toBeInTheDocument();
    expect(toasts()).toEqual(["Engineer on Mina is done: proposal 1 is in the inbox.", "Engineer on Rook is done: it answered in the engineer chat."]);

    // The proposal waits in Mina's engineer chat (and so her inbox) when she's opened again.
    await act(() => useEditor.getState().open(mina.id));
    fireEvent.click(await screen.findByRole("tab", { name: "Engineer" }));
    expect(await screen.findByRole("region", { name: "Proposal 1" })).toBeInTheDocument();
  });
});
