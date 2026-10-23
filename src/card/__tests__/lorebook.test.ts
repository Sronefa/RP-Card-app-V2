// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importLorebook, toLorebookV3File, toWorldInfo } from "../lorebook";
import { importPersona, toPersonaFile } from "../persona";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("lorebook files", () => {
  it("imports SillyTavern World Info, keeping ST-only settings in extensions", () => {
    const book = importLorebook(fixture("st-world-info.json"));
    expect(book.entries.map((e) => e.comment)).toEqual(["Kingdom", "Dragons"]); // sorted by display index
    const [kingdom, dragons] = book.entries;
    expect(kingdom).toMatchObject({ enabled: false, constant: true, use_regex: true, case_sensitive: true, position: "after_char" });
    expect(dragons).toMatchObject({ keys: ["dragon", "wyrm"], secondary_keys: ["fire"], insertion_order: 100, use_regex: false });
    expect(dragons.extensions).toMatchObject({ position: 4, depth: 2, probability: 80, selectiveLogic: 3, group: "beasts", sticky: 2, prevent_recursion: true });
  });

  it("round-trips World Info without losing settings", () => {
    const original = JSON.parse(fixture("st-world-info.json"));
    const back = toWorldInfo(importLorebook(fixture("st-world-info.json")));
    expect(back.entries).toEqual(original.entries);
  });

  it("reads V3 lorebook files and the book inside a card", () => {
    const book = importLorebook(fixture("st-world-info.json"));
    expect(importLorebook(JSON.stringify(toLorebookV3File(book)))).toEqual(book);
    const card = { spec: "chara_card_v2", data: { name: "x", character_book: { entries: [{ keys: ["a"], content: "b" }] } } };
    expect(importLorebook(JSON.stringify(card)).entries[0]).toMatchObject({ keys: ["a"], content: "b", enabled: true });
  });

  it("rejects files without a lorebook", () => {
    expect(() => importLorebook('{"spec":"chara_card_v2","data":{"name":"x"}}')).toThrow(/lorebook/);
  });
});

describe("persona files", () => {
  it("round-trips a persona and reads one from a card", () => {
    const persona = { name: "Alex", description: "A wandering bard.", extensions: { pronouns: "they" } };
    expect(importPersona(JSON.stringify(toPersonaFile(persona)))).toEqual(persona);
    expect(importPersona('{"spec":"chara_card_v3","data":{"name":"Sera","description":"guardian"}}')).toEqual({
      name: "Sera",
      description: "guardian",
      extensions: {},
    });
  });
});
