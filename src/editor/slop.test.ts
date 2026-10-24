import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import { emptyBook, newEntry } from "./lorebook";
import { findSlop, slopRequest } from "./slop";

describe("findSlop", () => {
  it("finds phrases with wildcards in fields, greetings and lorebook entries", () => {
    const card = newCard("Mira");
    const book = emptyBook();
    card.data = {
      ...card.data,
      description: "Mira is calm. A shiver ran down his spine when she spoke. She is tall.",
      alternate_greetings: ["Her voice was barely above a whisper."],
      character_book: { ...book, entries: [newEntry(book, { comment: "Gate", content: "The air smells of ozone." })] },
    };
    const hits = findSlop(card.data, ["shiver* * down * spine", "barely above a whisper", "smell* of ozone", "nothing here"]);
    expect(hits.map((h) => [h.where, h.phrase, h.line])).toEqual([
      ["Description", "shiver* * down * spine", "A shiver ran down his spine when she spoke."],
      ["Alternate greeting 1", "barely above a whisper", "Her voice was barely above a whisper."],
      ["Lorebook: Gate", "smell* of ozone", "The air smells of ozone."],
    ]);
    expect(hits[2].target).toEqual({ section: "lorebook", entry: 0 });
    expect(slopRequest(hits[1])).toContain('In alternate greeting 1, rewrite this line');
  });

  it("matches whole words only", () => {
    const card = newCard("Mira");
    card.data.description = "She delved deep into the unbustling streets.";
    expect(findSlop(card.data, ["delve", "bustling"])).toEqual([]);
  });
});
