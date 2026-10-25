import { create } from "zustand";

const KEY = "cardforge.prefs";

interface Prefs {
  /** The Immersive Engine button's animated RGB light. */
  engineGlow: boolean;
}

function load(): Prefs {
  try {
    return { engineGlow: true, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { engineGlow: true };
  }
}

/** Small look-and-feel choices, kept on this device. */
export const usePrefs = create<Prefs & { set: (patch: Partial<Prefs>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { engineGlow } = { ...get(), ...patch };
      localStorage.setItem(KEY, JSON.stringify({ engineGlow }));
    } catch {
      /* not saved, still applied */
    }
  },
}));
