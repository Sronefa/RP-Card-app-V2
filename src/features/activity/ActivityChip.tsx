import { useState } from "react";
import { isActive, KIND_LABEL, useActivity, type ActivityItem } from "../../app/activity";
import { runningLine } from "../../app/keepAlive";
import { useUi } from "../../app/store";
import { Button, Dialog } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { useEngineer } from "../../engine/engineer/session";
import { WorkerLive } from "../engine/WorkerSteps";

const first = (s: string, n = 60) => {
  const line = s.split("\n")[0].trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** What the running job is doing, in a few words: "Engineer: step 3, building the shop app". */
export function useActivityLine(): string | undefined {
  const running = useActivity((s) => s.items.find((i) => i.status === "running"));
  const { round, worker } = useEngineer();
  return running && runningLine(running, { round, worker });
}

/** The chip on every page: what's running in the background, and a dot when something finished. */
export function ActivityChip({ className = "" }: { className?: string }) {
  const items = useActivity((s) => s.items);
  const line = useActivityLine();
  const [open, setOpen] = useState(false);
  const queued = items.filter((i) => i.status === "queued").length;
  const unseen = items.filter((i) => !isActive(i) && !i.seen);
  if (!line && !queued && !unseen.length) return null;
  const needs = unseen.some((i) => i.status === "needs-user" || i.status === "failed");
  const label = line ?? (unseen.length ? `${unseen.length} finished` : `${queued} waiting`);
  return (
    <>
      <button
        type="button"
        aria-label={`Background work: ${label}${queued ? `, ${queued} waiting` : ""}`}
        onClick={() => setOpen(true)}
        className={`flex max-w-[60vw] min-h-9 items-center gap-2 rounded-full border border-border bg-surface-raised px-3 text-xs text-ink shadow-sm hover:border-ink-muted ${className}`}
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${line ? "animate-pulse bg-accent" : needs ? "bg-amber-400" : "bg-emerald-400"}`}
        />
        <span className="truncate">{label}</span>
        {queued > 0 && line && <span className="shrink-0 text-ink-muted">+{queued}</span>}
      </button>
      <ActivityDialog
        open={open}
        onClose={() => {
          setOpen(false);
          useActivity.getState().markSeen();
        }}
      />
    </>
  );
}

const STATUS_TEXT: Record<ActivityItem["status"], string> = {
  queued: "Waiting",
  running: "Running",
  done: "Done",
  "needs-user": "Needs you",
  failed: "Failed",
  stopped: "Stopped",
};

/** The live view: the running job's steps, the queue, and what finished, each a tap away from its card. */
export function ActivityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useActivity((s) => s.items);
  const { worker, streaming, stop } = useEngineer();
  const line = useActivityLine();
  const running = items.find((i) => i.status === "running");
  const queued = items.filter((i) => i.status === "queued");
  const finished = items.filter((i) => !isActive(i)).reverse();

  async function go(item: ActivityItem) {
    if (useEditor.getState().record?.id !== item.cardId) await useEditor.getState().open(item.cardId);
    if (item.kind === "engineer") useUi.getState().goTo("engine", "engineer");
    onClose();
  }

  return (
    <Dialog open={open} title="Background work" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        {!items.length && <p className="text-ink-muted">Nothing is running. Long jobs, like the UI engineer's, run here while you keep working.</p>}
        {running && (
          <section className="flex flex-col gap-2" aria-label="Running">
            <h3 className="font-medium">Running on {running.cardName || "an unnamed card"}</h3>
            <p className="text-ink-muted">{first(running.label, 140)}</p>
            {line && <p className="text-xs text-ink-muted">{line}</p>}
            {worker ? <WorkerLive worker={worker} /> : streaming && <p className="text-xs whitespace-pre-wrap text-ink-muted">{streaming}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void go(running)}>Open</Button>
              <Button variant="ghost" onClick={stop}>
                Stop
              </Button>
            </div>
          </section>
        )}
        {queued.length > 0 && (
          <section className="flex flex-col gap-1" aria-label="Waiting">
            <h3 className="font-medium">Waiting ({queued.length})</h3>
            <ul className="flex flex-col gap-1">
              {queued.map((q) => (
                <li key={q.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {KIND_LABEL[q.kind]} on {q.cardName || "an unnamed card"}: {first(q.label)}
                  </span>
                  <Button variant="ghost" onClick={() => useActivity.getState().cancel(q.id)}>
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {finished.length > 0 && (
          <section className="flex flex-col gap-1" aria-label="Finished">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Finished</h3>
              <Button variant="ghost" onClick={() => useActivity.getState().clearFinished()}>
                Clear
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {finished.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {KIND_LABEL[f.kind]} on {f.cardName || "an unnamed card"}: {first(f.label)}
                    </span>
                    <span
                      className={`text-xs ${f.status === "failed" ? "text-red-300" : f.status === "needs-user" ? "text-amber-300" : "text-ink-muted"}`}
                    >
                      {STATUS_TEXT[f.status]}
                      {f.detail ? `: ${f.detail}` : ""}
                    </span>
                  </span>
                  <Button aria-label={`Open ${f.cardName || "the card"}`} onClick={() => void go(f)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
