import { useState } from "react";
import { formatCost, formatTokens, meterOf, promptTokens, totalTokens, useUsage, type Usage, type UsageScope } from "../../ai/usage";

const label = (u: Usage) =>
  `${formatTokens(promptTokens(u))} in · ${formatTokens(u.output)} out${u.cacheRead ? ` · ${formatTokens(u.cacheRead)} cached` : ""}`;

const cost = (u: Usage) => (u.calls && u.cost ? `${formatCost(u.cost)}${u.unpriced ? "+" : ""}` : "");

/**
 * Token use of one part of the app: this message (`turn`), the session, how full the context of
 * the last call was, and the cost when it's known. Tapping it opens a breakdown, when given one.
 */
export function UsageMeter({
  scope,
  turnLabel = "This message",
  breakdown,
  extra,
}: {
  scope: UsageScope;
  turnLabel?: string;
  /** Estimated tokens by source, shown when the meter is tapped. */
  breakdown?: () => { label: string; tokens: number }[];
  /** More rows for the breakdown, like screenshot tokens. */
  extra?: string;
}) {
  const meter = useUsage((s) => meterOf(s, scope));
  const reset = useUsage((s) => s.resetSession);
  const [open, setOpen] = useState(false);
  const { last, turn, session } = meter;
  if (!session.calls) return null;
  const fill = last ? Math.min(1, last.prompt / last.contextMax) : 0;
  const warn = fill >= 0.8;
  const rows = open ? (breakdown?.() ?? []) : [];
  const rowsTotal = rows.reduce((n, r) => n + r.tokens, 0);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-ink-muted">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Token use"
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left"
      >
        {turn.calls > 0 && (
          <span>
            <span className="text-ink">{turnLabel}:</span> {label(turn)}
            {cost(turn) && ` · ${cost(turn)}`}
          </span>
        )}
        <span>
          <span className="text-ink">Session:</span> {formatTokens(totalTokens(session))} tokens, {session.calls}{" "}
          {session.calls === 1 ? "call" : "calls"}
          {cost(session) && ` · ${cost(session)}`}
        </span>
      </button>
      {last && (
        <div className="flex items-center gap-2">
          <div
            role="meter"
            aria-label="Context used by the last call"
            aria-valuemin={0}
            aria-valuemax={last.contextMax}
            aria-valuenow={last.prompt}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div className={`h-full rounded-full ${warn ? "bg-amber-400" : "bg-accent"}`} style={{ width: `${Math.max(1, fill * 100)}%` }} />
          </div>
          <span className={warn ? "text-amber-300" : ""}>
            {formatTokens(last.prompt)} / {last.guessed ? "~" : ""}
            {formatTokens(last.contextMax)} context{warn ? ": nearly full" : ""}
          </span>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-1 border-t border-border pt-1.5">
          <span>
            Session: {label(session)}
            {session.cacheWrite ? ` · ${formatTokens(session.cacheWrite)} written to cache` : ""}
            {session.unpriced ? ` · ${session.unpriced} ${session.unpriced === 1 ? "call" : "calls"} without a known price` : ""}
          </span>
          {extra && <span>{extra}</span>}
          {rows.length > 0 && (
            <>
              <span className="text-ink">What fills the context now (estimated):</span>
              <ul aria-label="Context breakdown" className="flex flex-col gap-0.5">
                {rows
                  .filter((r) => r.tokens > 0)
                  .map((r) => (
                    <li key={r.label} className="flex items-center gap-2">
                      <span className="w-28 shrink-0">{r.label}</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <span className="block h-full bg-ink-muted" style={{ width: `${(r.tokens / Math.max(1, rowsTotal)) * 100}%` }} />
                      </span>
                      <span className="w-12 shrink-0 text-right">{formatTokens(r.tokens)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
          <button type="button" className="self-start underline" onClick={() => reset(scope)}>
            Reset the session count
          </button>
        </div>
      )}
    </div>
  );
}
