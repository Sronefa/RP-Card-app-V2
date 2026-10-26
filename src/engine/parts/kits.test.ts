import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import type { CardDataV3 } from "../../card";
import { worldEntry } from "../../editor/world";
import { coreModules, effectiveVars, moduleConflicts, modulesOf } from "../modules/compile";
import { TITLE_TAG } from "../modules/title";
import { applyEngine, newEngine, readEngine, starterVar, tavernHelperScript, varPath, type EngineConfig } from "../sheet";
import { fakeTavern, runScript } from "../testing";
import { applyKit, BUILT_IN_KITS, BUILT_IN_PARTS, type Kit } from "./catalog";

function card(): CardDataV3 {
  const book = { name: "", entries: [] as never[], extensions: {} };
  const npc = worldEntry(book as never, "npc", { name: "Rhea", role: "barista", look: "Green apron, quick smile" });
  const place = worldEntry(book as never, "location", { name: "Harbor", mood: "salty" });
  const item = worldEntry(book as never, "item", { name: "Sea glass charm", price: "12 coins", type: "item" });
  return {
    ...newCard().data,
    name: "Port Noir",
    first_mes: "The rain.",
    scenario: "A rain-soaked harbor town.",
    character_book: { ...book, entries: [npc, { ...place, id: 2 }, { ...item, id: 3 }] } as never,
    assets: [
      { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
      { type: "x_portrait", uri: "embeded://assets/other/images/rhea.webp", name: "Rhea", ext: "webp" },
      { type: "x_cg", uri: "embeded://assets/other/images/cg_rhea_rain.png", name: "cg_rhea_rain", ext: "png" },
    ],
  };
}

const kit = (id: string) => BUILT_IN_KITS.find((k) => k.id === id)!;
const install = (k: Kit) => applyKit({ ...newEngine(), modules: [] }, card(), k, BUILT_IN_PARTS);
const paths = (config: EngineConfig) => effectiveVars(config).map((v) => varPath(v).join("."));

/** Runs a card's engine in a fake Tavern Helper; `turn` sends a reply with an update block. */
async function play(config: EngineConfig) {
  const data = applyEngine(card(), config);
  const tavern = fakeTavern([{ role: "assistant", message: data.first_mes }]);
  Object.assign(tavern.api, { injectPrompts: () => {}, uninjectPrompts: () => {}, replaceScriptButtons: () => {}, eventOnButton: () => {}, eventRemoveListener: () => {} });
  await runScript(tavernHelperScript(readEngine(data)!).content, tavern);
  const turn = async (ops: unknown[]) => {
    tavern.messages.push({ role: "user", message: "…" }, { role: "assistant", message: `Next.\n<UpdateVariable><JSONPatch>${JSON.stringify(ops)}</JSONPatch></UpdateVariable>` });
    tavern.vars.push({}, {});
    await tavern.api.eventEmit("message_sent", tavern.messages.length - 2);
    await tavern.api.eventEmit("message_received", tavern.messages.length - 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (tavern.vars.at(-1) as { stat_data: Record<string, any> }).stat_data;
  };
  return { tavern, turn };
}
const clock = (c: string) => ({ op: "replace", path: "/Time/Clock", value: c });
const day = (d: number) => ({ op: "replace", path: "/Time/Day", value: d });

describe("the kits", () => {
  it("each installs cleanly, with its theme and a title screen", () => {
    for (const id of ["kit-modern-life", "kit-school", "kit-dating", "kit-fantasy", "kit-dark-fantasy", "kit-isekai"]) {
      const out = install(kit(id));
      expect(moduleConflicts(out.config).map((c) => c.message), id).toEqual([]);
      expect(out.config.theme, id).toEqual(kit(id).theme);
      expect(out.messageTags[0], id).toBe(TITLE_TAG);
    }
    expect(install(kit("kit-school")).config.theme?.preset).toBe("academy");
    expect(install(kit("kit-dark-fantasy")).config.theme?.preset).toBe("grimdark");
    expect(install(kit("kit-isekai")).config.theme?.preset).toBe("system");
  });

  it("lets the hero take over the engine's starter health", () => {
    const out = applyKit({ ...newEngine(), vars: [starterVar()] }, card(), kit("kit-fantasy"), BUILT_IN_PARTS);
    expect(moduleConflicts(out.config)).toEqual([]);
    expect(out.config.vars).toEqual([]);
    const mine = { ...starterVar(), max: 250 };
    expect(applyKit({ ...newEngine(), vars: [mine] }, card(), kit("kit-fantasy"), BUILT_IN_PARTS).config.vars).toEqual([mine]);
  });

  it("fantasy shares stats with the creator and links quests and fights to the hero and the bag", () => {
    const { config } = install(kit("kit-fantasy"));
    const all = paths(config);
    expect(all.filter((p) => /Strength$/.test(p))).toEqual(["Player.Strength"]);
    expect(all).toEqual(
      expect.arrayContaining(["Player._Level", "Player.XP", "Player._Points", "Player.Health", "Player._MaxHealth", "Player.Abilities", "Inventory.Items", "Inventory.Gold", "Equipped.Weapon", "Quests.Active", "Quests._Rank", "Map.Location", "Combat.Enemies", "Combat.$Max"]),
    );
    const mods = modulesOf(config);
    expect(mods.find((m) => m.id === "quests")!.rules[1].content).toContain("add XP to /Player/XP");
    expect(mods.find((m) => m.id === "combat")!.settings.live).toMatchObject({ links: { group: "Player", known: "Player.Abilities", bag: "Inventory.Items", resources: ["Health", "Mana", "Stamina"] } });
    expect(mods.find((m) => m.id === "inventory")!.settings.items).toEqual(expect.arrayContaining([{ name: "Sea glass charm", kind: "accessory", slot: "", effect: "", price: 12 }]));
  });

  it("dark fantasy survives on needs without a job, and pays from the pack", () => {
    const { config } = install(kit("kit-dark-fantasy"));
    const all = paths(config);
    expect(all).toEqual(expect.arrayContaining(["Needs.Thirst", "Needs.Warmth", "Needs.Sanity", "Inventory.Gold", "Equipped.Trinket"]));
    expect(all.some((p) => p.startsWith("Job.") || p === "Life.Money" || p === "Player.Mana")).toBe(false);
    expect(modulesOf(config).find((m) => m.id === "combat")!.rules[0].content).toContain("a bad choice can end {{user}}");
  });

  it("the isekai System speaks in brackets and keeps titles", () => {
    const { config } = install(kit("kit-isekai"));
    expect(paths(config)).toEqual(expect.arrayContaining(["Player.Titles", "Player.Title", "Player.Luck"]));
    expect(modulesOf(config).find((m) => m.id === "hero")!.rules[1].content).toContain("[System: Level up!");
  });

  it("puts the world's places on the map, replacing the example ones", () => {
    const data = card();
    const book = data.character_book!;
    const more = worldEntry(book as never, "location", { name: "Lighthouse", mood: "lonely" });
    data.character_book = { ...book, entries: [...book.entries, { ...more, id: 9 }] };
    const out = applyKit({ ...newEngine(), modules: [] }, data, kit("kit-fantasy"), BUILT_IN_PARTS);
    const map = modulesOf(out.config).find((m) => m.id === "map")!;
    expect((map.settings.places as { name: string; links: string }[]).map((p) => [p.name, p.links])).toEqual([["Harbor", ""], ["Lighthouse", "Harbor"]]);
    expect(map.settings.start).toBe("Harbor");
  });

  it("sets up the core parts a new engine already has, unless the author changed them", () => {
    const fresh = applyKit({ ...newEngine(), modules: coreModules() }, card(), kit("kit-dating"), BUILT_IN_PARTS);
    expect(modulesOf(fresh.config).find((m) => m.id === "time")!.settings).toMatchObject({ startWeekday: "Friday", startClock: "16:00" });
    const mine = coreModules().map((m) => (m.id === "time" ? { ...m, settings: { ...m.settings, startClock: "05:00" } } : m));
    const kept = applyKit({ ...newEngine(), modules: mine }, card(), kit("kit-dating"), BUILT_IN_PARTS);
    expect(modulesOf(kept.config).find((m) => m.id === "time")!.settings).toMatchObject({ startWeekday: "Monday", startClock: "05:00" });
  });

  it("modern life shares money with the phone and skills with the creator", () => {
    const { config } = install(kit("kit-modern-life"));
    const all = paths(config);
    expect(all).toContain("Phone.Money");
    expect(all).not.toContain("Life.Money");
    expect(all.filter((p) => /Cooking$/.test(p))).toEqual(["Player.Cooking"]);
    expect(all).toEqual(expect.arrayContaining(["Needs.Energy", "Needs.Hunger", "Job.Performance", "Job._Shift", "Life._Bills", "Life.$Paid"]));
    const life = modulesOf(config).find((m) => m.id === "life")!;
    expect(life.rules[0].content).toContain("into Phone.Money (log it in /Phone/Transactions)");
  });

  it("dating fills routes and the cast from the card, and keeps its own money without a wallet", () => {
    const { config } = install(kit("kit-dating"));
    const routes = modulesOf(config).find((m) => m.id === "routes")!;
    expect(routes.settings.interests).toEqual([{ name: "Rhea", avatar: "Rhea.webp", about: "Green apron, quick smile", loved: "", liked: "", disliked: "" }]);
    expect(routes.settings.gallery).toEqual([{ file: "cg_rhea_rain.png", caption: "Rhea rain", route: "Rhea" }]);
    expect((routes.settings.gifts as { name: string }[]).map((g) => g.name)).toContain("Sea glass charm");
    expect(modulesOf(config).find((m) => m.id === "title")!.settings.cast).toEqual([{ name: "Rhea", avatar: "Rhea.webp" }]);
    expect(paths(config)).toEqual(expect.arrayContaining(["Rhea.Affection", "Rhea.Trust", "Rhea.Route", "Routes.Money", "Choices.Options"]));
  });
});

describe("the kit parts in a chat", () => {
  it("daily life drains needs with the clock, finds the shift and the bills", async () => {
    const { turn } = await play(install(kit("kit-modern-life")).config);
    let s = await turn([clock("09:30")]);
    expect(s.Needs).toMatchObject({ Energy: 72, Hunger: 30, Hygiene: 86, Mood: 58, Stress: 20 });
    expect(s.Job._Shift).toBe("On shift now, until 17:00");
    // A need the story set this turn is left alone.
    s = await turn([clock("10:30"), { op: "replace", path: "/Needs/Energy", value: 100 }]);
    expect(s.Needs.Energy).toBe(100);
    expect(s.Needs.Hunger).toBe(35);
    expect(s.Life._Bills).toEqual([]);
    s = await turn([day(5), clock("18:00")]);
    expect(s.Life._Bills).toEqual(["Rent $650: due Day 7"]);
    expect(s.Job._Shift).toBe("Monday 09:00–17:00");
    s = await turn([day(9), clock("08:00")]);
    expect(s.Life._Bills).toEqual(["Rent $650: overdue since Day 7", "Phone bill $35: due Day 12"]);
  });

  it("the school app knows the period, counts down exams and expires violations", async () => {
    const { turn } = await play(install(kit("kit-school")).config);
    let s = await turn([clock("08:00")]);
    expect(s.School._Now).toBe("Before school");
    expect(s.School._Next).toBe("08:30 Homeroom");
    expect(s.School._Exams).toEqual(["Midterms: Day 14 (in 13 days)", "Finals: Day 42 (in 41 days)"]);
    s = await turn([clock("09:00"), { op: "insert", path: "/School/Violations/-", value: "Late to homeroom — expires Day 3" }]);
    expect(s.School._Now).toBe("1st period: Math (until 09:40)");
    expect(s.School.Violations).toEqual(["Late to homeroom — expires Day 3"]);
    s = await turn([day(3), clock("12:00")]);
    expect(s.School._Now).toBe("Lunch (until 12:30)");
    expect(s.School.Violations).toEqual([]);
    s = await turn([day(6), clock("10:00")]);
    expect(s.School._Now).toBe("No school today");
  });

  it("the hero levels up from XP, unlocks skills, refills, regains with time and sheds conditions", async () => {
    const { turn } = await play(install(kit("kit-fantasy")).config);
    let s = await turn([{ op: "delta", path: "/Player/XP", value: 250 }, { op: "insert", path: "/Player/Conditions/-", value: "Poisoned until Day 2" }]);
    expect(s.Player).toMatchObject({ _Level: 3, XP: 0, _NextXP: 225, _Points: 6, Health: 124, _MaxHealth: 124, _MaxMana: 42 });
    expect(s.Player.Abilities).toEqual(["Power Strike", "Second Wind"]);
    s = await turn([{ op: "delta", path: "/Player/Health", value: -50 }]);
    expect(s.Player.Health).toBe(74);
    s = await turn([clock("10:00")]);
    expect(s.Player.Health).toBe(82);
    expect(s.Player.Conditions).toEqual(["Poisoned until Day 2"]);
    s = await turn([day(2)]);
    expect(s.Player.Conditions).toEqual([]);
  });

  it("the map discovers places as you go; fights count rounds and end with the last foe; quests rank up", async () => {
    const { turn } = await play(install(kit("kit-fantasy")).config);
    let s = await turn([{ op: "replace", path: "/Map/Location", value: "Whispering Woods" }]);
    expect(s.Map.Discovered).toEqual(expect.arrayContaining(["Oakvale", "Whispering Woods", "Ruined Keep"]));
    expect(s.Map._Nearby).toEqual(["Oakvale (3h)", "Ruined Keep (3h)"]);
    s = await turn([{ op: "replace", path: "/Combat/Active", value: true }, { op: "insert", path: "/Combat/Enemies/Wolf", value: 30 }]);
    expect(s.Combat).toMatchObject({ _Round: 1, $Max: { Wolf: 30 } });
    s = await turn([{ op: "replace", path: "/Combat/Enemies/Wolf", value: 12 }]);
    expect(s.Combat).toMatchObject({ Active: true, _Round: 2, Enemies: { Wolf: 12 }, $Max: { Wolf: 30 } });
    s = await turn([{ op: "replace", path: "/Combat/Enemies/Wolf", value: 0 }]);
    expect(s.Combat).toMatchObject({ Active: false, _Round: 0, Enemies: {}, $Max: {} });
    expect(s.Quests.Tracked).toBe("A new arrival");
    s = await turn([{ op: "remove", path: "/Quests/Active/0" }, { op: "insert", path: "/Quests/Active/-", value: "Wolves at the mill — Find the den" }, { op: "delta", path: "/Quests/Renown", value: 60 }]);
    expect(s.Quests).toMatchObject({ Tracked: "Wolves at the mill", _Rank: "E" });
  });

  it("dark fantasy needs drain with the clock", async () => {
    const { turn } = await play(install(kit("kit-dark-fantasy")).config);
    const s = await turn([clock("19:30")]);
    expect(s.Needs).toMatchObject({ Hunger: 36, Thirst: 35, Warmth: 56, Rest: 64, Sanity: 75 });
    expect(s.Inventory.Gold).toBe(8);
  });

  it("routes keep unlocked pictures and endings with the character", async () => {
    const k = structuredClone(kit("kit-dating"));
    k.parts.find((p) => p.id === "routes")!.settings = { endings: [{ route: "Rhea", name: "Harbor dawn", kind: "good", hint: "" }] };
    const { tavern, turn } = await play(install(k).config);
    let s = await turn([{ op: "delta", path: "/Rhea/Affection", value: 45 }, { op: "insert", path: "/Routes/Unlocked/-", value: "Rhea rain" }]);
    expect(s.Rhea.Affection).toBe(55);
    await new Promise((r) => setTimeout(r, 0));
    s = await turn([{ op: "replace", path: "/Routes/Ending", value: "Rhea: Harbor dawn" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(tavern.scopes.character.cardforge).toEqual({ keep: { gallery: ["Rhea rain"], endings: ["Rhea: Harbor dawn"] } });
  });
});
