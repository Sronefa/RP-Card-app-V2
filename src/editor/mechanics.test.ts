import { describe, expect, it } from "vitest";
import { newCard } from "../card";
import { stDepth, stPosition } from "./lorebook";
import {
  activeText,
  applyMechanics,
  cleanModule,
  galleryImages,
  isMechanicEntry,
  moduleText,
  moduleTips,
  newModule,
  readMechanics,
  setTips,
  stImagePath,
} from "./mechanics";
import { readTracker, regexScripts } from "./trackers";

const mana = () =>
  newModule({
    name: "Mana",
    tag: "mana",
    summary: "Spells cost mana.",
    rules: "Each spell costs 10 Mana. At 0 Mana, spells fizzle and {{user}} feels hollow.",
    example: "*The ward flickers as your Mana drops to 30.*",
    activation: "keyed",
    keys: ["spell", "cast"],
    secondaryKeys: ["dream"],
    logic: 2,
    depth: 2,
    sticky: 3,
    cooldown: 1,
    group: "mode",
    priority: 5,
    tracked: [{ label: "Mana", kind: "bar", start: "50", max: 50, rule: "Spells cost 10; rest restores it." }],
  });

describe("mechanics", () => {
  it("writes a module as one tagged entry at depth with its trigger setup", () => {
    const data = applyMechanics(newCard("Mira").data, [mana()]);
    const entry = data.character_book!.entries.find(isMechanicEntry)!;
    expect(entry.content).toBe(
      "<mechanics>\n<mana>\nEach spell costs 10 Mana. At 0 Mana, spells fizzle and {{user}} feels hollow.\nExample: *The ward flickers as your Mana drops to 30.*\n</mana>\n</mechanics>",
    );
    expect(entry).toMatchObject({
      comment: "Mechanic: Mana",
      keys: ["spell", "cast"],
      secondary_keys: ["dream"],
      selective: true,
      constant: false,
      insertion_order: 650,
    });
    expect(stPosition(entry)).toBe(4);
    expect(stDepth(entry)).toBe(2);
    expect(entry.extensions).toMatchObject({ role: 0, selectiveLogic: 2, sticky: 3, cooldown: 1, group: "mode" });
    expect(activeText(mana())).toBe(
      'When the chat mentions "spell" or "cast" but none of "dream", at depth 2. Stays for 3 messages after that. Then rests for 1 message. Only one "mode" module at a time.',
    );
    expect(readMechanics(data)).toHaveLength(1);
  });

  it("adds tracked values to the status tracker and removes them with the module", () => {
    const data = applyMechanics(newCard("Mira").data, [mana()]);
    const tracker = readTracker(data)!;
    expect(tracker.fields).toMatchObject([{ label: "Mana", kind: "bar", start: "50", max: 50, addon: "mechanic" }]);
    expect(regexScripts(data)).toHaveLength(2);
    expect(data.character_book!.entries.some((e) => e.comment === "Status block rules")).toBe(true);
    // Rewriting keeps the field's id, so the tracker isn't churned.
    const again = applyMechanics(data, readMechanics(data));
    expect(readTracker(again)!.fields[0].id).toBe(tracker.fields[0].id);
    const gone = applyMechanics(data, []);
    expect(readTracker(gone)).toBeUndefined();
    expect(regexScripts(gone)).toEqual([]);
    expect(gone.character_book!.entries).toEqual([]);
    expect(gone.extensions.cardforge).toBeUndefined();
  });

  it("keeps the user's own tracker fields", () => {
    const base = newCard("Mira").data;
    base.extensions.cardforge = {
      tracker: {
        tag: "status",
        accent: "#fff",
        scriptIds: [],
        fields: [{ id: "h", label: "Health", kind: "bar", start: "100", max: 100, rule: "", addon: "stats" }],
      },
    };
    const data = applyMechanics(base, [mana()]);
    expect(readTracker(data)!.fields.map((f) => f.label)).toEqual(["Health", "Mana"]);
    expect(readTracker(applyMechanics(data, []))!.fields.map((f) => f.label)).toEqual(["Health"]);
  });

  it("flags modules that go against the attention best practices", () => {
    const data = newCard("Mira").data;
    expect(moduleTips(mana(), data)).toEqual([]);
    const bad = newModule({
      name: "Bad",
      tag: "bad",
      rules: "Never do this. Don't do that. Avoid the other.",
      depth: 0,
    });
    expect(moduleTips(bad, data)).toEqual([
      "It has no keys, so it never comes up. Add keys or make it always on.",
      "Depth 0 is for the user's message and post-history instructions. Use depth 1 or deeper.",
      'Mostly "don\'t" rules. Say what to do instead; models follow positive, concrete rules better.',
      "Add a one-line example of correct output.",
    ]);
    const always = (tag: string) => newModule({ tag, activation: "always" });
    expect(setTips([always("a"), always("b"), always("c"), always("a")])).toEqual([
      "4 modules are always on. Keep few rules constant and let situational ones come up with their keys.",
      "More than one module uses the tag <a>. Each module needs its own tag.",
    ]);
  });

  it("cleans up modules from the co-writer", () => {
    const m = cleanModule({
      name: "Dark Corruption!",
      depth: 99,
      priority: 0,
      logic: 7,
      tracked: [{ label: " ", kind: "bar", start: "", rule: "" }],
    });
    expect(m).toMatchObject({ tag: "dark_corruption", depth: 20, priority: 1, logic: 0, tracked: [] });
  });

  it("finds where SillyTavern serves a CHARX image and shows it from a module", () => {
    const asset = {
      type: "other",
      uri: "embeded://assets/other/image/Sword Icon.PNG",
      name: "Sword Icon!",
      ext: "PNG",
    };
    expect(stImagePath("Mira: the Ranger", asset)).toBe("/user/images/Mira%20the%20Ranger/sword_icon.png");
    expect(stImagePath("Mira", { ...asset, type: "background" })).toBeUndefined();
    expect(stImagePath("Mira", { ...asset, type: "icon" })).toBeUndefined();
    expect(stImagePath("Mira", { ...asset, uri: "https://x/y.png" })).toBeUndefined();
    const data = { ...newCard("Mira").data, assets: [asset] };
    expect(galleryImages(data).map((g) => g.path)).toEqual(["/user/images/Mira/sword_icon.png"]);
    const text = moduleText({ ...mana(), images: [{ uri: asset.uri, when: "when a sword is drawn" }] }, data);
    expect(text).toContain('- when a sword is drawn: <img src="/user/images/Mira/sword_icon.png" width="240">');
  });
});
