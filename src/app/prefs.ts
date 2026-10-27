import { create } from "zustand";
import type { CustomTheme } from "./theme";

const KEY = "cardforge.prefs";

export interface DriftPrefs {
  on: boolean;
  /** Minutes for one turn of the colour wheel, 1 to 60. */
  minutes: number;
  /** Saturation of the drifting colour, 0 to 100. */
  saturation: number;
  scope: "accent" | "borders" | "aurora";
  /** Pause while the battery is low and not charging. */
  batteryPause: boolean;
}

export interface Prefs {
  /** The Immersive Engine button's animated RGB light. */
  engineGlow: boolean;
  /** A preset id, or `custom:<id>` for one of the user's themes. */
  theme: string;
  /** Overrides the theme's accent, when set. */
  accent?: string;
  customThemes: CustomTheme[];
  drift: DriftPrefs;
  /** The open card sets the app colours (its engine theme, or its avatar's palette). */
  cardColors: boolean;
  /** A thin line in the project's own colour while one of its cards is open. */
  projectLine: boolean;
  /** Parchment by day, OLED Black at night. */
  followClock: boolean;
  texture: "none" | "paper" | "scanlines" | "stars";
  /** Each section turns the accent's hue a little. */
  sectionHues: boolean;
  /** Text size in percent. */
  textSize: number;
  density: "compact" | "comfortable" | "roomy";
  /** A serif font in the writing fields. */
  serif: boolean;
  /** A monospace font everywhere (goes well with Phosphor). */
  mono: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  engineGlow: true,
  theme: "default",
  customThemes: [],
  drift: { on: false, minutes: 10, saturation: 80, scope: "accent", batteryPause: true },
  cardColors: false,
  projectLine: false,
  followClock: false,
  texture: "none",
  sectionHues: false,
  textSize: 100,
  density: "comfortable",
  serif: false,
  mono: false,
};

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...stored, drift: { ...DEFAULT_PREFS.drift, ...stored.drift } };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Look-and-feel choices, kept on this device. */
export const usePrefs = create<Prefs & { set: (patch: Partial<Prefs>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const all = get();
      const prefs = Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, all[k as keyof Prefs]]));
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* not saved, still applied */
    }
  },
}));
