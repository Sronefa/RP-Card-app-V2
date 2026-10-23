import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import type { CardRecord } from "../db/db";
import { checkCard } from "./checker";
import { emptyBook, newEntry } from "./lorebook";

function record(fields: Partial<CardRecord["card"]["data"]> = {}, rest: Partial<CardRecord> = {}): CardRecord {
  const card = newCard("Sera");
  card.data = {
    ...card.data,
    description: "A guardian.",
    first_mes: "*The forest hums.*",
    tags: ["fantasy"],
    ...fields,
  };
  return { id: "c", projectId: "p", kind: "character", createdAt: 0, updatedAt: 0, card, files: {}, image: new Uint8Array([1]), ...rest };
}

const messages = (r: CardRecord) => checkCard(r).map((i) => `${i.level}: ${i.message}`);

describe("checkCard", () => {
  it("passes a complete card", () => {
    expect(checkCard(record())).toEqual([]);
  });

  it("flags missing basics", () => {
    const issues = checkCard(record({ name: " ", description: "", first_mes: "" }));
    expect(issues.map((i) => i.level)).toEqual(["error", "error", "warning"]);
    expect(issues[0].target).toEqual({ section: "editor", group: "basics" });
  });

  it("flags macros SillyTavern won't replace, but not valid ones", () => {
    expect(messages(record({ description: "{char} meets {{ user }}." }))).toEqual([
      expect.stringMatching(/^error: Description has \{char\}, \{\{ user \}\}/),
    ]);
    expect(checkCard(record({ description: "{{char}} meets {{user}} and <USER>." }))).toEqual([]);
  });

  it("flags greetings that speak for the user and examples without <START>", () => {
    const m = messages(record({ first_mes: "Hi.\n{{user}}: hello", mes_example: "{{char}}: hey" }));
    expect(m).toContain("warning: Example dialogues should start with <START>, or SillyTavern may read them as one block.");
    expect(m.some((x) => x.includes("speak for the user"))).toBe(true);
  });

  it("flags lorebook entries that can never trigger, bad regex and shared keys", () => {
    const book = emptyBook();
    book.entries.push(
      newEntry(book, { comment: "Keyless", content: "x" }),
      newEntry(book, { comment: "Bad", keys: ["/drag(on/"], content: "x" }),
      newEntry(book, { comment: "One", keys: ["Castle"], content: "x" }),
      newEntry(book, { comment: "Two", keys: ["castle"], content: "x" }),
      newEntry(book, { comment: "Off", keys: [], content: "", enabled: false }),
    );
    const issues = checkCard(record({ character_book: book }));
    expect(issues.map((i) => [i.level, i.target])).toEqual([
      ["error", { section: "lorebook", entry: 0 }],
      ["error", { section: "lorebook", entry: 1 }],
      ["tip", { section: "lorebook", entry: 3 }],
    ]);
  });

  it("flags assets whose file is missing and duplicate main icons", () => {
    const r = record({
      assets: [
        { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
        { type: "icon", uri: "embeded://assets/icon/images/a.png", name: "main", ext: "png" },
      ],
    });
    expect(messages(r)).toEqual([
      'error: The icon asset "main" points to a file that is missing.',
      'warning: 2 icon assets are named "main". Only one per type should be.',
    ]);
  });

  it("warns when the permanent fields are very long", () => {
    expect(messages(record({ description: "x".repeat(9000) }))[0]).toMatch(/^warning: About 2250 permanent tokens/);
  });
});
