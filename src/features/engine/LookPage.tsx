/** The engine's Look tab: the card theme every screen shares, and the status panel. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, TextInput } from "../../components/ui";
import { panelHtml } from "../../engine/panel";
import kitCss from "../../engine/runtime/kit.css?raw";
import { effectiveConfig } from "../../engine/modules/compile";
import { initialState, themeOf, type EngineConfig } from "../../engine/sheet";
import { FONTS, PRESET_IDS, PRESETS, themeTokens, themeVars, type CardTheme, type ThemeMode, type ThemeTokens } from "../../engine/theme";
import { selectClass } from "./VarEditor";

type Save = (c: EngineConfig, key?: string) => void;

const COLOURS: [keyof ThemeTokens, string][] = [
  ["accent", "Accent"],
  ["accent2", "Second accent"],
  ["bg", "Background"],
  ["surface", "Cards"],
  ["text", "Text"],
  ["border", "Borders"],
];

const fontName = (stack: string) => Object.entries(FONTS).find(([, v]) => v === stack)?.[0] ?? "System";

export function LookPage({ config, save }: { config: EngineConfig; save: Save }) {
  const theme = themeOf(config);
  const preset = PRESETS[theme.preset] ?? PRESETS.phone;
  const [mode, setMode] = useState<ThemeMode>(preset.mode);
  useEffect(() => setMode(preset.mode), [preset.mode]);
  const tokens = themeTokens(theme, mode);
  const setTheme = (next: CardTheme, key?: string) => save({ ...config, theme: next }, key && `engine.theme.${key}`);
  const override = (patch: Partial<ThemeTokens>, key: string) => setTheme({ ...theme, overrides: { ...theme.overrides, ...patch } }, key);
  const clear = (key: keyof ThemeTokens) => {
    const overrides = { ...theme.overrides };
    delete overrides[key];
    setTheme({ ...theme, overrides });
  };
  const panel = config.panel;
  const setPanel = (patch: Partial<EngineConfig["panel"]>, key: string) => save({ ...config, panel: { ...panel, ...patch } }, `engine.panel.${key}`);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="Theme">
        <h2 className="font-medium">Theme</h2>
        <p className="text-sm text-ink-muted">
          One look for every screen of the card: the status panel, the hub screens and inline blocks. Players can still
          switch light or dark, the accent and the text size in the card's Settings app.
        </p>
        <div role="radiogroup" aria-label="Preset" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRESET_IDS.map((id) => {
            const p = PRESETS[id];
            const t = p[p.mode];
            const on = theme.preset === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTheme({ ...theme, preset: id })}
                className={`flex min-h-14 items-center gap-3 rounded-xl border p-2 text-left ${on ? "border-accent bg-accent/10" : "border-border bg-surface-raised"}`}
              >
                <span className="flex shrink-0 overflow-hidden rounded-lg border border-border" aria-hidden>
                  {[t.bg, t.surface, t.accent, t.accent2].map((c, i) => (
                    <span key={i} className="block h-10 w-4" style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-ink-muted">{p.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="Your changes">
        <h2 className="font-medium">Your changes</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COLOURS.map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={label}
                  value={/^#[0-9a-f]{6}$/i.test(String(tokens[key])) ? String(tokens[key]) : "#888888"}
                  className="h-10 w-14 rounded-lg border border-border bg-surface-sunken"
                  onChange={(e) => override({ [key]: e.target.value }, key)}
                />
                {label}
              </label>
              {theme.overrides[key] !== undefined && (
                <button type="button" className="self-start text-xs text-ink-muted underline" onClick={() => clear(key)}>
                  Back to the preset's
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Text font
            <select className={selectClass} value={fontName(tokens.font)} onChange={(e) => override({ font: FONTS[e.target.value] }, "font")}>
              {Object.keys(FONTS).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Heading font
            <select className={selectClass} value={fontName(tokens.heading)} onChange={(e) => override({ heading: FONTS[e.target.value] }, "heading")}>
              {Object.keys(FONTS).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Corners: {tokens.radius}px
            <input type="range" min={0} max={24} value={tokens.radius} onChange={(e) => override({ radius: Number(e.target.value) }, "radius")} />
          </label>
          <label className="flex min-h-8 items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={theme.overrides.texture !== "none"}
              onChange={(e) => (e.target.checked ? clear("texture") : override({ texture: "none" }, "texture"))}
            />
            Texture
          </label>
        </div>
        {Object.keys(theme.overrides).length > 0 && (
          <Button variant="ghost" className="self-start" onClick={() => setTheme({ ...theme, overrides: {} })}>
            Undo all my changes
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Theme preview">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Preview</h2>
          <div role="group" aria-label="Light or dark" className="flex rounded-lg border border-border p-0.5">
            {(["light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-8 rounded-md px-3 text-sm ${mode === m ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
              >
                {m === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <ThemeSample tokens={tokens} mode={mode} />
      </section>

      <section className="flex flex-col gap-3" aria-label="Status panel">
        <h2 className="font-medium">Status panel</h2>
        <label className="flex min-h-8 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={panel.enabled} onChange={(e) => setPanel({ enabled: e.target.checked }, "enabled")} />
          Show a status panel under each reply
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Title
          <TextInput value={panel.title} className="max-w-xs" onChange={(e) => setPanel({ title: e.target.value }, "title")} />
        </label>
        <label className="flex min-h-8 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={config.reminder} onChange={(e) => save({ ...config, reminder: e.target.checked })} />
          Remind the model of the update block near the end of the prompt (helps models that forget it)
        </label>
        {panel.enabled && (
          <>
            <h3 className="text-sm font-medium">With the starting values</h3>
            <PanelPreview config={config} state={initialState(effectiveConfig(config))} mode={mode} />
            <p className="text-xs text-ink-muted">
              Values shown in the compact panel are checked on the Variables tab. "All" opens the rest. Module sections
              like the clock show in the Sandbox.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

const SAMPLE = `<div class="cf-app"><div class="cf-appbar"><h1>Inventory</h1><button class="cf-btn ghost" type="button">✕</button></div>
<div class="cf-appbody">
<div class="cf-tabs" role="tablist"><button class="cf-tab" role="tab" aria-selected="true">Bag</button><button class="cf-tab" role="tab">Quests</button></div>
<div class="cf-card cf-stack">
<div class="cf-meter"><div class="cf-meter-head"><span>Health</span><span class="cf-delta down">-12</span><span class="cf-meter-value">68 / 100</span></div><div class="cf-meter-track"><div class="cf-meter-fill" style="width:68%"></div></div></div>
<div class="cf-grid"><div class="cf-stat"><span class="cf-label">Gold</span><b>120</b></div><div class="cf-stat"><span class="cf-label">Day</span><b>3</b></div><div class="cf-stat"><span class="cf-label">Mood</span><b>Calm</b></div></div>
<div class="cf-row"><span class="cf-chip">Rested</span><span class="cf-chip">Rope ×1</span><span class="cf-small cf-muted">Updated just now</span></div>
</div>
<div class="cf-bubbles"><div class="cf-bubble">Meet me at the café at six?</div><div class="cf-bubble me">I'll be there.</div></div>
<div class="cf-row"><button class="cf-btn primary" type="button">Use</button><button class="cf-btn" type="button">Drop</button></div>
</div></div>`;

/** The kit's pieces in the theme, the way a hub screen shows them. */
function ThemeSample({ tokens, mode }: { tokens: ThemeTokens; mode: ThemeMode }) {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>:root { ${themeVars(tokens)}; color-scheme: ${mode}; } html, body { margin: 0; background: var(--cf-bg); }\n${kitCss}</style></head><body class="cf">${SAMPLE}</body></html>`;
  return <iframe title="Theme preview" sandbox="" srcDoc={doc} className="h-80 w-full rounded-lg border border-border" />;
}

/** The panel as SillyTavern shows it, fed the given state instead of a chat. */
export function PanelPreview({ config, state, delta, mode }: { config: EngineConfig; state: unknown; delta?: unknown; mode?: ThemeMode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const theme = themeOf(config);
  const tokens = themeTokens(theme, mode);
  const vars = themeVars(tokens);
  const dark = mode ? mode === "dark" : (PRESETS[theme.preset] ?? PRESETS.phone).mode === "dark";
  const doc = useMemo(() => {
    const data = JSON.stringify({ stat_data: state, delta_data: delta ?? {} }).replace(/</g, "\\u003c");
    const shim =
      `<script>window.Mvu = { getMvuData: function () { return ${data}; } }; window.getCurrentMessageId = function () { return 0; };` +
      `new ResizeObserver(function () { parent.postMessage({ cfPanelHeight: document.documentElement.scrollHeight }, "*"); }).observe(document.documentElement);</script>`;
    // The card theme, on the theme's own background, the way the engine core styles it.
    const look = `<style>html { ${vars}; color-scheme: ${dark ? "dark" : "light"}; } body { font-family: var(--cf-font); color: var(--cf-text); }</style>`;
    return panelHtml(config).replace("<head>", `<head>${shim}${look}`);
  }, [config, state, delta, vars, dark]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === ref.current?.contentWindow && typeof e.data?.cfPanelHeight === "number") setHeight(Math.min(800, e.data.cfPanelHeight + 20));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <iframe
      ref={ref}
      title="Status panel preview"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ height, background: tokens.bg }}
      className="w-full rounded-lg border border-border p-2"
    />
  );
}
