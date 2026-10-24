import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import { applyArc, arcHidden, constantTokens, isArcEntry, newArc, readArc, type Arc } from "./arc";
import { emptyBook, newEntry, stDepth, stPosition } from "./lorebook";
import { findSlop } from "./slop";
import { estimateTokens } from "../lib/tokens";

const arc = (patch: Partial<Arc> = {}): Arc => ({
  ...newArc(),
  title: "The Drowned Bell",
  premise: "A bell rings under the harbour.",
  beats: [
    { title: "The bell", summary: "A bell rings at low tide.", direction: "Unease.", antagonist: "Holt listens." },
    { title: "The divers", summary: "Divers vanish.", direction: "Clues in the nets.", antagonist: "Holt bribes the watch." },
    { title: "The vault", summary: "The vault opens.", direction: "A shiver ran down her spine.", antagonist: "Holt strikes." },
  ],
  ending: "Ring the bell or sink it.",
  antagonist: {
    name: "Holt",
    role: "harbourmaster",
    age: "52",
    look: "salt-white beard",
    voice: "Speaks in tide tables.",
    goal: "Raise the drowned city.",
    methods: "The watch is his.",
    moves: "First watches, then frames {{user}}.",
    secret: "He can't swim.",
    aliases: "the harbourmaster, Old Holt",
  },
  ...patch,
});

describe("story arc", () => {
  it("writes the rules, one beat entry per beat and the antagonist", () => {
    const data = applyArc(newCard("Mira").data, arc());
    const entries = data.character_book!.entries;
    expect(entries.map((e) => e.comment)).toEqual([
      "Story arc: rules",
      "Story arc: beat 1",
      "Story arc: beat 2",
      "Story arc: beat 3",
      "Story arc: antagonist",
    ]);
    expect(entries.every(isArcEntry)).toBe(true);
    const [rules, b1, b2, b3, villain] = entries;
    expect(rules.constant).toBe(true);
    expect(rules.content).toContain("Difficulty: Obstacles are real but fair");
    expect(rules.content).toContain("Death: No one dies");
    expect(stPosition(rules)).toBe(4);
    expect(stDepth(rules)).toBe(4);
    // Beats share a group with prioritize on, and each later one waits longer, so the latest one wins.
    expect(b1.extensions).toMatchObject({ group: "story_arc", group_override: true, delay: 0 });
    expect(b2.extensions).toMatchObject({ group: "story_arc", delay: 20 });
    expect(b3.extensions).toMatchObject({ delay: 40 });
    expect(b3.insertion_order).toBeGreaterThan(b2.insertion_order);
    expect(b2.content).toBe(
      '<story_beat n="2" of="3" title="The divers">\nWhat happens: Divers vanish.\nHow to play it: Clues in the nets.\nHolt: Holt bribes the watch.\n</story_beat>',
    );
    expect(b3.content).toContain("Endings: Ring the bell or sink it.");
    // A hidden antagonist is always on; an active one comes up when named.
    expect(villain).toMatchObject({ constant: true, keys: ["Holt", "the harbourmaster", "Old Holt"] });
    expect(villain.content).toContain("Moves against {{user}}: First watches, then frames {{user}}.");
    const active = applyArc(data, arc({ settings: { ...newArc().settings, antagonist: "active", pacing: "fast" } }));
    expect(active.character_book!.entries.find((e) => e.comment === "Story arc: antagonist")!.constant).toBe(false);
    expect(active.character_book!.entries[3].extensions.delay).toBe(24);
    // Only one beat is in the prompt at a time, so only the longest counts as always on.
    const tokens = (i: number) => estimateTokens(entries[i].content);
    expect(constantTokens(entries)).toBe(tokens(0) + Math.max(tokens(1), tokens(2), tokens(3)) + tokens(4));
    const none = applyArc(data, arc({ settings: { ...newArc().settings, antagonist: "none" } }));
    expect(none.character_book!.entries.some((e) => e.comment === "Story arc: antagonist")).toBe(false);
  });

  it("rewrites its entries in place, keeps the user's, and removes everything", () => {
    const base = newCard("Mira").data;
    const own = newEntry(emptyBook(), { comment: "Docks", keys: ["docks"], content: "Wet." });
    base.character_book = { extensions: {}, entries: [own] };
    const once = applyArc(base, arc());
    const twice = applyArc(once, arc({ beats: arc().beats.slice(0, 2) }));
    expect(twice.character_book!.entries.map((e) => e.comment)).toEqual([
      "Docks",
      "Story arc: rules",
      "Story arc: beat 1",
      "Story arc: beat 2",
      "Story arc: antagonist",
    ]);
    expect(readArc(twice)!.beats).toHaveLength(2);
    const gone = applyArc(twice, undefined);
    expect(gone.character_book!.entries.map((e) => e.comment)).toEqual(["Docks"]);
    expect(readArc(gone)).toBeUndefined();
    expect(gone.extensions.cardforge).toBeUndefined();
  });

  it("keeps a secret arc out of the slop detector", () => {
    const hidden = applyArc(newCard("Mira").data, arc());
    expect(arcHidden(hidden)).toBe(true);
    expect(findSlop(hidden, ["shiver* * down * spine"])).toEqual([]);
    const shown = applyArc(hidden, arc({ hidden: false }));
    expect(findSlop(shown, ["shiver* * down * spine"]).map((h) => h.where)).toEqual(["Lorebook: Story arc: beat 3"]);
  });
});
