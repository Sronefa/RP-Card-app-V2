/**
 * Token usage: what each model call cost, read from the provider's reply. Kept per part of the app
 * (co-writer, engineer, playtest, images) for this session, and per project on the device.
 */
import { create } from "zustand";
import { getSetting, putSetting } from "../db/db";
import type { CallUsage, ModeId, ModelInfo } from "./types";

export type UsageScope = "cowriter" | "engineer" | "playtest" | "images";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD, reported or worked out from the model's prices. */
  cost: number;
  /** Calls whose cost isn't known (no reported cost and no prices). */
  unpriced: number;
  calls: number;
}

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0, calls: 0 };

export interface LastCall extends CallUsage {
  /** The whole prompt: fresh, cached and cache-written tokens. */
  prompt: number;
  /** The model's context window, and whether that number is a guess. */
  contextMax: number;
  guessed: boolean;
}

export interface Meter {
  last?: LastCall;
  /** Since the current message was sent (an engineer turn is many calls). */
  turn: Usage;
  /** Since the app was opened, or the meter was reset. */
  session: Usage;
}

const EMPTY_METER: Meter = { turn: EMPTY_USAGE, session: EMPTY_USAGE };

export const scopeOf = (mode: ModeId): UsageScope =>
  mode === "engineer" || mode === "worker" ? "engineer" : mode === "playtest" || mode === "player" || mode === "sidecall" ? "playtest" : "cowriter";

export const promptTokens = (u: Pick<CallUsage, "input" | "cacheRead" | "cacheWrite">) => u.input + u.cacheRead + u.cacheWrite;
export const totalTokens = (u: Usage) => promptTokens(u) + u.output;

/** A call's cost in USD: the provider's own figure, else from the model's prices (cache reads at a tenth). */
export function callCost(call: CallUsage, info: ModelInfo): number | undefined {
  if (call.cost !== undefined) return call.cost;
  if (info.inPrice === undefined || info.outPrice === undefined) return undefined;
  return ((call.input + call.cacheWrite + call.cacheRead * 0.1) * info.inPrice + call.output * info.outPrice) / 1e6;
}

export function addUsage(a: Usage, call: CallUsage, cost: number | undefined): Usage {
  return {
    input: a.input + call.input,
    output: a.output + call.output,
    cacheRead: a.cacheRead + call.cacheRead,
    cacheWrite: a.cacheWrite + call.cacheWrite,
    cost: a.cost + (cost ?? 0),
    unpriced: a.unpriced + (cost === undefined ? 1 : 0),
    calls: a.calls + 1,
  };
}

const TOTALS_KEY = "usage";

interface UsageState {
  meters: Partial<Record<UsageScope, Meter>>;
  /** All-time totals by project id, kept on the device. */
  totals: Record<string, Usage>;
  totalsLoaded: boolean;
  record: (scope: UsageScope, call: CallUsage, info: ModelInfo & { context: number; guessed: boolean }, projectId?: string) => void;
  startTurn: (scope: UsageScope) => void;
  resetSession: (scope: UsageScope) => void;
  loadTotals: () => Promise<void>;
  clearTotals: (projectId: string) => Promise<void>;
}

export const meterOf = (s: UsageState, scope: UsageScope) => s.meters[scope] ?? EMPTY_METER;

let saving: Promise<void> = Promise.resolve();

export const useUsage = create<UsageState>((set, get) => ({
  meters: {},
  totals: {},
  totalsLoaded: false,

  record(scope, call, info, projectId) {
    const cost = callCost(call, info);
    const meter = meterOf(get(), scope);
    const last: LastCall = { ...call, prompt: promptTokens(call), contextMax: info.context, guessed: info.guessed };
    set({
      meters: {
        ...get().meters,
        [scope]: { last, turn: addUsage(meter.turn, call, cost), session: addUsage(meter.session, call, cost) },
      },
    });
    if (!projectId) return;
    // Totals are added on top of what's stored, one write at a time.
    saving = saving.then(async () => {
      await get().loadTotals();
      const totals = { ...get().totals, [projectId]: addUsage(get().totals[projectId] ?? EMPTY_USAGE, call, cost) };
      set({ totals });
      await putSetting(TOTALS_KEY, totals).catch(() => undefined);
    });
  },

  startTurn(scope) {
    set({ meters: { ...get().meters, [scope]: { ...meterOf(get(), scope), turn: EMPTY_USAGE } } });
  },

  resetSession(scope) {
    set({ meters: { ...get().meters, [scope]: EMPTY_METER } });
  },

  async loadTotals() {
    if (get().totalsLoaded) return;
    const stored = await getSetting<Record<string, Usage>>(TOTALS_KEY).catch(() => undefined);
    if (!get().totalsLoaded) set({ totals: { ...stored, ...get().totals }, totalsLoaded: true });
  },

  async clearTotals(projectId) {
    await get().loadTotals();
    const totals = { ...get().totals };
    delete totals[projectId];
    set({ totals });
    await putSetting(TOTALS_KEY, totals);
  },
}));

/** "12.3k", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export const formatCost = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
