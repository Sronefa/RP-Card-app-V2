import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { isAbort } from "../../cowriter/engine";

/** Runs one co-writer call at a time, with a status line, an error and a Stop button. */
export function useRun() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(status: string, fn: (signal: AbortSignal) => Promise<void>) {
    setBusy(status);
    setError(undefined);
    controller.current = new AbortController();
    try {
      await fn(controller.current.signal);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }
  const status = (busy || error) && (
    <>
      {busy && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-ink-muted" aria-live="polite">
            {busy}
          </p>
          <Button variant="ghost" onClick={() => controller.current?.abort()}>
            Stop
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </>
  );
  return { busy, run, status };
}
