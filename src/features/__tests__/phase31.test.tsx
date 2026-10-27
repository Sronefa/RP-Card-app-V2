import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { cardContext, settingsContext } from "../../ai/prompts";
import { useAiSettings } from "../../ai/settings";
import { applyEdit, planEdit, ToolInputError } from "../../ai/tools";
import { splitGreetingState, tiersEntryOf } from "../../ai/engineTools";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { newCard, type CardDataV3 } from "../../card";
import { changesText, logChange, readChanges } from "../../cowriter/changeLog";
import { gatherContext } from "../../cowriter/engine";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { engineReadyIssues } from "../../editor/engineReady";
import { useEditor } from "../../editor/store";
import { readEngine } from "../../engine/sheet";
import { ENGINEER_TOOLS, runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { CowriterPanel } from "../cowriter/CowriterPanel";

const script = vi.hoisted(() => ({
  replies: [] as CompletionResult[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      if (next.text) req.onText?.(next.text);
      return next;
    },
  }),
}));

let callId = 0;
const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input]) => ({ id: `c${++callId}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});
const call = (name: string, input: Record<string, unknown>) => ({ id: `t${++callId}`, name, input });
const apply = (d: CardDataV3, name: string, input: Record<string, unknown>) => applyEdit(d, planEdit(d, call(name, input)));

/** A card with one tracked number, Trust. */
function engineCard(): CardDataV3 {
  const d = newCard("Sera").data;
  d.first_mes = "Sera looks up from the fire.";
  return apply(d, "add_variable", { group: "Sera", name: "trust", type: "number", start: "20", min: 0, max: 100, rule: "" });
}

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useUi.setState({ cowriterTab: "chat" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "big-model" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
    },
  });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Sera");
});

describe("engine tools for the co-writer", () => {
  it("adds a value, turning the engine on, and refuses macros and duplicates", () => {
    const d = engineCard();
    const v = readEngine(d)!.vars.find((x) => x.name === "trust")!;
    expect(v).toMatchObject({ group: "Sera", type: "number", start: "20", max: 100 });
    expect(() => planEdit(d, call("add_variable", { group: "Sera", name: "Trust", type: "number" }))).toThrow(ToolInputError);
    expect(() => planEdit(d, call("add_variable", { group: "{{user}}", name: "gold", type: "number" }))).toThrow(/protagonist/);
    expect(() =>
      planEdit(d, call("add_variable", { name: "era", type: "text", read_only: true, rule: "changes at dawn" })),
    ).toThrow(/Read-only/);
  });

  it("writes tiers as a constant entry, sets rules, and gives a greeting its starting state", () => {
    let d = engineCard();
    d = apply(d, "set_update_rule", { variable: "Sera.trust", rule: "+3 to 6 when {{user}} keeps a promise; -10 on a lie" });
    expect(readEngine(d)!.vars.find((x) => x.name === "trust")!.rule).toMatch(/\+3 to 6/);
    d = apply(d, "write_tiers", {
      variable: "Sera.trust",
      tiers: [
        { from: 0, to: 30, name: "Wary", behavior: "Short answers." },
        { from: 31, to: 100, name: "Open", behavior: "Shares her past." },
      ],
      events: [{ at: "reaches 60", event: "She shows {{user}} the map." }],
    });
    const tiers = tiersEntryOf(d, "Sera.trust")!;
    expect(tiers.constant).toBe(true);
    expect(tiers.content).toContain("0 to 30, Wary: Short answers.");
    expect(tiers.content).toContain("When it reaches 60");
    d = apply(d, "set_greeting_state", { greeting: 0, state: { Sera: { trust: 5 } } });
    expect(splitGreetingState(d.first_mes)).toEqual({ prose: "Sera looks up from the fire.", state: "Sera:\n  trust: 5" });
    // A second state replaces the first rather than stacking.
    d = apply(d, "set_greeting_state", { greeting: 0, state: { Sera: { trust: 9 } } });
    expect(d.first_mes.match(/<initvar>/g)).toHaveLength(1);
    expect(() => planEdit(d, call("set_greeting_state", { greeting: 0, state: { Sera: { mood: "x" } } }))).toThrow(/No such values/);
  });

  it("shows the values to the co-writer and the engine guide in engine mode", () => {
    const text = cardContext(engineCard(), "character");
    expect(text).toContain("## engine values");
    expect(text).toMatch(/Sera\.trust.*no tiers yet/);
    expect(settingsContext({ engineMode: true } as never, [], "GUIDE TEXT")).toContain("GUIDE TEXT");
  });

  it("offers the engine tools in the chat once the engine is on", async () => {
    const d = engineCard();
    useEditor.getState().replaceData(d);
    await useCowriter.getState().load(useEditor.getState().record!.id);
    script.replies.push(reply("Done."));
    await useCowriter.getState().send("Plan the values");
    const names = script.requests[0].tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_variable", "set_update_rule", "write_tiers", "set_greeting_state"]));
  });
});

describe("engine-ready check", () => {
  it("flags missing rules, missing tiers, numbers in prose, macro names and depth", () => {
    let d = engineCard();
    d.description = "Sera is a ranger. Trust: 40 at the start.";
    d.extensions.cardforge = {
      ...(d.extensions.cardforge as object),
      engine: {
        ...readEngine(d)!,
        vars: [
          ...readEngine(d)!.vars,
          { id: "x", group: "{{user}}", name: "gold", type: "number", start: "0", rule: "+5 per job" },
          { id: "y", group: "World.Map", name: "pins", type: "list", start: "", rule: "Add a pin when a place is found, at most 8." },
        ],
      },
    };
    const messages = engineReadyIssues(d).map((i) => i.message);
    expect(messages.some((m) => /"Sera.trust" has no update rule/.test(m))).toBe(true);
    expect(messages.some((m) => /"Sera.trust" has no tiers/.test(m))).toBe(true);
    expect(messages.some((m) => /description states "Trust: 40"/.test(m))).toBe(true);
    expect(messages.some((m) => /macro in its name/.test(m))).toBe(true);
    expect(messages.some((m) => /more than one level deep/.test(m))).toBe(true);
    expect(engineReadyIssues(newCard("Plain").data)).toEqual([]);
    d = apply(d, "set_update_rule", { variable: "Sera.trust", rule: "goes up sometimes" });
    expect(engineReadyIssues(d).some((i) => /is vague/.test(i.message))).toBe(true);
  });

  it("wants every greeting to set its state once one does", () => {
    let d = engineCard();
    d.alternate_greetings = ["Rain on the roof."];
    expect(engineReadyIssues(d).some((i) => /No greeting sets its starting state/.test(i.message))).toBe(true);
    d = apply(d, "set_greeting_state", { greeting: 0, state: { Sera: { trust: 5 } } });
    expect(engineReadyIssues(d).map((i) => i.message)).toContain(
      "Alternate greeting 1 has no starting state, but other greetings do. It starts from the defaults.",
    );
  });
});

describe("shared change log", () => {
  it("keeps each side's accepted changes for the other", async () => {
    await logChange("card1", "cowriter", ["Rewrite the description"]);
    await logChange("card1", "engineer", ["Add the map screen", "Add value World.pins"]);
    const entries = await readChanges("card1");
    expect(entries.map((e) => e.by)).toEqual(["cowriter", "engineer", "engineer"]);
    expect(changesText(entries, "engineer")).toMatch(/Add the map screen\n.*Add value World.pins/);
    expect(changesText(entries, "cowriter", Date.now() + 1)).toBe("");
  });

  it("logs an accepted co-writer edit and shows engineer changes in the co-writer's context", async () => {
    const id = useEditor.getState().record!.id;
    useUi.setState({ section: "cowriter" });
    render(<CowriterPanel />);
    await useCowriter.getState().load(id);
    script.replies.push(reply("", [["set_field", { field: "scenario", text: "A ferry at dusk." }]]), reply("Done."));
    await useCowriter.getState().send("Write the scenario");
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(async () => expect((await readChanges(id)).map((e) => e.summary)).toHaveLength(1));
    expect((await readChanges(id))[0].by).toBe("cowriter");

    await logChange(id, "engineer", ["Add the map screen"]);
    const parts = await gatherContext(useEditor.getState().record!);
    expect(parts.find((p) => p.key === "engineer_changes")?.text).toContain("Add the map screen");
  });

  it("lets the engineer propose card text through the co-writer chat", async () => {
    expect(ENGINEER_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["set_field", "patch_field"]));
    const ctx = { data: engineCard(), draft: readEngine(engineCard())!, ops: [], skills: [] } as EngineerContext;
    const result = await runEngineerTool(ctx, call("patch_field", { field: "first_mes", find: "the fire", replace: "the status panel" }));
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/co-writer chat/);
    expect(ctx.cardCalls).toHaveLength(1);
  });
});
