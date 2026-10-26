/**
 * The engine's Modules tab: the packages merged into the card (the core clock and settings app, the
 * built-in screens like the phone and character creator, and the author's own), their settings, what clashes between them, and the library and pack files
 * that move modules between projects and machines.
 */
import { useEffect, useState } from "react";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { coreModules, moduleConflicts, resolveModule, modulePaths, modulesOf, newModule } from "../../engine/modules/compile";
import { creatorModule, creatorSettings } from "../../engine/modules/creator";
import { eventsModule, eventsSettings } from "../../engine/modules/events";
import { journalModule, journalSettings } from "../../engine/modules/journal";
import { menuModule, menuSettings } from "../../engine/modules/menu";
import { notifyModule, notifySettings } from "../../engine/modules/notify";
import { peopleSettings } from "../../engine/modules/people";
import { titleModule, titleSettings } from "../../engine/modules/title";
import { addModules, modulePack, readPack } from "../../engine/modules/pack";
import { phoneModule, phoneSettings } from "../../engine/modules/phone";
import { settingsAppModule, settingsAppSettings, type SettingsAppSettings } from "../../engine/modules/settingsApp";
import { SEASONS, timeModule, timeSettings, WEEKDAYS, type Routine, type TimeSettings } from "../../engine/modules/time";
import { SLOTS, type EngineModule, type ModuleRegex, type ModuleRule, type Slot } from "../../engine/modules/types";
import { scriptSource } from "../../engine/runtime";
import { newVar, settingsSource, type EngineConfig, type EngineVar } from "../../engine/sheet";
import { pickFiles, safeFileName, saveFile } from "../../lib/files";
import { loadModuleLibrary, removeFromModuleLibrary, saveModulesToLibrary } from "./moduleLibrary";
import { EventsEditor, JournalEditor, MenuEditor, NotifyEditor, PeopleEditor, TitleEditor } from "./PartEditors";
import { PartsBrowser } from "./PartsBrowser";
import { CreatorEditor, ListInput, PhoneEditor } from "./ScreenEditors";
import { nameProblem, selectClass, summary, VarEditor } from "./VarEditor";

type Save = (c: EngineConfig, key?: string) => void;

const PACK_FILE = { filterName: "CardForge module pack", extensions: ["json"], mime: "application/json" };

async function exportPack(modules: EngineModule[], name: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(modulePack(modules), null, 2));
  if (await saveFile(`${safeFileName(name, "modules")}.cfmodules.json`, bytes, PACK_FILE)) toast(`Saved ${modules.length === 1 ? modules[0].name : `${modules.length} modules`}`);
}

const raw = <T,>(s: T) => s as unknown as Record<string, unknown>;

const kb = (n: number) => `${Math.round(n / 102.4) / 10} KB`;

export function ModulesPage({ config, save }: { config: EngineConfig; save: Save }) {
  const modules = modulesOf(config);
  const [open, setOpen] = useState<string>();
  const [library, setLibrary] = useState(false);
  const conflicts = moduleConflicts(config);
  const size = scriptSource(settingsSource(config)).length;

  const setModules = (next: EngineModule[], key?: string) => save({ ...config, modules: next }, key);
  const update = (index: number, m: EngineModule, key?: string) => setModules(modules.map((o, i) => (i === index ? m : o)), key && `engine.module.${index}.${key}`);
  const add = (incoming: EngineModule[]) => {
    const next = addModules(modules, incoming);
    setModules(next);
    return next;
  };
  const create = () => {
    const next = add([newModule()]);
    setOpen(`${next.length - 1}`);
  };
  const importPack = async () => {
    const [file] = await pickFiles(".json,application/json");
    if (!file) return;
    try {
      const incoming = readPack(await file.text());
      add(incoming);
      toast(`Added ${incoming.length === 1 ? incoming[0].name : `${incoming.length} modules`}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const missingCore = coreModules().filter((c) => !modules.some((m) => m.core === c.core));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Modules are packages the engine merges into the card: their values join the game state, their rules join the
        lorebook, and their screens show in the status panel, over the chat from a hub button, or inside messages.
      </p>
      {conflicts.length > 0 && (
        <section className="flex flex-col gap-1 rounded-xl border border-red-500/40 p-3 text-sm" aria-label="Conflicts">
          <h2 className="font-medium text-red-300">Fix before exporting</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.between.join(" and ")}</span>: {c.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="flex flex-col gap-2" aria-label="Modules">
        {modules.map((m, i) => {
          const expanded = open === `${i}`;
          return (
            <li key={i} className="rounded-xl border border-border bg-surface-raised">
              <div className="flex min-h-12 items-center gap-2 px-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? undefined : `${i}`)}
                  className="min-w-0 flex-1 py-2 text-left text-sm"
                >
                  <span className="font-medium">{m.name || m.id}</span>{" "}
                  <span className="text-ink-muted">· {SLOTS[m.slot].label}</span>
                  {m.core && <span className="ml-2 rounded-full bg-accent/15 px-2 text-xs text-accent">{m.tags.includes("built-in") ? "Built-in" : "Core"}</span>}
                  {m.description && <span className="block truncate text-xs text-ink-muted">{m.description}</span>}
                </button>
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={m.enabled} onChange={(e) => update(i, { ...m, enabled: e.target.checked })} />
                  On
                </label>
              </div>
              {expanded && (
                <div className="flex flex-col gap-3 border-t border-border p-3">
                  {m.core === "time" ? (
                    <TimeEditor settings={timeSettings(m.settings)} onChange={(s, key) => update(i, timeModule(s as unknown as Record<string, unknown>, m.enabled), key)} />
                  ) : m.core === "settings" ? (
                    <SettingsAppEditor settings={settingsAppSettings(m.settings)} onChange={(s) => update(i, settingsAppModule(s as unknown as Record<string, unknown>, m.enabled))} />
                  ) : m.core === "creator" ? (
                    <CreatorEditor settings={creatorSettings(m.settings)} onChange={(s, key) => update(i, creatorModule(s as unknown as Record<string, unknown>, m.enabled), key)} />
                  ) : m.core === "phone" ? (
                    <PhoneEditor settings={phoneSettings(m.settings)} onChange={(s, key) => update(i, phoneModule(s as unknown as Record<string, unknown>, m.enabled), key)} />
                  ) : m.core === "title" ? (
                    <TitleEditor settings={titleSettings(m.settings)} onChange={(s, key) => update(i, titleModule(raw(s), m.enabled), key)} />
                  ) : m.core === "menu" ? (
                    <MenuEditor settings={menuSettings(m.settings)} onChange={(s, key) => update(i, menuModule(raw(s), m.enabled), key)} />
                  ) : m.core === "people" ? (
                    <PeopleEditor settings={peopleSettings(m.settings)} onChange={(s, key) => update(i, resolveModule({ ...m, settings: raw(s) }, modules), key)} />
                  ) : m.core === "events" ? (
                    <EventsEditor settings={eventsSettings(m.settings)} onChange={(s, key) => update(i, eventsModule(raw(s), m.enabled), key)} />
                  ) : m.core === "journal" ? (
                    <JournalEditor settings={journalSettings(m.settings)} onChange={(s, key) => update(i, journalModule(raw(s), m.enabled), key)} />
                  ) : m.core === "notify" ? (
                    <NotifyEditor settings={notifySettings(m.settings)} onChange={(s, key) => update(i, notifyModule(raw(s), m.enabled), key)} />
                  ) : (
                    <CustomEditor m={m} onChange={(next, key) => update(i, next, key)} />
                  )}
                  {m.vars.length > 0 && <p className="text-xs text-ink-muted">Adds {modulePaths(m).join(", ")}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void saveModulesToLibrary([m]).then(() => toast(`Saved ${m.name} to your library`))}>Save to my library</Button>
                    <Button onClick={() => void exportPack([m], m.name)}>Save as a file</Button>
                    <Button
                      variant="danger"
                      className="ml-auto"
                      onClick={() => {
                        setModules(modules.filter((_, j) => j !== i));
                        setOpen(undefined);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={create}>
          New module
        </Button>
        <Button onClick={() => setLibrary(true)}>From my library</Button>
        <Button onClick={() => void importPack()}>Open a pack file</Button>
        <Button disabled={!modules.length} onClick={() => void exportPack(modules, "modules")}>
          Save all as a pack
        </Button>
        {missingCore.map((c) => (
          <Button key={c.id} variant="ghost" onClick={() => add([c])}>
            Add back {c.name}
          </Button>
        ))}
      </div>
      <p className="text-xs text-ink-muted">The card's engine script is {kb(size)} with these modules.</p>
      <PartsBrowser config={config} onAdded={(i) => setOpen(`${i}`)} />
      {library && (
        <LibraryDialog
          onClose={() => setLibrary(false)}
          onUse={(m) => {
            add([m]);
            setLibrary(false);
            toast(`Added ${m.name}`);
          }}
        />
      )}
    </div>
  );
}

function LibraryDialog({ onClose, onUse }: { onClose: () => void; onUse: (m: EngineModule) => void }) {
  const [list, setList] = useState<EngineModule[]>();
  useEffect(() => void loadModuleLibrary().then(setList), []);
  return (
    <Dialog open title="My module library" onClose={onClose}>
      {!list ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !list.length ? (
        <p className="text-sm text-ink-muted">Nothing saved yet. Open a module and press "Save to my library" to reuse it in other projects.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{m.name}</div>
                <div className="truncate text-xs text-ink-muted">{m.description || SLOTS[m.slot].label}</div>
              </div>
              <Button onClick={() => onUse(m)}>Add</Button>
              <Button variant="ghost" aria-label={`Delete ${m.name} from the library`} onClick={() => void removeFromModuleLibrary(m.id).then(setList)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function TimeEditor({ settings, onChange }: { settings: TimeSettings; onChange: (s: TimeSettings, key?: string) => void }) {
  const set = (patch: Partial<TimeSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const setRoutine = (i: number, patch: Partial<Routine>, key: string) =>
    set({ routines: settings.routines.map((r, j) => (j === i ? { ...r, ...patch } : r)) }, `routine.${i}.${key}`);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model moves the clock in its updates; the engine rolls the day at midnight, works out the weekday, season
        and part of the day, and drops timers once they run out.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          First day
          <TextInput inputMode="numeric" value={settings.startDay} onChange={(e) => set({ startDay: Number(e.target.value) || 1 }, "startDay")} />
        </label>
        <label className="flex flex-col gap-1">
          Starting time
          <TextInput type="time" value={settings.startClock} onChange={(e) => set({ startClock: e.target.value }, "startClock")} />
        </label>
        <label className="flex flex-col gap-1">
          Weekday
          <select className={selectClass} value={settings.startWeekday} onChange={(e) => set({ startWeekday: e.target.value }, "startWeekday")}>
            {WEEKDAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Season
          <select className={selectClass} value={settings.startSeason} onChange={(e) => set({ startSeason: e.target.value }, "startSeason")}>
            {SEASONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Days a season
          <TextInput inputMode="numeric" value={settings.daysPerSeason} onChange={(e) => set({ daysPerSeason: Number(e.target.value) || 1 }, "daysPerSeason")} />
        </label>
        <label className="flex flex-col gap-1">
          Starting weather
          <select className={selectClass} value={settings.startWeather} onChange={(e) => set({ startWeather: e.target.value }, "startWeather")}>
            {settings.weathers.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        Weathers, separated by commas
        <ListInput value={settings.weathers} onChange={(weathers) => set({ weathers }, "weathers")} />
      </label>
      <label className="flex min-h-8 items-center gap-2">
        <input type="checkbox" className="size-4" checked={settings.lore} onChange={(e) => set({ lore: e.target.checked }, "lore")} />
        Let the time turn on lorebook entries (keys like "night", "winter", "Saturday" or "rain")
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Routines</legend>
        <p className="text-xs text-ink-muted">Where the regulars are at each hour. The engine tells the model, so they turn up in the right place.</p>
        {settings.routines.map((r, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-6">
            <TextInput aria-label="Who" placeholder="Who" value={r.npc} onChange={(e) => setRoutine(i, { npc: e.target.value }, "npc")} />
            <TextInput aria-label="Where" placeholder="Where" className="sm:col-span-2" value={r.place} onChange={(e) => setRoutine(i, { place: e.target.value }, "place")} />
            <TextInput aria-label="From" type="time" value={r.from} onChange={(e) => setRoutine(i, { from: e.target.value }, "from")} />
            <TextInput aria-label="Until" type="time" value={r.to} onChange={(e) => setRoutine(i, { to: e.target.value }, "to")} />
            <TextInput aria-label="Days" placeholder="Mon-Fri" value={r.days} onChange={(e) => setRoutine(i, { days: e.target.value }, "days")} />
            <Button variant="ghost" className="col-span-2 sm:col-span-6 sm:justify-self-end" onClick={() => set({ routines: settings.routines.filter((_, j) => j !== i) }, "routines")}>
              Remove
            </Button>
          </div>
        ))}
        <Button className="self-start" onClick={() => set({ routines: [...settings.routines, { npc: "", place: "", from: "09:00", to: "17:00", days: "" }] }, "routines")}>
          Add a routine
        </Button>
      </fieldset>
    </div>
  );
}

const SECTIONS: [keyof SettingsAppSettings["sections"], string][] = [
  ["look", "Look: light or dark, accent, text size"],
  ["panels", "Panels: compact panels, how many stay live"],
  ["generations", "Generations: background calls on or off"],
  ["sound", "Sound: music and ambience levels"],
  ["state", "Game state: fix values by hand, start over"],
];

function SettingsAppEditor({ settings, onChange }: { settings: SettingsAppSettings; onChange: (s: SettingsAppSettings) => void }) {
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 text-ink-muted">What players can change, from the ⚙ Settings button above the input box</legend>
      {SECTIONS.map(([key, label]) => (
        <label key={key} className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.sections[key]}
            onChange={(e) => onChange({ sections: { ...settings.sections, [key]: e.target.checked } })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

const codeClass = "font-mono text-xs";

function CustomEditor({ m, onChange }: { m: EngineModule; onChange: (m: EngineModule, key?: string) => void }) {
  const set = (patch: Partial<EngineModule>, key: string) => onChange({ ...m, ...patch }, key);
  const [openVar, setOpenVar] = useState<string>();
  const groups = [...new Set(m.vars.map((v) => v.group.trim()).filter(Boolean))];
  const setVar = (id: string, patch: Partial<EngineVar>, key: string) => set({ vars: m.vars.map((v) => (v.id === id ? { ...v, ...patch } : v)) }, `var.${id}.${key}`);
  const moveVar = (index: number, by: number) => {
    const vars = [...m.vars];
    const [v] = vars.splice(index, 1);
    vars.splice(index + by, 0, v);
    set({ vars }, "vars");
  };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          Name
          <TextInput value={m.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        </label>
        <label className="flex flex-col gap-1">
          Id
          <TextInput value={m.id} onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }, "id")} />
        </label>
        <label className="flex flex-col gap-1">
          Shows as
          <select className={selectClass} value={m.slot} onChange={(e) => set({ slot: e.target.value as Slot }, "slot")}>
            {(Object.keys(SLOTS) as Slot[]).map((s) => (
              <option key={s} value={s}>
                {SLOTS[s].label}
              </option>
            ))}
          </select>
        </label>
        {m.slot === "overlay" && (
          <label className="flex flex-col gap-1">
            Hub button
            <TextInput value={m.button ?? ""} placeholder="✦ Phone" onChange={(e) => set({ button: e.target.value }, "button")} />
          </label>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        {SLOTS[m.slot].help}
        {m.slot === "message" && <> Put <code>{`<cf-module id="${m.id}"/>`}</code> in a message or the greeting.</>}
      </p>
      <label className="flex flex-col gap-1">
        Description
        <TextInput value={m.description} onChange={(e) => set({ description: e.target.value }, "description")} />
      </label>

      <details className="rounded-lg border border-border p-2" open={m.vars.length > 0}>
        <summary className="cursor-pointer font-medium">Values ({m.vars.length})</summary>
        <ul className="mt-2 flex flex-col gap-2">
          {m.vars.map((v, i) => {
            const expanded = openVar === v.id;
            const problem = nameProblem(v, m.vars);
            return (
              <li key={v.id} className="rounded-lg border border-border">
                <button type="button" aria-expanded={expanded} onClick={() => setOpenVar(expanded ? undefined : v.id)} className="flex min-h-10 w-full items-center gap-2 px-2 text-left">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{[v.group.trim(), v.name.trim()].filter(Boolean).join(".") || "New value"}</span>{" "}
                    <span className="text-ink-muted">· {summary(v)}</span>
                  </span>
                  {problem && <span className="text-xs text-red-300">Fix</span>}
                </button>
                {expanded && (
                  <VarEditor
                    v={v}
                    groups={groups}
                    problem={problem}
                    onChange={(patch, key) => setVar(v.id, patch, key)}
                    onRemove={() => set({ vars: m.vars.filter((o) => o.id !== v.id) }, "vars")}
                    onMove={(by) => moveVar(i, by)}
                    first={i === 0}
                    last={i === m.vars.length - 1}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <Button
          className="mt-2"
          onClick={() => {
            const v = newVar({ group: m.vars.at(-1)?.group ?? m.name.replace(/[^A-Za-z0-9 ]/g, "").trim(), name: "" });
            set({ vars: [...m.vars, v] }, "vars");
            setOpenVar(v.id);
          }}
        >
          Add a value
        </Button>
      </details>

      {m.slot !== "script" && (
        <details className="rounded-lg border border-border p-2" open>
          <summary className="cursor-pointer font-medium">Screen</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-ink-muted">
              The script runs with <code>CF</code> (the engine), <code>app</code> (this screen: state, set, send, open,
              toast…) and <code>root</code> (its element). The card theme and the UI kit's <code>cf-</code> classes are
              already there.
            </p>
            <label className="flex flex-col gap-1">
              HTML
              <AutoTextarea rows={3} className={codeClass} value={m.html} spellCheck={false} onChange={(e) => set({ html: e.target.value }, "html")} />
            </label>
            <label className="flex flex-col gap-1">
              CSS
              <AutoTextarea rows={3} className={codeClass} value={m.css} spellCheck={false} onChange={(e) => set({ css: e.target.value }, "css")} />
            </label>
            <label className="flex flex-col gap-1">
              Screen script
              <AutoTextarea rows={5} className={codeClass} value={m.js} spellCheck={false} onChange={(e) => set({ js: e.target.value }, "js")} />
            </label>
          </div>
        </details>
      )}

      <details className="rounded-lg border border-border p-2" open={m.slot === "script" || !!m.script}>
        <summary className="cursor-pointer font-medium">Card script</summary>
        <p className="mt-2 text-xs text-ink-muted">
          Runs once when the chat opens, with <code>CF</code>, <code>settings</code> and <code>hooks</code>.{" "}
          <code>hooks.afterUpdate(function (stat, before) {"{ … return stat; }"})</code> changes the state after each
          reply.
        </p>
        <AutoTextarea rows={4} className={`mt-2 ${codeClass}`} aria-label="Card script" value={m.script} spellCheck={false} onChange={(e) => set({ script: e.target.value }, "script")} />
      </details>

      <RulesEditor rules={m.rules} onChange={(rules) => set({ rules }, "rules")} />
      <RegexEditor regex={m.regex} onChange={(regex) => set({ regex }, "regex")} />
    </div>
  );
}

function RulesEditor({ rules, onChange }: { rules: ModuleRule[]; onChange: (r: ModuleRule[]) => void }) {
  const set = (i: number, patch: Partial<ModuleRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <details className="rounded-lg border border-border p-2" open={rules.length > 0}>
      <summary className="cursor-pointer font-medium">Lorebook rules ({rules.length})</summary>
      <div className="mt-2 flex flex-col gap-2">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <TextInput aria-label="Rule name" placeholder="Name" value={r.comment} onChange={(e) => set(i, { comment: e.target.value })} />
            <AutoTextarea aria-label="Rule text" rows={2} placeholder="What the model is told" value={r.content} onChange={(e) => set(i, { content: e.target.value })} />
            <label className="flex min-h-8 items-center gap-2">
              <input type="checkbox" className="size-4" checked={r.constant} onChange={(e) => set(i, { constant: e.target.checked })} />
              Always sent
            </label>
            {!r.constant && (
              <ListInput aria-label="Keys" placeholder="Keys, separated by commas" value={r.keys} onChange={(keys) => set(i, { keys })} />
            )}
            <Button variant="ghost" className="self-end" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button className="self-start" onClick={() => onChange([...rules, { comment: "", content: "", constant: true, keys: [], order: 100 }])}>
          Add a rule
        </Button>
      </div>
    </details>
  );
}

function RegexEditor({ regex, onChange }: { regex: ModuleRegex[]; onChange: (r: ModuleRegex[]) => void }) {
  const set = (i: number, patch: Partial<ModuleRegex>) => onChange(regex.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <details className="rounded-lg border border-border p-2" open={regex.length > 0}>
      <summary className="cursor-pointer font-medium">Regex ({regex.length})</summary>
      <div className="mt-2 flex flex-col gap-2">
        {regex.map((r, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <TextInput aria-label="Regex name" placeholder="Name" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <TextInput aria-label="Find" placeholder="/pattern/g" className={codeClass} value={r.find} onChange={(e) => set(i, { find: e.target.value })} />
            <AutoTextarea aria-label="Replace with" rows={1} placeholder="Replace with" className={codeClass} value={r.replace} onChange={(e) => set(i, { replace: e.target.value })} />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-8 items-center gap-2">
                <input type="checkbox" className="size-4" checked={r.ai} onChange={(e) => set(i, { ai: e.target.checked })} />
                AI replies
              </label>
              <label className="flex min-h-8 items-center gap-2">
                <input type="checkbox" className="size-4" checked={r.user} onChange={(e) => set(i, { user: e.target.checked })} />
                Player messages
              </label>
              <select aria-label="Changes" className={selectClass} value={r.only} onChange={(e) => set(i, { only: e.target.value as ModuleRegex["only"] })}>
                <option value="both">Changes the message</option>
                <option value="display">Only what's shown</option>
                <option value="prompt">Only what the model gets</option>
              </select>
            </div>
            <Button variant="ghost" className="self-end" onClick={() => onChange(regex.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button className="self-start" onClick={() => onChange([...regex, { name: "", find: "", replace: "", ai: true, user: false, only: "display" }])}>
          Add a regex
        </Button>
      </div>
    </details>
  );
}
