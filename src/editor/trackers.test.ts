import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import { emptyBook, newEntry, stDepth, stPosition } from "./lorebook";
import {
  addAddon,
  applyTracker,
  blockText,
  newScript,
  newTracker,
  parseRegex,
  previewReply,
  readTracker,
  regexScripts,
  removeAddon,
  rulesText,
} from "./trackers";

const tracker = () => addAddon(addAddon(newTracker(), "stats"), "inventory", "crowns");

describe("status tracker", () => {
  it("finds the block the model writes and shows it as HTML", () => {
    const config = tracker();
    const block = blockText(config, Object.fromEntries(config.fields.map((f) => [f.id, f.kind === "bar" ? "42" : f.start])));
    expect(block).toBe("<status>\nHealth: 42/100\nStamina: 42/100\nMoney (crowns): 20\nInventory: a knife, a waterskin\n</status>");
    const data = applyTracker(newCard("Mira").data, config);
    const html = previewReply(regexScripts(data), `Hello.\n\n${block}`);
    expect(html).toMatch(/^Hello\.\n\n<div style="border:1px solid #a78bfa66/);
    expect(html).toContain("<span>42/100</span>");
    expect(html).toContain("width:calc(42 / 100 * 100%)");
    expect(html).toContain('<span style="text-align:right">a knife, a waterskin</span>');
    expect(html).not.toContain("<status>");
    // Extra spaces and a model that drops the trailing newline still match.
    expect(parseRegex(regexScripts(data)[0].findRegex)!.test(block.replace(/: /g, ":  ").replace("\n</status>", "</status>"))).toBe(true);
  });

  it("writes the scripts and lorebook entries, and removes only its own", () => {
    const card = newCard("Mira");
    const book = emptyBook();
    const mine = { ...newScript(), scriptName: "Mine" };
    card.data = {
      ...card.data,
      extensions: { regex_scripts: [mine] },
      character_book: { ...book, entries: [newEntry(book, { comment: "Gate", keys: ["gate"] })] },
    };
    let data = applyTracker(card.data, addAddon(tracker(), "relationship"));
    expect(regexScripts(data).map((s) => s.scriptName)).toEqual([
      "Mine",
      "CardForge: status block",
      "CardForge: old status blocks out of the prompt",
    ]);
    const entries = data.character_book!.entries;
    expect(entries.map((e) => e.comment)).toEqual([
      "Gate",
      "Status block rules",
      "Stage: Strangers",
      "Stage: Acquaintances",
      "Stage: Allies",
      "Stage: Close",
      "Stage: Lovers",
    ]);
    const rules = entries[1];
    expect(rules).toMatchObject({ constant: true });
    expect([stPosition(rules), stDepth(rules)]).toEqual([4, 1]);
    expect(rules.content).toContain("Stage: set from Affection (Strangers 0-20, Acquaintances 21-40, Allies 41-60, Close 61-80, Lovers 81-100).");
    expect(entries[2]).toMatchObject({ keys: ["Stage: Strangers"], constant: false });

    // Editing again replaces, never duplicates.
    data = applyTracker(data, removeAddon(readTracker(data)!, "relationship"));
    expect(regexScripts(data)).toHaveLength(3);
    expect(data.character_book!.entries.map((e) => e.comment)).toEqual(["Gate", "Status block rules"]);
    expect(rulesText(readTracker(data)!)).not.toContain("Stage");

    data = applyTracker(data, undefined);
    expect(regexScripts(data).map((s) => s.scriptName)).toEqual(["Mine"]);
    expect(data.character_book!.entries.map((e) => e.comment)).toEqual(["Gate"]);
    expect(data.extensions.cardforge).toBeUndefined();
  });

  it("leaves a card with no add-on untouched", () => {
    const card = newCard("Mira");
    const data = applyTracker(card.data, undefined);
    expect(data.extensions).toEqual(card.data.extensions);
    expect(data.character_book).toBeUndefined();
  });
});
