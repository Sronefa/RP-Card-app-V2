import { describe, expect, it } from "vitest";
import { toWorldInfo } from "../card";
import { emptyBook, mergeBooks, newEntry, parseKeys, regexError, stPosition, withStPosition } from "./lorebook";

describe("lorebook helpers", () => {
  it("gives new entries the next free id", () => {
    const book = emptyBook();
    book.entries.push(newEntry(book), { ...newEntry(book), id: 7 });
    expect(newEntry(book).id).toBe(8);
  });

  it("renumbers merged entries", () => {
    const a = { ...emptyBook(), name: "A" };
    a.entries.push(newEntry(a, { keys: ["x"] }));
    const b = emptyBook();
    b.entries.push(newEntry(b, { keys: ["y"] }), newEntry(b, { id: 1, keys: ["z"] }));
    const merged = mergeBooks(a, b);
    expect(merged.name).toBe("A");
    expect(merged.entries.map((e) => [e.id, e.keys[0]])).toEqual([[0, "x"], [1, "y"], [2, "z"]]);
  });

  it("splits keys on commas but keeps regex keys whole", () => {
    expect(parseKeys(" dragon, Wyrm ,, \n drake ")).toEqual(["dragon", "Wyrm", "drake"]);
    expect(parseKeys("/drag(on|ons){1,2}/i")).toEqual(["/drag(on|ons){1,2}/i"]);
    expect(parseKeys("  ")).toEqual([]);
  });

  it("reports invalid regex keys", () => {
    expect(regexError("/dragons?/i")).toBeUndefined();
    expect(regexError("/drag(on/")).toBeTruthy();
    expect(regexError("bare(")).toBeTruthy();
  });

  it("writes SillyTavern positions to both fields, and World Info export uses them", () => {
    const book = emptyBook();
    const entry = withStPosition(newEntry(book, { keys: ["k"] }), 4);
    expect(entry.position).toBe("after_char");
    expect(stPosition(entry)).toBe(4);
    expect(stPosition(withStPosition(entry, 0))).toBe(0);
    expect(withStPosition(entry, 0).position).toBe("before_char");
    book.entries.push(entry);
    expect((toWorldInfo(book).entries as Record<string, { position: number }>)["0"].position).toBe(4);
  });
});
