import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../ai/types";
import { EXAMPLES } from "../../engine/engineer/examples";
import { BUILT_IN_SKILLS, readDoc, readExample } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { WRITE_TOOLS } from "../../engine/engineer/tools";
import { applyOp, configFiles } from "../../engine/engineer/workspace";
import { cleanLiveFeeds, liveCadence, liveTokens, newLiveFeed } from "../../engine/modules/live";
import { modulePack, readPack } from "../../engine/modules/pack";
import { phoneModule } from "../../engine/modules/phone";
import { settingsAppModule } from "../../engine/modules/settingsApp";
import type { EngineModule, LiveFeed } from "../../engine/modules/types";
import { modulesOf, moduleRuntime, newModule } from "../../engine/modules/compile";
import { ModulesPage } from "../engine/ModulesPage";
import { newEngine, newVar, tavernHelperScript, type EngineConfig } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";

interface Item {
  from: string;
  text: string;
  messageId: number;
  fallback: boolean;
}
interface Kit {
  live: {
    feeds(): { id: string; name: string; on: boolean; tokens: number; every: number }[];
    items(id: string, o?: { messageId?: number; max?: number }): Item[];
    pending(id: string): boolean;
    feed(id: string, spec: Record<string, unknown>): void;
    run(id: string): Promise<{ from: string; text: string }[]>;
    on(fn: (d: Record<string, unknown>) => void): () => void;
  };
  frame(w: Window, o?: object): { live(id: string, o?: object): Item[] } & Record<string, unknown>;
  ui: { typing(label?: string): string };
}

const VARS = [
  newVar({ id: "mood", group: "Mina", name: "Mood", type: "choice", options: ["calm", "jealous"], start: "calm", rule: "" }),
  newVar({ id: "texts", group: "Phone", name: "Texts", type: "list", start: "", rule: "" }),
];

const feed = (patch: Partial<LiveFeed> = {}): LiveFeed =>
  newLiveFeed("Mina's texts", {
    id: "texts",
    enabled: true,
    every: 1,
    from: "Mina",
    pack: { voice: "Mina texting: lowercase, quick", tone: "warm", format: "a text message", length: "one line" },
    fallback: ["Mina: you up?"],
    ...patch,
  });

const textsModule = (live: LiveFeed[], script = ""): EngineModule => ({ ...newModule("Mina texts"), id: "mina-texts", live, script });

let tavern: ReturnType<typeof fakeTavern>;
let calls: Record<string, unknown>[];
let answer: () => unknown;

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

async function boot(
  live: LiveFeed[],
  o: { settings?: Record<string, unknown>; script?: string; messages?: { role: string; message: string }[]; extra?: EngineModule[] } = {},
) {
  const config: EngineConfig = { ...newEngine(), vars: VARS, modules: [textsModule(live, o.script), ...(o.extra ?? [])] };
  tavern = fakeTavern(o.messages ?? [{ role: "assistant", message: "Hi." }, { role: "user", message: "Hey." }, { role: "assistant", message: "She smiles and leaves." }]);
  tavern.scopes.chat = { cardforge: { settings: { ...o.settings } } };
  calls = [];
  answer = () => JSON.stringify({ items: [{ from: "Mina", text: "miss u already" }] });
  Object.assign(tavern.api, {
    generateRaw: async (options: Record<string, unknown>) => {
      // The replies here have no update block, so the engine asks a side call for one: not a feed's call.
      if ((options.json_schema as { name?: string } | undefined)?.name === "game_state_update") return JSON.stringify({ analysis: "", ops: [] });
      calls.push(options);
      const a = answer();
      if (a instanceof Error) throw a;
      return a;
    },
    toastr: { warning: () => {} },
  });
  await runScript(tavernHelperScript(config, "Mina").content, tavern);
  return tavern.globals.CardForge as Kit;
}

const reply = async (id: number) => {
  await tavern.api.eventEmit("character_message_rendered", id);
  await flush();
};
const stat = (id: number) => (tavern.vars[id] as { stat_data: Record<string, Record<string, unknown>> }).stat_data;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("living screens: the runtime", () => {
  it("writes a feed's items after a reply, keeps them on the message and puts them into the list value", async () => {
    const CF = await boot([feed({ into: "Phone.Texts" })]);
    await reply(1);
    await reply(2);
    expect(calls).toHaveLength(1);
    const call = calls[0] as { ordered_prompts: unknown[]; max_chat_history: number; should_silence: boolean };
    expect(call.should_silence).toBe(true);
    expect(call.max_chat_history).toBe(6);
    expect(call.ordered_prompts[1]).toBe("chat_history");
    expect(JSON.stringify(call.ordered_prompts[0])).toContain("Mina texting: lowercase, quick");
    const saved = (tavern.vars[2] as { cf_live: Record<string, { source: string; items: unknown[] }> }).cf_live.texts;
    expect(saved.source).toBe("She smiles and leaves.");
    expect(saved.items).toEqual([{ from: "Mina", text: "miss u already" }]);
    expect(stat(2).Phone.Texts).toEqual(["Mina: miss u already"]);
    expect(CF.live.items("texts")).toEqual([{ from: "Mina", text: "miss u already", messageId: 2, fallback: false }]);
  });

  it("doesn't pay twice for the same reply, and a re-read keeps the lines in the state", async () => {
    await boot([feed({ into: "Phone.Texts" })]);
    await reply(2);
    await tavern.api.eventEmit("message_edited", 2);
    await flush();
    expect(calls).toHaveLength(1);
    expect(stat(2).Phone.Texts).toEqual(["Mina: miss u already"]);
  });

  it("gives a reroll its own items, and swiping back brings the old ones", async () => {
    const CF = await boot([feed()]);
    await reply(2);
    const first = structuredClone(tavern.vars[2]);
    // A new swipe: new text, its own (empty) variables.
    tavern.messages[2].message = "She frowns at her phone.";
    tavern.vars[2] = {};
    answer = () => JSON.stringify({ items: [{ from: "Mina", text: "who was that girl" }] });
    await reply(2);
    expect(calls).toHaveLength(2);
    expect(CF.live.items("texts").map((i) => i.text)).toEqual(["who was that girl"]);
    tavern.messages[2].message = "She smiles and leaves.";
    tavern.vars[2] = first;
    expect(CF.live.items("texts").map((i) => i.text)).toEqual(["miss u already"]);
  });

  it("collects items across replies, oldest first, up to keep", async () => {
    const CF = await boot([feed({ keep: 2 })], {
      messages: [
        { role: "assistant", message: "Hi." },
        { role: "user", message: "a" },
        { role: "assistant", message: "one" },
        { role: "user", message: "b" },
        { role: "assistant", message: "two" },
        { role: "user", message: "c" },
        { role: "assistant", message: "three" },
      ],
    });
    let n = 0;
    answer = () => JSON.stringify({ items: [{ from: "Mina", text: `text ${++n}` }] });
    for (const id of [2, 4, 6]) {
      // Each reply is the latest when it arrives.
      const rest = tavern.messages.splice(id + 1);
      await reply(id);
      tavern.messages.push(...rest);
    }
    expect(calls).toHaveLength(3);
    expect(CF.live.items("texts").map((i) => i.text)).toEqual(["text 2", "text 3"]);
    expect(CF.live.items("texts", { messageId: 4, max: 5 }).map((i) => i.text)).toEqual(["text 1", "text 2"]);
    // The earlier items are shown to the model so it doesn't repeat them.
    expect(JSON.stringify(calls[2].ordered_prompts)).toContain("Mina: text 2");
  });

  it("runs every Nth reply, or when a value it follows changes", async () => {
    await boot([feed({ every: 0, on: ["Mina.Mood"] })]);
    await reply(2);
    expect(calls).toHaveLength(0);
    tavern.messages[2].message = "She glares. <UpdateVariable>\n_.set('Mina.Mood', 'jealous');\n</UpdateVariable>";
    await reply(2);
    expect(calls).toHaveLength(1);
  });

  it("waits for enough replies with every > 1", async () => {
    await boot([feed({ every: 3 })]);
    await reply(2);
    // The greeting and this reply: two of three.
    expect(calls).toHaveLength(0);
  });

  it("only runs for the latest reply", async () => {
    await boot([feed()], {
      messages: [
        { role: "assistant", message: "Hi." },
        { role: "user", message: "a" },
        { role: "assistant", message: "one" },
        { role: "user", message: "b" },
      ],
    });
    await reply(2);
    expect(calls).toHaveLength(0);
  });

  it("stays quiet with background generations off, or the feed turned off by the player", async () => {
    await boot([feed()], { settings: { sideCalls: false } });
    await reply(2);
    expect(calls).toHaveLength(0);
    const CF = await boot([feed()], { settings: { liveOff: ["texts"] } });
    await reply(2);
    expect(calls).toHaveLength(0);
    expect(CF.live.feeds()).toEqual([expect.objectContaining({ id: "texts", on: false })]);
  });

  it("uses a fallback line when the call fails, and reads prose answers as lines", async () => {
    const CF = await boot([feed()]);
    answer = () => new Error("offline");
    await reply(2);
    expect(CF.live.items("texts")).toEqual([{ from: "Mina", text: "you up?", messageId: 2, fallback: true }]);
    await boot([feed({ count: 2 })]);
    answer = () => "Mina: on my way\nMina: save me a seat\nMina: too many";
    await reply(2);
    expect((tavern.globals.CardForge as Kit).live.items("texts").map((i) => i.text)).toEqual(["on my way", "save me a seat"]);
  });

  it("drops items written for a reply that changed meanwhile", async () => {
    const CF = await boot([feed()]);
    let release: (v: string) => void = () => {};
    Object.assign(tavern.api, {});
    answer = () => new Promise<string>((r) => (release = r));
    const events: Record<string, unknown>[] = [];
    CF.live.on((d) => events.push(d));
    await tavern.api.eventEmit("character_message_rendered", 2);
    await flush();
    expect(CF.live.pending("texts")).toBe(true);
    tavern.messages[2].message = "A different swipe.";
    release(JSON.stringify({ items: [{ text: "late" }] }));
    await flush();
    expect(CF.live.pending("texts")).toBe(false);
    expect(CF.live.items("texts")).toEqual([]);
    expect(events.map((e) => e.pending)).toEqual([true, false]);
  });

  it("lists only the feeds that are on, and takes feeds added by a module's script", async () => {
    let CF = await boot([feed({ enabled: false })]);
    expect(CF.live.feeds()).toEqual([]);
    CF = await boot([], { script: 'CF.live.feed("rumours", { name: "Rumours", every: 1, pack: { voice: "tavern gossip" } });' });
    expect(CF.live.feeds().map((f) => f.id)).toEqual(["rumours"]);
    await reply(2);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].ordered_prompts)).toContain("tavern gossip");
  });

  it("CF.live.run writes new items for the latest reply on demand; screens read at their message", async () => {
    const CF = await boot([feed()]);
    await reply(2);
    answer = () => JSON.stringify({ items: [{ from: "Mina", text: "again" }] });
    const items = await CF.live.run("texts");
    expect(items).toEqual([{ from: "Mina", text: "again" }]);
    expect(calls).toHaveLength(2);
    const app = CF.frame(window, { messageId: 2 });
    expect(app.live("texts").map((i) => i.text)).toEqual(["again"]);
    expect(CF.ui.typing()).toContain('class="cf-typing"');
  });
});

describe("living screens: the feed format", () => {
  it("cleans feeds from untrusted JSON, off by default", () => {
    const [a, b] = cleanLiveFeeds([{ name: "Texts", count: 9, history: 1, every: -2, pack: { voice: "v", extra: 1 } }, { id: "texts" }, null]);
    expect(a).toMatchObject({ id: "texts", enabled: false, count: 5, history: 2, every: 0, pack: { voice: "v", tone: "", format: "", length: "" } });
    expect(b.id).toBe("texts-2");
  });

  it("estimates the tokens and says how often it runs", () => {
    const f = feed();
    expect(liveTokens(f)).toBeGreaterThan(1000);
    expect(liveTokens({ ...f, history: 2 })).toBeLessThan(liveTokens(f));
    expect(liveCadence(f)).toBe("after every reply");
    expect(liveCadence({ ...f, every: 3, on: ["Mina.Mood"] })).toBe("after every 3rd reply, or when Mina.Mood changes");
    expect(liveCadence({ ...f, every: 0 })).toMatch(/^never/);
  });
});

describe("living screens: the settings app", () => {
  it("lists the feeds that are on with their cost, and the player can turn one off", async () => {
    const CF = (await boot([feed()], { extra: [settingsAppModule()] })) as Kit & { mount(w: Window, id: string, el: Element): unknown };
    const el = document.createElement("div");
    document.body.appendChild(el);
    CF.mount(window, "settings", el);
    fireEvent.click(within(el).getByRole("tab", { name: "Generations" }));
    const box = within(el).getByRole("checkbox", { name: /Mina's texts/ });
    expect(box).toBeChecked();
    expect(el.textContent).toMatch(/About \d+ tokens, after each reply/);
    fireEvent.click(box);
    fireEvent.change(box);
    await flush();
    expect((tavern.scopes.chat as { cardforge: { settings: { liveOff: string[] } } }).cardforge.settings.liveOff).toEqual(["texts"]);
    await reply(2);
    expect(calls).toHaveLength(0);
  });
});

describe("living screens: the card, the engineer and the lint", () => {
  const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ id: name, name, input });
  const engine = (modules: EngineModule[]): EngineConfig => ({ ...newEngine(), vars: VARS, modules });

  it("compiles only the feeds that are on, with their cost, and keeps a built-in's feeds through a rebuild", () => {
    const config = engine([textsModule([feed(), feed({ id: "off", enabled: false })])]);
    const [m] = moduleRuntime(config);
    expect(m.live.map((f) => f.id)).toEqual(["texts"]);
    expect(m.live[0].tokens).toBe(liveTokens(feed()));
    const phone = { ...phoneModule(), live: [feed({ into: "Phone.Texts" })] };
    expect(modulesOf(engine([phone]))[0].live).toEqual(phone.live);
    const [back] = readPack(JSON.stringify(modulePack([phone])));
    expect(back.live).toEqual(phone.live);
  });

  it("set_live_feed adds, changes and removes a feed, off by default", () => {
    expect(WRITE_TOOLS.some((t) => t.name === "set_live_feed")).toBe(true);
    let c = engine([textsModule([])]);
    const added = applyOp(c, call("set_live_feed", { module: "mina-texts", id: "texts", name: "Mina's texts", pack: { voice: "lowercase", format: "a text" }, every: 3 }));
    expect(added.summary).toMatch(/Add the Mina's texts feed \(about \d+ tokens a run, off\)/);
    c = added.config;
    c = applyOp(c, call("set_live_feed", { module: "mina-texts", id: "texts", pack: { tone: "warm" }, enabled: true, into: "Phone.Texts" })).config;
    const f = c.modules![0].live![0];
    expect(f).toMatchObject({ enabled: true, every: 3, into: "Phone.Texts", pack: { voice: "lowercase", tone: "warm", format: "a text" } });
    expect(configFiles(c)["modules/mina-texts/manifest.json"]).toContain('"tokens_per_run"');
    expect(() => applyOp(c, call("set_live_feed", { module: "mina-texts", id: "news" }))).toThrow(/content pack/);
    expect(() => applyOp(c, call("set_live_feed", { module: "mina-texts", id: "news", remove: true }))).toThrow(/no feed "news"/);
    c = applyOp(c, call("set_live_feed", { module: "mina-texts", id: "texts", remove: true })).config;
    expect(c.modules![0].live).toEqual([]);
  });

  it("lints feeds: unknown values, no pack, never runs, unread, and screens reading a missing feed", () => {
    const reader = { ...newModule("Reader"), id: "reader", js: 'root.textContent = app.live("gossip").length + CF.live.items("texts").length;' };
    const findings = lintConfig(
      engine([
        textsModule([feed({ on: ["Mina.Nope"], into: "Mina.Mood", fallback: [] }), feed({ id: "quiet", enabled: true, every: 0, pack: { voice: "", tone: "", format: "", length: "" } })]),
        reader,
      ]),
    );
    const live = findings.filter((f) => f.check === "live" || f.check === "values").map((f) => f.message);
    expect(live).toEqual(
      expect.arrayContaining([
        expect.stringContaining('follows "Mina.Nope"'),
        expect.stringContaining('adds its items to "Mina.Mood", which isn\'t a list value'),
        expect.stringContaining("texts feed has no fallback lines"),
        expect.stringContaining("quiet feed has no content pack"),
        expect.stringContaining("quiet feed never runs"),
        expect.stringContaining("quiet feed is on, but no screen reads it"),
        expect.stringContaining('reads the "gossip" feed, but no module has it'),
        expect.stringMatching(/texts feed costs about \d+ tokens each run/),
      ]),
    );
    const off = lintConfig(engine([textsModule([feed({ enabled: false })]), reader])).map((f) => f.message);
    expect(off).toEqual(expect.arrayContaining([expect.stringContaining('reads the "texts" feed, which is off')]));
  });

  it("ships docs, a skill and two examples that lint clean", () => {
    const doc = readDoc("core-api#living-screens-cf-live")!;
    expect(doc).toContain("set_live_feed");
    expect(doc).toContain("app.live");
    expect(readDoc("tavern-helper#side-calls-background-generations")).toContain("living screen");
    expect(BUILT_IN_SKILLS.find((s) => s.id === "living-screens")!.title).toBe("Make a screen the story writes");
    for (const id of ["npc-texts", "town-news"]) {
      const m = EXAMPLES.find((e) => e.id === id)!;
      expect(m.live![0].enabled).toBe(false);
      expect(readExample(id)).toContain('name="live.json"');
      const bad = lintConfig({ ...newEngine(), modules: [{ ...m, tags: [] }] }).filter((f) => f.level !== "info");
      expect(bad).toEqual([]);
      expect(() => new Function("CF", "app", "root", "settings", m.js)).not.toThrow();
    }
  });

  it("the example screens draw their feed, with a typing dot while it writes", async () => {
    const m = EXAMPLES.find((e) => e.id === "town-news")!;
    const CF = (await boot([], { extra: [{ ...m, live: [{ ...m.live![0], enabled: true, every: 1 }] }] })) as Kit & { mount(w: Window, id: string, el: Element): unknown };
    const el = document.createElement("div");
    document.body.appendChild(el);
    CF.mount(window, "town-news", el);
    expect(el.textContent).toContain("No news yet");
    let release: (v: string) => void = () => {};
    answer = () => new Promise<string>((r) => (release = r));
    await reply(2);
    expect(el.querySelector(".cf-typing")).not.toBeNull();
    release(JSON.stringify({ items: [{ from: "", text: "Wolves at the Gate — The watch doubles its patrols." }] }));
    await flush(10);
    expect(el.querySelector(".cf-typing")).toBeNull();
    expect(el.querySelector(".nw-item h3")!.textContent).toBe("Wolves at the Gate");
    expect(stat(2).Town.News).toEqual(["Wolves at the Gate — The watch doubles its patrols."]);
  });
});

describe("living screens: the Modules tab", () => {
  it("adds a feed, off, shows its cost, and turns it on", () => {
    let config = { ...newEngine(), vars: VARS, modules: [{ ...newModule("Mina texts"), id: "mina-texts" }] };
    const save = vi.fn((c: EngineConfig) => {
      config = c as typeof config;
      view.rerender(<ModulesPage config={config} save={save} />);
    });
    const view = render(<ModulesPage config={config} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: /Mina texts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add a living screen" }));
    expect(config.modules[0].live).toHaveLength(1);
    expect(config.modules[0].live![0].enabled).toBe(false);
    const item = screen.getByRole("listitem", { name: "Feed Texts" });
    expect(within(item).getByTestId("live-cost").textContent).toMatch(/About [\d,]+ tokens each run, after every 2nd reply\./);
    fireEvent.change(within(item).getByLabelText("Voice"), { target: { value: "lowercase" } });
    fireEvent.change(within(item).getByLabelText("Also add to"), { target: { value: "Phone.Texts" } });
    fireEvent.click(within(item).getByRole("checkbox", { name: "On" }));
    expect(config.modules[0].live![0]).toMatchObject({ enabled: true, into: "Phone.Texts", pack: { voice: "lowercase" } });
  });
});
