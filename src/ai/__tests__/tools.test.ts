import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import { emptyBook, newEntry } from "../../editor/lorebook";
import { diffWords } from "../../lib/diff";
import { composeUserMessage } from "../prompts";
import { applyEdit, describeEdit, planEdit, ToolInputError } from "../tools";

function data() {
  const d = newCard("Sera").data;
  d.description = "Sera is a guardian. She is kind.";
  d.alternate_greetings = ["Hello."];
  const book = emptyBook();
  book.entries.push(newEntry(book, { comment: "Forest", keys: ["forest"], content: "Old trees." }));
  d.character_book = book;
  return d;
}
const call = (name: string, input: Record<string, unknown>) => ({ id: "t", name, input });
const run = (name: string, input: Record<string, unknown>, d = data()) => applyEdit(d, planEdit(d, call(name, input)));

describe("card tools", () => {
  it("sets and patches fields", () => {
    expect(run("set_field", { field: "scenario", text: "A storm." }).scenario).toBe("A storm.");
    expect(run("patch_field", { field: "description", find: "kind", replace: "fierce" }).description).toBe(
      "Sera is a guardian. She is fierce.",
    );
  });

  it("rejects patches that don't match exactly once, and unknown fields", () => {
    const d = data();
    expect(() => planEdit(d, call("patch_field", { field: "description", find: "missing", replace: "x" }))).toThrow(ToolInputError);
    expect(() => planEdit(d, call("patch_field", { field: "description", find: "S", replace: "x" }))).toThrow(/more than once/);
    expect(() => planEdit(d, call("set_field", { field: "tags", text: "x" }))).toThrow(/must be one of/);
    expect(() => planEdit(d, call("nope", {}))).toThrow(/Unknown tool/);
  });

  it("adds and updates greetings and example dialogues", () => {
    expect(run("add_greeting", { text: "Hi again." }).alternate_greetings).toEqual(["Hello.", "Hi again."]);
    expect(run("add_greeting", { text: "Hi all.", group_only: true }).group_only_greetings).toEqual(["Hi all."]);
    expect(run("update_greeting", { number: 1, text: "Hey." }).alternate_greetings).toEqual(["Hey."]);
    expect(() => planEdit(data(), call("update_greeting", { number: 2, text: "x" }))).toThrow(ToolInputError);
    const once = run("add_example_dialogue", { text: "{{char}}: Hm." });
    expect(once.mes_example).toBe("<START>\n{{char}}: Hm.");
    expect(run("add_example_dialogue", { text: "<START>\n{{char}}: Ha." }, once).mes_example).toBe(
      "<START>\n{{char}}: Hm.\n<START>\n{{char}}: Ha.",
    );
  });

  it("adds, updates and deletes lore entries by id", () => {
    const added = run("add_lore_entry", { title: "River", keys: ["river", " "], content: "Cold.", constant: true });
    expect(added.character_book!.entries[1]).toMatchObject({ id: 1, comment: "River", keys: ["river"], constant: true });
    const updated = run("update_lore_entry", { id: "0", content: "Ancient trees." });
    expect(updated.character_book!.entries[0]).toMatchObject({ comment: "Forest", content: "Ancient trees." });
    expect(run("delete_lore_entry", { id: 0 }).character_book!.entries).toEqual([]);
    expect(() => planEdit(data(), call("delete_lore_entry", { id: 9 }))).toThrow(/No lorebook entry/);
  });

  it("describes edits", () => {
    const d = data();
    expect(describeEdit(planEdit(d, call("set_field", { field: "scenario", text: "x" })))).toBe("Write scenario");
    expect(describeEdit(planEdit(d, call("patch_field", { field: "description", find: "kind", replace: "x" })))).toBe("Change description");
    expect(describeEdit(planEdit(d, call("pitch", { title: "A twin", idea: "She has a twin." })))).toBe("Idea: A twin");
  });
});

describe("composeUserMessage", () => {
  it("sends only the context parts that changed", () => {
    const parts = [
      { key: "settings", title: "Settings", text: "Normal" },
      { key: "card", title: "Card", text: "v1" },
    ];
    const first = composeUserMessage("Do it", parts, {}, []);
    expect(first.text).toContain("<settings");
    expect(first.text).toContain("<card");
    const second = composeUserMessage("Again", [parts[0], { ...parts[1], text: "v2" }], first.sent, ["Edit 1 (x): accepted"]);
    expect(second.text).not.toContain("<settings");
    expect(second.text).toContain("v2");
    expect(second.text).toMatch(/<decisions>\nEdit 1 \(x\): accepted\n<\/decisions>\n\nAgain$/);
  });
});

describe("diffWords", () => {
  it("marks added and removed words", () => {
    expect(diffWords("She is kind.", "She is fierce.")).toEqual([
      { type: "same", text: "She is " },
      { type: "del", text: "kind." },
      { type: "add", text: "fierce." },
    ]);
    expect(diffWords("", "New")).toEqual([{ type: "add", text: "New" }]);
  });
});
