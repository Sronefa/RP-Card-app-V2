import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivity, type Outcome } from "../../app/activity";
import { startKeepAlive } from "../../app/keepAlive";
import { useEngineer } from "../../engine/engineer/session";

let calls: [string, Record<string, unknown>][] = [];
const call = async (cmd: string, args?: unknown) => {
  calls.push([cmd, args as Record<string, unknown>]);
  return undefined as never;
};

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  useActivity.setState({ items: [] });
  useEngineer.setState({ round: 0, worker: undefined });
});
afterEach(() => vi.useRealTimers());

describe("the Android keep-alive service", () => {
  it("starts with the first job, follows its steps, and stops with a notice when the user is away", async () => {
    const stop = startKeepAlive(call, true);
    try {
      let finish!: (o: Outcome) => void;
      const job = useActivity
        .getState()
        .enqueue(
          {
            kind: "engineer",
            cardId: "1",
            cardName: "Mina",
            label: "Build a shop",
          },
          () => new Promise((r) => (finish = r)),
        );
      void useActivity
        .getState()
        .enqueue(
          {
            kind: "engineer",
            cardId: "2",
            cardName: "Rook",
            label: "Add a map",
          },
          async () => ({ status: "done" }),
        );
      expect(calls[0]).toEqual([
        "plugin:keepalive|start",
        {
          title: "Engineer working on Mina",
          text: "Engineer: step 1, planning",
        },
      ]);
      expect(calls.at(-1)).toEqual([
        "plugin:keepalive|update",
        {
          title: "Engineer working on Mina",
          text: "Engineer: step 1, planning · 1 more waiting",
        },
      ]);
      const before = calls.length;

      // Streamed words don't each update the notification; a new step does, a second later.
      useEngineer.setState({
        round: 1,
        worker: {
          task: "the shop app",
          steps: [{ label: "Created shop" }],
          status: "running",
          streaming: "",
        },
      });
      useEngineer.setState({
        worker: {
          task: "the shop app",
          steps: [{ label: "Created shop" }],
          status: "running",
          streaming: "Now…",
        },
      });
      expect(calls).toHaveLength(before);
      vi.advanceTimersByTime(1000);
      expect(calls[before]).toEqual([
        "plugin:keepalive|update",
        {
          title: "Engineer working on Mina",
          text: "Engineer: step 2, building the shop app · 1 more waiting",
        },
      ]);

      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      useEngineer.setState({ worker: undefined, round: 0 });
      finish({ status: "done", detail: "proposal 1 is in the inbox." });
      await job;
      await vi.runAllTimersAsync();
      expect(calls.map((c) => c[0])).toContain("plugin:keepalive|update");
      expect(calls.at(-1)).toEqual([
        "plugin:keepalive|stop",
        { title: "Engineer on Rook is done", text: undefined },
      ]);
      // One start for the whole queue.
      expect(calls.filter((c) => c[0].endsWith("start"))).toHaveLength(1);
    } finally {
      stop();
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
    }
  });

  it("does nothing off Android", () => {
    startKeepAlive(call, false)();
    void useActivity
      .getState()
      .enqueue(
        { kind: "engineer", cardId: "1", cardName: "Mina", label: "x" },
        async () => ({ status: "done" }),
      );
    expect(calls).toHaveLength(0);
  });
});
