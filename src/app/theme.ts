/**
 * App themes: the colours CardForge itself wears (not a card's engine theme). The app's colours are
 * CSS variables (`src/index.css`); a theme is a set of values for them, applied on <html>.
 */

export interface AppTokens {
  surface: string;
  raised: string;
  sunken: string;
  border: string;
  ink: string;
  muted: string;
  accent: string;
  accentStrong: string;
  mode: "dark" | "light";
}

export const TOKEN_VARS: Record<Exclude<keyof AppTokens, "mode">, string> = {
  surface: "--color-surface",
  raised: "--color-surface-raised",
  sunken: "--color-surface-sunken",
  border: "--color-border",
  ink: "--color-ink",
  muted: "--color-ink-muted",
  accent: "--color-accent",
  accentStrong: "--color-accent-strong",
};

// ---------------------------------------------------------------- colour maths

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  l = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

export const hexToHsl = (hex: string) => rgbToHsl(...hexToRgb(hex));

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Turns the hue of a colour, keeping its saturation and lightness. */
export function shiftHue(hex: string, by: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + by, s, l);
}

// ---------------------------------------------------------------- presets

export type PresetId =
  | "default"
  | "oled"
  | "midnight"
  | "neon"
  | "bloodmoon"
  | "forest"
  | "frostbite"
  | "sakura"
  | "phosphor"
  | "ember"
  | "parchment";

export interface AppPreset {
  id: PresetId;
  name: string;
  description: string;
  tokens: AppTokens;
}

/** The pressed or hover shade of an accent. */
export const strong = (accent: string, mode: "dark" | "light") => {
  const [h, s, l] = hexToHsl(accent);
  return hslToHex(h, s, mode === "dark" ? l - 10 : l - 8);
};

const preset = (
  id: PresetId,
  name: string,
  description: string,
  [surface, raised, sunken, border, ink, muted, accent, accentStrong]: string[],
  mode: "dark" | "light" = "dark",
): AppPreset => ({
  id,
  name,
  description,
  tokens: { surface, raised, sunken, border, ink, muted, accent, accentStrong: accentStrong ?? strong(accent, mode), mode },
});

export const APP_PRESETS: AppPreset[] = [
  preset("default", "CardForge", "Deep violet, the original look.", ["#14121a", "#1d1a26", "#0f0d14", "#2c2838", "#ece8f4", "#9a93ab", "#c08cff", "#a865ff"]),
  preset("oled", "OLED Black", "Pure black for OLED screens, panels split by thin lines, in your accent.", ["#000000", "#0a0a0c", "#000000", "#24242a", "#f2f2f5", "#8f8f9a", "#c08cff"]),
  preset("midnight", "Midnight Library", "Navy and brass, like a reading room after hours.", ["#0f1528", "#172036", "#0a0f1d", "#28344f", "#ece6d4", "#9ea3b6", "#c9a45c"]),
  preset("neon", "Neon Noir", "Black with cyan and magenta signs.", ["#07070b", "#101018", "#040406", "#24223a", "#eaf6ff", "#8f97ab", "#22e5ff", "#ff3cac"]),
  preset("bloodmoon", "Bloodmoon", "Black and deep red.", ["#0c0607", "#180b0d", "#070304", "#331619", "#f2e4e4", "#a98d8f", "#e0364a"]),
  preset("forest", "Forest Shrine", "Moss and old gold.", ["#101710", "#172117", "#0b100b", "#283828", "#e9ecdf", "#9aa58e", "#d4b04a"]),
  preset("frostbite", "Frostbite", "Slate and ice blue.", ["#131a21", "#1b242d", "#0e1419", "#2b3844", "#e8f1f7", "#96a7b5", "#7fd3ff"]),
  preset("sakura", "Sakura Night", "Plum and blossom pink.", ["#1b1020", "#26162c", "#140b18", "#3b2443", "#f6e8f1", "#b39aae", "#ff8fc7"]),
  preset("phosphor", "Phosphor", "A green terminal on black.", ["#050805", "#0a110a", "#030503", "#173317", "#b8ffb8", "#62b062", "#39ff6a"]),
  preset("ember", "Ember", "Charcoal and glowing orange.", ["#141211", "#1e1a18", "#0e0c0b", "#342c28", "#f2e9e2", "#a9998d", "#ff7a2f"]),
  preset(
    "parchment",
    "Parchment",
    "Warm paper and ink, a light theme.",
    ["#f4ecd8", "#fbf6e8", "#eadfc5", "#d3c3a0", "#2e2419", "#6a5b46", "#8a4b1f", "#6f3a14"],
    "light",
  ),
];

export const presetById = (id: string) => APP_PRESETS.find((p) => p.id === id);

// ---------------------------------------------------------------- custom themes

export interface CustomTheme {
  id: string;
  name: string;
  /** The background tint. */
  tint: string;
  accent: string;
  mode: "dark" | "light";
}

/** A whole theme from a background tint and an accent. */
export function deriveTokens(tint: string, accent: string, mode: "dark" | "light"): AppTokens {
  const [h, s0] = hexToHsl(tint);
  const s = Math.min(s0, 30);
  const at = (sat: number, light: number) => hslToHex(h, sat, light);
  return mode === "dark"
    ? { surface: at(s, 8), raised: at(s, 12), sunken: at(s, 5.5), border: at(s * 0.9, 20), ink: at(s * 0.4, 93), muted: at(s * 0.4, 64), accent, accentStrong: strong(accent, mode), mode }
    : { surface: at(s, 93), raised: at(s, 97), sunken: at(s, 88), border: at(s * 0.8, 76), ink: at(s * 0.5, 13), muted: at(s * 0.4, 36), accent, accentStrong: strong(accent, mode), mode };
}

export interface Readability {
  ink: number;
  muted: number;
  accent: number;
  /** Everything reads well (4.5:1 text, 3:1 accent). */
  ok: boolean;
}

export function readability(t: AppTokens): Readability {
  const r = { ink: contrast(t.ink, t.surface), muted: contrast(t.muted, t.surface), accent: contrast(t.accent, t.surface) };
  return { ...r, ok: r.ink >= 4.5 && r.muted >= 4.5 && r.accent >= 3 };
}

/** A custom theme as a file to share. */
export const themeFile = (t: CustomTheme) => JSON.stringify({ cardforgeTheme: 1, name: t.name, tint: t.tint, accent: t.accent, mode: t.mode }, null, 2);

export function readThemeFile(text: string): Omit<CustomTheme, "id"> {
  const json = JSON.parse(text) as Record<string, unknown>;
  const hex = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  if (json.cardforgeTheme !== 1 || !hex(json.tint) || !hex(json.accent)) throw new Error("This isn't a CardForge theme file.");
  return {
    name: typeof json.name === "string" && json.name.trim() ? json.name.trim() : "Imported theme",
    tint: json.tint as string,
    accent: json.accent as string,
    mode: json.mode === "light" ? "light" : "dark",
  };
}

// ---------------------------------------------------------------- everything else

/** A stable hue for a project, from its id. */
export function projectHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** How far each section turns the accent's hue, with "a hue per section" on. */
export const SECTION_HUES: Record<string, number> = {
  library: 0,
  editor: 35,
  lorebook: 75,
  trackers: 150,
  engine: 195,
  assets: 250,
  cowriter: 300,
  settings: 0,
};

/** Day runs from 7:00 to 19:00 for "follow the clock". */
export const isDaytime = (date: Date) => date.getHours() >= 7 && date.getHours() < 19;

/** The dominant vivid colour of an image's pixels (RGBA bytes), for an avatar palette. */
export function dominantColor(pixels: Uint8ClampedArray): string | undefined {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const [h, s, l] = rgbToHsl(r, g, b);
    // Greys, near-black and near-white say little about a palette.
    if (s < 25 || l < 15 || l > 88) continue;
    const key = Math.floor(h / 20);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  return best && rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n);
}

/** An accent that reads on the surface: lightened (dark mode) or darkened (light mode) until it does. */
export function readableAccent(accent: string, surface: string, mode: "dark" | "light"): string {
  const [h, s, l0] = hexToHsl(accent);
  let l = l0;
  let out = accent;
  for (let i = 0; i < 20 && contrast(out, surface) < 3; i++) {
    l += mode === "dark" ? 4 : -4;
    out = hslToHex(h, s, l);
  }
  return out;
}
