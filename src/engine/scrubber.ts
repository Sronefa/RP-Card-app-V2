/**
 * The state scrubber: a card's screens at several states at once, so a design is checked at its
 * edges and not only with the starting values. Low and empty, high and full, morning and night,
 * built from the card's own values and their limits.
 */
import { effectiveConfig } from "./modules/compile";
import { initialState, startValue, varPath, type EngineConfig, type EngineVar } from "./sheet";

export interface SampleState {
  id: string;
  label: string;
  state: Record<string, unknown>;
}

const LONG_TEXT = "A much longer value than usual, to see how it wraps";

function lowValue(v: EngineVar): unknown {
  switch (v.type) {
    case "number":
      // A sliver of the bar, not nothing: the low end of a real game.
      return v.min !== undefined && v.max !== undefined ? Math.round(v.min + (v.max - v.min) * 0.1) : (v.min ?? 0);
    case "toggle":
      return false;
    case "choice":
      return v.options?.[0] ?? startValue(v);
    case "list":
      return [];
    case "counts":
      return {};
    default:
      return startValue(v);
  }
}

function highValue(v: EngineVar): unknown {
  const start = startValue(v);
  switch (v.type) {
    case "number":
      return v.max ?? 99999;
    case "toggle":
      return true;
    case "choice":
      return v.options?.at(-1) ?? start;
    case "list": {
      const items = Array.isArray(start) ? start.map(String) : [];
      for (let i = items.length; i < 8; i++) items.push(`${v.name} ${i + 1}`);
      return items;
    }
    case "counts": {
      const out: Record<string, number> = { ...(start as Record<string, number>) };
      for (let i = Object.keys(out).length; i < 8; i++) out[`${v.name} ${i + 1}`] = 99;
      return Object.fromEntries(Object.keys(out).map((k) => [k, 99]));
    }
    default:
      return String(start ?? "").length > 40 ? start : LONG_TEXT;
  }
}

function stateWith(vars: EngineVar[], value: (v: EngineVar) => unknown, base: Record<string, unknown>): Record<string, unknown> {
  const state = structuredClone(base);
  for (const v of vars) {
    // Values the AI can't change are the engine's own (the weekday, the part of day): left as they are.
    if (v.readOnly) continue;
    const path = varPath(v);
    if (path.length === 2) {
      const group = (state[path[0]] ??= {}) as Record<string, unknown>;
      group[path[1]] = value(v);
    } else state[path[0]] = value(v);
  }
  return state;
}

/** The states worth seeing for this card: its start, its low and high ends, and day and night when it keeps time. */
export function sampleStates(config: EngineConfig): SampleState[] {
  const full = effectiveConfig(config);
  const vars = full.vars.filter((v) => v.name.trim());
  const start = initialState(full);
  const out: SampleState[] = [
    { id: "start", label: "Starting values", state: start },
    { id: "low", label: "Low and empty", state: stateWith(vars, lowValue, start) },
    { id: "high", label: "High and full", state: stateWith(vars, highValue, start) },
  ];
  const time = start.Time as Record<string, unknown> | undefined;
  if (time && typeof time.Clock === "string") {
    out.push({ id: "morning", label: "Morning", state: { ...start, Time: { ...time, Clock: "07:30", PartOfDay: "Morning" } } });
    out.push({ id: "night", label: "Night", state: { ...start, Time: { ...time, Clock: "23:30", PartOfDay: "Night" } } });
  }
  return out;
}
