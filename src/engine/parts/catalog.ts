/**
 * The parts library: finished modules the author and the UI engineer pick from and mix across
 * kits. A part is a module with a short pitch, tags to search by, the parts it needs, sample values
 * for its preview, and a note on what to tailor once it's in a card. CardForge's own parts are
 * built from settings (and filled from the card's world when installed); the author's saved
 * modules are parts too. A kit is a theme plus a set of parts.
 */
import type { CardAsset, CardDataV3 } from "../../card";
import { worldMeta } from "../../editor/world";
import { newId } from "../../lib/id";
import { coreModules, modulesOf } from "../modules/compile";
import { creatorModule, creatorSettings, CREATOR_TAG } from "../modules/creator";
import { eventsModule } from "../modules/events";
import { journalModule } from "../modules/journal";
import { menuModule } from "../modules/menu";
import { notifyModule } from "../modules/notify";
import { addModules, cleanModule } from "../modules/pack";
import { peopleModule, peopleSettings } from "../modules/people";
import { phoneModule, phoneSettings } from "../modules/phone";
import { settingsAppModule } from "../modules/settingsApp";
import { timeModule } from "../modules/time";
import { titleModule, titleSettings, TITLE_TAG } from "../modules/title";
import type { EngineModule } from "../modules/types";
import type { EngineConfig } from "../sheet";
import type { CardTheme } from "../theme";

type Settings = Record<string, unknown>;

export interface Part {
  /** The id of the module it installs. */
  id: string;
  name: string;
  summary: string;
  tags: string[];
  /** Parts installed along with it. */
  requires: string[];
  source: "built-in" | "mine";
  make: (settings?: Settings) => EngineModule;
  /** What to adapt from the card once it's installed. */
  tailor: string;
  /** Values for its preview, by group. */
  sample?: Record<string, unknown>;
  /** Settings for its preview, so it isn't empty on a card without a world yet. */
  previewSettings?: Settings;
  /** Fills the settings from the card's world pages and images. */
  fill?: (settings: Settings, data: CardDataV3) => Settings;
  /** Takes out what belongs to one card (names, places, art), for saving in a kit. */
  generic?: (settings: Settings) => Settings;
  /** The tag that shows it in the opening message. */
  messageTag?: string;
}

// ---------------------------------------------------------------- tailoring from the card

/** The card's world pages of one kind, as their fields. */
export function worldOf(data: CardDataV3, kind: "npc" | "location" | "item") {
  return (data.character_book?.entries ?? [])
    .map(worldMeta)
    .filter((m) => m?.kind === kind && m.fields.name?.trim())
    .map((m) => m!.fields);
}

const IMAGE = /^(png|jpe?g|webp|gif|avif)$/i;
const fileOf = (a: CardAsset) => `${a.name}.${a.ext}`;
const images = (data: CardDataV3) => (data.assets ?? []).filter((a) => IMAGE.test(a.ext) && !a.uri.startsWith("ccdefault:"));

/** A card image named after someone ("mina.png", "Mina_smile.webp"), for their portrait. */
export function portraitFor(data: CardDataV3, name: string): string {
  const key = name.trim().toLowerCase();
  const hit = images(data).find((a) => a.name.toLowerCase() === key) ?? images(data).find((a) => a.name.toLowerCase().startsWith(key));
  return hit ? fileOf(hit) : "";
}

const firstNumber = (s = "") => Number(/\d+(?:\.\d+)?/.exec(s)?.[0] ?? 0);

/** Adds rows by name, skipping names already there. */
export function mergeByName<T extends { name: string }>(rows: T[], incoming: T[]): T[] {
  const have = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  return [...rows, ...incoming.filter((r) => !have.has(r.name.trim().toLowerCase()))];
}

/** One or two sentences, at most about 220 characters. */
function premiseOf(text: string): string {
  const flat = text.replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]+[.!?]+/g) ?? [flat];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > 220) break;
    out += s;
  }
  return (out || flat.slice(0, 220)).trim();
}

export function fillPhone(raw: Settings, data: CardDataV3): Settings {
  const s = phoneSettings(raw);
  const contacts = worldOf(data, "npc").map((f) => ({ name: f.name.trim(), role: f.role ?? "", avatar: portraitFor(data, f.name) }));
  const places = worldOf(data, "location").map((f) => ({ name: f.name.trim(), description: f.mood ?? "" }));
  const shop = worldOf(data, "item").map((f) => ({ name: f.name.trim(), price: firstNumber(f.price), description: f.effect ?? "" }));
  return { ...raw, contacts: mergeByName(s.contacts, contacts), places: mergeByName(s.places, places), shop: mergeByName(s.shop, shop) };
}

export function fillCreator(raw: Settings, data: CardDataV3): Settings {
  const s = creatorSettings(raw);
  const places = worldOf(data, "location");
  const items = worldOf(data, "item").filter((f) => (f.type ?? "item").toLowerCase() !== "service");
  const choices =
    places.length && !s.choices.some((c) => c.name === "Start")
      ? [...s.choices, { name: "Start", options: places.map((p) => ({ name: p.name.trim(), description: p.mood || "" })) }]
      : s.choices;
  return { ...raw, choices, items: [...s.items, ...items.map((i) => i.name.trim()).filter((n) => !s.items.includes(n))] };
}

export function fillPeople(raw: Settings, data: CardDataV3): Settings {
  const s = peopleSettings(raw);
  const people = worldOf(data, "npc").map((f) => ({ name: f.name.trim(), role: f.role ?? "", avatar: portraitFor(data, f.name), about: f.look ?? "", likes: "" }));
  return { ...raw, people: mergeByName(s.people, people) };
}

export function fillTitle(raw: Settings, data: CardDataV3): Settings {
  const s = titleSettings(raw);
  const art = images(data).find((a) => a.type === "background") ?? images(data).find((a) => a.type === "icon");
  return {
    ...raw,
    title: s.title || data.name,
    premise: s.premise || premiseOf(data.scenario || data.description || ""),
    art: s.art || (art ? fileOf(art) : ""),
  };
}

// ---------------------------------------------------------------- the built-in parts

const PHONE_SAMPLE = {
  Phone: {
    Texts: ["Rhea: Coffee later? ☕", "Me → Rhea: Sure, at six?", "Rhea: It's a date 💛"],
    News: ["Storm warning — Ferries cancelled tonight"],
    Money: 120,
    Transactions: ["+200 Paycheck", "−5 Coffee"],
    Location: "Harbor Café",
  },
  Rhea: { Affection: 46 },
};

export const BUILT_IN_PARTS: Part[] = [
  {
    id: "time",
    name: "In-game time",
    summary: "Clock, day, weekday, season and weather; timers that expire; where the regulars are by their routines.",
    tags: ["shared", "core", "time", "weather", "routines"],
    requires: [],
    source: "built-in",
    make: (s) => timeModule(s),
    tailor: "Set the start day, clock, season and weathers to fit the setting, and add routines for the regulars (who is where, when).",
    generic: (s) => ({ ...s, routines: [] }),
    sample: { Time: { Day: 3, Clock: "18:40", Weather: "Rain", _Weekday: "Wednesday", _PartOfDay: "Evening", _Season: "Autumn" } },
  },
  {
    id: "settings",
    name: "Settings app",
    summary: "The player's own settings: light or dark, accent, text size, panels, generations, sound, and fixing values by hand.",
    tags: ["shared", "core", "settings", "hub"],
    requires: [],
    source: "built-in",
    make: (s) => settingsAppModule(s),
    tailor: "Nothing to tailor; turn sections off that the card doesn't use (sound with no audio).",
  },
  {
    id: "title",
    name: "Title screen",
    summary: "The opening message starts on a title screen: card art, title, premise and New game / Continue / Settings.",
    tags: ["shared", "title", "inline", "start"],
    requires: [],
    source: "built-in",
    make: (s) => titleModule(s),
    tailor: "Write a tagline in the card's tone, tighten the premise to one or two sentences, and pick the art and music from the card's assets.",
    fill: fillTitle,
    generic: (s) => ({ ...s, title: "", premise: "", art: "", music: "" }),
    messageTag: TITLE_TAG,
  },
  {
    id: "creator",
    name: "Character creator",
    summary: "An opening screen where the player makes their character: name, look, choices, stats from a point budget and starting items.",
    tags: ["shared", "creator", "inline", "start", "stats"],
    requires: [],
    source: "built-in",
    make: (s) => creatorModule(s),
    tailor: "Make the choices fit the setting (backgrounds, classes, factions), name the stats in the genre's words, and write route openings in the card's voice.",
    fill: fillCreator,
    messageTag: CREATOR_TAG,
  },
  {
    id: "menu",
    name: "Menu",
    summary: "One hub button that opens a home screen of tiles for every other screen, so the input box stays clear.",
    tags: ["shared", "hub", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => menuModule(s),
    tailor: "Rename the menu and its button to fit the genre (a satchel, a terminal, a grimoire).",
  },
  {
    id: "people",
    name: "People",
    summary: "A profile for everyone in the cast: portrait, role, where they are now, how they feel about you and what you've learned.",
    tags: ["shared", "npc", "relationships", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => peopleModule(s),
    tailor: "Check each person's role and look, add what they like, and rename the stages to fit the setting (rivals, sworn, beloved…).",
    fill: fillPeople,
    generic: (s) => ({ ...s, people: [] }),
    previewSettings: { people: [{ name: "Mina", role: "Runs the harbor café", avatar: "", about: "Freckles, ink-stained fingers, a laugh you hear across the room.", likes: "Rain, strong tea, old maps" }] },
    sample: { Mina: { Affection: 52, Learned: ["Hates the sea since the wreck", "Keeps her father's compass"] }, Time: { _Whereabouts: "Mina: the café (until 22:00)" } },
  },
  {
    id: "events",
    name: "Events",
    summary: "Scheduled and random events by day, time and place; what's happening now goes in the state for the model to weave in.",
    tags: ["shared", "events", "time", "script"],
    requires: ["time"],
    source: "built-in",
    make: (s) => eventsModule(s),
    tailor: "Write the card's own events: its festivals, shifts, markets and dangers, with the places from the world pages.",
    generic: (s) => ({ ...s, scheduled: [], random: [] }),
    sample: { Events: { _Now: ["Market day: Stalls fill the square; prices are good and gossip is better."] } },
  },
  {
    id: "journal",
    name: "Journal",
    summary: "The day's key events, filed by day and sent back as a short memory; optionally written up by a side call.",
    tags: ["shared", "journal", "memory", "screen"],
    requires: ["time"],
    source: "built-in",
    make: (s) => journalModule(s),
    tailor: "Rename it to fit (a diary, a captain's log, a case file) and pick how many days the model remembers.",
    sample: { Journal: { Today: ["Met Mina at the café", "Promised to find her brother"], $Past: ["Day 2: Arrived in port. The ferry was late and the inn was full."] }, Time: { Day: 3 } },
  },
  {
    id: "notify",
    name: "Notifications",
    summary: "Banners over the chat for new texts, news, events and anything a screen announces, in the card's theme.",
    tags: ["notifications", "script", "phone"],
    requires: [],
    source: "built-in",
    make: (s) => notifyModule(s),
    tailor: "Watch the lists the card's screens fill (texts, quests, news) and give each banner a title in the genre's words.",
  },
  {
    id: "phone",
    name: "Phone",
    summary: "A phone over the chat with a lock screen, home screen and apps the player uses to act: texts, contacts, social, news, wallet, map and more.",
    tags: ["phone", "screen", "hub", "modern", "relationships", "money"],
    requires: ["time"],
    source: "built-in",
    make: (s) => phoneModule(s),
    tailor: "Pick the apps the setting needs, set the currency and starting money, and give the system app the card's own job (a quest board, a dating app…).",
    fill: fillPhone,
    generic: (s) => ({ ...s, contacts: [], places: [], shop: [], photos: [], wallpaper: "" }),
    previewSettings: { contacts: [{ name: "Rhea", role: "Barista", avatar: "" }] },
    sample: PHONE_SAMPLE,
  },
];

/** The author's saved modules, as parts. */
export function libraryParts(modules: EngineModule[]): Part[] {
  return modules
    .filter((m) => !m.core)
    .map((m) => ({
      id: m.id,
      name: m.name,
      summary: m.description,
      tags: ["mine", ...m.tags],
      requires: m.requires,
      source: "mine" as const,
      make: () => structuredClone({ ...m, enabled: true }),
      tailor: "Adapt the names, labels and rules to this card.",
    }));
}

export const allParts = (library: EngineModule[] = []) => [...BUILT_IN_PARTS, ...libraryParts(library).filter((p) => !BUILT_IN_PARTS.some((b) => b.id === p.id))];

export const partTags = (parts: Part[]) => [...new Set(parts.flatMap((p) => p.tags))].sort();

/** Parts matching every word of the query (in the name, pitch or tags) and the tag, if any. */
export function searchParts(parts: Part[], query = "", tag = ""): Part[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.filter((p) => {
    if (tag && !p.tags.includes(tag)) return false;
    const hay = `${p.id} ${p.name} ${p.summary} ${p.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Whether the card has the part, by module id or built-in kind. */
export const hasPart = (config: EngineConfig, id: string) => modulesOf(config).some((m) => m.id === id || m.core === id);

export interface Installed {
  config: EngineConfig;
  /** The modules added, in order (needed parts first). */
  added: EngineModule[];
  /** Tags to put in the opening message. */
  messageTags: string[];
  /** What to adapt next, per part. */
  notes: string[];
}

/**
 * Installs parts with the parts they need, each filled from the card. Parts already in the card are
 * left as they are (turned on if they were off). `settings` are merged over the part's own.
 */
export function installParts(config: EngineConfig, data: CardDataV3, ids: string[], parts: Part[], settings: Record<string, Settings> = {}): Installed {
  let modules = config.modules ?? coreModules();
  const added: EngineModule[] = [];
  const messageTags: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (seen.has(id)) return;
    seen.add(id);
    const part = parts.find((p) => p.id === id);
    if (!part) throw new Error(`There's no part "${id}"${path.length ? ` (needed by ${path.at(-1)})` : ""}.`);
    // What the part says it needs, and what its module says (a saved module's own "requires").
    for (const need of new Set([...part.requires, ...part.make().requires])) visit(need, [...path, part.name]);
    const at = modules.findIndex((m) => m.id === id || m.core === id);
    if (at >= 0) {
      if (!modules[at].enabled) modules = modules.map((m, i) => (i === at ? { ...m, enabled: true } : m));
      return;
    }
    let module = part.make();
    let s: Settings = { ...module.settings, ...(settings[id] ?? {}) };
    delete s.live;
    if (part.fill) s = part.fill(s, data);
    module = cleanModule({ ...part.make(s), enabled: true }) ?? module;
    modules = addModules(modules, [module]);
    added.push(modules.at(-1)!);
    if (part.messageTag) messageTags.push(part.messageTag);
    notes.push(`${part.name}: ${part.tailor}`);
  };
  for (const id of ids) visit(id, []);
  return { config: { ...config, modules }, added, messageTags, notes };
}

/** The opening message with the tags of newly installed parts: the title first, the rest after. */
export function withMessageTags(firstMes: string, tags: string[]): string {
  let out = firstMes;
  for (const tag of tags) {
    if (out.includes(tag)) continue;
    out = tag === TITLE_TAG ? `${tag}\n\n${out}`.trimEnd() : `${out}\n\n${tag}`.trimStart();
  }
  return out;
}

// ---------------------------------------------------------------- kits

export interface Kit {
  id: string;
  name: string;
  description: string;
  /** The theme it brings; none keeps the card's. */
  theme?: CardTheme;
  /** Built-in parts by id, with the settings to install them with. */
  parts: { id: string; settings?: Settings }[];
  /** The author's own modules, saved whole. */
  modules: EngineModule[];
  builtIn?: boolean;
}

export const BUILT_IN_KITS: Kit[] = [
  {
    id: "shared-starter",
    name: "Starter game",
    description: "The shared parts every kit starts from: time, settings, title screen, character creator, menu, people, events, journal and notifications.",
    parts: ["time", "settings", "title", "creator", "menu", "people", "events", "journal", "notify"].map((id) => ({ id })),
    modules: [],
    builtIn: true,
  },
];

/** A kit from the card: its theme, its built-in parts without what belongs to this card, and its own modules. */
export function kitFromConfig(config: EngineConfig, name: string, description = ""): Kit {
  const parts: Kit["parts"] = [];
  const modules: EngineModule[] = [];
  for (const m of config.modules ?? coreModules()) {
    if (!m.enabled) continue;
    const part = m.core ? BUILT_IN_PARTS.find((p) => p.id === m.core) : undefined;
    if (part) {
      const s = { ...m.settings };
      delete s.live;
      parts.push({ id: part.id, settings: part.generic ? part.generic(s) : s });
    } else if (!m.core) modules.push(structuredClone(m));
  }
  return { id: newId(), name: name.trim() || "My kit", description, theme: config.theme ? structuredClone(config.theme) : undefined, parts, modules };
}

/** Puts a kit in the card: its theme, then its parts (filled from the card) and its own modules. */
export function applyKit(config: EngineConfig, data: CardDataV3, kit: Kit, parts: Part[]): Installed {
  const base = kit.theme ? { ...config, theme: structuredClone(kit.theme) } : config;
  const settings = Object.fromEntries(kit.parts.filter((p) => p.settings).map((p) => [p.id, p.settings!]));
  const out = installParts(base, data, kit.parts.map((p) => p.id), parts, settings);
  const fresh = kit.modules.filter((m) => !hasPart(out.config, m.id));
  if (!fresh.length) return out;
  const modules = addModules(out.config.modules ?? [], fresh);
  return { ...out, config: { ...out.config, modules }, added: [...out.added, ...modules.slice(-fresh.length)] };
}

/** A kit from untrusted JSON (a saved one), or null. */
export function cleanKit(raw: unknown): Kit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string") return null;
  const theme = r.theme && typeof r.theme === "object" ? (r.theme as CardTheme) : undefined;
  return {
    id: typeof r.id === "string" ? r.id : newId(),
    name: r.name,
    description: typeof r.description === "string" ? r.description : "",
    theme,
    parts: (Array.isArray(r.parts) ? r.parts : [])
      .filter((p): p is { id: string; settings?: Settings } => !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string")
      .filter((p) => BUILT_IN_PARTS.some((b) => b.id === p.id))
      .map((p) => ({ id: p.id, settings: p.settings && typeof p.settings === "object" ? structuredClone(p.settings) : undefined })),
    modules: (Array.isArray(r.modules) ? r.modules : []).map(cleanModule).filter((m): m is EngineModule => !!m && !m.core),
  };
}

/** Lines for list_parts. */
export function partsText(parts: Part[], config: EngineConfig): string {
  if (!parts.length) return "No parts match.";
  return parts
    .map((p) => `- ${p.id}${hasPart(config, p.id) ? " (installed)" : ""}: ${p.name}. ${p.summary} Tags: ${p.tags.join(", ")}.${p.requires.length ? ` Needs: ${p.requires.join(", ")}.` : ""}${p.source === "mine" ? " From the author's library." : ""}`)
    .join("\n");
}

