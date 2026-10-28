/** The Look tab's living theme: moods that follow the state, and portraits that change expression and outfit. */
import { toast } from "../../components/toast";
import { Button, TextInput } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { artSlots } from "../../images/engineArt";
import { mergeShots, updateStudio } from "../../images/shots";
import { newId } from "../../lib/id";
import { effectiveConfig } from "../../engine/modules/compile";
import { varPath, type EngineConfig, type EngineVar } from "../../engine/sheet";
import { AMBIENCES, TEXTURES, textureName, type CardTheme, type PortraitBinding, type ThemeMood, type ThemeTokens } from "../../engine/theme";
import { selectClass } from "./VarEditor";

const MOOD_COLOURS: [keyof ThemeTokens, string][] = [
  ["bg", "Background"],
  ["surface", "Cards"],
  ["text", "Text"],
  ["accent", "Accent"],
];

/** The values a mood or portrait can follow. */
function valuesOf(config: EngineConfig) {
  return effectiveConfig(config)
    .vars.filter((v) => v.name.trim() && v.type !== "list" && v.type !== "counts")
    .map((v) => ({ path: varPath(v).join("."), v }));
}

function ValueSelect({ label, values, value, onChange, none }: { label: string; values: { path: string }[]; value?: string; onChange: (p: string) => void; none?: string }) {
  const known = !value || values.some((x) => x.path === value);
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {none !== undefined && <option value="">{none}</option>}
        {!known && <option value={value}>{value} (missing)</option>}
        {values.map((x) => (
          <option key={x.path} value={x.path}>
            {x.path}
          </option>
        ))}
      </select>
    </label>
  );
}

/** When a mood is on, in the words its value's type calls for. */
function MoodWhen({ mood, v, set }: { mood: ThemeMood; v?: EngineVar; set: (patch: Partial<ThemeMood>) => void }) {
  if (v?.type === "toggle") return <p className="text-xs text-ink-muted">On while {mood.path} is yes.</p>;
  if (v?.type === "number")
    return (
      <div className="grid grid-cols-2 gap-2">
        {(["min", "max"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            {k === "min" ? "On from" : "Up to"}
            <TextInput
              type="number"
              aria-label={`${mood.name || "Mood"} ${k === "min" ? "from" : "up to"}`}
              value={mood[k] ?? ""}
              onChange={(e) => set({ [k]: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    );
  const is = mood.is ?? [];
  if (v?.type === "choice" && v.options?.length)
    return (
      <fieldset className="flex flex-wrap gap-x-4 text-sm">
        <legend className="mb-1">On while it's</legend>
        {v.options.map((o) => (
          <label key={o} className="flex min-h-8 items-center gap-2">
            <input type="checkbox" className="size-4" checked={is.some((x) => x.toLowerCase() === o.toLowerCase())} onChange={(e) => set({ is: e.target.checked ? [...is, o] : is.filter((x) => x.toLowerCase() !== o.toLowerCase()) })} />
            {o}
          </label>
        ))}
      </fieldset>
    );
  return (
    <label className="flex flex-col gap-1 text-sm">
      On while it's one of (comma separated)
      <TextInput value={is.join(", ")} placeholder="Night, Midnight" onChange={(e) => set({ is: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
    </label>
  );
}

export function MoodsEditor({ config, theme, setTheme, preview, setPreview }: { config: EngineConfig; theme: CardTheme; setTheme: (t: CardTheme, key?: string) => void; preview: string; setPreview: (id: string) => void }) {
  const values = valuesOf(config);
  const moods = theme.moods ?? [];
  const setMood = (i: number, patch: Partial<ThemeMood>, key: string) => setTheme({ ...theme, moods: moods.map((m, j) => (j === i ? { ...m, ...patch } : m)) }, `moods.${i}.${key}`);
  const setToken = (i: number, key: keyof ThemeTokens, value: string | undefined) => {
    const tokens = { ...moods[i].tokens };
    if (value === undefined) delete tokens[key];
    else (tokens as Record<string, string>)[key] = value;
    setMood(i, { tokens }, `tokens.${key}`);
  };
  return (
    <section className="flex flex-col gap-3" aria-label="Moods">
      <h2 className="font-medium">Moods</h2>
      <p className="text-sm text-ink-muted">
        The theme follows the story: while a value matches, its colours change, a tint lies over the screens and weather can drift over the
        open screen. Changes fade in. A later mood wins where two change the same colour.
      </p>
      {moods.map((m, i) => {
        const v = values.find((x) => x.path === m.path)?.v;
        const tint = m.tint ?? { color: "#000000", strength: 0 };
        return (
          <div key={m.id || i} className="flex flex-col gap-2 rounded-xl border border-border p-2" aria-label={`Mood ${m.name || i + 1}`} role="group">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <TextInput value={m.name} placeholder="e.g. Danger" onChange={(e) => setMood(i, { name: e.target.value }, "name")} />
              </label>
              <ValueSelect label="Follows" values={values} value={m.path} onChange={(path) => setMood(i, { path, is: undefined, min: undefined, max: undefined }, "path")} />
            </div>
            <label className="flex flex-col gap-1 text-sm">
              How the story feels then
              <TextInput value={m.description ?? ""} placeholder="e.g. Every shadow could be a wolf; people talk in whispers." onChange={(e) => setMood(i, { description: e.target.value }, "description")} />
            </label>
            <MoodWhen mood={m} v={v} set={(patch) => setMood(i, patch, "when")} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {MOOD_COLOURS.map(([key, label]) => {
                const value = m.tokens[key];
                return (
                  <div key={key} className="flex flex-col gap-1 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={`${m.name || "Mood"} ${label}`}
                        value={/^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value) : "#888888"}
                        className={`h-10 w-14 rounded-lg border border-border bg-surface-sunken ${value === undefined ? "opacity-40" : ""}`}
                        onChange={(e) => setToken(i, key, e.target.value)}
                      />
                      {label}
                    </label>
                    {value !== undefined && (
                      <button type="button" className="self-start text-xs text-ink-muted underline" onClick={() => setToken(i, key, undefined)}>
                        Keep the theme's
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Texture
                <select className={selectClass} value={m.tokens.texture === undefined ? "" : (textureName(m.tokens.texture) ?? (m.tokens.texture === "none" ? "none" : ""))} onChange={(e) => setToken(i, "texture", e.target.value === "" ? undefined : e.target.value === "none" ? "none" : TEXTURES[e.target.value])}>
                  <option value="">The theme's</option>
                  <option value="none">None</option>
                  {Object.keys(TEXTURES).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="color" aria-label={`${m.name || "Mood"} tint`} value={/^#[0-9a-f]{6}$/i.test(tint.color) ? tint.color : "#000000"} className="h-10 w-14 rounded-lg border border-border bg-surface-sunken" onChange={(e) => setMood(i, { tint: { color: e.target.value, strength: tint.strength || 0.15 } }, "tint")} />
                Tint
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tint strength: {Math.round(tint.strength * 100)}%
                <input type="range" min={0} max={0.6} step={0.05} value={tint.strength} onChange={(e) => setMood(i, { tint: Number(e.target.value) ? { color: tint.color, strength: Number(e.target.value) } : undefined }, "tint")} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Weather
                <select className={selectClass} value={m.ambience ?? ""} onChange={(e) => setMood(i, { ambience: (e.target.value || undefined) as ThemeMood["ambience"] }, "ambience")}>
                  <option value="">None</option>
                  {AMBIENCES.map((a) => (
                    <option key={a} value={a}>
                      {a[0].toUpperCase() + a.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" aria-pressed={preview === m.id} onClick={() => setPreview(preview === m.id ? "" : m.id)}>
                {preview === m.id ? "Stop previewing" : "Preview"}
              </Button>
              <Button variant="ghost" onClick={() => setTheme({ ...theme, moods: moods.filter((_, j) => j !== i) }, "moods.remove")}>
                Remove
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        className="self-start"
        disabled={!values.length}
        onClick={() => setTheme({ ...theme, moods: [...moods, { id: newId().slice(0, 8), name: "", path: values[0]?.path ?? "", tokens: {} }] }, "moods.add")}
      >
        Add a mood
      </Button>
      {!values.length && <p className="text-xs text-ink-muted">Add values on the Variables tab first: moods follow them.</p>}
    </section>
  );
}

export function PortraitsEditor({ config, theme, setTheme }: { config: EngineConfig; theme: CardTheme; setTheme: (t: CardTheme, key?: string) => void }) {
  const record = useEditor((s) => s.record);
  const values = valuesOf(config);
  const list = theme.portraits ?? [];
  const set = (i: number, patch: Partial<PortraitBinding>, key: string) => setTheme({ ...theme, portraits: list.map((b, j) => (j === i ? { ...b, ...patch } : b)) }, `portraits.${i}.${key}`);
  const slots = record ? artSlots(record.card.data).filter((s) => s.part === "Expressive portraits") : [];
  const empty = slots.filter((s) => !s.filled);
  const addShots = () => {
    if (!record) return;
    void updateStudio(record.id, (st) => ({ ...st, shots: mergeShots(st.shots, empty.map((s) => s.shot())) }));
    toast(`${empty.length === 1 ? "Added to" : `${empty.length} shots added to`} the Image Studio's shot list`);
  };
  return (
    <section className="flex flex-col gap-3" aria-label="Expressive portraits">
      <h2 className="font-medium">Expressive portraits</h2>
      <p className="text-sm text-ink-muted">
        A character's portrait changes with their values: their emotion, their outfit, and a hurt look when their health runs low. It fades
        from one picture to the next, and uses the closest picture the card has when one is missing.
      </p>
      {list.map((b, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-2" role="group" aria-label={`Portrait ${b.name || i + 1}`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Character
              <TextInput value={b.name} placeholder="e.g. Mina" onChange={(e) => set(i, { name: e.target.value }, "name")} />
            </label>
            <ValueSelect label="Emotion from" none="Nothing" values={values} value={b.emotion} onChange={(p) => set(i, { emotion: p || undefined }, "emotion")} />
            <ValueSelect label="Outfit from" none="Nothing" values={values} value={b.outfit} onChange={(p) => set(i, { outfit: p || undefined }, "outfit")} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ValueSelect
              label="Looks hurt when"
              none="Never"
              values={values.filter((x) => x.v.type === "number")}
              value={b.hurt?.path}
              onChange={(p) => set(i, { hurt: p ? { path: p, below: b.hurt?.below ?? 30, emotion: b.hurt?.emotion ?? "hurt" } : undefined }, "hurt")}
            />
            {b.hurt && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  is below
                  <TextInput type="number" value={b.hurt.below} onChange={(e) => set(i, { hurt: { ...b.hurt!, below: Number(e.target.value) } }, "hurt")} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Hurt emotion
                  <TextInput value={b.hurt.emotion} onChange={(e) => set(i, { hurt: { ...b.hurt!, emotion: e.target.value } }, "hurt")} />
                </label>
              </>
            )}
          </div>
          <Button variant="ghost" className="self-start" onClick={() => setTheme({ ...theme, portraits: list.filter((_, j) => j !== i) }, "portraits.remove")}>
            Remove
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => setTheme({ ...theme, portraits: [...list, { name: "" }] }, "portraits.add")}>
        Add a character
      </Button>
      {slots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Art: {slots.length - empty.length} of {slots.length} ready
            {empty.length > 0 && <span className="text-ink-muted"> (missing {empty.map((s) => s.label).join("; ")})</span>}
          </span>
          {empty.length > 0 && (
            <Button variant="ghost" onClick={addShots}>
              Add the missing {empty.length} to the shot list
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
