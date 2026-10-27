import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import type { CardDataV3 } from "../../card";
import { worldEntry } from "../../editor/world";
import { coreModules, modulesOf, moduleConflicts } from "../modules/compile";
import { phoneModule } from "../modules/phone";
import { TITLE_TAG } from "../modules/title";
import { CREATOR_TAG } from "../modules/creator";
import { applyEngine, newEngine, readEngine, tavernHelperScript, type EngineConfig } from "../sheet";
import { fakeTavern, runScript } from "../testing";
import { allParts, applyKit, BUILT_IN_PARTS, installParts, kitFromConfig, searchParts, withMessageTags } from "./catalog";

function card(): CardDataV3 {
  const book = { name: "", entries: [] as never[], extensions: {} };
  const npc = worldEntry(book as never, "npc", { name: "Rhea", role: "barista", look: "Green apron, quick smile" });
  const place = worldEntry(book as never, "location", { name: "Harbor", mood: "salty" });
  return {
    ...newCard().data,
    name: "Port Noir",
    scenario: "A rain-soaked harbor town where everyone owes someone. The ferry is late again. Nobody says why.",
    character_book: { ...book, entries: [npc, { ...place, id: 2 }] } as never,
    assets: [
      { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
      { type: "background", uri: "embeded://assets/background/images/docks.png", name: "docks", ext: "png" },
      { type: "x_portrait", uri: "embeded://assets/other/images/rhea.webp", name: "Rhea", ext: "webp" },
    ],
  };
}

const engine = (): EngineConfig => ({ ...newEngine(), modules: [] });

describe("the parts library", () => {
  it("finds parts by words and tags", () => {
    expect(searchParts(BUILT_IN_PARTS, "relationships").map((p) => p.id)).toEqual(expect.arrayContaining(["people", "phone"]));
    expect(searchParts(BUILT_IN_PARTS, "", "shared").map((p) => p.id)).toEqual(["time", "settings", "title", "creator", "menu", "people", "stage", "events", "journal"]);
    const mine = allParts([{ ...phoneModule(), id: "tarot", name: "Tarot", core: undefined, tags: ["fortune"], description: "Draw a card." }]);
    expect(searchParts(mine, "draw").map((p) => [p.id, p.source])).toEqual([["tarot", "mine"]]);
  });

  it("installs a part with what it needs, filled from the card", () => {
    const out = installParts(engine(), card(), ["events", "people", "title"], BUILT_IN_PARTS);
    expect(out.added.map((m) => m.id)).toEqual(["time", "events", "people", "title"]);
    const people = out.added.find((m) => m.id === "people")!;
    expect(people.settings.people).toEqual([{ name: "Rhea", role: "barista", avatar: "Rhea.webp", about: "Green apron, quick smile", likes: "" }]);
    expect(people.vars.map((v) => `${v.group}.${v.name}`)).toEqual(["Rhea.Affection", "Rhea.Learned"]);
    const title = out.added.find((m) => m.id === "title")!;
    expect(title.settings).toMatchObject({ title: "Port Noir", art: "docks.png", premise: "A rain-soaked harbor town where everyone owes someone. The ferry is late again. Nobody says why." });
    expect(out.messageTags).toEqual([TITLE_TAG]);
    expect(out.notes).toHaveLength(4);
    // Again: nothing new.
    expect(installParts(out.config, card(), ["events"], BUILT_IN_PARTS).added).toEqual([]);
  });

  it("puts the title before the opening and the creator after it", () => {
    expect(withMessageTags("The rain.", [TITLE_TAG, CREATOR_TAG])).toBe(`${TITLE_TAG}\n\nThe rain.\n\n${CREATOR_TAG}`);
    expect(withMessageTags(`${TITLE_TAG}\n\nThe rain.`, [TITLE_TAG])).toBe(`${TITLE_TAG}\n\nThe rain.`);
  });

  it("shares values the phone already keeps instead of doubling them", () => {
    const withPhone = installParts(engine(), card(), ["phone", "people"], BUILT_IN_PARTS).config;
    const people = modulesOf(withPhone).find((m) => m.id === "people")!;
    expect(people.vars.map((v) => `${v.group}.${v.name}`)).toEqual(["Rhea.Learned"]);
    expect(moduleConflicts(withPhone).map((c) => c.message)).toEqual([]);
  });

  it("saves a kit without the card's own names and puts it in another card", () => {
    const first = installParts({ ...engine(), theme: { preset: "noir", overrides: { accent: "#c0392b" } } as never }, card(), ["title", "people", "menu"], BUILT_IN_PARTS).config;
    const kit = kitFromConfig(first, "Noir kit");
    expect(kit.parts.map((p) => p.id)).toEqual(["title", "people", "menu"]);
    expect(kit.parts.find((p) => p.id === "people")!.settings!.people).toEqual([]);
    expect(kit.parts.find((p) => p.id === "title")!.settings!.title).toBe("");
    const other = { ...newCard().data, name: "Skyline" };
    const out = applyKit({ ...newEngine(), modules: coreModules() }, other, kit, BUILT_IN_PARTS);
    expect(out.config.theme).toEqual({ preset: "noir", overrides: { accent: "#c0392b" } });
    expect(out.added.map((m) => m.id)).toEqual(["title", "people", "menu"]);
    expect(out.added[0].settings.title).toBe("Skyline");
  });
});

describe("the shared parts in a chat", () => {
  it("works out events, files the journal at midnight and shows the menu alone", async () => {
    const config = installParts(engine(), card(), ["time", "events", "journal", "menu", "notify"], BUILT_IN_PARTS, {
      time: { startWeekday: "Saturday", startClock: "07:30" },
      events: { scheduled: [{ name: "Market day", when: "Sat", from: "08:00", to: "13:00", where: "", text: "Stalls fill the square." }], random: [] },
    }).config;
    const data = applyEngine(card(), config);
    const tavern = fakeTavern([{ role: "assistant", message: "Morning." }]);
    const injected: { id: string; content: string }[][] = [];
    const buttons: { name: string }[][] = [];
    Object.assign(tavern.api, {
      injectPrompts: (p: { id: string; content: string }[]) => injected.push(p),
      uninjectPrompts: () => {},
      replaceScriptButtons: (b: { name: string }[]) => buttons.push(b),
      eventOnButton: () => {},
      eventRemoveListener: () => {},
    });
    await runScript(tavernHelperScript(readEngine(data)!).content, tavern);
    expect(buttons.at(-1)!.map((b) => b.name)).toEqual(["☰ Menu"]);
    expect(tavern.vars[0]).toMatchObject({ stat_data: { Events: { _Now: [] }, Journal: { Today: [] } } });

    const turn = async (text: string) => {
      tavern.messages.push({ role: "user", message: "…" }, { role: "assistant", message: text });
      tavern.vars.push({}, {});
      await tavern.api.eventEmit("message_sent", tavern.messages.length - 2);
      await tavern.api.eventEmit("message_received", tavern.messages.length - 1);
      return tavern.vars.at(-1) as { stat_data: Record<string, any> };
    };
    const block = (ops: unknown[]) => `\n<UpdateVariable><JSONPatch>${JSON.stringify(ops)}</JSONPatch></UpdateVariable>`;
    let v = await turn("To the square." + block([{ op: "replace", path: "/Time/Clock", value: "09:15" }, { op: "insert", path: "/Journal/Today/-", value: "Bought a map" }]));
    expect(v.stat_data.Events._Now).toEqual(["Market day: Stalls fill the square."]);
    v = await turn("Night falls." + block([{ op: "replace", path: "/Time/Clock", value: "23:50" }]));
    expect(v.stat_data.Events._Now).toEqual([]);
    v = await turn("Midnight." + block([{ op: "replace", path: "/Time/Clock", value: "00:20" }, { op: "delta", path: "/Time/Day", value: 1 }]));
    expect(v.stat_data.Journal.Today).toEqual([]);
    expect(v.stat_data.Journal.$Past).toEqual(["Day 1: Bought a map"]);
    expect(injected.at(-1)!.find((p) => p.id === "cardforge-journal")?.content).toContain("Day 1: Bought a map");
  });
});
