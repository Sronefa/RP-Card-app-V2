/** Applies the app theme from the look prefs, the open card, the section and the clock. */
import { useEffect, useState } from "react";
import { useEditor } from "../editor/store";
import { readEngine, themeOf } from "../engine/sheet";
import { themeBundle } from "../engine/theme";
import { cardImage } from "../lib/cardFiles";
import { usePrefs, type Prefs } from "./prefs";
import { useUi } from "./store";
import {
  APP_PRESETS,
  deriveTokens,
  dominantColor,
  hexToHsl,
  isDaytime,
  presetById,
  readableAccent,
  SECTION_HUES,
  shiftHue,
  strong,
  TOKEN_VARS,
  type AppTokens,
} from "./theme";

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** The theme a set of prefs picks, before the open card or the section change it. */
export function baseTokens(prefs: Prefs, now: Date): AppTokens {
  if (prefs.followClock) return presetById(isDaytime(now) ? "parchment" : "oled")!.tokens;
  if (prefs.theme.startsWith("custom:")) {
    const custom = prefs.customThemes.find((t) => `custom:${t.id}` === prefs.theme);
    if (custom) return deriveTokens(custom.tint, custom.accent, custom.mode);
  }
  return (presetById(prefs.theme) ?? APP_PRESETS[0]).tokens;
}

export interface ThemeContext {
  now: Date;
  section: string;
  /** The open card's engine colours, when it has the engine on. */
  engine?: Partial<AppTokens>;
  /** The open card's avatar's dominant colour. */
  avatar?: string;
}

export function resolveTokens(prefs: Prefs, ctx: ThemeContext): AppTokens {
  let t = baseTokens(prefs, ctx.now);
  if (prefs.accent && isHex(prefs.accent)) {
    const accent = readableAccent(prefs.accent, t.surface, t.mode);
    t = { ...t, accent, accentStrong: strong(accent, t.mode) };
  }
  if (prefs.cardColors) {
    const e = ctx.engine;
    if (e && [e.surface, e.raised, e.ink, e.accent].every(isHex)) t = { ...t, ...e } as AppTokens;
    else if (ctx.avatar) t = deriveTokens(ctx.avatar, readableAccent(ctx.avatar, deriveTokens(ctx.avatar, ctx.avatar, t.mode).surface, t.mode), t.mode);
  }
  if (prefs.sectionHues) {
    const by = SECTION_HUES[ctx.section] ?? 0;
    t = { ...t, accent: shiftHue(t.accent, by), accentStrong: shiftHue(t.accentStrong, by) };
  }
  return t;
}

/** CSS values to set on <html>. A drifting accent turns with the animated --rgb-angle. */
export function themeStyle(t: AppTokens, prefs: Prefs): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(TOKEN_VARS)) style[cssVar] = t[key as keyof typeof TOKEN_VARS];
  if (prefs.drift.on) {
    const [h, , l] = hexToHsl(t.accent);
    const s = prefs.drift.saturation;
    const hue = `calc(var(--rgb-angle) + ${Math.round(h)}deg)`;
    style["--color-accent"] = `hsl(${hue} ${s}% ${Math.round(l)}%)`;
    style["--color-accent-strong"] = `hsl(${hue} ${s}% ${Math.round(l - 10)}%)`;
    style["--drift-hue"] = hue;
    style["--drift-sat"] = `${s}%`;
    style["--drift-duration"] = `${Math.round(prefs.drift.minutes * 60)}s`;
    if (prefs.drift.scope !== "accent")
      style["--color-border"] = `color-mix(in oklab, hsl(${hue} ${s}% 55%) 35%, ${t.border})`;
  }
  style["color-scheme"] = t.mode;
  style["font-size"] = `${prefs.textSize}%`;
  style["--spacing"] = { compact: "0.22rem", comfortable: "0.25rem", roomy: "0.28rem" }[prefs.density];
  return style;
}

export function themeClasses(prefs: Prefs, t: AppTokens, paused: boolean): string[] {
  return [
    t.mode === "light" && "theme-light",
    prefs.drift.on && "drift",
    prefs.drift.on && prefs.drift.scope === "aurora" && "drift-aurora",
    prefs.drift.on && paused && "drift-paused",
    prefs.texture !== "none" && `texture-${prefs.texture}`,
    prefs.serif && "serif-writing",
    prefs.mono && "mono",
  ].filter((c): c is string => !!c);
}

const avatarColors = new Map<string, string | null>();

async function avatarColor(key: string, bytes: Uint8Array): Promise<string | undefined> {
  if (avatarColors.has(key)) return avatarColors.get(key) ?? undefined;
  let color: string | undefined;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, 48, 48);
      color = dominantColor(ctx.getImageData(0, 0, 48, 48).data);
    }
  } catch {
    /* no palette */
  }
  avatarColors.set(key, color ?? null);
  return color;
}

/** True while the battery is low and not charging, when the drift should pause for it. */
function useLowBattery(watch: boolean) {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { level: number; charging: boolean }> };
    if (!watch || !nav.getBattery) return setLow(false);
    let battery: (EventTarget & { level: number; charging: boolean }) | undefined;
    const update = () => battery && setLow(!battery.charging && battery.level <= 0.2);
    void nav.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });
    return () => {
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, [watch]);
  return low;
}

export function useAppTheme() {
  const prefs = usePrefs();
  const section = useUi((s) => s.section);
  const record = useEditor((s) => (prefs.cardColors ? s.record : undefined));
  const [now, setNow] = useState(() => new Date());
  const [avatar, setAvatar] = useState<string>();
  const paused = useLowBattery(prefs.drift.on && prefs.drift.batteryPause);

  // Following the clock checks it every minute.
  useEffect(() => {
    if (!prefs.followClock) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [prefs.followClock]);

  const engineConfig = record && readEngine(record.card.data);
  const image = record && !engineConfig ? cardImage(record) : undefined;
  const imageKey = record && image ? `${record.id}:${image.length}` : "";
  useEffect(() => {
    setAvatar(undefined);
    if (!image || !imageKey) return;
    let live = true;
    void avatarColor(imageKey, image).then((c) => live && setAvatar(c));
    return () => {
      live = false;
    };
    // The key stands for the image.
  }, [imageKey]);

  let engine: Partial<AppTokens> | undefined;
  if (engineConfig) {
    const bundle = themeBundle(themeOf(engineConfig));
    const e = bundle[bundle.mode];
    engine = { surface: e.bg, raised: e.surface, sunken: e.surface2, border: e.border, ink: e.text, muted: e.muted, accent: e.accent, accentStrong: e.accent2, mode: bundle.mode };
  }

  const tokens = resolveTokens(prefs, { now, section, engine, avatar });
  const style = themeStyle(tokens, prefs);
  const classes = themeClasses(prefs, tokens, paused);
  const styleKey = JSON.stringify(style);
  const classKey = classes.join(" ");

  useEffect(() => {
    const root = document.documentElement;
    const set = JSON.parse(styleKey) as Record<string, string>;
    for (const [k, v] of Object.entries(set)) root.style.setProperty(k, v);
    root.classList.add(...(classKey ? classKey.split(" ") : []));
    return () => {
      for (const k of Object.keys(set)) root.style.removeProperty(k);
      if (classKey) root.classList.remove(...classKey.split(" "));
    };
  }, [styleKey, classKey]);

  return tokens;
}
