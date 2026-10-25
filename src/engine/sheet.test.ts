import { describe, expect, it } from "vitest";
import { z } from "zod";
import { newCard } from "../card";
import { applyTracker, addAddon, newTracker } from "../editor/trackers";
import { panelHtml } from "./panel";
import {
  applyEngine,
  initialState,
  NOTE,
  newEngine,
  newVar,
  readEngine,
  rulesText,
  tavernHelperScript,
  varsFromTracker,
  type EngineConfig,
} from "./sheet";

const config = (): EngineConfig => ({
  ...newEngine(),
  vars: [
    newVar({ group: "Player", name: "Health", type: "number", start: "80", min: 0, max: 100, rule: "Drops when hurt." }),
    newVar({ group: "Player", name: "Gold", type: "number", start: "12" }),
    newVar({ name: "Secret", type: "text", start: "the key is under the bell", hidden: true }),
  ],
});

/** A stand-in for Tavern Helper: a chat whose messages keep variables per message, and the events. */
function fakeTavern(messages: { role: string; message: string }[]) {
  const vars: Record<string, unknown>[] = messages.map(() => ({}));
  const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const globals: Record<string, unknown> = {};
  const id = (option: { message_id?: number | "latest" }) =>
    option.message_id === "latest" || option.message_id === undefined ? messages.length - 1 : option.message_id;
  const api = {
    z,
    YAML: { parse: (s: string) => JSON.parse(s) },
    getVariables: (o: { message_id?: number }) => structuredClone(vars[id(o)]),
    replaceVariables: (v: Record<string, unknown>, o: { message_id?: number }) => (vars[id(o)] = structuredClone(v)),
    updateVariablesWith: async (fn: (v: Record<string, unknown>) => Record<string, unknown>, o: { message_id?: number }) =>
      (vars[id(o)] = fn(structuredClone(vars[id(o)]))),
    getChatMessages: (i: number) => (messages[i] ? [{ message_id: i, ...messages[i] }] : []),
    setChatMessages: async (changes: { message_id: number; message?: string }[]) => {
      for (const c of changes) if (c.message !== undefined) messages[c.message_id].message = c.message;
    },
    getLastMessageId: () => messages.length - 1,
    getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    getWorldbook: async () => [],
    eventOn: (name: string, fn: (...args: unknown[]) => unknown) => (listeners[name] ??= []).push(fn),
    eventEmit: async (name: string, ...args: unknown[]) => {
      for (const fn of listeners[name] ?? []) await fn(...args);
    },
    tavern_events: {
      MESSAGE_RECEIVED: "message_received",
      MESSAGE_SENT: "message_sent",
      MESSAGE_EDITED: "message_edited",
      MESSAGE_SWIPED: "message_swiped",
      CHAT_CHANGED: "chat_id_changed",
    },
    initializeGlobal: (name: string, value: unknown) => (globals[name] = value),
    registerVariableSchema: () => {},
    console: { info: () => {}, warn: console.warn, error: console.error },
  };
  return { api, vars, messages, listeners, globals };
}

async function runScript(source: string, tavern: ReturnType<typeof fakeTavern>) {
  const names = Object.keys(tavern.api);
  new Function(...names, source)(...names.map((n) => tavern.api[n as keyof typeof tavern.api]));
  // Let the start-up initialization finish.
  await new Promise((r) => setTimeout(r, 0));
}

describe("the engine in the card", () => {
  it("writes the script, lorebook entries, regex and the Tavern Helper note", () => {
    const data = applyEngine(newCard().data, config());
    expect(readEngine(data)?.vars).toHaveLength(3);
    expect(data.creator_notes).toBe(NOTE);
    const entries = data.character_book!.entries;
    expect(entries.map((e) => [e.comment, e.enabled, e.constant ?? false])).toEqual([
      ["[initvar] Starting values", false, false],
      ["[mvu_update] Update rules", true, true],
      ["Game state", true, true],
      ["[mvu_update] Format reminder", true, true],
    ]);
    expect(entries[0].content).toBe("Player:\n  Health: 80\n  Gold: 12\n$Secret: the key is under the bell");
    expect(entries[2].content).toContain("{{format_message_variable::stat_data}}");
    const helper = data.extensions.tavern_helper as { scripts: { name: string; enabled: boolean; type: string }[] };
    expect(helper.scripts).toEqual([expect.objectContaining({ type: "script", name: "CardForge engine", enabled: true })]);
    expect((data.extensions.regex_scripts as unknown[]).length).toBe(4);
  });

  it("keeps the AI from seeing hidden fields and explains the format", () => {
    const text = rulesText(config());
    expect(text).toContain("- Player.Health (number, 0 to 100): Drops when hurt.");
    expect(text).not.toContain("Secret");
    expect(text).toContain('{ "op": "delta", "path": "/Player/Health", "value": -5 }');
    expect(text).toContain("<UpdateVariable>");
  });

  it("replaces itself on re-apply and takes everything out again", () => {
    const card = newCard().data;
    const withOther = {
      ...card,
      creator_notes: "Play slow.",
      extensions: { tavern_helper: { scripts: [{ type: "script", id: "mine", name: "My script" }], variables: {} } },
    };
    const once = applyEngine(withOther, config());
    const twice = applyEngine(once, { ...readEngine(once)!, reminder: false });
    expect(twice.character_book!.entries).toHaveLength(3);
    expect((twice.extensions.regex_scripts as unknown[]).length).toBe(4);
    expect((twice.extensions.tavern_helper as { scripts: unknown[] }).scripts).toHaveLength(2);
    expect(twice.creator_notes).toBe(`${NOTE}\n\nPlay slow.`);
    const off = applyEngine(twice, undefined);
    expect(off.character_book!.entries).toHaveLength(0);
    expect(off.extensions.regex_scripts).toBeUndefined();
    expect((off.extensions.tavern_helper as { scripts: { id: string }[] }).scripts.map((s) => s.id)).toEqual(["mine"]);
    expect(off.creator_notes).toBe("Play slow.");
    expect(readEngine(off)).toBeUndefined();
  });

  it("keeps the panel free of what SillyTavern's regex would replace", () => {
    const html = panelHtml({ ...config(), vars: [...config().vars, newVar({ name: "$1 odd {{name}}" })] });
    expect(html).not.toMatch(/\$\d|\$<|\{\{/);
    // Tavern Helper reads the code block's text, which decodes entities.
    expect(html).not.toMatch(/&[a-z]+;|&#/i);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("imports the status tracker", () => {
    const tracker = addAddon(addAddon(newTracker(), "stats"), "relationship");
    const data = applyTracker(newCard().data, tracker);
    const vars = varsFromTracker(tracker);
    expect(vars.map((v) => [v.group, v.name, v.type])).toEqual([
      ["Player", "Health", "number"],
      ["Player", "Stamina", "number"],
      ["Relationship", "Affection", "number"],
      ["Relationship", "Stage", "choice"],
    ]);
    expect(initialState({ ...newEngine(), vars })).toEqual({
      Player: { Health: 100, Stamina: 100 },
      Relationship: { Affection: 10, Stage: "Strangers" },
    });
    expect(data.extensions.cardforge).toBeDefined();
  });
});

describe("the engine script in a chat", () => {
  it("starts the state on the greeting and updates it after each reply", async () => {
    const tavern = fakeTavern([{ role: "assistant", message: "Welcome to the inn." }]);
    await runScript(tavernHelperScript(config()).content, tavern);
    expect(tavern.vars[0]).toMatchObject({ stat_data: { Player: { Health: 80, Gold: 12 } } });
    expect(tavern.globals.Mvu).toBeDefined();

    tavern.messages.push({ role: "user", message: "I buy a drink." });
    tavern.vars.push({});
    await tavern.api.eventEmit("message_sent", 1);
    tavern.messages.push({
      role: "assistant",
      message: 'You pay.\n<UpdateVariable><JSONPatch>[{ "op": "delta", "path": "/Player/Gold", "value": -2 }]</JSONPatch></UpdateVariable>',
    });
    tavern.vars.push({});
    await tavern.api.eventEmit("message_received", 2);
    expect(tavern.vars[2]).toMatchObject({ stat_data: { Player: { Gold: 10 } }, delta_data: { "Player.Gold": [12, 10] } });
    expect(tavern.messages[2].message).toMatch(/<StatusPlaceHolderImpl\/>$/);

    // A swipe is a new reply from the same state, so it starts again from 12.
    tavern.messages[2].message = '<UpdateVariable><JSONPatch>[{ "op": "delta", "path": "/Player/Gold", "value": -5 }]</JSONPatch></UpdateVariable>';
    tavern.vars[2] = {};
    await tavern.api.eventEmit("message_received", 2);
    expect(tavern.vars[2]).toMatchObject({ stat_data: { Player: { Gold: 7 } } });

    const mvu = tavern.globals.Mvu as { getMvuData: (o: object) => { stat_data: unknown } };
    expect(mvu.getMvuData({ type: "message", message_id: 2 }).stat_data).toMatchObject({ Player: { Gold: 7 } });
  });

  it("takes the greeting's own <initvar> start", async () => {
    const tavern = fakeTavern([{ role: "assistant", message: 'Rich start.\n<initvar>{ "Player": { "Gold": 500 } }</initvar>' }]);
    await runScript(tavernHelperScript(config()).content, tavern);
    expect(tavern.vars[0]).toMatchObject({ stat_data: { Player: { Health: 80, Gold: 500 } } });
  });
});
