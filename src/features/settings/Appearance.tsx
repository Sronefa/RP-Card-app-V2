import { useState } from "react";
import { usePrefs, type Prefs } from "../../app/prefs";
import {
  APP_PRESETS,
  deriveTokens,
  readability,
  readThemeFile,
  themeFile,
  type AppTokens,
  type CustomTheme,
} from "../../app/theme";
import { utf8Encode } from "../../card/bytes";
import { toast } from "../../components/toast";
import { Button, TextInput } from "../../components/ui";
import { newId } from "../../lib/id";
import { pickFiles, safeFileName, saveFile } from "../../lib/files";
import { selectClass } from "../engine/VarEditor";

function Swatch({ tokens }: { tokens: AppTokens }) {
  return (
    <span aria-hidden="true" className="flex h-8 w-full overflow-hidden rounded-md border" style={{ borderColor: tokens.border, background: tokens.surface }}>
      <span className="m-1.5 flex-1 rounded-sm" style={{ background: tokens.raised }} />
      <span className="my-1.5 mr-1.5 w-3 rounded-full" style={{ background: tokens.accent }} />
      <span className="my-2.5 mr-1.5 w-5 rounded-sm" style={{ background: tokens.ink }} />
    </span>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-8 items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const ratio = (n: number) => `${n.toFixed(1)}:1`;

/** Settings → Look: the app's theme, RGB Drift, custom themes and the display toggles. */
export function Appearance() {
  const prefs = usePrefs();
  const set = (patch: Partial<Prefs>) => prefs.set(patch);
  const drift = (patch: Partial<Prefs["drift"]>) => set({ drift: { ...prefs.drift, ...patch } });
  const [editing, setEditing] = useState<CustomTheme>();

  const themes = [
    ...APP_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, tokens: p.tokens })),
    ...prefs.customThemes.map((t) => ({ id: `custom:${t.id}`, name: t.name, description: "Your theme", tokens: deriveTokens(t.tint, t.accent, t.mode) })),
  ];

  async function importTheme() {
    for (const file of await pickFiles(".json,application/json")) {
      try {
        const theme = { ...readThemeFile(await file.text()), id: newId() };
        set({ customThemes: [...prefs.customThemes, theme], theme: `custom:${theme.id}` });
        toast(`Added the theme "${theme.name}"`);
      } catch (e) {
        toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
      }
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Look">
      <h2 className="font-medium">Look</h2>

      <div className="flex flex-col gap-2">
        <span className="text-sm">Theme</span>
        {prefs.followClock && <span className="text-xs text-ink-muted">Following the clock: Parchment by day, OLED Black at night.</span>}
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={prefs.theme === t.id}
              title={t.description}
              onClick={() => set({ theme: t.id })}
              className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left text-xs ${prefs.theme === t.id ? "border-accent" : "border-border"}`}
            >
              <Swatch tokens={t.tokens} />
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            Accent
            <input
              type="color"
              aria-label="Accent colour"
              className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
              value={prefs.accent ?? themes.find((t) => t.id === prefs.theme)?.tokens.accent ?? "#c08cff"}
              onChange={(e) => set({ accent: e.target.value })}
            />
          </label>
          {prefs.accent && (
            <Button variant="ghost" onClick={() => set({ accent: undefined })}>
              Use the theme's accent
            </Button>
          )}
          <Button onClick={() => setEditing({ id: newId(), name: "My theme", tint: "#1a1426", accent: "#c08cff", mode: "dark" })}>
            Make a theme
          </Button>
          <Button variant="ghost" onClick={() => void importTheme()}>
            Import a theme
          </Button>
          {prefs.theme.startsWith("custom:") && (
            <Button variant="ghost" onClick={() => setEditing(prefs.customThemes.find((t) => `custom:${t.id}` === prefs.theme))}>
              Edit this theme
            </Button>
          )}
        </div>
        {editing && (
          <ThemeBuilder
            theme={editing}
            isNew={!prefs.customThemes.some((t) => t.id === editing.id)}
            onSave={(t) => {
              const exists = prefs.customThemes.some((x) => x.id === t.id);
              set({
                customThemes: exists ? prefs.customThemes.map((x) => (x.id === t.id ? t : x)) : [...prefs.customThemes, t],
                theme: `custom:${t.id}`,
              });
              setEditing(undefined);
            }}
            onDelete={() => {
              set({ customThemes: prefs.customThemes.filter((x) => x.id !== editing.id), theme: "default" });
              setEditing(undefined);
            }}
            onCancel={() => setEditing(undefined)}
          />
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <Toggle checked={prefs.drift.on} onChange={(on) => drift({ on })}>
          RGB Drift: the accent slowly travels round the colour wheel
        </Toggle>
        {prefs.drift.on && (
          <div className="flex flex-col gap-2 pl-6 text-sm">
            <label className="flex flex-col gap-1">
              <span>
                One turn every {prefs.drift.minutes} {prefs.drift.minutes === 1 ? "minute" : "minutes"}
              </span>
              <input
                type="range"
                aria-label="Drift speed in minutes"
                min={1}
                max={60}
                value={prefs.drift.minutes}
                onChange={(e) => drift({ minutes: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Saturation {prefs.drift.saturation}%</span>
              <input
                type="range"
                aria-label="Drift saturation"
                min={20}
                max={100}
                value={prefs.drift.saturation}
                onChange={(e) => drift({ saturation: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1">
              What drifts
              <select
                aria-label="What drifts"
                className={selectClass}
                value={prefs.drift.scope}
                onChange={(e) => drift({ scope: e.target.value as Prefs["drift"]["scope"] })}
              >
                <option value="accent">The accent only</option>
                <option value="borders">The accent and the borders</option>
                <option value="aurora">The accent and a faint aurora behind everything</option>
              </select>
            </label>
            <Toggle checked={prefs.drift.batteryPause} onChange={(batteryPause) => drift({ batteryPause })}>
              Pause while the battery is low
            </Toggle>
            <span className="text-xs text-ink-muted">It stands still when your device asks for less motion.</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Toggle checked={prefs.cardColors} onChange={(cardColors) => set({ cardColors })}>
          The open card sets the colours: its engine theme, or the palette of its picture
        </Toggle>
        <Toggle checked={prefs.projectLine} onChange={(projectLine) => set({ projectLine })}>
          A thin line in each project's own colour
        </Toggle>
        <Toggle checked={prefs.followClock} onChange={(followClock) => set({ followClock })}>
          Follow the clock: Parchment by day, OLED Black at night
        </Toggle>
        <Toggle checked={prefs.sectionHues} onChange={(sectionHues) => set({ sectionHues })}>
          A hue for each section
        </Toggle>
        <Toggle checked={prefs.engineGlow} onChange={(engineGlow) => set({ engineGlow })}>
          RGB light on the Engine button
        </Toggle>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Texture
          <select aria-label="Texture" className={selectClass} value={prefs.texture} onChange={(e) => set({ texture: e.target.value as Prefs["texture"] })}>
            <option value="none">None</option>
            <option value="paper">Paper grain</option>
            <option value="scanlines">Scanlines</option>
            <option value="stars">Slow starfield</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Density
          <select aria-label="Density" className={selectClass} value={prefs.density} onChange={(e) => set({ density: e.target.value as Prefs["density"] })}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="roomy">Roomy</option>
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          Text size {prefs.textSize}%
          <input
            type="range"
            aria-label="Text size"
            min={85}
            max={130}
            step={5}
            value={prefs.textSize}
            onChange={(e) => set({ textSize: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <Toggle checked={prefs.serif} onChange={(serif) => set({ serif })}>
          A serif font in the writing fields
        </Toggle>
        <Toggle checked={prefs.mono} onChange={(mono) => set({ mono })}>
          A monospace font everywhere (made for Phosphor)
        </Toggle>
      </div>
    </section>
  );
}

/** A custom theme from a background tint and an accent, with a readability check. */
function ThemeBuilder({
  theme,
  isNew,
  onSave,
  onDelete,
  onCancel,
}: {
  theme: CustomTheme;
  isNew: boolean;
  onSave: (t: CustomTheme) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [t, setT] = useState(theme);
  const tokens = deriveTokens(t.tint, t.accent, t.mode);
  const check = readability(tokens);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm" aria-label="Theme builder">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Name
          <TextInput value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          Background tint
          <input type="color" aria-label="Background tint" className="h-9 w-14 rounded border border-border bg-transparent" value={t.tint} onChange={(e) => setT({ ...t, tint: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          Accent
          <input type="color" aria-label="Theme accent" className="h-9 w-14 rounded border border-border bg-transparent" value={t.accent} onChange={(e) => setT({ ...t, accent: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          Mode
          <select aria-label="Mode" className={selectClass} value={t.mode} onChange={(e) => setT({ ...t, mode: e.target.value as CustomTheme["mode"] })}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: tokens.surface, color: tokens.ink, border: `1px solid ${tokens.border}` }}>
        <span>Text on the background</span>
        <span style={{ color: tokens.muted }}>Quieter text</span>
        <span className="self-start rounded-md px-2 py-1" style={{ background: tokens.raised, color: tokens.accent, border: `1px solid ${tokens.border}` }}>
          An accent button
        </span>
      </div>
      <p role="status" className={check.ok ? "text-ink-muted" : "text-amber-300"}>
        {check.ok ? "Reads well" : "Hard to read"}: text {ratio(check.ink)}, quiet text {ratio(check.muted)}, accent {ratio(check.accent)}
        {check.ok ? "." : ". Text needs 4.5:1 and the accent 3:1; try a darker or lighter tint, or another accent."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!t.name.trim()} onClick={() => onSave({ ...t, name: t.name.trim() })}>
          Save and use it
        </Button>
        <Button
          onClick={() =>
            void saveFile(`${safeFileName(t.name, "theme")}.cardforge-theme.json`, utf8Encode(themeFile(t)), {
              filterName: "CardForge theme",
              extensions: ["json"],
              mime: "application/json",
            })
          }
        >
          Export
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {!isNew && (
          <Button variant="danger" className="ml-auto" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
