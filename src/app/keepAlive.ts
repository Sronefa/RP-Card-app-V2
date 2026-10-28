/**
 * On Android, a foreground service keeps background work running when the app is minimized or the
 * phone is locked (src-tauri/plugins/keepalive). It starts when a job starts, its notification
 * follows the job's steps, and it stops when the queue is empty, leaving a notice if the user was
 * away when the work ended.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEngineer } from "../engine/engineer/session";
import { isActive, KIND_LABEL, useActivity, type ActivityItem } from "./activity";

/** "Engineer: step 3, building the shop app" for the running job. */
export function runningLine(item: ActivityItem, engineer: { round: number; worker?: { task: string; steps: unknown[] } }): string {
  const short = (s: string, n: number) => {
    const line = s.split("\n")[0].trim();
    return line.length > n ? `${line.slice(0, n - 1)}…` : line;
  };
  const { round, worker } = engineer;
  const step = worker ? `step ${worker.steps.length + 1}, building ${short(worker.task, 40)}` : `step ${Math.max(round, 1)}, planning`;
  return `${KIND_LABEL[item.kind]}: ${step}`;
}

/** What the notification says: who works on which card, the step, and what waits. */
export function keepAliveStatus(items: ActivityItem[], engineer: Parameters<typeof runningLine>[1]) {
  const running = items.find((i) => i.status === "running");
  if (!running) return undefined;
  const queued = items.filter((i) => i.status === "queued").length;
  return {
    title: `${KIND_LABEL[running.kind]} working on ${running.cardName || "a card"}`,
    text: [runningLine(running, engineer), queued ? `${queued} more waiting` : ""].filter(Boolean).join(" · "),
  };
}

/** The notice left when the work ends while the user is away. */
export function endNotice(items: ActivityItem[]) {
  const last = items.filter((i) => !isActive(i) && i.status !== "stopped").at(-1);
  if (!last) return {};
  const what = { done: "is done", "needs-user": "needs you", failed: "failed" }[last.status as "done" | "needs-user" | "failed"];
  return { title: `${KIND_LABEL[last.kind]} on ${last.cardName || "a card"} ${what}`, text: last.detail };
}

const onAndroid = () => isTauri() && /Android/i.test(navigator.userAgent);

/** Follows the queue and keeps the service in step with it. Call once at startup. */
export function startKeepAlive(call: typeof invoke = invoke, enabled = onAndroid()) {
  if (!enabled) return () => undefined;
  let on = false;
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (command: string, args: Record<string, unknown>) => void call(`plugin:keepalive|${command}`, args).catch(() => undefined);

  const sync = () => {
    timer = undefined;
    const items = useActivity.getState().items;
    const status = keepAliveStatus(items, useEngineer.getState());
    if (status) {
      const key = `${status.title}\n${status.text}`;
      if (key === last) return;
      last = key;
      send(on ? "update" : "start", status);
      on = true;
    } else if (on && !items.some(isActive)) {
      on = false;
      last = "";
      send("stop", typeof document !== "undefined" && document.visibilityState === "hidden" ? endNotice(items) : {});
    }
  };
  // The engineer's state changes with every streamed word; the notification needn't.
  const soon = () => {
    timer ??= setTimeout(sync, 1000);
  };
  const offActivity = useActivity.subscribe(sync);
  const offEngineer = useEngineer.subscribe(soon);
  return () => {
    offActivity();
    offEngineer();
    if (timer) clearTimeout(timer);
  };
}
