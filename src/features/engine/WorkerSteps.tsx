import type { WorkerRun } from "../../engine/engineer/worker";

/** The worker's steps as they happen. */
export function WorkerLive({ worker }: { worker: WorkerRun & { streaming: string } }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-raised p-3" aria-label="Worker">
      <span className="text-xs font-medium text-ink">
        Worker, step {worker.steps.length + 1}: {worker.task.split("\n")[0]}
      </span>
      <WorkerSteps steps={worker.steps} />
      {worker.streaming && <span className="text-xs leading-relaxed whitespace-pre-wrap">{worker.streaming}</span>}
    </section>
  );
}

export function WorkerSteps({ steps }: { steps: WorkerRun["steps"] }) {
  if (!steps.length) return null;
  return (
    <ol className="flex flex-col gap-0.5 text-xs text-ink-muted" aria-label="Worker steps">
      {steps.map((st, n) => (
        <li key={n} className={st.error ? "text-red-300" : ""}>
          {st.label}
        </li>
      ))}
    </ol>
  );
}
