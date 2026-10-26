import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import type { LorebookEntry } from "../../card";
import { newEntry, withStPosition } from "../../editor/lorebook";
import type { SandboxMessage } from "../sandbox/sandbox";
import { applyEngine, newEngine, newVar } from "../sheet";
import { activeLore, playerPrompt, promptRegex, replyPrompt, scriptPrompt } from "./prompt";

const persona = { name: "Ash", description: "A courier who never stays long." };
const msg = (id: number, role: "user" | "assistant", message: string, variables: Record<string, unknown> = {}): SandboxMessage => ({
  id,
  role,
  name: role === "user" ? "Ash" : "Mina",
  message,
  swipe_id: 0,
  swipes: 1,
  variables,
});

const entry = (fields: Partial<LorebookEntry>): LorebookEntry => ({ ...newEntry({ extensions: {}, entries: [] }), ...fields });

function card() {
  const base = { ...newCard().data, name: "Mina", description: "{{char}} runs the café.", scenario: "A rainy port.", post_history_instructions: "Stay in character." };
  const data = applyEngine(base, { ...newEngine(), vars: [newVar({ group: "Player", name: "Gold", start: "5" }), newVar({ group: "Player", name: "Secret", hidden: true, start: "x", type: "text" })] });
  const book = data.character_book!;
  return {
    ...data,
    character_book: {
      ...book,
      entries: [
        ...book.entries,
        entry({ comment: "Harbor", keys: ["harbor"], content: "The harbor smells of tar.", insertion_order: 10 }),
        withStPosition(entry({ comment: "Rule", constant: true, content: "Keep replies short.", insertion_order: 5 }), 0),
        entry({ comment: "Off", keys: ["café"], content: "Never sent.", enabled: false }),
      ],
    },
  };
}

describe("the playtest prompt", () => {
  it("builds SillyTavern's order with the state, lore by key and the tail", () => {
    const chat = [msg(0, "assistant", "Welcome in.", { stat_data: { Player: { Gold: 5, $Secret: "x" } } }), msg(1, "user", "I walk to the harbor.")];
    const p = replyPrompt({ data: card(), chat, persona, jailbreak: "JB" });
    expect(p.system.indexOf("Keep replies short.")).toBeLessThan(p.system.indexOf("Mina runs the café."));
    expect(p.system).toContain("Scenario: A rainy port.");
    expect(p.system).toContain("Ash: A courier");
    expect(p.system).toContain("<variable_rules>");
    expect(p.system).toContain("The harbor smells of tar.");
    expect(p.system).not.toContain("Never sent.");
    const all = p.messages.map((m) => (m.role === "tool" ? "" : m.text)).join("\n---\n");
    expect(all).toContain("Gold: 5");
    expect(all).not.toContain("$Secret");
    expect(p.messages[0]).toEqual({ role: "user", text: "[The roleplay begins.]" });
    const last = p.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.role === "user" && last.text).toMatch(/I walk to the harbor\.[\s\S]*Stay in character\.[\s\S]*JB$/);
    expect(p.lore).toContain("Harbor");
    expect(p.tokens).toBeGreaterThan(50);
  });

  it("runs prompt regex with depth limits and leaves display-only ones out", () => {
    const scripts = [
      { id: "a", scriptName: "a", findRegex: "/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g", replaceString: "", trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true, substituteRegex: 0, minDepth: 2, maxDepth: null },
      { id: "b", scriptName: "b", findRegex: "/Hi/g", replaceString: "SHOWN", trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null },
    ];
    expect(promptRegex("Hi <UpdateVariable>x</UpdateVariable>", false, 3, scripts)).toBe("Hi ");
    expect(promptRegex("Hi <UpdateVariable>x</UpdateVariable>", false, 0, scripts)).toBe("Hi <UpdateVariable>x</UpdateVariable>");
  });

  it("follows secondary-key logic", () => {
    const e = entry({ keys: ["sword"], secondary_keys: ["rust", "blood"], selective: true, content: "x", extensions: { selectiveLogic: 3 } });
    expect(activeLore([e], "a sword with rust")).toHaveLength(0);
    expect(activeLore([e], "a sword with rust and blood")).toHaveLength(1);
    expect(activeLore([{ ...e, extensions: { selectiveLogic: 2 } }], "a sword with rust")).toHaveLength(0);
  });

  it("puts injected prompts at their depth", () => {
    const chat = [msg(0, "assistant", "One."), msg(1, "user", "Two."), msg(2, "assistant", "Three."), msg(3, "user", "Four.")];
    const p = replyPrompt({ data: { ...newCard().data, name: "Mina" }, chat, persona, injected: [{ id: "t", position: "in_chat", depth: 2, role: "system", content: "It is night.", should_scan: false }] });
    const texts = p.messages.map((m) => (m.role === "tool" ? "" : m.text));
    expect(texts).toEqual(["[The roleplay begins.]", "One.", "Two.\n\nIt is night.", "Three.", "Four."]);
  });

  it("answers a card script's generateRaw with its own prompt order and the JSON schema", () => {
    const chat = [msg(0, "assistant", "Welcome."), msg(1, "user", "Coffee?")];
    const p = scriptPrompt({ data: card(), chat, persona }, "generateRaw", {
      ordered_prompts: [{ role: "system", content: "Keep the state." }, { role: "user", content: "Update for {{char}}." }],
      json_schema: { name: "x", value: { type: "object" } },
    });
    expect(p.system).toBe('Keep the state.\n\nAnswer with JSON only, no other text, matching this JSON Schema:\n{"type":"object"}');
    expect(p.messages).toEqual([{ role: "user", text: "Update for Mina." }]);
    const g = scriptPrompt({ data: card(), chat, persona }, "generate", { user_input: "Write a text from Mina." });
    const last = g.messages.at(-1)!;
    expect(last.role === "user" && last.text).toMatch(/<game_state>[\s\S]*Coffee\?\n\nWrite a text from Mina\.$/);
  });

  it("lets the auto-player see the story from {{user}}'s side, without the engine's blocks", () => {
    const chat = [msg(0, "assistant", "Welcome.\n<UpdateVariable>[]</UpdateVariable>\n<StatusPlaceHolderImpl/>"), msg(1, "user", '<action app="phone">{"to":"Rhea"}</action>\nHi'), msg(2, "assistant", "She smiles.")];
    const p = playerPrompt({ data: card(), chat, persona }, "try the phone");
    expect(p.system).toContain("You are playing Ash");
    expect(p.system).toContain("try the phone");
    expect(p.messages.map((m) => [m.role, m.role === "tool" ? "" : m.text])).toEqual([
      ["user", "Welcome."],
      ["assistant", '[on the phone app: {"to":"Rhea"}]\nHi'],
      ["user", "She smiles."],
    ]);
  });
});
