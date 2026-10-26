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
import { caseModule, caseSettings, defaultCaseSettings } from "../modules/casefile";
import { choicesModule } from "../modules/choices";
import { combatModule } from "../modules/combat";
import { creatorModule, creatorSettings, CREATOR_TAG } from "../modules/creator";
import { eventsModule } from "../modules/events";
import { heroModule } from "../modules/hero";
import { inventoryModule, inventorySettings, type ItemKind } from "../modules/inventory";
import { journalModule } from "../modules/journal";
import { lifeModule } from "../modules/life";
import { defaultMapSettings, mapModule, mapSettings } from "../modules/map";
import { menuModule } from "../modules/menu";
import { notifyModule } from "../modules/notify";
import { addModules, cleanModule } from "../modules/pack";
import { peopleModule, peopleSettings, valueKey } from "../modules/people";
import { phoneModule, phoneSettings } from "../modules/phone";
import { questsModule } from "../modules/quests";
import { routesModule, routesSettings } from "../modules/routes";
import { schoolModule } from "../modules/school";
import { settingsAppModule } from "../modules/settingsApp";
import { shipModule } from "../modules/ship";
import { timeModule } from "../modules/time";
import { titleModule, titleSettings, TITLE_TAG } from "../modules/title";
import type { EngineModule } from "../modules/types";
import { isStarterVar, type EngineConfig } from "../sheet";
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
  /** A tag its preview shows it with, for an inline part the model places itself. */
  previewTag?: string;
}

// ---------------------------------------------------------------- tailoring from the card

/** The card's world pages of one kind, as their fields. */
export function worldOf(data: CardDataV3, kind: "npc" | "location" | "item" | "shop") {
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
  const cast = worldOf(data, "npc").map((f) => ({ name: f.name.trim(), avatar: portraitFor(data, f.name) }));
  return {
    ...raw,
    title: s.title || data.name,
    premise: s.premise || premiseOf(data.scenario || data.description || ""),
    art: s.art || (art ? fileOf(art) : ""),
    cast: mergeByName(s.cast, cast).slice(0, 6),
  };
}

const CG = /^(cg|event|scene)[ _-]?/i;
const words = (name: string) => name.replace(CG, "").replace(/[_-]+/g, " ").trim();

/** Love interests from the NPC pages, date spots from the places, gifts from the items, event pictures from "cg_…" images. */
export function fillRoutes(raw: Settings, data: CardDataV3): Settings {
  const s = routesSettings(raw);
  const npcs = worldOf(data, "npc");
  const interests = npcs.map((f) => ({ name: f.name.trim(), avatar: portraitFor(data, f.name), about: f.look ?? "", loved: "", liked: "", disliked: "" }));
  const spots = worldOf(data, "location").map((f) => ({ name: f.name.trim(), description: f.mood ?? "" }));
  const gifts = worldOf(data, "item")
    .filter((f) => (f.type ?? "item").toLowerCase() !== "service")
    .map((f) => ({ name: f.name.trim(), price: firstNumber(f.price) }));
  const gallery = images(data)
    .filter((a) => CG.test(a.name) || /cg/i.test(a.type))
    .map((a) => {
      const caption = words(a.name);
      const route = npcs.find((f) => caption.toLowerCase().includes(f.name.trim().toLowerCase()))?.name.trim() ?? "";
      return { file: fileOf(a), caption: caption.charAt(0).toUpperCase() + caption.slice(1), route };
    });
  const byFile = new Set(s.gallery.map((g) => g.file));
  return {
    ...raw,
    interests: mergeByName(s.interests, interests),
    spots: mergeByName(s.spots, spots),
    gifts: mergeByName(s.gifts, gifts),
    gallery: [...s.gallery, ...gallery.filter((g) => !byFile.has(g.file))],
  };
}

/** An item's kind from its world page's category and name. */
function itemKind(f: Record<string, string>): ItemKind {
  const t = `${f.category ?? ""} ${f.name ?? ""}`.toLowerCase();
  if (/weapon|sword|blade|dagger|bow|axe|mace|spear|staff|knife|gun|pistol|rifle/.test(t)) return "weapon";
  if (/armou?r|shield|helm|mail|cloak|boots|gauntlet|clothes/.test(t)) return "armor";
  if (/ring|amulet|necklace|charm|trinket|jewel|accessor|talisman/.test(t)) return "accessory";
  if (/heal|potion|elixir|tonic|food|drink|ration|bread|meal|consum|bandage|medicine|herbal/.test(t)) return "consumable";
  if (/material|ore|ingot|pelt|hide|herb|ingredient|reagent|wood|cloth/.test(t)) return "material";
  if (/key|pass|seal/.test(t)) return "key";
  return "other";
}

/** Items from the world's item pages, and merchants from its shop pages with what they sell. */
export function fillInventory(raw: Settings, data: CardDataV3): Settings {
  const s = inventorySettings(raw);
  const goods = worldOf(data, "item").filter((f) => (f.type ?? "item").toLowerCase() !== "service");
  const items = goods.map((f) => ({ name: f.name.trim(), kind: itemKind(f), slot: "", effect: f.effect ?? "", price: firstNumber(f.price) }));
  const places = new Set(worldOf(data, "location").map((f) => f.name.trim()));
  const merchants = worldOf(data, "shop").map((f) => {
    const shop = f.name.trim().toLowerCase();
    const sells = (f.sells ?? "").toLowerCase();
    const stock = goods.filter((g) => (g.shop ?? "").toLowerCase().includes(shop) || sells.includes(g.name.trim().toLowerCase())).map((g) => g.name.trim());
    return { name: f.name.trim(), where: places.has((f.place ?? "").trim()) ? (f.place ?? "").trim() : "", stock: stock.join(", ") };
  });
  return { ...raw, items: mergeByName(s.items, items), merchants: mergeByName(s.merchants, merchants.filter((m) => m.stock)) };
}

/**
 * The world's places on the map. Two or more replace the part's own example places (an author's own
 * rows with the same names are kept); each new place gets a road to the first, to edit from there.
 */
export function fillMap(raw: Settings, data: CardDataV3): Settings {
  const s = mapSettings(raw);
  const world = worldOf(data, "location");
  if (world.length < 2) return raw;
  const examples = new Set(defaultMapSettings().places.map((p) => p.name));
  const own = s.places.filter((p) => !examples.has(p.name));
  const hub = own[0]?.name ?? world[0].name.trim();
  const added = world.map((f) => {
    const name = f.name.trim();
    return { name, region: "", description: f.mood ? `${f.mood.charAt(0).toUpperCase()}${f.mood.slice(1)}.` : "", danger: 0, links: name === hub ? "" : hub, x: -1, y: -1 };
  });
  const places = mergeByName(own, added);
  return { ...raw, places, start: places.some((p) => p.name === s.start) ? s.start : hub };
}

/**
 * The world's people as the suspects. Two or more replace the part's example suspects (an author's
 * own rows are kept), with their portraits, and the example case goes with them: its truth names
 * people who aren't in this card.
 */
export function fillCase(raw: Settings, data: CardDataV3): Settings {
  const s = caseSettings(raw);
  const world = worldOf(data, "npc");
  if (world.length < 2) return raw;
  const base = defaultCaseSettings();
  const examples = new Set(base.suspects.map((x) => x.name));
  const own = s.suspects.filter((x) => !examples.has(x.name));
  const added = world.map((f) => ({ name: f.name.trim(), description: [f.role, f.look].filter(Boolean).join(". "), avatar: portraitFor(data, f.name) }));
  const out: Settings = { ...raw, suspects: mergeByName(own, added) };
  if (s.truth === base.truth) Object.assign(out, { truth: "", question: s.question === base.question ? "" : s.question, caseName: s.caseName === base.caseName ? "" : s.caseName });
  if (JSON.stringify(s.clues) === JSON.stringify(base.clues)) out.clues = [];
  return out;
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
  {
    id: "life",
    name: "Daily life",
    summary: "Needs that drain with the clock, a job with shifts and pay, bills that come due, skills that grow, and a home to sleep, cook and wash in.",
    tags: ["life", "needs", "money", "job", "screen", "modern"],
    requires: ["time"],
    source: "built-in",
    make: (s) => lifeModule(s),
    tailor: "Set the job, pay and shift days, the rent and bills in the card's currency, the home and its rooms, and how fast each need drains.",
    sample: {
      Time: { Day: 5, Clock: "07:40", _Weekday: "Friday", Weather: "Clear" },
      Needs: { Energy: 34, Hunger: 72, Hygiene: 80, Mood: 58, Stress: 41 },
      Job: { Title: "Barista", Performance: 62, _Shift: "Today 09:00–17:00" },
      Life: { Money: 212, Home: "Studio apartment", _Bills: ["Rent $650: due Day 7"], $Paid: {} },
      Skills: { Cooking: 2, Fitness: 1, Charisma: 3, Work: 2 },
    },
  },
  {
    id: "school",
    name: "School app",
    summary: "The class on now from a timetable, grades and study per subject, exam days, attendance and violations that expire, clubs and council requests.",
    tags: ["school", "time", "screen", "stats"],
    requires: ["time"],
    source: "built-in",
    make: (s) => schoolModule(s),
    tailor: "Name the school, set the subjects, periods and timetable, the exam days, the clubs from the cast, and the handbook's rules.",
    sample: {
      Time: { Day: 3, Clock: "09:55", _Weekday: "Wednesday" },
      School: {
        _Now: "2nd period: English (until 10:40)",
        _Next: "10:50 3rd period: Math",
        Grades: { Math: 58, Literature: 74, History: 66, Science: 61, English: 70, Art: 82, PE: 77 },
        Study: { Math: 2, Literature: 4, History: 1, Science: 0, English: 3, Art: 1, PE: 0 },
        Attendance: 94,
        Violations: ["Late to homeroom — expires Day 9"],
        _Exams: ["Midterms: Day 14 (in 11 days)"],
        Club: "Literature club",
        ClubRank: "New member",
        Announcements: ["Culture festival stall sign-ups open Friday"],
      },
    },
  },
  {
    id: "routes",
    name: "Routes",
    summary: "Love interests with heart meters, stages and route status; date planning, gifts and discovered tastes; a gallery and endings that stay unlocked across chats.",
    tags: ["dating", "relationships", "vn", "romance", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => routesModule(s),
    tailor: "Write each love interest's loved, liked and disliked things, the date spots, the endings per route with hints, and caption the event pictures.",
    fill: fillRoutes,
    generic: (s) => ({ ...s, interests: [], gallery: [], endings: [] }),
    previewSettings: {
      interests: [
        { name: "Mina", avatar: "", about: "Runs the harbor café; laughs with her whole face.", loved: "tea, old maps", liked: "rain", disliked: "perfume" },
        { name: "Kai", avatar: "", about: "Quiet, sharp, always sketching.", loved: "jazz", liked: "", disliked: "crowds" },
      ],
      gallery: [
        { file: "", caption: "Under one umbrella", route: "Mina" },
        { file: "", caption: "Rooftop stars", route: "Kai" },
      ],
      endings: [
        { route: "Mina", name: "The café at dawn", kind: "good", hint: "Earn her trust before the festival" },
        { route: "Mina", name: "Strangers again", kind: "bad", hint: "" },
        { route: "Kai", name: "A sketch of you", kind: "good", hint: "Find out what he draws" },
      ],
    },
    sample: {
      Mina: { Affection: 62, Trust: 40, Route: "Open", Discovered: ["Loves: tea", "Dislikes: perfume"] },
      Kai: { Affection: 28, Trust: 22, Route: "Open", Discovered: [] },
      Routes: { Focus: "Mina", Gifts: { Flowers: 1 }, Money: 140, Unlocked: ["Under one umbrella"] },
    },
  },
  {
    id: "choices",
    name: "Choice menu",
    summary: "At moments that matter the model offers two to four options as buttons, with an optional countdown; a tap sends the choice.",
    tags: ["choices", "inline", "vn", "story"],
    requires: [],
    source: "built-in",
    make: (s) => choicesModule(s),
    tailor: "Pick how often the model offers choices, and set a timer for tense scenes (confessions, chases).",
    previewTag: '<cf-module id="choices"/>',
    sample: { Choices: { Options: ["Tell her the truth", "Change the subject", "Kiss her"] } },
  },
  {
    id: "hero",
    name: "Hero sheet",
    summary: "Level and XP, health, mana and stamina that grow with the level, stat points to spend, skills that unlock, conditions and titles; an isekai status window style.",
    tags: ["rpg", "stats", "fantasy", "isekai", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => heroModule(s),
    tailor: "Name the resources and stats in the setting's words, write the skills each class or path unlocks and when, and set how fast levels come.",
    sample: {
      Player: {
        Name: "Arin",
        Class: "Warrior",
        _Level: 4,
        XP: 180,
        _NextXP: 338,
        _Points: 3,
        Health: 92,
        _MaxHealth: 136,
        Mana: 12,
        _MaxMana: 48,
        Stamina: 41,
        _MaxStamina: 65,
        Strength: 9,
        Agility: 6,
        Intellect: 5,
        Vitality: 8,
        Abilities: ["Power Strike", "Second Wind"],
        Conditions: ["Poisoned until Day 4"],
      },
      Time: { Day: 3 },
    },
  },
  {
    id: "inventory",
    name: "Inventory",
    summary: "A bag of items with a slot limit, gear slots to equip, gold, and merchants to buy from and sell to.",
    tags: ["rpg", "items", "money", "fantasy", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => inventoryModule(s),
    tailor: "Fill the item catalog with the setting's gear and prices, set the currency and starting gold, the gear slots, and who sells what where.",
    fill: fillInventory,
    generic: (s) => ({ ...s, merchants: [] }),
    sample: {
      Inventory: { Items: { Shortsword: 1, "Leather armor": 1, "Health potion": 2, Rations: 3, "Wolf pelt": 2 }, Gold: 64 },
      Equipped: { Weapon: "Shortsword", Armor: "Leather armor", Accessory: "" },
    },
  },
  {
    id: "quests",
    name: "Quest log",
    summary: "Quests with their objectives, a board of offers to accept, a log of what's done and failed, and a guild rank from renown.",
    tags: ["rpg", "quests", "fantasy", "isekai", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => questsModule(s),
    tailor: "Write the opening quest and the first offers from the card's conflicts and NPCs, name the board, and set or remove the ranks.",
    generic: (s) => ({ ...s, start: [], offers: [] }),
    sample: {
      Quests: {
        Active: ["Wolves at the mill — Find the den in the hills", "A new arrival — Register at the adventurers' guild"],
        Board: ["The missing courier — Find the courier who never arrived (reward: 80 gold)"],
        Done: ["Herbs for the healer"],
        Failed: [],
        Tracked: "Wolves at the mill",
        Renown: 70,
        _Rank: "E",
      },
    },
  },
  {
    id: "map",
    name: "World map",
    summary: "Places joined by roads on a map to tap: where you are, what the fog still hides, and travel with its hours and danger.",
    tags: ["map", "travel", "fantasy", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => mapModule(s),
    tailor: "Lay out the places (across and down, 0 to 100), join them with roads, set each one's danger and region, and pick the start.",
    fill: fillMap,
    generic: (s) => ({ ...s, art: "" }),
    sample: { Map: { Location: "Oakvale", Discovered: ["Oakvale", "Old Mill", "Whispering Woods", "King's Road", "Ruined Keep"], _Nearby: ["Old Mill (3h)", "Whispering Woods (3h)", "King's Road (3h)"] } },
  },
  {
    id: "combat",
    name: "Combat HUD",
    summary: "In a fight, a block under the reply with the foes' health, your bars, the last blows, and attack, skill, item, defend and flee buttons.",
    tags: ["rpg", "combat", "inline", "fantasy"],
    requires: [],
    source: "built-in",
    make: (s) => combatModule(s),
    tailor: "Pick how hard fights are, and whether fleeing and defending are allowed. Install the hero sheet and inventory for skills and items.",
    previewTag: '<cf-module id="combat"/>',
    sample: {
      Combat: { Active: true, Enemies: { "Wolf 1": 14, "Wolf 2": 30 }, $Max: { "Wolf 1": 30, "Wolf 2": 30 }, _Round: 2, Log: ["You slash Wolf 1: −16", "Wolf 2 bites you: −8"] },
      Player: { Health: 84, _MaxHealth: 136, Stamina: 31, _MaxStamina: 65, Abilities: ["Power Strike"] },
    },
  },
  {
    id: "ship",
    name: "Ship",
    summary: "Hull, shields and fuel; reactor power the player routes between systems; damaged systems to repair; the crew; a cargo hold; the alert level. Jumps on the map burn fuel.",
    tags: ["ship", "scifi", "space", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => shipModule(s),
    tailor: "Name the ship and its class, set the hull, shields and tanks, write the systems and what power does for each, and sign on the crew.",
    generic: (s) => ({ ...s, crew: [] }),
    sample: {
      Ship: {
        Hull: 72,
        _MaxHull: 100,
        Shields: 25,
        _MaxShields: 60,
        Fuel: 9,
        _MaxFuel: 20,
        _Power: { Engines: 3, Shields: 2, Weapons: 2, Sensors: 1, "Life support": 0 },
        Damaged: ["Sensors"],
        Alert: "Yellow",
        Crew: ["Juno Reyes — Pilot", "Okafor — Engineer", "Doc Lin — Medic"],
        Cargo: { "Ration packs": 4, "Spare parts": 2, "Unmarked crates": 6 },
      },
    },
  },
  {
    id: "case",
    name: "Case file",
    summary: "The question, the clues and where they turned up, the suspects, an evidence board with red string, questioning and accusing; a dread meter that unsettles the screen.",
    tags: ["mystery", "horror", "clues", "screen"],
    requires: [],
    source: "built-in",
    make: (s) => caseModule(s),
    tailor: "Write the question and the truth behind it (only the model sees it), list the suspects, give the opening clue, and name or drop the dread meter.",
    fill: fillCase,
    generic: (s) => ({ ...s, suspects: [], clues: [], truth: "", question: "", caseName: "" }),
    sample: {
      Case: {
        Clues: ["Mara's last letter — Your desk", "Fresh scratches on the nursery door — Upstairs hall", "A tray with two cups — The kitchen"],
        Suspects: ["Elias Vell — Mara's brother", "Mrs. Harrow — The caretaker", "Father Doyle — The parish priest"],
        _Links: ["A tray with two cups → Elias Vell", "Fresh scratches on the nursery door → Mrs. Harrow"],
        _Theory: "",
        Solved: false,
        Dread: 38,
      },
    },
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
      const have = modules[at];
      // A built-in part the author never changed takes the settings asked for (a kit's start time).
      const take = settings[id] && have.core && untouched(have, part) ? cleanModule({ ...part.make({ ...stripLive(have.settings), ...settings[id] }), enabled: true }) : null;
      if (take) modules = modules.map((m, i) => (i === at ? take : m));
      else if (!have.enabled) modules = modules.map((m, i) => (i === at ? { ...m, enabled: true } : m));
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
  // The engine's starter value gives way to a part that keeps the same one (the hero's health).
  const kept = new Set(added.flatMap((m) => m.vars.map(valueKey)));
  const vars = config.vars.filter((v) => !(isStarterVar(v) && kept.has(valueKey(v))));
  return { config: { ...config, vars, modules }, added, messageTags, notes };
}

function stripLive(settings: Settings): Settings {
  const s = { ...settings };
  delete s.live;
  return s;
}

/** Whether a module still has its part's default settings. */
function untouched(m: EngineModule, part: Part): boolean {
  const norm = (s: Settings) => JSON.stringify(stripLive(part.make(stripLive(s)).settings));
  return norm(m.settings) === norm(part.make().settings);
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

const opt = (name: string, description: string) => ({ name, description });

export const BUILT_IN_KITS: Kit[] = [
  {
    id: "shared-starter",
    name: "Starter game",
    description: "The shared parts every kit starts from: time, settings, title screen, character creator, menu, people, events, journal and notifications.",
    parts: ["time", "settings", "title", "creator", "menu", "people", "events", "journal", "notify"].map((id) => ({ id })),
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-modern-life",
    name: "Modern life sim",
    description: "A phone at the centre of a modern life: texts, social, bank and maps; needs, a job, rent and bills; a lock-screen title.",
    theme: { preset: "phone", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "07:30", startSeason: "Spring", weathers: ["Clear", "Cloudy", "Rain", "Storm", "Fog"] } },
      { id: "settings" },
      { id: "title", settings: { style: "lock", newGame: "Start my life" } },
      {
        id: "creator",
        settings: {
          title: "Who are you?",
          intro: "A new chapter in the city. Who's living it?",
          lookIdeas: ["Oversized hoodie, tired eyes, good sneakers", "Sharp blazer, neat bun, always on time", "Paint on the jeans, rings on every finger"],
          choices: [
            { name: "Background", options: [opt("Moved for work", "New city, new job, nobody you know yet."), opt("Fresh start", "You left something behind. You don't talk about it."), opt("Local", "You grew up here. Everyone knows your mother.")] },
            { name: "Occupation", options: [opt("Working", "A job that pays the rent, mostly."), opt("Student", "Classes by day, a part-time shift by night.")] },
            { name: "Apartment", options: [opt("Shared flat", "Cheap, loud, a fridge with names on everything."), opt("Studio", "Small, yours, a window over the street."), opt("Nice one-bedroom", "More than you can afford. For now.")] },
          ],
          stats: [
            { name: "Cooking", base: 1, max: 10 },
            { name: "Fitness", base: 1, max: 10 },
            { name: "Charisma", base: 1, max: 10 },
            { name: "Work", base: 1, max: 10 },
          ],
          points: 5,
          items: [],
          pickItems: 0,
          routes: [{ label: "Begin", description: "", message: "I'm {name}. My alarm goes off and a new day starts." }],
        },
      },
      { id: "phone", settings: { startMoney: 800, apps: ["messages", "contacts", "social", "news", "wallet", "map", "calendar", "shop", "system", "quests", "photos", "settings"], system: { name: "Jobs", description: "Job offers and side gigs in town. Applying reaches the story: the employer answers, an interview follows." } } },
      { id: "life", settings: { skillsGroup: "Player" } },
      { id: "people" },
      {
        id: "events",
        settings: {
          scheduled: [
            { name: "Payday", when: "Fri", from: "", to: "", where: "", text: "Wages land today; the bars fill up after work." },
            { name: "Farmers' market", when: "Sat", from: "08:00", to: "13:00", where: "", text: "Stalls along the square; fresh bread and neighbours who talk." },
          ],
          random: [
            { name: "A call from home", chance: 10, where: "", part: "Evening", text: "Family calls: news, guilt, or a favour." },
            { name: "Street performer", chance: 15, where: "", part: "Afternoon", text: "Music on the corner draws a small crowd." },
          ],
        },
      },
      { id: "journal", settings: { title: "Diary", button: "📔 Diary" } },
      { id: "menu", settings: { title: "Home screen", only: true } },
      { id: "notify", settings: { watch: [{ path: "Phone.Texts", title: "Messages", icon: "chat" }, { path: "Phone.Feed", title: "Social", icon: "heart" }, { path: "Phone.News", title: "News", icon: "news" }] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-school",
    name: "School / academy",
    description: "Timetable and periods, grades and exams, clubs, a record that expires, festivals on the calendar; a phone for the class chat; a school-gate title.",
    theme: { preset: "academy", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "07:40", startSeason: "Spring", weathers: ["Clear", "Cloudy", "Rain", "Storm"] } },
      { id: "settings" },
      { id: "title", settings: { style: "gate", tagline: "The spring term begins", newGame: "Through the gate" } },
      {
        id: "creator",
        settings: {
          title: "Student file",
          intro: "Fill in your student file before the first bell.",
          lookIdeas: ["Uniform worn loose, tie undone, headphones always on", "Perfectly pressed uniform, glasses, a planner in hand", "Sleeves rolled up, sports tape on the fingers, sunburnt nose"],
          choices: [
            { name: "Year", options: [opt("First year", "Everything is new; nobody knows your name."), opt("Second year", "You know the halls and the rumours."), opt("Third year", "Exams, futures, and one last festival.")] },
            { name: "Arrival", options: [opt("Transfer student", "You arrive mid-term. Everyone stares."), opt("Returning", "Same school, same faces, new year.")] },
            { name: "Living", options: [opt("Dorm", "A roommate, a curfew, a hallway that never sleeps."), opt("Commute", "The morning train and the walk past the shrine.")] },
          ],
          stats: [
            { name: "Academics", base: 1, max: 5 },
            { name: "Sports", base: 1, max: 5 },
            { name: "Arts", base: 1, max: 5 },
            { name: "Social", base: 1, max: 5 },
          ],
          points: 5,
          items: [],
          pickItems: 0,
          routes: [{ label: "First day", description: "", message: "I'm {name}. The bell rings as I reach the gate." }],
        },
      },
      { id: "school" },
      { id: "phone", settings: { apps: ["messages", "contacts", "social", "calendar", "map", "wallet", "system", "photos", "settings"], startMoney: 60, system: { name: "Forum", description: "The anonymous school forum: gossip, the confessions board, rankings. Posts here reach the story and spread." } } },
      { id: "people", settings: { stages: [{ name: "Classmate", from: 0 }, { name: "Friend", from: 25 }, { name: "Close friend", from: 50 }, { name: "Crush", from: 70 }, { name: "Sweetheart", from: 90 }] } },
      {
        id: "events",
        settings: {
          scheduled: [
            { name: "Morning assembly", when: "Mon", from: "08:30", to: "08:45", where: "", text: "The principal's speech; whispers in the back rows." },
            { name: "Sports day", when: "Day 10", from: "09:00", to: "16:00", where: "", text: "Relays, tug of war and class rivalries on the field." },
            { name: "Culture festival", when: "Day 24", from: "10:00", to: "20:00", where: "", text: "Every class runs a stall; the night ends with a bonfire." },
            { name: "School trip", when: "Day 35", from: "", to: "", where: "", text: "Two nights away: shared rooms, late talks, one big secret." },
          ],
          random: [
            { name: "Pop quiz", chance: 12, where: "", part: "Morning", text: "A surprise quiz; the unprepared panic." },
            { name: "Rumour", chance: 15, where: "", part: "Afternoon", text: "A rumour spreads through the class chat." },
          ],
        },
      },
      { id: "journal", settings: { title: "Diary", button: "📔 Diary" } },
      { id: "menu", settings: { title: "Menu", only: true } },
      { id: "notify", settings: { watch: [{ path: "Phone.Texts", title: "Messages", icon: "chat" }, { path: "School.Announcements", title: "Announcement", icon: "news" }] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-dating",
    name: "Dating sim / VN",
    description: "Routes with hearts and stages, dates and gifts, choices at key moments, a gallery and endings kept across playthroughs; a visual-novel title with the cast.",
    theme: { preset: "dating", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Friday", startClock: "16:00", startSeason: "Spring" } },
      { id: "settings" },
      { id: "title", settings: { style: "cast", newGame: "Start" } },
      {
        id: "creator",
        settings: {
          title: "About you",
          intro: "Before the story starts: who are you, and how did you get here?",
          lookIdeas: ["Messy hair, warm smile, always a little late", "Tall, neat, a quiet sort of handsome", "Bright eyes, freckles, talks with her hands"],
          choices: [
            { name: "Situation", options: [opt("New in town", "A new place where nobody knows your past."), opt("Childhood friend returns", "Someone you grew up with is back, and changed."), opt("New job", "First week, new colleagues, everyone curious.")] },
          ],
          stats: [
            { name: "Charm", base: 1, max: 5 },
            { name: "Confidence", base: 1, max: 5 },
            { name: "Wit", base: 1, max: 5 },
            { name: "Style", base: 1, max: 5 },
          ],
          points: 6,
          items: [],
          pickItems: 0,
          routes: [{ label: "Begin", description: "", message: "I'm {name}. It's a Friday afternoon, and something is about to start." }],
        },
      },
      { id: "routes" },
      { id: "choices" },
      { id: "phone", settings: { apps: ["messages", "contacts", "calendar", "photos", "settings"], lock: false } },
      {
        id: "events",
        settings: {
          scheduled: [
            { name: "Summer festival", when: "Day 7", from: "18:00", to: "23:00", where: "", text: "Lanterns, yukata, fireworks at nine: the night for a confession." },
            { name: "Confession day", when: "Day 14", from: "", to: "", where: "", text: "Chocolates change hands; everyone is watching who gets one." },
          ],
          random: [{ name: "Chance meeting", chance: 20, where: "", part: "Afternoon", text: "One of the love interests happens to be here." }],
        },
      },
      { id: "journal", settings: { title: "Memories", button: "💌 Memories" } },
      { id: "menu", settings: { title: "Menu", only: true } },
      { id: "notify", settings: { watch: [{ path: "Phone.Texts", title: "Messages", icon: "chat" }] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-fantasy",
    name: "Fantasy RPG",
    description: "Levels, stats and skills; a bag with gear, gold and merchants; quests from the guild board; a map to travel; turn-based fights under the reply.",
    theme: { preset: "parchment", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "08:00", startSeason: "Spring", weathers: ["Clear", "Cloudy", "Rain", "Fog", "Storm"] } },
      { id: "settings" },
      { id: "title", settings: { style: "classic", tagline: "An adventure begins", newGame: "Begin the adventure" } },
      {
        id: "creator",
        settings: {
          title: "Your hero",
          intro: "Every legend starts somewhere. Who sets out today?",
          lookIdeas: ["Scarred knuckles, a patched cloak, eyes that never stop counting exits", "Silver braid, ink on the fingers, a staff taller than you", "Broad and bearded, a laugh like a rockslide"],
          choices: [
            { name: "Race", options: [opt("Human", "Stubborn and everywhere; no door is closed to you for long."), opt("Elf", "Long memory, sharp eyes, old grudges."), opt("Dwarf", "Stone-steady and hard to kill."), opt("Halfling", "Small, quick, lucky, underestimated.")] },
            { name: "Class", options: [opt("Warrior", "Steel and stubbornness. You stand in front."), opt("Mage", "Spells that cost you; power that frightens others."), opt("Rogue", "Locks, shadows and a knife you never show."), opt("Cleric", "A god's favour, if you keep its rules.")] },
          ],
          stats: [
            { name: "Strength", base: 5, max: 99 },
            { name: "Agility", base: 5, max: 99 },
            { name: "Intellect", base: 5, max: 99 },
            { name: "Vitality", base: 5, max: 99 },
          ],
          points: 6,
          items: [],
          pickItems: 0,
          routes: [{ label: "Set out", description: "", message: "I'm {name}. I step out of the inn with everything I own on my back." }],
        },
      },
      { id: "hero" },
      { id: "inventory" },
      { id: "quests" },
      { id: "map" },
      { id: "combat" },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Acquaintance", from: 20 }, { name: "Ally", from: 45 }, { name: "Companion", from: 70 }, { name: "Sworn", from: 90 }] } },
      {
        id: "events",
        settings: {
          scheduled: [
            { name: "Market day", when: "Sat", from: "08:00", to: "14:00", where: "", text: "Stalls fill the square; prices are good and gossip is better." },
            { name: "Harvest festival", when: "Day 12", from: "16:00", to: "23:00", where: "", text: "Bonfires, dancing and a strength contest; the whole valley comes." },
          ],
          random: [
            { name: "Bandit ambush", chance: 10, where: "", part: "Evening", text: "Bandits block the road and want a toll in coin or blood." },
            { name: "Travelling bard", chance: 15, where: "", part: "Evening", text: "A bard in the tavern sings of a treasure nobody has found." },
          ],
        },
      },
      { id: "journal", settings: { title: "Adventure log", button: "📖 Log" } },
      { id: "menu", settings: { title: "Satchel", button: "🧭 Menu", only: true } },
      { id: "notify", settings: { watch: [] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-dark-fantasy",
    name: "Dark fantasy / survival",
    description: "Hunger, thirst, cold and sanity that drain with the clock; a camp to rest at; scarce gear; contracts on the notice board; deadly roads and brutal fights.",
    theme: { preset: "grimdark", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "17:30", startSeason: "Autumn", weathers: ["Overcast", "Rain", "Fog", "Sleet", "Storm"] } },
      { id: "settings" },
      { id: "title", settings: { style: "embers", tagline: "The fires are going out", newGame: "Endure" } },
      {
        id: "creator",
        settings: {
          title: "Who survived?",
          intro: "The world is ending slowly. You are still here. Why?",
          lookIdeas: ["Hollow cheeks, a soldier's posture, a cough that won't leave", "Shaved head, burn scars, prayer beads wound tight", "Mud to the knees, a hunter's hood, nothing wasted"],
          choices: [
            { name: "Origin", options: [opt("Deserter", "You ran from a war that was already lost. Some still hunt you."), opt("Plague survivor", "Your village burned with the sick inside. You walked out."), opt("Heretic", "The Church wants you on a pyre. You know why.")] },
            { name: "Burden", options: [opt("Haunted", "You hear the dead at night. Some nights they are right."), opt("Oathbound", "You swore something. It keeps you alive and costs you."), opt("Wanted", "There is a price on your head and a face on the posters.")] },
          ],
          stats: [
            { name: "Might", base: 4, max: 99 },
            { name: "Cunning", base: 4, max: 99 },
            { name: "Grit", base: 4, max: 99 },
            { name: "Faith", base: 4, max: 99 },
          ],
          points: 5,
          items: [],
          pickItems: 0,
          routes: [{ label: "Endure", description: "", message: "I'm {name}. The light is going, and I need a fire before dark." }],
        },
      },
      {
        id: "hero",
        settings: {
          title: "Survivor",
          button: "🩸 Survivor",
          resources: [
            { name: "Health", base: 60, perLevel: 8, regen: 1 },
            { name: "Stamina", base: 40, perLevel: 4, regen: 8 },
          ],
          stats: [
            { name: "Might", start: 4 },
            { name: "Cunning", start: 4 },
            { name: "Grit", start: 4 },
            { name: "Faith", start: 4 },
          ],
          xpBase: 120,
          xpGrowth: 1.6,
          maxLevel: 20,
          pointsPerLevel: 2,
          abilities: [
            { name: "Desperate Strike", level: 1, cost: 8, resource: "Stamina", description: "All your weight behind one blow. Leaves you open." },
            { name: "Bind Wounds", level: 2, cost: 10, resource: "Stamina", description: "Stop the bleeding with what you have. It will scar." },
            { name: "Riposte", level: 4, cost: 12, resource: "Stamina", description: "Turn their attack back on them." },
            { name: "Last Stand", level: 7, cost: 25, resource: "Stamina", description: "When death is close, you hit hardest." },
          ],
        },
      },
      {
        id: "life",
        settings: {
          title: "Survival",
          button: "🔥 Camp",
          needs: [
            { name: "Hunger", start: 30, perHour: 3, worse: "high", warn: 70, hint: "a real meal lowers it a lot, scraps a little" },
            { name: "Thirst", start: 25, perHour: 5, worse: "high", warn: 65, hint: "clean water lowers it; foul water lowers it and risks sickness" },
            { name: "Warmth", start: 60, perHour: 2, worse: "low", warn: 30, hint: "a fire, shelter and dry clothes raise it; rain, sleet and night lower it" },
            { name: "Rest", start: 70, perHour: 3, worse: "low", warn: 25, hint: "sleep restores it; marching and fighting drain it" },
            { name: "Sanity", start: 75, perHour: 0, worse: "low", warn: 30, hint: "horror, the dead and isolation lower it; prayer, company and a fire raise it" },
          ],
          job: { title: "", employer: "", salary: 0, days: "", from: "", to: "" },
          bills: [],
          skills: [],
          home: "Camp",
          rooms: [
            { name: "Campfire", action: "cook" },
            { name: "Bedroll", action: "sleep" },
            { name: "Stream", action: "drink and fill the waterskin" },
            { name: "Watch", action: "keep watch through the dark" },
          ],
          wakeAt: "06:00",
          currency: "⚜ ",
        },
      },
      {
        id: "inventory",
        settings: {
          title: "Pack",
          button: "🎒 Pack",
          currency: "crowns",
          startGold: 8,
          capacity: 10,
          slots: ["Weapon", "Armor", "Trinket"],
          items: [
            { name: "Rusty blade", kind: "weapon", slot: "", effect: "+2 attack, may snap", price: 10 },
            { name: "Hatchet", kind: "weapon", slot: "", effect: "+3 attack, chops wood", price: 14 },
            { name: "Padded jack", kind: "armor", slot: "", effect: "+2 defence", price: 12 },
            { name: "Holy symbol", kind: "accessory", slot: "Trinket", effect: "Steadies the mind: Sanity loss halved", price: 30 },
            { name: "Bandage", kind: "consumable", slot: "", effect: "Stops bleeding, heals 15", price: 3 },
            { name: "Stale bread", kind: "consumable", slot: "", effect: "Hunger −30", price: 2 },
            { name: "Waterskin", kind: "consumable", slot: "", effect: "Thirst −40; refill at a stream", price: 4 },
            { name: "Torch", kind: "consumable", slot: "", effect: "Light for an hour; keeps some things away", price: 1 },
            { name: "Tallow candle", kind: "consumable", slot: "", effect: "A little light and a little hope", price: 1 },
            { name: "Wolf pelt", kind: "material", slot: "", effect: "Warmth if worn; sells to tanners", price: 6 },
          ],
          start: [
            { name: "Rusty blade", count: 1 },
            { name: "Padded jack", count: 1 },
            { name: "Bandage", count: 2 },
            { name: "Stale bread", count: 2 },
            { name: "Waterskin", count: 1 },
            { name: "Torch", count: 2 },
          ],
          merchants: [{ name: "Peddler", where: "", stock: "Bandage, Stale bread, Waterskin, Torch, Tallow candle, Holy symbol" }],
          sellRate: 40,
        },
      },
      {
        id: "quests",
        settings: {
          title: "Contracts",
          button: "📜 Contracts",
          board: "Notice board",
          start: [{ name: "Shelter", objective: "Find somewhere safe to spend the night", reward: "Another day", giver: "" }],
          offers: [
            { name: "The beast of Blackwood", objective: "Kill the thing taking sheep from the pens", reward: "30 crowns", giver: "The reeve" },
            { name: "Burn the dead", objective: "Burn the plague bodies in the chapel cellar", reward: "12 crowns", giver: "Father Osk" },
            { name: "A debt", objective: "Collect what the miller owes, by any means", reward: "A third of it", giver: "Hennick the moneylender" },
          ],
          ranks: [],
        },
      },
      {
        id: "map",
        settings: {
          title: "The Reach",
          button: "🗺️ Map",
          places: [
            { name: "Ashford", region: "The Reach", description: "A walled hamlet that still opens its gate by day. Barely.", danger: 1, links: "Chapel of Saint Varn, Gallows Hill, The Mire", x: 46, y: 58 },
            { name: "Chapel of Saint Varn", region: "The Reach", description: "Cracked bells, a priest who doesn't sleep, a cellar no one opens.", danger: 1, links: "Ashford, Ruined abbey", x: 74, y: 40 },
            { name: "Gallows Hill", region: "The Reach", description: "Crows, ropes and a view of everything coming.", danger: 2, links: "Ashford, Blackwood", x: 22, y: 34 },
            { name: "The Mire", region: "The Lowlands", description: "Black water and lights that move when you look away.", danger: 3, links: "Ashford", x: 40, y: 90 },
            { name: "Blackwood", region: "The Wilds", description: "Trees too close together. Something walks on two legs and four.", danger: 3, links: "Gallows Hill", x: 12, y: 8 },
            { name: "Ruined abbey", region: "The Wilds", description: "The monks left in a hurry. Their books did not.", danger: 3, links: "Chapel of Saint Varn", x: 88, y: 10 },
          ],
          start: "Ashford",
          hours: 4,
          fog: true,
        },
      },
      { id: "combat", settings: { difficulty: "brutal" } },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Wary", from: 20 }, { name: "Trusted", from: 50 }, { name: "Bound", from: 80 }] } },
      {
        id: "events",
        settings: {
          scheduled: [{ name: "Blood moon", when: "Day 7", from: "20:00", to: "", where: "", text: "The moon rises red. Doors are barred; what hunts tonight is bold." }],
          random: [
            { name: "Plague cart", chance: 12, where: "", part: "Morning", text: "A cart of the dead rattles past; someone on it is still moving." },
            { name: "Howling", chance: 18, where: "", part: "Night", text: "Howling in the dark, closer than yesterday." },
            { name: "Pilgrims", chance: 10, where: "", part: "Afternoon", text: "Flagellants on the road, singing, looking for sinners." },
          ],
        },
      },
      { id: "journal", settings: { title: "Chronicle", button: "🕯️ Chronicle" } },
      { id: "menu", settings: { title: "Pack", button: "☰ Menu", only: true } },
      { id: "notify", settings: { watch: [] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-isekai",
    name: "Isekai / system",
    description: "A System only you can see: a glowing status window with levels, skills and titles, an item box, guild quests and ranks, a world map, and fights with skill buttons.",
    theme: { preset: "system", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "10:00", startSeason: "Spring", weathers: ["Clear", "Cloudy", "Rain", "Wind"] } },
      { id: "settings" },
      { id: "title", settings: { style: "system", tagline: "Another world is waiting", newGame: "Accept" } },
      {
        id: "creator",
        settings: {
          title: "Reincarnation",
          intro: "You died. A calm voice asks who you were, and what you'll take with you.",
          lookIdeas: ["Your old face, younger: messy hair, tired eyes that are suddenly bright", "A new body: silver hair, one gold eye, nobody's face you know", "Broad, tanned, a farmer's son's hands and a stranger's memories"],
          choices: [
            { name: "Past life", options: [opt("Office worker", "Overtime, convenience-store dinners, a truck you didn't see."), opt("Student", "Exams, games, a crosswalk on the way home."), opt("Nurse", "Night shifts. You know how bodies break and mend."), opt("Gamer", "You know how these worlds work. Mostly.")] },
            { name: "Gift", options: [opt("Appraisal+", "You see what anything is, and what anyone hides."), opt("Endless Item Box", "A pocket of space with no bottom."), opt("Growth x2", "You level twice as fast as anyone here."), opt("Tongue of All", "Every language, beasts included.")] },
          ],
          stats: [
            { name: "Strength", base: 5, max: 999 },
            { name: "Agility", base: 5, max: 999 },
            { name: "Intellect", base: 5, max: 999 },
            { name: "Vitality", base: 5, max: 999 },
            { name: "Luck", base: 5, max: 999 },
          ],
          points: 10,
          items: [],
          pickItems: 0,
          routes: [{ label: "Wake up", description: "", message: "I'm {name}. I open my eyes in a meadow under two suns, and a blue window floats in front of me." }],
        },
      },
      {
        id: "hero",
        settings: {
          style: "system",
          title: "Status",
          button: "🟦 System",
          titles: true,
          resources: [
            { name: "Health", base: 100, perLevel: 15, regen: 5 },
            { name: "Mana", base: 50, perLevel: 10, regen: 5 },
            { name: "Stamina", base: 60, perLevel: 6, regen: 10 },
          ],
          stats: [
            { name: "Strength", start: 5 },
            { name: "Agility", start: 5 },
            { name: "Intellect", start: 5 },
            { name: "Vitality", start: 5 },
            { name: "Luck", start: 5 },
          ],
          xpBase: 80,
          xpGrowth: 1.4,
          maxLevel: 99,
          pointsPerLevel: 5,
          abilities: [
            { name: "Appraisal", level: 1, cost: 0, resource: "", description: "See an item's or creature's name, level and nature." },
            { name: "Item Box", level: 1, cost: 0, resource: "", description: "Store things in a pocket of space." },
            { name: "Fireball", level: 3, cost: 15, resource: "Mana", description: "The classic. Hot." },
            { name: "Haste", level: 6, cost: 20, resource: "Mana", description: "Everything slows down except you." },
            { name: "Mana Burst", level: 10, cost: 40, resource: "Mana", description: "Raw mana, released all at once." },
          ],
        },
      },
      {
        id: "inventory",
        settings: {
          title: "Item Box",
          button: "📦 Item Box",
          currency: "G",
          startGold: 100,
          capacity: 0,
          start: [
            { name: "Shortsword", count: 1 },
            { name: "Leather armor", count: 1 },
            { name: "Health potion", count: 3 },
            { name: "Rations", count: 2 },
          ],
        },
      },
      {
        id: "quests",
        settings: {
          board: "Adventurers' guild",
          start: [{ name: "Welcome to another world", objective: "Reach the town and register at the adventurers' guild", reward: "A guild card, 50 XP", giver: "System" }],
          offers: [
            { name: "Slime extermination", objective: "Clear five slimes from the plains", reward: "30 G", giver: "Guild" },
            { name: "Medicinal herbs", objective: "Bring back ten moonleaf from the forest edge", reward: "25 G", giver: "Apothecary" },
            { name: "Escort the merchant", objective: "Guard a merchant's wagon to the capital", reward: "120 G", giver: "Merchant guild" },
          ],
        },
      },
      {
        id: "map",
        settings: {
          places: [
            { name: "Starting Meadow", region: "Lumia Plains", description: "Where you woke up. The grass hums with mana.", danger: 0, links: "Lumia", x: 14, y: 76 },
            { name: "Lumia", region: "Lumia Plains", description: "A starter town with a guild hall, a fountain and suspiciously cheap potions.", danger: 0, links: "Starting Meadow, Slime Plains, Goblin Forest, Royal Road", x: 38, y: 60 },
            { name: "Slime Plains", region: "Lumia Plains", description: "Bouncing slimes as far as the eye can see. Easy XP.", danger: 1, links: "Lumia", x: 30, y: 90 },
            { name: "Goblin Forest", region: "Greenwood", description: "Goblins with traps and a chieftain who isn't stupid.", danger: 2, links: "Lumia, Demon Lord's Border", x: 26, y: 24 },
            { name: "Royal Road", region: "The Kingdom", description: "A paved road, patrolled, mostly.", danger: 1, links: "Lumia, Royal Capital", x: 64, y: 54 },
            { name: "Royal Capital", region: "The Kingdom", description: "Castle, academy, nobles who want heroes on a leash.", danger: 0, links: "Royal Road", x: 88, y: 34 },
            { name: "Demon Lord's Border", region: "The Dark Lands", description: "The sky turns purple. Monsters here have names.", danger: 3, links: "Goblin Forest", x: 54, y: 6 },
          ],
          start: "Starting Meadow",
          hours: 2,
        },
      },
      { id: "combat", settings: { difficulty: "fair" } },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Acquaintance", from: 20 }, { name: "Party member", from: 45 }, { name: "Trusted", from: 70 }, { name: "Devoted", from: 90 }] } },
      {
        id: "events",
        settings: {
          scheduled: [{ name: "Guild ranking day", when: "Day 10", from: "10:00", to: "16:00", where: "", text: "The guild posts the rankings; top parties get noble attention." }],
          random: [
            { name: "Hidden quest", chance: 10, where: "", part: "Afternoon", text: "[System: Hidden quest discovered.] Something nearby is more than it seems." },
            { name: "Monster stampede", chance: 6, where: "", part: "Morning", text: "Monsters flee something worse toward the town." },
          ],
        },
      },
      { id: "journal", settings: { title: "Adventure log", button: "📖 Log" } },
      { id: "menu", settings: { title: "Menu", button: "☰ Menu", only: true } },
      { id: "notify", settings: { watch: [] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-cyberpunk",
    name: "Cyberpunk",
    description: "Chrome and neon: a neural HUD with health, RAM and quickhacks, cyberware slots and a ripperdoc, gigs from a fixer with street cred, a sprawl to move through, a phone full of messages, and fights.",
    theme: { preset: "cyberpunk", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Friday", startClock: "22:00", startSeason: "Autumn", weathers: ["Acid rain", "Smog", "Neon haze", "Clear", "Storm"] } },
      { id: "settings" },
      { id: "title", settings: { style: "glitch", tagline: "The city never sleeps. Neither do you", newGame: "Jack in" } },
      {
        id: "creator",
        settings: {
          title: "Who are you on the street?",
          intro: "Everyone in this city is selling something. What are you selling, and who did you used to be?",
          lookIdeas: ["Shaved sides, chrome jaw, a jacket with somebody else's blood on it", "Corpo-sharp suit gone shabby, one optic implant glowing amber", "Braids threaded with fibre-optics, fingerless gloves, a deck on your back"],
          choices: [
            { name: "Lifepath", options: [opt("Street kid", "You grew up in the Stacks. You know every alley and owe half of them."), opt("Ex-corpo", "You had a badge, a salary and a conscience. You kept one."), opt("Nomad", "Family, the open road and a car you'd die for. The city is new.")] },
            { name: "Role", options: [opt("Netrunner", "You ride the Net. Doors open when you think at them."), opt("Solo", "A gun for hire, chromed for the job."), opt("Fixer", "You know who wants what, and what it costs."), opt("Techie", "If it's broken, you fix it. If it works, you improve it.")] },
          ],
          stats: [
            { name: "Body", base: 4, max: 20 },
            { name: "Reflexes", base: 4, max: 20 },
            { name: "Tech", base: 4, max: 20 },
            { name: "Cool", base: 4, max: 20 },
          ],
          points: 6,
          items: [],
          pickItems: 0,
          routes: [{ label: "Jack in", description: "", message: "I'm {name}. Rain on neon, a message from my fixer blinking on my phone, and a debt I can't pay." }],
        },
      },
      {
        id: "hero",
        settings: {
          title: "Neural HUD",
          button: "🧠 HUD",
          resources: [
            { name: "Health", base: 80, perLevel: 8, regen: 3 },
            { name: "RAM", base: 6, perLevel: 1, regen: 6 },
          ],
          stats: [
            { name: "Body", start: 4 },
            { name: "Reflexes", start: 4 },
            { name: "Tech", start: 4 },
            { name: "Cool", start: 4 },
          ],
          xpBase: 100,
          xpGrowth: 1.5,
          maxLevel: 30,
          pointsPerLevel: 2,
          abilities: [
            { name: "Ping", level: 1, cost: 1, resource: "RAM", description: "Light up every device and camera around you." },
            { name: "Zap", level: 1, cost: 3, resource: "RAM", description: "A jolt through the target's cyberware." },
            { name: "Breach", level: 3, cost: 4, resource: "RAM", description: "Open a door, a camera or a turret to your will." },
            { name: "Overheat", level: 5, cost: 5, resource: "RAM", description: "Cook their chrome from the inside." },
            { name: "Flatline", level: 9, cost: 8, resource: "RAM", description: "Their brain goes quiet. Permanently." },
          ],
        },
      },
      {
        id: "inventory",
        settings: {
          title: "Gear",
          button: "🎒 Gear",
          currency: "€$",
          startGold: 300,
          capacity: 16,
          slots: ["Weapon", "Armor", "Cyberdeck", "Optics", "Arms"],
          items: [
            { name: "Street pistol", kind: "weapon", slot: "", effect: "+3 damage, loud", price: 120 },
            { name: "Smart SMG", kind: "weapon", slot: "", effect: "+4 damage, bullets that bend", price: 600 },
            { name: "Armored jacket", kind: "armor", slot: "", effect: "+3 armor, still looks good", price: 250 },
            { name: "Cheap cyberdeck", kind: "accessory", slot: "Cyberdeck", effect: "Quickhacks cost 1 less RAM", price: 400 },
            { name: "Optic implant", kind: "accessory", slot: "Optics", effect: "Zoom, threat scan, see in the dark", price: 500 },
            { name: "Blade arms", kind: "accessory", slot: "Arms", effect: "+5 damage up close; they unfold from the forearms", price: 1500 },
            { name: "MedPatch", kind: "consumable", slot: "", effect: "Heals 30 health", price: 40 },
            { name: "RAM booster", kind: "consumable", slot: "", effect: "+4 RAM now, a headache later", price: 60 },
            { name: "Synth noodles", kind: "consumable", slot: "", effect: "A hot meal, nearly food", price: 8 },
            { name: "Data shard", kind: "key", slot: "", effect: "Somebody's secrets. Worth something to someone", price: 0 },
          ],
          start: [
            { name: "Street pistol", count: 1 },
            { name: "Armored jacket", count: 1 },
            { name: "Cheap cyberdeck", count: 1 },
            { name: "MedPatch", count: 2 },
          ],
          merchants: [
            { name: "Ripperdoc", where: "Chrome Market", stock: "Optic implant, Blade arms, Cheap cyberdeck, MedPatch, RAM booster" },
            { name: "Arms dealer", where: "Rustline Docks", stock: "Street pistol, Smart SMG, Armored jacket" },
          ],
          sellRate: 50,
        },
      },
      {
        id: "quests",
        settings: {
          title: "Gigs",
          button: "💾 Gigs",
          board: "Fixer's list",
          start: [{ name: "The debt", objective: "Pay Vex the 2,000 you owe before Day 7", reward: "Keeping your kneecaps", giver: "Vex" }],
          offers: [
            { name: "Extraction", objective: "Get a scared lab tech out of Glasswater Plaza alive", reward: "1,500 €$", giver: "Mama Sol" },
            { name: "Lost shard", objective: "Recover a data shard from a gang safehouse in the Undercity", reward: "900 €$", giver: "Mama Sol" },
            { name: "Quiet job", objective: "Wipe a cop's file from the precinct's servers", reward: "1,200 €$", giver: "Anonymous" },
          ],
          ranks: [
            { name: "Nobody", from: 0 },
            { name: "Street rat", from: 40 },
            { name: "Known", from: 120 },
            { name: "Respected", from: 300 },
            { name: "Legend", from: 700 },
          ],
        },
      },
      {
        id: "map",
        settings: {
          title: "The Sprawl",
          button: "🗺️ Map",
          places: [
            { name: "Neon Row", region: "Downtown", description: "Clubs, noodle bars and holograms twenty storeys tall. Everyone is watching everyone.", danger: 1, links: "Glasswater Plaza, The Stacks, Chrome Market", x: 46, y: 46 },
            { name: "Glasswater Plaza", region: "Corporate district", description: "Clean glass towers, drones and private security that shoots first.", danger: 1, links: "Neon Row", x: 78, y: 22 },
            { name: "The Stacks", region: "Megablocks", description: "Fifty floors of people living on top of each other. Home, for now.", danger: 1, links: "Neon Row, Rustline Docks", x: 18, y: 36 },
            { name: "Chrome Market", region: "Downtown", description: "Stalls selling anything that fits in a body, legal or not.", danger: 1, links: "Neon Row, The Undercity", x: 56, y: 72 },
            { name: "Rustline Docks", region: "Waterfront", description: "Containers, smugglers and an arms dealer who doesn't ask.", danger: 2, links: "The Stacks, Badlands Gate", x: 10, y: 74 },
            { name: "The Undercity", region: "Below", description: "Old metro tunnels where gangs and worse live in the dark.", danger: 3, links: "Chrome Market", x: 70, y: 94 },
            { name: "Badlands Gate", region: "City limits", description: "The wall, the checkpoint and the dust beyond.", danger: 2, links: "Rustline Docks", x: 4, y: 98 },
          ],
          start: "The Stacks",
          hours: 1,
          fog: false,
          verb: "Go",
          go: "I head to {place}.",
        },
      },
      { id: "combat", settings: { difficulty: "fair" } },
      { id: "phone", settings: { apps: ["messages", "contacts", "social", "news", "system", "photos", "settings"], system: { name: "Darknet", description: "Anonymous boards: jobs nobody signs, rumours, people selling what they shouldn't. Posts here reach the story." } } },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Contact", from: 20 }, { name: "Friend", from: 45 }, { name: "Ride or die", from: 75 }] } },
      {
        id: "events",
        settings: {
          scheduled: [{ name: "Blackout", when: "Day 5", from: "23:00", to: "", where: "", text: "The grid goes down citywide. In the dark, the gangs come out to shop." }],
          random: [
            { name: "Gang war", chance: 10, where: "", part: "Night", text: "Two gangs open fire over a corner; the street empties in seconds." },
            { name: "Chrome rampage", chance: 6, where: "", part: "Evening", text: "Someone with too much chrome and too little mind is tearing a block apart." },
            { name: "Corp sweep", chance: 10, where: "", part: "Afternoon", text: "Corporate security sweeps the district looking for a face. Maybe yours." },
          ],
        },
      },
      { id: "journal", settings: { title: "Datalog", button: "📼 Datalog" } },
      { id: "menu", settings: { title: "Menu", button: "☰ Menu", only: true } },
      { id: "notify", settings: { watch: [{ path: "Phone.Texts", title: "Messages", icon: "chat" }, { path: "Phone.News", title: "News", icon: "news" }] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-scifi",
    name: "Sci-fi / space",
    description: "A ship to captain: hull, shields and fuel, reactor power to route, a crew and a cargo hold; a star chart where every jump burns fuel; contracts from the job board; an officer's sheet; firefights.",
    theme: { preset: "starship", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Monday", startClock: "06:00", startSeason: "Spring", weathers: ["Clear void", "Ion storm", "Solar flare", "Debris field", "Nebula"] } },
      { id: "settings" },
      { id: "title", settings: { style: "stars", tagline: "The stars are waiting", newGame: "Launch" } },
      {
        id: "creator",
        settings: {
          title: "Crew file",
          intro: "The ship is yours, the debt is yours, and the galaxy doesn't care. Who's in the captain's chair?",
          lookIdeas: ["Grey at the temples, a flight jacket with three patches torn off", "Station-pale, bright prosthetic hand, eyes that read everything twice", "Tall and calm, a colony accent, a sidearm worn like an old friend"],
          choices: [
            { name: "Origin", options: [opt("Core worlder", "Money, schools and manners. The frontier eats people like you."), opt("Spacer", "Born on a ship. Gravity feels like an insult."), opt("Colonist", "Dirt under your nails and a world that needed you."), opt("Synthetic", "Built, not born. Some people mind.")] },
            { name: "Specialty", options: [opt("Pilot", "You fly what can't be flown."), opt("Engineer", "Engines talk to you. You talk back."), opt("Medic", "You've patched people up in vacuum."), opt("Marine", "You were trained to board ships and come back.")] },
          ],
          stats: [
            { name: "Piloting", base: 4, max: 20 },
            { name: "Engineering", base: 4, max: 20 },
            { name: "Combat", base: 4, max: 20 },
            { name: "Charm", base: 4, max: 20 },
          ],
          points: 6,
          items: [],
          pickItems: 0,
          routes: [{ label: "Launch", description: "", message: "I'm {name}, captain of the Wayfarer. Docking clamps release, and Haven Station falls away behind us." }],
        },
      },
      {
        id: "hero",
        settings: {
          title: "Officer",
          button: "🎖️ Officer",
          resources: [
            { name: "Health", base: 90, perLevel: 8, regen: 3 },
            { name: "Focus", base: 30, perLevel: 4, regen: 6 },
          ],
          stats: [
            { name: "Piloting", start: 4 },
            { name: "Engineering", start: 4 },
            { name: "Combat", start: 4 },
            { name: "Charm", start: 4 },
          ],
          xpBase: 100,
          xpGrowth: 1.5,
          maxLevel: 30,
          pointsPerLevel: 2,
          abilities: [
            { name: "Tactical scan", level: 1, cost: 5, resource: "Focus", description: "Read a room, a ship or a fight before it starts." },
            { name: "Patch job", level: 1, cost: 8, resource: "Focus", description: "Make it work for now. It won't last." },
            { name: "Evasive maneuvers", level: 3, cost: 12, resource: "Focus", description: "Throw the ship around; everything misses, for a moment." },
            { name: "Called shot", level: 5, cost: 15, resource: "Focus", description: "One shot, exactly where it hurts." },
            { name: "Rally the crew", level: 8, cost: 20, resource: "Focus", description: "A few words, and everyone does their best work." },
          ],
        },
      },
      { id: "ship" },
      {
        id: "inventory",
        settings: {
          title: "Locker",
          button: "🧰 Locker",
          currency: "cr",
          startGold: 500,
          capacity: 12,
          slots: ["Weapon", "Armor", "Tool"],
          items: [
            { name: "Blaster pistol", kind: "weapon", slot: "", effect: "+3 damage, reliable", price: 300 },
            { name: "Pulse rifle", kind: "weapon", slot: "", effect: "+5 damage, burns through armor", price: 900 },
            { name: "Vac suit", kind: "armor", slot: "", effect: "+2 armor; air for 6 hours in vacuum", price: 400 },
            { name: "Multitool", kind: "accessory", slot: "Tool", effect: "Opens panels, splices wires, cuts small locks", price: 120 },
            { name: "Medkit", kind: "consumable", slot: "", effect: "Heals 35 health", price: 60 },
            { name: "Stim", kind: "consumable", slot: "", effect: "+15 Focus now, a crash later", price: 45 },
            { name: "Ration bar", kind: "consumable", slot: "", effect: "A meal. Technically", price: 5 },
            { name: "Encrypted chip", kind: "key", slot: "", effect: "Locked data someone wants badly", price: 0 },
          ],
          start: [
            { name: "Blaster pistol", count: 1 },
            { name: "Vac suit", count: 1 },
            { name: "Multitool", count: 1 },
            { name: "Medkit", count: 2 },
            { name: "Ration bar", count: 3 },
          ],
          merchants: [{ name: "Quartermaster", where: "Haven Station", stock: "Blaster pistol, Pulse rifle, Vac suit, Multitool, Medkit, Stim, Ration bar" }],
          sellRate: 50,
        },
      },
      {
        id: "quests",
        settings: {
          title: "Contracts",
          button: "📡 Contracts",
          board: "Job board",
          start: [{ name: "Make the payment", objective: "Pay the shipyard 5,000 cr on the Wayfarer before Day 10", reward: "Keeping the ship", giver: "Haven shipyard" }],
          offers: [
            { name: "Medical run", objective: "Get vaccines to the colony on Ashfall before the outbreak spreads", reward: "2,500 cr", giver: "Colonial health office" },
            { name: "No questions asked", objective: "Haul sealed crates through the Drift; don't scan them", reward: "4,000 cr", giver: "A woman with no name" },
            { name: "Salvage rights", objective: "Strip a derelict in the Kestrel Belt before the scavengers do", reward: "Half of the haul", giver: "Kestrel mining guild" },
          ],
          ranks: [
            { name: "Unknown", from: 0 },
            { name: "Reliable", from: 50 },
            { name: "Trusted", from: 150 },
            { name: "Renowned", from: 350 },
            { name: "Legendary", from: 700 },
          ],
        },
      },
      {
        id: "map",
        settings: {
          title: "Star chart",
          button: "🌌 Star chart",
          places: [
            { name: "Haven Station", region: "Tycho sector", description: "A ring station of docks, bars and brokers. Home port.", danger: 0, links: "Vega Prime, Kestrel Belt, Tycho Gate", x: 40, y: 56 },
            { name: "Vega Prime", region: "The Core", description: "A shining capital world. Customs inspect everything twice.", danger: 0, links: "Haven Station", x: 82, y: 70 },
            { name: "Kestrel Belt", region: "Tycho sector", description: "Asteroid mines, claim-jumpers and rocks that move when you're not looking.", danger: 1, links: "Haven Station, The Drift", x: 18, y: 82 },
            { name: "Tycho Gate", region: "Tycho sector", description: "An ancient relay nobody built. Ships go through; most come back.", danger: 1, links: "Haven Station, Outer Reach", x: 56, y: 22 },
            { name: "The Drift", region: "Nebula", description: "A nebula that blinds sensors. Pirates love it.", danger: 2, links: "Kestrel Belt, Ashfall", x: 8, y: 40 },
            { name: "Ashfall", region: "Nebula", description: "A colony that stopped answering six weeks ago.", danger: 3, links: "The Drift", x: 22, y: 6 },
            { name: "Outer Reach", region: "Frontier", description: "The last charted stars. Beyond them, only rumours.", danger: 2, links: "Tycho Gate", x: 90, y: 8 },
          ],
          start: "Haven Station",
          hours: 8,
          fog: true,
          verb: "Jump",
          go: "Plot a jump to {place}.",
        },
      },
      { id: "combat", settings: { difficulty: "fair" } },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Shipmate", from: 25 }, { name: "Trusted", from: 55 }, { name: "Family", from: 85 }] } },
      {
        id: "events",
        settings: {
          scheduled: [{ name: "Payment due", when: "Day 10", from: "09:00", to: "", where: "", text: "The shipyard's collectors come for the Wayfarer's payment." }],
          random: [
            { name: "Distress beacon", chance: 12, where: "", part: "Night", text: "A faint distress call on an old frequency. It could be a trap." },
            { name: "Pirate hail", chance: 8, where: "", part: "Afternoon", text: "A pirate ship hails: cut the engines and share the cargo." },
            { name: "Ion storm", chance: 10, where: "", part: "Morning", text: "An ion storm rolls in; sensors go blind and systems spark." },
          ],
        },
      },
      { id: "journal", settings: { title: "Captain's log", button: "📓 Log" } },
      { id: "menu", settings: { title: "Bridge", button: "☰ Menu", only: true } },
      { id: "notify", settings: { watch: [] } },
    ],
    modules: [],
    builtIn: true,
  },
  {
    id: "kit-horror",
    name: "Horror / mystery",
    description: "A case to crack: clues, suspects and a red-string evidence board, questioning and accusing; dread that rises and warps the screen; a small town at night; a VHS-static title; a phone with no one to call.",
    theme: { preset: "dread", overrides: {} },
    parts: [
      { id: "time", settings: { startWeekday: "Friday", startClock: "21:00", startSeason: "Autumn", weathers: ["Fog", "Rain", "Overcast", "Storm", "Still"] } },
      { id: "settings" },
      { id: "title", settings: { style: "static", tagline: "Some doors should stay closed", newGame: "Play tape" } },
      {
        id: "creator",
        settings: {
          title: "Who came to Blackwater?",
          intro: "A letter brought you here. Who are you, and what do you carry with you?",
          lookIdeas: ["Rumpled trench coat, a notebook full of other people's secrets", "Clerical collar, hands that shake until they pray", "Thin and watchful, dark circles, a camera always ready"],
          choices: [
            { name: "Occupation", options: [opt("Detective", "A badge, a gun and a habit of not letting go."), opt("Journalist", "You get the story. It's the rest you're bad at."), opt("Priest", "Faith, Latin and doubts you never confess."), opt("Medium", "You hear things. You wish you didn't.")] },
            { name: "Burden", options: [opt("Insomnia", "You haven't slept properly in a year. Things look different at 3am."), opt("Grief", "Someone you lost looks a lot like Mara."), opt("A debt", "Someone in this town knows what you did.")] },
          ],
          stats: [
            { name: "Nerve", base: 3, max: 10 },
            { name: "Wits", base: 3, max: 10 },
            { name: "Body", base: 3, max: 10 },
            { name: "Intuition", base: 3, max: 10 },
          ],
          points: 4,
          items: [],
          pickItems: 0,
          routes: [{ label: "Open the letter", description: "", message: "I'm {name}. I read Mara's letter one more time in the rain outside the Raven Inn, then fold it away." }],
        },
      },
      { id: "case", settings: { dread: "Dread" } },
      {
        id: "inventory",
        settings: {
          title: "Pockets",
          button: "🔦 Pockets",
          currency: "$",
          startGold: 60,
          capacity: 8,
          slots: ["Hand"],
          items: [
            { name: "Flashlight", kind: "accessory", slot: "Hand", effect: "Light. The batteries are older than you'd like", price: 15 },
            { name: "Revolver", kind: "weapon", slot: "Hand", effect: "Six shots. They might not be enough", price: 200 },
            { name: "Lighter", kind: "other", slot: "", effect: "A flame, a cigarette, a way to burn things", price: 3 },
            { name: "Holy water", kind: "consumable", slot: "", effect: "It helps. Sometimes", price: 0 },
            { name: "Painkillers", kind: "consumable", slot: "", effect: "Dulls the pain and, a little, the fear", price: 6 },
            { name: "Spare batteries", kind: "consumable", slot: "", effect: "Another hour of light", price: 4 },
            { name: "Old brass key", kind: "key", slot: "", effect: "It doesn't fit any door you've found yet", price: 0 },
          ],
          start: [
            { name: "Flashlight", count: 1 },
            { name: "Lighter", count: 1 },
            { name: "Painkillers", count: 1 },
          ],
          merchants: [{ name: "General store", where: "Main Street", stock: "Flashlight, Spare batteries, Painkillers, Lighter" }],
          sellRate: 40,
        },
      },
      {
        id: "map",
        settings: {
          title: "Blackwater",
          button: "🗺️ Town",
          places: [
            { name: "Raven Inn", region: "Blackwater", description: "Your room, a bar that empties at nine and a landlady who locks the doors.", danger: 0, links: "Main Street, Harbor road", x: 44, y: 60 },
            { name: "Main Street", region: "Blackwater", description: "A general store, a diner and a police station with one tired officer.", danger: 0, links: "Raven Inn, St. Brigid's Church", x: 70, y: 48 },
            { name: "St. Brigid's Church", region: "Blackwater", description: "Candles always lit. The confessional is never empty, but no one goes in.", danger: 1, links: "Main Street, Old cemetery", x: 88, y: 24 },
            { name: "Old cemetery", region: "Hill", description: "Leaning stones, a family crypt and fresh earth where there shouldn't be.", danger: 2, links: "St. Brigid's Church, Vell House", x: 64, y: 8 },
            { name: "Vell House", region: "Hill", description: "Three storeys, boarded windows and a light upstairs that no one admits to.", danger: 2, links: "Old cemetery, Blackwater woods", x: 30, y: 14 },
            { name: "Blackwater woods", region: "Outskirts", description: "Pines so close the fog gets lost. Something follows at a distance.", danger: 3, links: "Vell House, Harbor road", x: 8, y: 40 },
            { name: "Harbor road", region: "Outskirts", description: "The road out of town, and a lighthouse that hasn't worked in years.", danger: 1, links: "Raven Inn, Blackwater woods", x: 22, y: 90 },
          ],
          start: "Raven Inn",
          hours: 1,
          fog: false,
          verb: "Go",
          go: "I head to {place}.",
        },
      },
      { id: "phone", settings: { apps: ["messages", "contacts", "photos", "news", "settings"] } },
      { id: "people", settings: { stages: [{ name: "Stranger", from: 0 }, { name: "Wary", from: 20 }, { name: "Ally", from: 50 }, { name: "Confidant", from: 80 }] } },
      {
        id: "events",
        settings: {
          scheduled: [{ name: "The anniversary", when: "Day 3", from: "23:00", to: "03:00", where: "", text: "A year since Mara's mother died in the house. The town stays indoors; the house does not stay quiet." }],
          random: [
            { name: "Power cut", chance: 14, where: "", part: "Night", text: "The lights die all at once. In the quiet, something moves." },
            { name: "Knocking", chance: 12, where: "", part: "Night", text: "Three knocks at the door. No one is there. Then three more." },
            { name: "The photo", chance: 8, where: "", part: "Evening", text: "A photo on your phone you don't remember taking. Someone is standing behind you in it." },
          ],
        },
      },
      { id: "journal", settings: { title: "Notebook", button: "📓 Notebook" } },
      { id: "menu", settings: { title: "Menu", button: "☰ Menu", only: true } },
      { id: "notify", settings: { watch: [{ path: "Phone.Texts", title: "Messages", icon: "chat" }] } },
    ],
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

