/**
 * Background work: one queue for long jobs from any card, run one at a time while the user goes on
 * working anywhere in the app. The activity chip in the header shows what's running; a notice says
 * when a job is done or needs the user, and its results land in that card's inbox.
 */
import { create } from "zustand";
import { toast } from "../components/toast";
import { newId } from "../lib/id";

export type ActivityKind = "engineer" | "cowriter";
export type ActivityStatus = "queued" | "running" | "done" | "needs-user" | "failed" | "stopped";

export const KIND_LABEL: Record<ActivityKind, string> = { engineer: "Engineer", cowriter: "Co-writer" };

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  cardId: string;
  cardName: string;
  /** What was asked, as the user wrote it. */
  label: string;
  status: ActivityStatus;
  /** How it ended, in a sentence. */
  detail?: string;
  /** Where a running job is, in a few words, for jobs that report it ("12 of 20 written"). */
  progress?: string;
  at: number;
  endedAt?: number;
  /** The user has seen how it ended. */
  seen?: boolean;
}

export interface Outcome {
  status: Exclude<ActivityStatus, "queued" | "running">;
  detail?: string;
}

export const isActive = (item: ActivityItem) => item.status === "queued" || item.status === "running";

/** Finished jobs kept in the list. */
const KEEP_FINISHED = 20;

interface ActivityState {
  items: ActivityItem[];
  /** Adds a job to the end of the queue; resolves with how it ended. */
  enqueue: (
    item: Pick<ActivityItem, "kind" | "cardId" | "cardName" | "label">,
    run: (id: string) => Promise<Outcome>,
    /** Stops the job once it's running; the engineer's job is stopped through its own session. */
    stop?: () => void,
  ) => Promise<Outcome>;
  /** Stops the running job `id`, when it was queued with a way to stop it. */
  stop: (id: string) => void;
  /** Sets what a running job reports about where it is. */
  setProgress: (id: string, progress: string) => void;
  /** Takes a job that hasn't started out of the queue. */
  cancel: (id: string) => void;
  markSeen: () => void;
  clearFinished: () => void;
}

const jobs = new Map<string, { run: (id: string) => Promise<Outcome>; done: (o: Outcome) => void; stop?: () => void }>();

function notice(item: ActivityItem) {
  const who = `${KIND_LABEL[item.kind]} on ${item.cardName || "an unnamed card"}`;
  if (item.status === "done") toast(`${who} is done${item.detail ? `: ${item.detail}` : "."}`);
  else if (item.status === "needs-user") toast(`${who} needs you${item.detail ? `: ${item.detail}` : "."}`);
  else if (item.status === "failed") toast(`${who} failed${item.detail ? `: ${item.detail}` : "."}`, "error");
}

export const useActivity = create<ActivityState>((set, get) => {
  const patch = (id: string, change: Partial<ActivityItem>) =>
    set({ items: get().items.map((i) => (i.id === id ? { ...i, ...change } : i)) });

  async function pump() {
    if (get().items.some((i) => i.status === "running")) return;
    const next = get().items.find((i) => i.status === "queued");
    if (!next) return;
    const job = jobs.get(next.id);
    if (!job) {
      patch(next.id, { status: "stopped", endedAt: Date.now() });
      return pump();
    }
    patch(next.id, { status: "running" });
    let outcome: Outcome;
    try {
      outcome = await job.run(next.id);
    } catch (e) {
      outcome = { status: "failed", detail: (e as Error).message || "Something went wrong." };
    }
    jobs.delete(next.id);
    patch(next.id, { status: outcome.status, detail: outcome.detail, progress: undefined, endedAt: Date.now() });
    const ended = get().items.find((i) => i.id === next.id);
    if (ended && outcome.status !== "stopped") notice(ended);
    // Old finished jobs drop off the list.
    const finished = get().items.filter((i) => !isActive(i));
    if (finished.length > KEEP_FINISHED) {
      const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((i) => i.id));
      set({ items: get().items.filter((i) => !drop.has(i.id)) });
    }
    job.done(outcome);
    void pump();
  }

  return {
    items: [],
    enqueue(item, run, stop) {
      const id = newId();
      const done = new Promise<Outcome>((resolve) => jobs.set(id, { run, done: resolve, stop }));
      set({ items: [...get().items, { ...item, id, status: "queued", at: Date.now() }] });
      void pump();
      return done;
    },
    cancel(id) {
      const item = get().items.find((i) => i.id === id);
      if (item?.status !== "queued") return;
      const job = jobs.get(id);
      jobs.delete(id);
      patch(id, { status: "stopped", detail: "Taken out of the queue.", endedAt: Date.now(), seen: true });
      job?.done({ status: "stopped" });
    },
    stop(id) {
      if (get().items.find((i) => i.id === id)?.status === "running") jobs.get(id)?.stop?.();
    },
    setProgress(id, progress) {
      if (get().items.find((i) => i.id === id)?.status === "running") patch(id, { progress });
    },
    markSeen: () => set({ items: get().items.map((i) => (isActive(i) || i.seen ? i : { ...i, seen: true })) }),
    clearFinished: () => set({ items: get().items.filter(isActive) }),
  };
});
