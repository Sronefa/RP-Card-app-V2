/**
 * The card theme: one set of CSS variables every engine screen shares, from one of five presets
 * with the author's own changes on top. Players can switch light and dark and the text size in the
 * settings app; nothing here loads from the web (fonts are system font stacks, textures are CSS).
 */

export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
  good: string;
  bad: string;
  /** Corner radius in px. */
  radius: number;
  font: string;
  heading: string;
  /** A CSS background-image for the panel surface, or "none". */
  texture: string;
  shadow: string;
}

export type ThemeMode = "light" | "dark";

export interface ThemePreset {
  id: PresetId;
  name: string;
  description: string;
  /** The mode the preset is designed for; the other is its alternative. */
  mode: ThemeMode;
  light: ThemeTokens;
  dark: ThemeTokens;
}

export type PresetId = "parchment" | "cyberpunk" | "novel" | "dating" | "phone";

export interface CardTheme {
  preset: PresetId;
  /** The author's changes, applied to both modes. */
  overrides: Partial<ThemeTokens>;
}

export const FONTS: Record<string, string> = {
  System: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  Serif: 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, "Noto Serif", serif',
  Rounded: '"Segoe UI Variable Display", "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
  Mono: 'ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "Roboto Mono", monospace',
  Elegant: '"Didot", "Bodoni MT", "Noto Serif Display", Georgia, serif',
};

const parchmentTexture =
  "radial-gradient(circle at 20% 15%, rgba(255,255,255,.35), transparent 40%), radial-gradient(circle at 85% 80%, rgba(120,80,30,.12), transparent 45%)";
const scanlines = "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)";

export const PRESETS: Record<PresetId, ThemePreset> = {
  parchment: {
    id: "parchment",
    name: "Fantasy parchment",
    description: "Aged paper, ink and gold, with wax-red accents.",
    mode: "light",
    light: {
      bg: "#efe2c2",
      surface: "#f6ecd2",
      surface2: "#e6d3a8",
      text: "#3a2a17",
      muted: "#7a6243",
      accent: "#8c2318",
      accent2: "#a8862a",
      border: "#b9995c",
      good: "#4d7a2a",
      bad: "#9c2b1f",
      radius: 4,
      font: FONTS.Serif,
      heading: FONTS.Serif,
      texture: parchmentTexture,
      shadow: "0 2px 6px rgba(60,40,10,.25)",
    },
    dark: {
      bg: "#1f1710",
      surface: "#2a2016",
      surface2: "#3a2c1c",
      text: "#ead9b4",
      muted: "#b09a74",
      accent: "#d0533f",
      accent2: "#d4af37",
      border: "#6b5232",
      good: "#8fbf5a",
      bad: "#e0634f",
      radius: 4,
      font: FONTS.Serif,
      heading: FONTS.Serif,
      texture: "radial-gradient(circle at 50% 0%, rgba(212,175,55,.10), transparent 60%)",
      shadow: "0 2px 8px rgba(0,0,0,.5)",
    },
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk HUD",
    description: "Neon magenta and cyan on black, monospace data, scanlines.",
    mode: "dark",
    dark: {
      bg: "#07070d",
      surface: "#0e0e1a",
      surface2: "#161628",
      text: "#d8f6ff",
      muted: "#7189a8",
      accent: "#ff2bd6",
      accent2: "#00e5ff",
      border: "#00e5ff66",
      good: "#39ff88",
      bad: "#ff3b5c",
      radius: 0,
      font: FONTS.Mono,
      heading: FONTS.Mono,
      texture: scanlines,
      shadow: "0 0 12px rgba(0,229,255,.25)",
    },
    light: {
      bg: "#eef3f7",
      surface: "#ffffff",
      surface2: "#e1e9f0",
      text: "#0b1320",
      muted: "#56677d",
      accent: "#c2009e",
      accent2: "#007a99",
      border: "#007a9955",
      good: "#0a8f4a",
      bad: "#c4153a",
      radius: 0,
      font: FONTS.Mono,
      heading: FONTS.Mono,
      texture: "none",
      shadow: "0 1px 4px rgba(0,0,0,.15)",
    },
  },
  novel: {
    id: "novel",
    name: "Visual novel",
    description: "A translucent dialogue frame with soft gradients.",
    mode: "dark",
    dark: {
      bg: "#1a1528",
      surface: "rgba(34, 27, 54, 0.92)",
      surface2: "rgba(58, 46, 90, 0.9)",
      text: "#f4efff",
      muted: "#b3a7d1",
      accent: "#ff8fb8",
      accent2: "#8fc8ff",
      border: "rgba(255, 255, 255, 0.22)",
      good: "#8fe3b0",
      bad: "#ff8f8f",
      radius: 14,
      font: FONTS.Rounded,
      heading: FONTS.Elegant,
      texture: "linear-gradient(160deg, rgba(255,143,184,.10), rgba(143,200,255,.08))",
      shadow: "0 6px 20px rgba(0,0,0,.35)",
    },
    light: {
      bg: "#f6f1ff",
      surface: "rgba(255, 255, 255, 0.94)",
      surface2: "#ece4ff",
      text: "#2c2340",
      muted: "#776a93",
      accent: "#e0457f",
      accent2: "#3c8ad8",
      border: "rgba(60, 40, 110, 0.18)",
      good: "#2f9e62",
      bad: "#d64545",
      radius: 14,
      font: FONTS.Rounded,
      heading: FONTS.Elegant,
      texture: "linear-gradient(160deg, rgba(224,69,127,.06), rgba(60,138,216,.05))",
      shadow: "0 6px 18px rgba(60,40,110,.15)",
    },
  },
  dating: {
    id: "dating",
    name: "Dating sim",
    description: "Pinks and peach, round corners, playful.",
    mode: "light",
    light: {
      bg: "#fff0f5",
      surface: "#ffffff",
      surface2: "#ffe0eb",
      text: "#4a2536",
      muted: "#9a6a7f",
      accent: "#ff3d7f",
      accent2: "#ff9f43",
      border: "#ffc2d6",
      good: "#2fb67c",
      bad: "#e8455b",
      radius: 18,
      font: FONTS.Rounded,
      heading: FONTS.Rounded,
      texture: "radial-gradient(circle at 90% 10%, rgba(255,61,127,.08), transparent 40%)",
      shadow: "0 4px 14px rgba(255,61,127,.15)",
    },
    dark: {
      bg: "#2a1420",
      surface: "#3a1d2c",
      surface2: "#4d2639",
      text: "#ffe6ef",
      muted: "#d39ab3",
      accent: "#ff6b9d",
      accent2: "#ffb870",
      border: "#6e3550",
      good: "#5fd6a0",
      bad: "#ff6b7e",
      radius: 18,
      font: FONTS.Rounded,
      heading: FONTS.Rounded,
      texture: "radial-gradient(circle at 90% 10%, rgba(255,107,157,.12), transparent 40%)",
      shadow: "0 4px 14px rgba(0,0,0,.4)",
    },
  },
  phone: {
    id: "phone",
    name: "Modern phone OS",
    description: "Clean system UI, like a phone's own apps.",
    mode: "light",
    light: {
      bg: "#f2f2f7",
      surface: "#ffffff",
      surface2: "#e9e9ef",
      text: "#1c1c1e",
      muted: "#8e8e93",
      accent: "#0a84ff",
      accent2: "#34c759",
      border: "#d1d1d6",
      good: "#34c759",
      bad: "#ff3b30",
      radius: 14,
      font: FONTS.System,
      heading: FONTS.System,
      texture: "none",
      shadow: "0 1px 3px rgba(0,0,0,.12)",
    },
    dark: {
      bg: "#000000",
      surface: "#1c1c1e",
      surface2: "#2c2c2e",
      text: "#f2f2f7",
      muted: "#98989f",
      accent: "#0a84ff",
      accent2: "#30d158",
      border: "#38383a",
      good: "#30d158",
      bad: "#ff453a",
      radius: 14,
      font: FONTS.System,
      heading: FONTS.System,
      texture: "none",
      shadow: "0 1px 3px rgba(0,0,0,.5)",
    },
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const newTheme = (accent?: string): CardTheme => ({ preset: "phone", overrides: accent && accent !== "#a78bfa" ? { accent } : {} });

/** The tokens for a mode, the author's changes on top. */
export function themeTokens(theme: CardTheme, mode?: ThemeMode): ThemeTokens {
  const preset = PRESETS[theme.preset] ?? PRESETS.phone;
  return { ...preset[mode ?? preset.mode], ...cleanOverrides(theme.overrides) };
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

/** Only values that are safe inside a CSS declaration. */
export function cleanOverrides(overrides: Partial<ThemeTokens> | undefined): Partial<ThemeTokens> {
  const out: Partial<ThemeTokens> = {};
  for (const [key, value] of Object.entries(overrides ?? {}) as [keyof ThemeTokens, unknown][]) {
    if (key === "radius") {
      if (typeof value === "number" && Number.isFinite(value)) out.radius = Math.max(0, Math.min(40, value));
    } else if (key === "font" || key === "heading") {
      if (typeof value === "string" && Object.values(FONTS).includes(value)) out[key] = value;
    } else if (key === "texture") {
      if (value === "none" || (typeof value === "string" && !/[;{}<>]|url\(/i.test(value))) out.texture = value as string;
    } else if (key === "shadow") {
      if (typeof value === "string" && !/[;{}<>]|url\(/i.test(value)) out.shadow = value;
    } else if (typeof value === "string" && COLOR.test(value.trim())) {
      (out as Record<string, string>)[key] = value.trim();
    }
  }
  return out;
}

/** The tokens as CSS custom properties. */
export function themeVars(tokens: ThemeTokens): string {
  return [
    `--cf-bg: ${tokens.bg}`,
    `--cf-surface: ${tokens.surface}`,
    `--cf-surface2: ${tokens.surface2}`,
    `--cf-text: ${tokens.text}`,
    `--cf-muted: ${tokens.muted}`,
    `--cf-accent: ${tokens.accent}`,
    `--cf-accent2: ${tokens.accent2}`,
    `--cf-border: ${tokens.border}`,
    `--cf-good: ${tokens.good}`,
    `--cf-bad: ${tokens.bad}`,
    `--cf-radius: ${tokens.radius}px`,
    `--cf-font: ${tokens.font}`,
    `--cf-heading: ${tokens.heading}`,
    `--cf-texture: ${tokens.texture}`,
    `--cf-shadow: ${tokens.shadow}`,
  ].join("; ");
}

/** Both modes, for the engine core to switch between. */
export function themeBundle(theme: CardTheme) {
  const preset = PRESETS[theme.preset] ?? PRESETS.phone;
  return { preset: preset.id, mode: preset.mode, light: themeTokens(theme, "light"), dark: themeTokens(theme, "dark") };
}
