import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newCard } from "../../card";
import { parseRegex } from "../../editor/trackers";
import { readDoc } from "../../engine/engineer/knowledge";
import { settingsAppModule } from "../../engine/modules/settingsApp";
import { applyEngine, engineRegex, newEngine, newVar, tavernHelperScript, UPDATING_FOLD, type EngineConfig } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";

const VARS = [newVar({ group: "Player", name: "Gold", type: "number", start: "12", min: 0 })];
const config = (patch: Partial<EngineConfig> = {}): EngineConfig => ({ ...newEngine(), vars: VARS, ...patch });

const block = (ops: string) => `<UpdateVariable><JSONPatch>[${ops}]</JSONPatch></UpdateVariable>`;
const gold = (n: number) => `{ "op": "delta", "path": "/Player/Gold", "value": ${n} }`;
const STORY = "She counts the coins on the table, one by one, and slides them back.";

type Entry = { name: string; enabled: boolean; strategy: { type: string; keys: string[] }; content: string };
type Msg = { role: string; message: string; swipe_id?: number };
let tavern: ReturnType<typeof fakeTavern>;
let calls: { ordered_prompts: { content: string }[] }[];
let answer: () => Promise<string> | string;
let dates: string[];
let lore: Entry[];
let updating: { messageId: number; on: boolean }[];

const entry = (name: string, content: string, type = "selective", keys: string[] = []): Entry => ({
  name,
  enabled: true,
  strategy: { type, keys },
  content,
});

async function boot(messages: Msg[], cfg = config(), settings: Record<string, unknown> = {}) {
  tavern = fakeTavern(messages);
  tavern.scopes.chat = { cardforge: { settings } };
  calls = [];
  updating = [];
  lore = [];
  dates = messages.map((_, i) => `2026-10-28 10:0${i}`);
  answer = () => JSON.stringify({ analysis: "", ops: [] });
  Object.assign(tavern.api, {
    generateRaw: async (options: (typeof calls)[number]) => {
      calls.push(options);
      return answer();
    },
    getCharWorldbookNames: () => ({ primary: "Harbor", additional: [] }),
    getWorldbook: async () => lore,
    toastr: { warning: () => {} },
    SillyTavern: { getCurrentChatId: () => "chat-1", getContext: () => ({ chat: dates.map((send_date) => ({ send_date })) }) },
  });
  await runScript(tavernHelperScript(cfg).content, tavern);
  (tavern.listeners["cf:updating"] ??= []).push((e) => void updating.push(e as (typeof updating)[number]));
}

async function add(role: "user" | "assistant", message: string) {
  tavern.messages.push({ role, message });
  tavern.vars.push({});
  dates.push(`2026-10-28 11:${String(tavern.messages.length).padStart(3, "0")}`);
  await tavern.api.eventEmit(role === "user" ? "user_message_rendered" : "character_message_rendered", tavern.messages.length - 1);
}

type Vars = { stat_data?: { Player: { Gold: number } }; cf_trimmed?: boolean; cf_key?: string; cf_out?: string };
const vars = (id: number) => tavern.vars[id] as Vars;
const goldAt = (id: number) => vars(id).stat_data!.Player.Gold;
const CF = () => tavern.globals.CardForge as {
  state: { rebuild: () => Promise<void>; redo: () => Promise<void>; get: (path: string, id?: number) => unknown };
};
const sideTurn = (i = calls.length - 1) => calls[i].ordered_prompts[1].content;

beforeEach(() => boot([{ role: "assistant", message: "Welcome to the harbor." }]));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("the side call's prompt", () => {
  it("reads the card's lore that is on, without the engine's own or the story-only entries", async () => {
    lore = [
      entry("World", "The harbor smells of tar.", "constant"),
      entry("The Gull", "The Gull is a tavern run by Old Brannoc.", "selective", ["gull"]),
      entry("The bell", "The bell tower rings at noon.", "selective", ["bell"]),
      entry("Smugglers", "Smugglers pay in silver.", "selective", ["/smuggl(er|ing)/i"]),
      entry("[mvu_plot] Twist", "Brannoc is the smuggler king.", "constant"),
      entry("[initvar] Starting values", "Player: {}", "constant"),
      entry("Game state", "{{format_message_variable::stat_data}}", "constant"),
      { ...entry("Off", "Never read.", "constant"), enabled: false },
    ];
    await add("user", "I walk into the Gull.");
    await add("assistant", `${STORY} A smuggler waves.`);
    const turn = sideTurn();
    const read = /<lore>\n([\s\S]*?)\n<\/lore>/.exec(turn)![1];
    expect(read).toBe("The harbor smells of tar.\n\nThe Gull is a tavern run by Old Brannoc.\n\nSmugglers pay in silver.");
    expect(turn.indexOf("<lore>")).toBeLessThan(turn.indexOf("<game_state>"));
  });

  it("reads the two messages before the reply", async () => {
    await add("user", "I pay for a room.");
    await add("assistant", `${STORY}\n${block(gold(-2))}`);
    await add("user", "I ask about the bell.");
    await add("assistant", STORY);
    const turn = sideTurn();
    expect(turn).toMatch(/<earlier>\n\{\{char\}\}: She counts the coins[^<]*\n<\/earlier>/);
    expect(turn).toContain("<latest_turn>\n{{user}}: I ask about the bell.\n\n{{char}}: " + STORY + "\n</latest_turn>");
    expect(turn).not.toContain("I pay for a room.");
    expect(turn).not.toContain("UpdateVariable");
  });

  it("says when it starts and ends, and folds a line under the message while it runs", async () => {
    document.body.innerHTML = '<div id="chat"><div class="mes" mesid="2"><div class="mes_text">Text</div></div></div>';
    let seen = "";
    answer = () => {
      seen = document.querySelector(".mes_text")!.innerHTML;
      return JSON.stringify({ analysis: "", ops: [] });
    };
    await add("user", "Hello.");
    await add("assistant", STORY);
    expect(updating).toEqual([
      { messageId: 2, on: true },
      { messageId: 2, on: false },
    ]);
    expect(seen).toContain("Updating the game state…");
    expect(document.querySelector(".cf-updating")).toBeNull();
  });
});

describe("the streaming fold", () => {
  const regex = (name: RegExp) => {
    const script = engineRegex(config()).find((s) => name.test(s.scriptName))!;
    return { find: parseRegex(script.findRegex)!, replace: script.replaceString, script };
  };

  it("hides an update block still being written behind a fold, and leaves the panel", () => {
    const fold = regex(/fold the update/);
    expect(fold.script).toMatchObject({ markdownOnly: true, promptOnly: false });
    expect(`${STORY}\n<UpdateVariable><JSONPatch>[{ "op"`.replace(fold.find, fold.replace)).toBe(`${STORY}\n${UPDATING_FOLD}`);
    expect(`${STORY}\n<UpdateVariable>[\n\n<StatusPlaceHolderImpl/>`.replace(fold.find, fold.replace)).toBe(
      `${STORY}\n${UPDATING_FOLD}<StatusPlaceHolderImpl/>`,
    );
    expect(STORY.replace(fold.find, fold.replace)).toBe(STORY);
  });

  it("runs after the closed blocks are hidden, so a whole block never shows the fold", () => {
    const names = engineRegex(config()).map((s) => s.scriptName);
    expect(names.indexOf("CardForge engine: fold the update while it streams")).toBeGreaterThan(names.indexOf("CardForge engine: hide update blocks"));
    const hide = regex(/hide update blocks/);
    const fold = regex(/fold the update/);
    const whole = `${STORY}\n${block(gold(1))}`;
    expect(whole.replace(hide.find, hide.replace).replace(fold.find, fold.replace)).toBe(`${STORY}\n`);
  });

  it("keeps a cut-off block out of the prompt", () => {
    const prompt = regex(/out of the prompt$/);
    expect(prompt.script.findRegex).not.toBe("/<StatusPlaceHolderImpl\\/>/g");
    const cut = `${STORY}\n<UpdateVariable><JSONPatch>[${gold(-9)}]`;
    expect(cut.replace(prompt.find, "")).toBe(`${STORY}\n`);
  });
});

describe("the repair buttons", () => {
  it("rebuild the values from the chat", async () => {
    await add("user", "Pay.");
    await add("assistant", `${STORY}\n${block(gold(-2))}`);
    await add("user", "Pay more.");
    await add("assistant", `${STORY}\n${block(gold(-3))}`);
    // Something wrote over the values (another script, a bad import).
    vars(2).stat_data!.Player.Gold = 99;
    vars(4).stat_data!.Player.Gold = 98;
    await CF().state.rebuild();
    expect(goldAt(2)).toBe(10);
    expect(goldAt(4)).toBe(7);
  });

  it("redo asks a new side call even when an answer is kept", async () => {
    answer = () => JSON.stringify({ analysis: "", ops: [{ op: "delta", path: "/Player/Gold", value: -1 }] });
    await add("user", "Pay.");
    await add("assistant", STORY);
    expect(goldAt(2)).toBe(11);
    expect(calls).toHaveLength(1);
    answer = () => JSON.stringify({ analysis: "", ops: [{ op: "delta", path: "/Player/Gold", value: -4 }] });
    await CF().state.redo();
    expect(calls).toHaveLength(2);
    expect(goldAt(2)).toBe(8);
    // The new answer is the one kept: a re-read doesn't ask again.
    await tavern.api.eventEmit("message_edited", 2);
    expect(calls).toHaveLength(2);
    expect(goldAt(2)).toBe(8);
  });

  it("are in the settings app", () => {
    const js = settingsAppModule().js;
    expect(js).toContain("data-rebuild");
    expect(js).toContain("CF.state.rebuild()");
    expect(js).toContain("CF.state.redo()");
    expect(js).toContain('check("trimOld"');
  });
});

describe("keeping long chats small", () => {
  /** A chat of `turns` paid turns after the greeting: message 2n holds 12 + n gold. */
  async function play(turns: number) {
    for (let n = 1; n <= turns; n++) {
      await add("user", `Turn ${n}.`);
      await add("assistant", `${STORY}\n${block(gold(1))}`);
    }
  }

  it("clears the values from old messages, and keeps the greeting, a snapshot every 50 and the last 30", async () => {
    await play(41);
    const last = tavern.messages.length - 1;
    expect(last).toBe(82);
    for (let i = 1; i <= last - 30; i++) {
      if (i === 50) continue;
      expect(vars(i).stat_data, `message ${i}`).toBeUndefined();
      expect(vars(i)).toMatchObject({ cf_trimmed: true, cf_key: expect.any(String), cf_out: expect.any(String) });
    }
    expect(goldAt(0)).toBe(12);
    expect(goldAt(50)).toBe(37);
    for (let i = last - 29; i <= last; i++) expect(vars(i).stat_data, `message ${i}`).toBeDefined();
    expect(goldAt(last)).toBe(53);
  });

  it("shows an old message the nearest snapshot before it", async () => {
    await play(41);
    expect(CF().state.get("Player.Gold", 51)).toBe(37);
    expect(CF().state.get("Player.Gold", 20)).toBe(12);
  });

  it("rebuilds from the snapshot when an old message is edited", async () => {
    await play(41);
    tavern.messages[20].message = `${STORY}\n${block(gold(5))}`;
    await tavern.api.eventEmit("message_edited", 20);
    // Every message after it moved up by 4.
    expect(goldAt(50)).toBe(41);
    expect(goldAt(82)).toBe(57);
    expect(vars(30).stat_data).toBeUndefined();
  });

  it("stays off when the player turns it off or keeps every panel live", async () => {
    await boot([{ role: "assistant", message: "Welcome." }], config(), { trimOld: false });
    await play(17);
    expect(vars(1).stat_data).toBeDefined();
    await boot([{ role: "assistant", message: "Welcome." }], config(), { livePanels: 0 });
    await play(17);
    expect(vars(1).stat_data).toBeDefined();
  });
});

describe("the docs", () => {
  it("explain the repair buttons, the fold and the trimming", () => {
    expect(readDoc("core-api")).toContain("CF.state.rebuild()");
    expect(readDoc("tavern-helper")).toContain("snapshot every 50");
    expect(readDoc("rp-guide")).toContain("Rebuild from the chat");
  });

  it("put the card's lore names on the engine's own list", () => {
    const data = applyEngine(newCard().data, config());
    const script = (data.extensions.tavern_helper as { scripts: { content: string }[] }).scripts[0].content;
    expect(script).toContain('"ownLore":["[initvar] Starting values","[mvu_update] Update rules","Game state","[mvu_update] Format reminder"]');
  });
});
