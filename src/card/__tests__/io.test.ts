// @vitest-environment node
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { base64Decode, utf8Decode } from "../bytes";
import { exportCharx, exportJson, exportPng, importCard } from "../io";
import { newCard } from "../normalize";
import { readChunks, readTextChunks } from "../png";
import type { CardPackage } from "../types";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** The card JSON stored under a PNG text keyword. */
function pngJson(bytes: Uint8Array, keyword: string) {
  const chunk = readTextChunks(readChunks(bytes)).find((t) => t.keyword === keyword);
  return chunk && JSON.parse(utf8Decode(base64Decode(chunk.text)));
}

describe("import", () => {
  it("reads a SillyTavern V2 PNG and converts it to V3", () => {
    const r = importCard(fixture("st-v2.png"));
    expect(r.format).toBe("png");
    expect(r.sourceSpec).toBe("v2");
    expect(r.card.spec).toBe("chara_card_v3");
    expect(r.card.data.name).toBe("Seraphina");
    expect(r.card.data.description).toContain("Ünïcödé ✨");
    expect(r.card.data.group_only_greetings).toEqual([]);
    expect(r.card.data.character_book?.entries[0].keys).toEqual(["Eldoria", "forest"]);
    expect(r.card.data.extensions.talkativeness).toBe("0.5");
    expect(r.image && readTextChunks(readChunks(r.image))).toEqual([]);
  });

  it("prefers the ccv3 chunk and extracts embedded PNG assets", () => {
    const r = importCard(fixture("st-v3.png"));
    expect(r.sourceSpec).toBe("v3");
    expect(r.card.data.nickname).toBe("Sera");
    expect(r.card.data.group_only_greetings).toHaveLength(1);
    const happy = r.card.data.assets?.find((a) => a.name === "happy");
    expect(happy?.uri).toBe("embeded://assets/emotion/images/happy.png");
    expect(r.files["assets/emotion/images/happy.png"]?.subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
    expect(r.warnings).toEqual([]);
  });

  it("reads CHARX with embedded and linked assets", () => {
    const r = importCard(fixture("card.charx"));
    expect(r.format).toBe("charx");
    expect(r.card.data.assets?.map((a) => a.uri)).toEqual([
      "embeded://assets/icon/images/main.png",
      "embeded://assets/emotion/images/happy.png",
      "https://example.com/bg.webp",
    ]);
    expect(Object.keys(r.files).sort()).toEqual(["assets/emotion/images/happy.png", "assets/icon/images/main.png"]);
  });

  it("reads CHARX appended to a JPEG", () => {
    const r = importCard(fixture("card.jpeg"));
    expect(r.format).toBe("jpeg-charx");
    expect(r.card.data.name).toBe("Seraphina");
  });

  it("reads V1 and Pygmalion JSON", () => {
    const v1 = importCard(fixture("v1.json"));
    expect(v1.sourceSpec).toBe("v1");
    expect(v1.card.data.first_mes).toBe("What do you want?");
    const pyg = importCard(fixture("pygmalion.json"));
    expect(pyg.card.data).toMatchObject({ name: "Pyg", description: "Pygmalion persona", scenario: "space", first_mes: "Hey" });
  });

  it("rejects a PNG without a card", () => {
    expect(() => importCard(fixture("plain.png"))).toThrow(/no character card/);
  });
});

describe("export", () => {
  it("round-trips a V3 PNG with assets, writing ccv3 and a V2 chara chunk", () => {
    const original = importCard(fixture("st-v3.png"));
    const { bytes, warnings } = exportPng(original);
    expect(warnings).toEqual([]);

    const v2 = pngJson(bytes, "chara");
    expect(v2.spec).toBe("chara_card_v2");
    expect(v2.name).toBe("Seraphina"); // V1 fields at the top level, like SillyTavern
    expect(v2.data.assets).toBeUndefined();
    expect(pngJson(bytes, "ccv3").data.assets[1].uri).toBe("__asset:assets/emotion/images/happy.png");

    const again = importCard(bytes);
    expect(again.card).toEqual(original.card);
    expect(again.files).toEqual(original.files);
  });

  it("does not stack card chunks when exporting twice", () => {
    const once = exportPng(importCard(fixture("st-v3.png"))).bytes;
    const twice = exportPng(importCard(once)).bytes;
    const keywords = readTextChunks(readChunks(twice)).map((t) => t.keyword);
    expect(keywords.filter((k) => k === "ccv3")).toHaveLength(1);
    expect(keywords.filter((k) => k === "chara")).toHaveLength(1);
  });

  it("uses an embedded PNG main icon as the image and a placeholder otherwise", () => {
    const charx = importCard(fixture("card.charx"));
    const fromIcon = exportPng(charx);
    expect(fromIcon.warnings).toEqual([]);
    const back = importCard(fromIcon.bytes);
    expect(back.card.data.assets?.[0].uri).toBe("ccdefault:");
    expect(Object.keys(back.files)).toEqual(["assets/emotion/images/happy.png"]);

    const blank = exportPng({ card: newCard("Blank"), files: {} });
    expect(blank.warnings[0]).toMatch(/placeholder/);
    expect(importCard(blank.bytes).card.data.name).toBe("Blank");
  });

  it("round-trips CHARX, storing the default image as the main icon", () => {
    const png = importCard(fixture("st-v3.png"));
    const { bytes } = exportCharx(png);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "assets/emotion/images/happy.png",
      "assets/icon/images/main.png",
      "card.json",
    ]);
    const back = importCard(bytes);
    expect(back.card.data.assets?.[0].uri).toBe("embeded://assets/icon/images/main.png");
    expect(back.files["assets/icon/images/main.png"]).toEqual(png.image);
  });

  it("leaves embedded files out of JSON with a warning", () => {
    const pkg: CardPackage = importCard(fixture("card.charx"));
    const { text, warnings } = exportJson(pkg);
    expect(JSON.parse(text).data.assets).toEqual([pkg.card.data.assets![2]]);
    expect(warnings).toHaveLength(2);
  });

  it("does not modify the package it exports", () => {
    const pkg = importCard(fixture("card.charx"));
    const before = structuredClone(pkg.card);
    exportPng(pkg);
    exportCharx(pkg);
    exportJson(pkg);
    expect(pkg.card).toEqual(before);
  });
});
