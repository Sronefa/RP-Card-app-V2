import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newCard, type CardDataV3 } from "../../card";
import { lintConfig } from "../../engine/engineer/lint";
import { readDoc } from "../../engine/engineer/knowledge";
import { newModule } from "../../engine/modules/compile";
import type { EngineModule } from "../../engine/modules/types";
import { replyPrompt } from "../../engine/playtest/prompt";
import { applyEngine, newEngine, newVar, readEngine, rulesText, tavernHelperScript, type EngineConfig } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";
import { useEditor } from "../../editor/store";
import { EngineView } from "../engine/EngineView";

const VARS = [
  newVar({ group: "Player", name: "Health", type: "number", start: "80", min: 0, max: 100 }),
  newVar({ group: "Player", name: "Gold", type: "number", start: "12", min: 0 }),
  newVar({ group: "Player", name: "Luck", type: "number", start: "0" }),
];

/** A module whose update hook rolls a number on each reply, the way a weather or loot roll would. */
const dice: EngineModule = {
  ...newModule("Dice"),
  id: "dice",
  script: 'hooks.afterUpdate(function (stat, before, info) { if (info.role === "assistant") stat.Player.Luck = Math.floor(info.random() * 1e6); return stat; });',
};

const config = (patch: Partial<EngineConfig> = {}): EngineConfig => ({ ...newEngine(), vars: VARS, modules: [dice], ...patch });

const block = (ops: string) => `<UpdateVariable><JSONPatch>[${ops}]</JSONPatch></UpdateVariable>`;
const gold = (n: number) => `{ "op": "delta", "path": "/Player/Gold", "value": ${n} }`;
const STORY = "She counts the coins on the table, one by one, and slides them back.";

type Msg = { role: string; message: string; swipe_id?: number };
let tavern: ReturnType<typeof fakeTavern>;
let calls: { ordered_prompts: { content: string }[] }[];
let answer: () => Promise<string> | string;
let toasts: string[];
let chatId: string;
let dates: string[];

async function boot(messages: Msg[], cfg = config(), settings: Record<string, unknown> = {}) {
  tavern = fakeTavern(messages);
  tavern.scopes.chat = { cardforge: { settings } };
  calls = [];
  toasts = [];
  chatId = "chat-1";
  dates = messages.map((_, i) => `2026-10-28 10:0${i}`);
  answer = () => JSON.stringify({ analysis: "", ops: [] });
  Object.assign(tavern.api, {
    generateRaw: async (options: (typeof calls)[number]) => {
      calls.push(options);
      return answer();
    },
    toastr: { warning: (text: string) => toasts.push(text) },
    SillyTavern: { getCurrentChatId: () => chatId, getContext: () => ({ chat: dates.map((send_date) => ({ send_date })) }) },
  });
  await runScript(tavernHelperScript(cfg).content, tavern);
}

/** Adds a message and lets the engine read it, as SillyTavern does once it renders. */
async function add(role: "user" | "assistant", message: string) {
  tavern.messages.push({ role, message });
  tavern.vars.push({});
  dates.push(`2026-10-28 11:${String(tavern.messages.length).padStart(2, "0")}`);
  await tavern.api.eventEmit(role === "user" ? "user_message_rendered" : "character_message_rendered", tavern.messages.length - 1);
}

const stat = (id: number) => (tavern.vars[id] as { stat_data: { Player: Record<string, number>; _PlayerEdits?: string[] } }).stat_data;
const plain = (id: number) => tavern.messages[id].message.replace("\n\n<StatusPlaceHolderImpl/>", "");
const CF = () => tavern.globals.CardForge as {
  state: { set: (p: string, v: unknown, note?: string) => Promise<unknown>; reset: () => Promise<void> };
  updateMode: () => { mode: string; card: string; locked: boolean };
};

beforeEach(() => boot([{ role: "assistant", message: "Welcome to the inn." }]));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("a reply without a usable update", () => {
  it("gets a side call when it has no block, and none when it has one", async () => {
    answer = () => JSON.stringify({ analysis: "paid", ops: [{ op: "delta", path: "/Player/Gold", value: -2 }] });
    await add("user", "I buy a drink.");
    await add("assistant", STORY);
    expect(calls).toHaveLength(1);
    expect(calls[0].ordered_prompts[1].content).toContain(STORY);
    expect(stat(2).Player.Gold).toBe(10);
    await add("user", "Another.");
    await add("assistant", `${STORY}\n${block(gold(-3))}`);
    expect(calls).toHaveLength(1);
    expect(stat(4).Player.Gold).toBe(7);
  });

  it("drops a block cut off at the length limit and asks the side call instead", async () => {
    answer = () => JSON.stringify({ analysis: "", ops: [{ op: "delta", path: "/Player/Gold", value: -1 }] });
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n<UpdateVariable><JSONPatch>[${gold(-9)}]</JSONPatch>`);
    expect(calls).toHaveLength(1);
    expect(stat(2).Player.Gold).toBe(11);
  });

  it("drops a cut-off block even with background generations off, and keeps a whole one", async () => {
    await boot([{ role: "assistant", message: "Welcome." }], config(), { sideCalls: false });
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n<UpdateVariable><JSONPatch>[${gold(-9)}]</JSONPatch>`);
    expect(calls).toHaveLength(0);
    expect(stat(2).Player.Gold).toBe(12);
    await add("user", "Pay again.");
    await add("assistant", `Short.\n${block(gold(-2))}`);
    expect(stat(4).Player.Gold).toBe(10);
  });

  it("asks again when every change was rejected, and tells the player what the schema turned away", async () => {
    await add("user", "Heal me.");
    await add("assistant", `${STORY}\n${block('{ "op": "replace", "path": "/Player/Health", "value": { "a": 1 } }')}`);
    expect(calls).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/^A game-state change didn't fit the card's rules and was skipped: .*Health.*Reroll if the values look wrong\.$/);
  });
});

describe("the player's edits", () => {
  it("are kept on the message and survive a re-read", async () => {
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n${block(gold(-2))}`);
    await CF().state.set("Player.Gold", 50, "found a purse");
    expect(stat(2).Player.Gold).toBe(50);
    expect((tavern.vars[2] as { cf_edits: unknown[] }).cf_edits).toEqual([{ changes: [[["Player", "Gold"], 50]], note: "found a purse" }]);
    // Something makes SillyTavern read the message again: the edit stays.
    tavern.messages[2].message = `${STORY} She smiles.\n${block(gold(-4))}`;
    await tavern.api.eventEmit("message_edited", 2);
    expect(stat(2).Player.Gold).toBe(50);
    expect(stat(2)._PlayerEdits).toEqual(["Player.Gold: 8 → 50 (found a purse)"]);
  });

  it("start over with a reset that also survives a re-read", async () => {
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n${block(gold(-2))}`);
    await CF().state.set("Player.Health", 5);
    await CF().state.reset();
    expect((tavern.vars[2] as { cf_edits: unknown[] }).cf_edits).toEqual([{ reset: true }]);
    await tavern.api.eventEmit("message_edited", 2);
    expect(stat(2).Player).toMatchObject({ Health: 80, Gold: 12 });
    expect(stat(2)._PlayerEdits).toEqual(["The player reset every value to the start."]);
  });
});

describe("replaying the chat", () => {
  async function story() {
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n${block(gold(-2))}`);
    await add("user", "Pay more.");
    await add("assistant", `${STORY}\n${block(gold(-3))}`);
    expect(stat(4).Player.Gold).toBe(7);
  }

  it("rebuilds the messages after an edited one", async () => {
    await story();
    tavern.messages[2].message = `${STORY}\n${block(gold(-5))}`;
    await tavern.api.eventEmit("message_edited", 2);
    expect(stat(2).Player.Gold).toBe(7);
    expect(stat(4).Player.Gold).toBe(4);
  });

  it("rebuilds the messages that moved up after a delete", async () => {
    await story();
    tavern.messages.splice(1, 2);
    tavern.vars.splice(1, 2);
    dates.splice(1, 2);
    await tavern.api.eventEmit("message_deleted", tavern.messages.length);
    expect(plain(2)).toBe(`${STORY}\n${block(gold(-3))}`);
    expect(stat(2).Player.Gold).toBe(9);
  });

  it("catches a swipe whose text no longer matches its state", async () => {
    await story();
    // Deleting a swipe in SillyTavern can move another swipe's text in while the old variables stay.
    tavern.messages[4].message = `${STORY}\n${block(gold(-1))}`;
    await tavern.api.eventEmit("message_swiped", 4);
    expect(stat(4).Player.Gold).toBe(9);
    // A swipe that still matches is left alone.
    const kept = structuredClone(tavern.vars[4]);
    await tavern.api.eventEmit("message_swiped", 4);
    expect(tavern.vars[4]).toEqual(kept);
  });

  it("doesn't write a late answer onto another swipe or chat", async () => {
    let release: (v: string) => void = () => {};
    answer = () => new Promise<string>((r) => (release = r));
    await add("user", "Pay.");
    const pending = add("assistant", STORY);
    await new Promise((r) => setTimeout(r, 0));
    tavern.messages[2].swipe_id = 1;
    release(JSON.stringify({ analysis: "", ops: [{ op: "delta", path: "/Player/Gold", value: -2 }] }));
    await pending;
    expect(tavern.vars[2]).toEqual({});

    tavern.messages[2].swipe_id = undefined;
    answer = () => new Promise<string>((r) => (release = r));
    const again = tavern.api.eventEmit("character_message_rendered", 2);
    await new Promise((r) => setTimeout(r, 0));
    chatId = "chat-2";
    release(JSON.stringify({ analysis: "", ops: [] }));
    await again;
    expect(tavern.vars[2]).toEqual({});
  });

  it("rolls the same numbers when a message is read again, and new ones for a new message", async () => {
    await add("user", "Roll.");
    await add("assistant", `${STORY}\n${block(gold(-1))}`);
    const luck = stat(2).Player.Luck;
    expect(luck).toBeGreaterThan(0);
    await tavern.api.eventEmit("message_edited", 2);
    expect(stat(2).Player.Luck).toBe(luck);
    await add("user", "Again.");
    await add("assistant", `${STORY}\n${block(gold(-1))}`);
    expect(stat(4).Player.Luck).not.toBe(luck);
  });
});

describe("who writes the updates", () => {
  const lists = () => ({
    globalLore: [{ comment: "World" }],
    characterLore: [{ comment: "[mvu_update] Update rules" }, { comment: "Game state" }, { comment: "[mvu_update] Format reminder" }],
  });

  it("lets the player switch a card to the side call, which keeps the rules out of the story's prompt", async () => {
    await boot([{ role: "assistant", message: "Welcome." }], config(), { updateMode: "side" });
    expect(CF().updateMode()).toMatchObject({ mode: "side", card: "reply", locked: false });
    const l = lists();
    await tavern.api.eventEmit("worldinfo_entries_loaded", l);
    expect(l.characterLore.map((e) => e.comment)).toEqual(["Game state"]);
    expect(l.globalLore).toHaveLength(1);
    await add("user", "Pay.");
    await add("assistant", STORY);
    expect(calls).toHaveLength(1);
  });

  it("keeps the card's choice when the card locks it", async () => {
    await boot([{ role: "assistant", message: "Welcome." }], config({ lockUpdateMode: true }), { updateMode: "side" });
    expect(CF().updateMode()).toMatchObject({ mode: "reply", locked: true });
    const l = lists();
    await tavern.api.eventEmit("worldinfo_entries_loaded", l);
    expect(l.characterLore).toHaveLength(3);
  });

  it("is locked in the editor, and the playtest prompt follows the mode", () => {
    const data = applyEngine({ ...newCard().data, name: "Mina" }, config({ updateMode: "side" }));
    const persona = { name: "Ash", description: "" };
    const chat = [{ id: 0, role: "assistant" as const, name: "Mina", message: "Hi.", swipe_id: 0, swipes: 1, variables: {} }];
    expect(replyPrompt({ data, chat, persona }).lore).not.toContain("[mvu_update] Update rules");
    expect(replyPrompt({ data, chat, persona, updateMode: "reply" }).lore).toContain("[mvu_update] Update rules");
    const locked = applyEngine(data, { ...readEngine(data)!, lockUpdateMode: true });
    expect(replyPrompt({ data: locked, chat, persona, updateMode: "reply" }).lore).not.toContain("[mvu_update] Update rules");

    useEditor.setState({ record: { id: "c", projectId: "p", kind: "character", card: { spec: "chara_card_v3", spec_version: "3.0", data } } as never });
    render(<EngineView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Lock this choice/ }));
    expect(readEngine(useEditor.getState().record!.card.data as CardDataV3)!.lockUpdateMode).toBe(true);
  });
});

describe("the update prompt", () => {
  it("caps the analysis, says old blocks are hidden on purpose, and puts the state at depth 0", () => {
    const text = rulesText(config());
    expect(text).toContain("At most 80 words: how much time passed, then each value checked against its rule, using only this reply.");
    expect(text).toContain("The blocks from earlier replies are hidden from you on purpose");
    const book = applyEngine(newCard().data, config()).character_book!.entries;
    const depth = (name: string) => (book.find((e) => e.comment === name)!.extensions as { depth?: number }).depth;
    expect(depth("Game state")).toBe(0);
    expect(depth("[mvu_update] Format reminder")).toBe(0);
  });
});

describe("the engineer's guidance", () => {
  it("warns about unseeded rolls in an update hook", () => {
    const warn = (script: string) =>
      lintConfig(config({ modules: [{ ...dice, script }] })).filter((f) => /update hook uses Math.random/.test(f.message)).length;
    expect(warn(dice.script)).toBe(0);
    expect(warn("hooks.afterUpdate(function (stat) { stat.Player.Luck = Math.random(); return stat; });")).toBe(1);
  });

  it("documents the update fixes and the troubleshooting list", () => {
    const guide = readDoc("rp-guide")!;
    expect(guide).toContain("## When the update goes wrong");
    expect(guide).toContain("hidden from the model on purpose");
    expect(readDoc("core-api")).toContain("info.random()");
    expect(readDoc("tavern-helper")).toContain("CHARACTER_MESSAGE_RENDERED");
  });
});
