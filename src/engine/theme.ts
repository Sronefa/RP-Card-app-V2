/**
 * The card theme: one set of CSS variables every engine screen shares, from one of ten presets
 * with the author's own changes on top. Players can switch light and dark and the text size in the
 * settings app. Nothing here loads from the web: fonts are system stacks or a small bundled set that
 * a card carries only when it uses them, and textures are CSS gradients or inline SVG.
 */
import { FONT_FILES } from "./fonts/files";

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

export type PresetId = "parchment" | "cyberpunk" | "novel" | "dating" | "phone" | "academy" | "grimdark" | "system" | "starship" | "dread";

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
  Cinzel: '"Cinzel", "Trajan Pro", Georgia, serif',
  "Pirata One": '"Pirata One", "Old English Text MT", Georgia, serif',
  Orbitron: '"Orbitron", "Eurostile", ui-monospace, sans-serif',
  "Share Tech Mono": '"Share Tech Mono", ui-monospace, Menlo, Consolas, monospace',
  "Playfair Display": '"Playfair Display", "Didot", Georgia, serif',
  "Patrick Hand": '"Patrick Hand", "Comic Neue", "Segoe Print", system-ui, sans-serif',
};

/** The bundled fonts: what each suits, for the design guide and the font picker. */
export const BUNDLED_FONTS: Record<string, string> = {
  Cinzel: "carved Roman capitals: dark fantasy, epic, ancient",
  "Pirata One": "blackletter: grimdark, gothic horror, pirates",
  Orbitron: "wide geometric: sci-fi, cyberpunk HUD, mecha",
  "Share Tech Mono": "technical monospace: consoles, terminals, readouts",
  "Playfair Display": "high-contrast serif: romance, period drama, luxury",
  "Patrick Hand": "neat handwriting: cozy slice of life, notes, diaries",
};

/** The bundled fonts named in any of these texts (theme tokens, a screen's CSS). */
export function usedFonts(texts: string[]): string[] {
  const all = texts.join("\n");
  return Object.keys(FONT_FILES).filter((name) => all.includes(name));
}

/** @font-face rules that embed the given bundled fonts, so a card needs no network for them. */
export function fontFaces(names: string[]): string {
  return names
    .filter((n) => FONT_FILES[n])
    .map((n) => `@font-face { font-family: "${n}"; src: url(data:font/woff2;base64,${FONT_FILES[n]}) format("woff2"); font-display: swap; }`)
    .join("\n");
}

/** Inline SVG as a CSS url(), for textures. */
const svgUrl = (svg: string) =>
  `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;

const noise = (opacity: number, frequency: number) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${opacity} 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
  );

/**
 * Textures to pick from for the theme's `texture` token: layers over the surface colour. They are
 * the only textures that may hold an image (inline SVG); anything else must be gradients.
 */
export const TEXTURES: Record<string, string> = {
  Paper: `radial-gradient(circle at 20% 15%, rgba(255,255,255,.3), transparent 45%), radial-gradient(circle at 85% 85%, rgba(120,80,30,.12), transparent 50%), ${noise(0.1, 0.9)}`,
  Grain: noise(0.08, 0.75),
  Linen: "repeating-linear-gradient(45deg, rgba(127,127,127,.05) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgba(127,127,127,.05) 0 1px, transparent 1px 4px)",
  Scanlines: "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)",
  Grid: "linear-gradient(rgba(127,127,127,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,.08) 1px, transparent 1px)",
  Hex: svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="48"><path d="M14 0l14 8v16L14 32 0 24V8zM14 32v16" fill="none" stroke="rgba(127,127,127,.12)" stroke-width="1"/></svg>`,
  ),
  Stars: "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,.4), transparent), radial-gradient(1.5px 1.5px at 40% 80%, rgba(255,255,255,.35), transparent), radial-gradient(1px 1px at 85% 15%, rgba(255,255,255,.45), transparent)",
  Vignette: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.35))",
};

/** The texture's name, when it is one of the set. */
export const textureName = (value: string) => Object.entries(TEXTURES).find(([, v]) => v === value)?.[0];

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
  academy: {
    id: "academy",
    name: "Academy",
    description: "Navy and crest gold on crisp paper, like a school's own handbook.",
    mode: "light",
    light: {
      bg: "#f4f1ea",
      surface: "#fffdf8",
      surface2: "#e9e4d8",
      text: "#1d2840",
      muted: "#66708a",
      accent: "#1f3a6e",
      accent2: "#b8892b",
      border: "#cfc6b2",
      good: "#2e7d4f",
      bad: "#b3382c",
      radius: 10,
      font: FONTS.System,
      heading: FONTS.Serif,
      texture: "linear-gradient(180deg, rgba(31,58,110,.05), transparent 120px)",
      shadow: "0 1px 4px rgba(29,40,64,.14)",
    },
    dark: {
      bg: "#0f1626",
      surface: "#17213a",
      surface2: "#202c4a",
      text: "#ece7da",
      muted: "#9aa5bf",
      accent: "#6f95e0",
      accent2: "#e0b85a",
      border: "#33415f",
      good: "#5fbf86",
      bad: "#e2675a",
      radius: 10,
      font: FONTS.System,
      heading: FONTS.Serif,
      texture: "linear-gradient(180deg, rgba(224,184,90,.06), transparent 120px)",
      shadow: "0 1px 6px rgba(0,0,0,.45)",
    },
  },
  grimdark: {
    id: "grimdark",
    name: "Grimdark",
    description: "Ash, iron and old blood: a dark, worn look for dark fantasy and survival.",
    mode: "dark",
    dark: {
      bg: "#0d0b0a",
      surface: "#171412",
      surface2: "#221d19",
      text: "#ddd3c3",
      muted: "#958a7a",
      accent: "#a8322a",
      accent2: "#c08a3e",
      border: "#3b322b",
      good: "#7f9a5a",
      bad: "#d24a3a",
      radius: 3,
      font: FONTS.Serif,
      heading: FONTS.Elegant,
      texture: "radial-gradient(circle at 50% -10%, rgba(168,50,42,.14), transparent 55%), repeating-linear-gradient(45deg, rgba(255,255,255,.012) 0 2px, transparent 2px 5px)",
      shadow: "0 2px 10px rgba(0,0,0,.6)",
    },
    light: {
      bg: "#d9d3c9",
      surface: "#e8e3da",
      surface2: "#cdc5b8",
      text: "#221c17",
      muted: "#5f564c",
      accent: "#8a241d",
      accent2: "#8a5f22",
      border: "#a3988a",
      good: "#4f6a2e",
      bad: "#9c2b1f",
      radius: 3,
      font: FONTS.Serif,
      heading: FONTS.Elegant,
      texture: "radial-gradient(circle at 80% 0%, rgba(0,0,0,.08), transparent 50%)",
      shadow: "0 2px 6px rgba(30,20,10,.3)",
    },
  },
  system: {
    id: "system",
    name: "System window",
    description: "Glowing blue status windows over deep navy, like a game's own interface.",
    mode: "dark",
    dark: {
      bg: "#060b1a",
      surface: "rgba(14, 30, 64, 0.92)",
      surface2: "rgba(24, 48, 96, 0.85)",
      text: "#e4f1ff",
      muted: "#86a3cc",
      accent: "#3fb8ff",
      accent2: "#ffd166",
      border: "rgba(90, 180, 255, 0.45)",
      good: "#4ee6a0",
      bad: "#ff5d73",
      radius: 6,
      font: FONTS.System,
      heading: FONTS.System,
      texture: "linear-gradient(180deg, rgba(63,184,255,.10), transparent 60%), repeating-linear-gradient(0deg, rgba(63,184,255,.035) 0 1px, transparent 1px 4px)",
      shadow: "0 0 0 1px rgba(63,184,255,.18), 0 0 18px rgba(63,184,255,.22)",
    },
    light: {
      bg: "#eaf3ff",
      surface: "#ffffff",
      surface2: "#d8e8fb",
      text: "#0b1a33",
      muted: "#4d6587",
      accent: "#0a72c2",
      accent2: "#b07d00",
      border: "#93bbe6",
      good: "#13865a",
      bad: "#c42b44",
      radius: 6,
      font: FONTS.System,
      heading: FONTS.System,
      texture: "linear-gradient(180deg, rgba(10,114,194,.06), transparent 50%)",
      shadow: "0 0 0 1px rgba(10,114,194,.12), 0 2px 10px rgba(10,114,194,.15)",
    },
  },
  starship: {
    id: "starship",
    name: "Starship console",
    description: "A ship's console: amber readouts and cyan scans on deep space black, crisp and clean.",
    mode: "dark",
    dark: {
      bg: "#05080d",
      surface: "#0c121b",
      surface2: "#141d2a",
      text: "#e3ecf5",
      muted: "#8193a8",
      accent: "#d9730d",
      accent2: "#4cc9f0",
      border: "#24344a",
      good: "#56d69b",
      bad: "#ff4d5e",
      radius: 10,
      font: FONTS.System,
      heading: FONTS.Mono,
      texture: "radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,.35), transparent 60%), radial-gradient(1px 1px at 68% 42%, rgba(255,255,255,.25), transparent 60%), radial-gradient(1px 1px at 38% 82%, rgba(255,255,255,.3), transparent 60%), linear-gradient(180deg, rgba(76,201,240,.06), transparent 50%)",
      shadow: "0 0 0 1px rgba(76,201,240,.10), 0 4px 16px rgba(0,0,0,.5)",
    },
    light: {
      bg: "#eef2f6",
      surface: "#ffffff",
      surface2: "#dfe6ee",
      text: "#0e1621",
      muted: "#56667a",
      accent: "#b35a00",
      accent2: "#0b7ea3",
      border: "#b7c4d3",
      good: "#18865a",
      bad: "#c42b3c",
      radius: 10,
      font: FONTS.System,
      heading: FONTS.Mono,
      texture: "none",
      shadow: "0 1px 4px rgba(14,22,33,.15)",
    },
  },
  dread: {
    id: "dread",
    name: "Dread",
    description: "Near-black and bone white, a typewriter's headings and one colour: blood. For horror and mystery.",
    mode: "dark",
    dark: {
      bg: "#080808",
      surface: "#121212",
      surface2: "#1c1b1a",
      text: "#d9d4ca",
      muted: "#837d73",
      accent: "#b3121f",
      accent2: "#9aa06e",
      border: "#2e2b28",
      good: "#7d9a6a",
      bad: "#e0313f",
      radius: 2,
      font: FONTS.Serif,
      heading: FONTS.Mono,
      texture: "radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,.03), transparent 60%), radial-gradient(circle at 50% 120%, rgba(179,18,31,.10), transparent 55%)",
      shadow: "0 2px 12px rgba(0,0,0,.7)",
    },
    light: {
      bg: "#e4dfd4",
      surface: "#efebe2",
      surface2: "#d8d1c3",
      text: "#1a1714",
      muted: "#615a50",
      accent: "#8f0d18",
      accent2: "#5e6440",
      border: "#aaa092",
      good: "#4c6a3a",
      bad: "#a3121e",
      radius: 2,
      font: FONTS.Serif,
      heading: FONTS.Mono,
      texture: "radial-gradient(circle at 20% 10%, rgba(0,0,0,.05), transparent 45%)",
      shadow: "0 2px 6px rgba(26,23,20,.25)",
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
      if (value === "none" || (typeof value === "string" && (Object.values(TEXTURES).includes(value) || !/[;{}<>]|url\(/i.test(value)))) out.texture = value as string;
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
  const light = themeTokens(theme, "light");
  const dark = themeTokens(theme, "dark");
  return { preset: preset.id, mode: preset.mode, light, dark, fonts: usedFonts([light.font, light.heading, dark.font, dark.heading]) };
}
