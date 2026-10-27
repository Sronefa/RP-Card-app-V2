import { useState } from "react";
import type { TestResult } from "../../ai/connection";
import { Button } from "../../components/ui";

/** A provider's Test button, with what it found in plain words underneath. */
export function ConnectionTest({ name, run, disabled }: { name: string; run: () => Promise<TestResult>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult>();
  async function test() {
    setBusy(true);
    setResult(undefined);
    try {
      setResult(await run());
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message || "The test failed." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button aria-label={`Test ${name}`} disabled={busy || disabled} onClick={() => void test()}>
        {busy ? "Testing…" : "Test"}
      </Button>
      {result && (
        <p role="status" aria-label={`Test result for ${name}`} className="order-last w-full text-xs">
          <span className={result.ok ? "text-emerald-300" : "text-red-300"}>
            {result.ok ? "Works. " : "Failed. "}
            {result.message}
          </span>
          {result.warning && <span className="block text-amber-300">{result.warning}</span>}
        </p>
      )}
    </>
  );
}
