import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import { findUncovered, properNouns } from "./coverage";
import { emptyBook, newEntry } from "./lorebook";

const TEXT = `{{char}} is a ranger who guards the Sealed Gate in the Silverwood. She serves the Order of Ash and drinks at Brenna's tavern.
"Wrong forest," Mira says. Rain hammers the gate. When the Duke of Vael arrives, she hides. I can't. Okay then. The Ash Ford is cold. She met Tomas there and Tomas lied.`;

describe("properNouns", () => {
  it("finds names, places and factions but not sentence openers", () => {
    expect([...properNouns(TEXT).keys()].sort()).toEqual(
      ["Ash Ford", "Brenna", "Duke of Vael", "Mira", "Order of Ash", "Sealed Gate", "Silverwood", "Tomas"].sort(),
    );
    expect(properNouns(TEXT).get("Tomas")).toBe(2);
  });
});

describe("findUncovered", () => {
  it("skips the card's own name and names a lorebook covers", () => {
    const card = newCard("Mira");
    const book = emptyBook();
    card.data = {
      ...card.data,
      description: TEXT,
      character_book: {
        ...book,
        entries: [newEntry(book, { keys: ["silverwood"] }), newEntry(book, { keys: ["/duke\\b/i"] })],
      },
    };
    const world = [newEntry(book, { comment: "Ash Ford", keys: ["ford"] }), newEntry(book, { keys: ["order"] })];
    expect(findUncovered(card.data, world).map((u) => u.name)).toEqual(["Tomas", "Brenna", "Sealed Gate"]);
  });
});
