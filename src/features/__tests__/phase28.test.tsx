import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { cardContext } from "../../ai/prompts";
import { useAiSettings } from "../../ai/settings";
import { applyEdit, describeEdit, planEdit, ToolInputError } from "../../ai/tools";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { newCard } from "../../card";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { applyArc, newArc } from "../../editor/arc";
import { emptyBook, newEntry } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { guessWorldKind, isKind, setCastList, worldEntry, worldMeta } from "../../editor/world";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { CowriterPanel } from "../cowriter/CowriterPanel";
import { LorebookView } from "../lorebook/LorebookView";

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
const data = () => useEditor.getState().record!.card.data;
const entries = () => data().character_book?.entries ?? [];

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

describe("typed world tools", () => {
  const card = () => {
    const d = newCard("Sera").data;
    let book = emptyBook();
    book = { ...book, entries: [worldEntry(book, "npc", { name: "Holt", role: "ferryman", voice: "Short." })] };
    book = setCastList(book, true);
    book.entries.push(newEntry(book, { comment: "The Oath", keys: ["oath"], content: "Sworn at dusk." }));
    d.character_book = book;
    return d;
  };

  it("adds NPCs, places, items and shops as world entries written from their fields", () => {
    let d = card();
    d = applyEdit(d, planEdit(d, call("add_npc", { name: "Mira", role: "smuggler", age: "30s", voice: "Fast.", why: "x" })));
    const mira = d.character_book!.entries.at(-1)!;
    expect(worldMeta(mira)).toEqual({ kind: "npc", fields: { name: "Mira", role: "smuggler", age: "30s", voice: "Fast." } });
    expect(mira.content).toBe("Mira (smuggler), 30s\nVoice: Fast.");
    // The cast list follows.
    expect(d.character_book!.entries.find((e) => isKind(e, "cast"))!.content).toContain("- Mira (smuggler): Fast.");

    const place = planEdit(d, call("add_place", { name: "Saltreach", mood: "damp" }));
    expect(describeEdit(place)).toBe('Add place "Saltreach"');
    const item = planEdit(d, call("add_item", { name: "Lamp oil", price: "2 pennies" }));
    expect(item.kind === "lore" && worldMeta(item.after!)?.kind).toBe("item");
    expect(() => planEdit(d, call("add_npc", { name: "mira" }))).toThrow(/already an NPC named mira .*update_world_entry/);
    expect(() => planEdit(d, call("add_shop", { name: " " }))).toThrow(ToolInputError);
  });

  it("changes world entries by their fields, never their text", () => {
    let d = card();
    const holt = d.character_book!.entries[0];
    d = applyEdit(d, planEdit(d, call("update_world_entry", { id: String(holt.id), fields: { age: "50s", aliases: "the old man" } })));
    const after = d.character_book!.entries[0];
    expect(worldMeta(after)!.fields).toMatchObject({ name: "Holt", role: "ferryman", age: "50s" });
    expect(after.content).toBe("Holt (ferryman), 50s\nVoice: Short.");
    expect(after.keys).toEqual(["Holt", "the old man"]);
    expect(() => planEdit(d, call("update_world_entry", { id: String(holt.id), fields: { mood: "x" } }))).toThrow(/no mood/);
    expect(() => planEdit(d, call("update_lore_entry", { id: String(holt.id), content: "x" }))).toThrow(/update_world_entry/);
    expect(() => planEdit(d, call("update_world_entry", { id: "2", fields: { name: "x" } }))).toThrow(/isn't an NPC/);
    // Settings that aren't written from the fields can still change.
    expect(planEdit(d, call("update_lore_entry", { id: String(holt.id), enabled: false }))).toBeTruthy();
  });

  it("shows world entries to the co-writer by kind and fields", () => {
    const text = cardContext(card(), "character");
    expect(text).toContain("[id 0] NPC: Holt\nname: Holt\nrole: ferryman\nvoice: Short.");
    expect(text).toContain("[id 2] The Oath\nkeys: oath\nSworn at dusk.");
  });

  it("guesses what a plain entry describes, only when it's clear", () => {
    expect(guessWorldKind("Mira", "Mira is a 30-year-old smuggler. She has green eyes and speaks fast.")).toBe("npc");
    expect(guessWorldKind("Saltreach", "A port town of narrow streets and a fish market by the docks.")).toBe("location");
    expect(guessWorldKind("The Oath", "Sworn at dusk by every knight of the order.")).toBeUndefined();
  });

  it("the UI engineer's world additions are checked against the card and kept for the co-writer chat", async () => {
    const ctx = { data: card(), draft: {}, ops: [], skills: [] } as unknown as EngineerContext;
    const ok = await runEngineerTool(ctx, call("add_npc", { name: "Kai", role: "fixer" }));
    expect(ok.content).toMatch(/Add NPC "Kai": proposed to the user in the co-writer chat/);
    const twin = await runEngineerTool(ctx, call("add_npc", { name: "Kai" }));
    expect(twin.isError).toBe(true);
    expect(ctx.cardCalls).toHaveLength(1);
  });
});

describe("the co-writer keeps people on the NPC page", () => {
  it("offers to save a plain entry that reads like a person as an NPC", async () => {
    script.replies.push(
      reply("Added her.", [
        ["add_lore_entry", { title: "Mira", keys: ["Mira", "the smuggler"], content: "Mira is a smuggler in her 30s. She speaks fast and trusts no one." }],
      ]),
      reply("Noted."),
    );
    render(<CowriterPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the co-writer" }), { target: { value: "Add Mira" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save as NPC" }));
    expect(screen.getByText(/Edit 1: Add NPC "Mira"/)).toBeInTheDocument();
    expect(screen.getByText(/On the NPCs page/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    const mira = entries().find((e) => e.comment === "Mira")!;
    expect(worldMeta(mira)).toEqual({
      kind: "npc",
      fields: { name: "Mira", notes: "Mira is a smuggler in her 30s. She speaks fast and trusts no one.", aliases: "the smuggler" },
    });
    expect(useCowriter.getState().chat!.unreported.join("\n")).toContain('filed edit 1 ("Mira") as an NPC');
  });

  it("after a turn, adds the names it mentioned to the world pages in one tap", async () => {
    script.replies.push(
      reply("Rewrote it.", [["set_field", { field: "scenario", text: "Sera waits at the docks of Saltreach, where Captain Orrin owes her money." }]]),
      reply("Done."),
      reply("", [
        [
          "file_world",
          {
            items: [
              { kind: "location", name: "Saltreach", mood: "salt-stung" },
              { kind: "npc", name: "Captain Orrin", role: "debtor" },
            ],
          },
        ],
      ]),
    );
    render(<CowriterPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message to the co-writer" }), { target: { value: "A scenario" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/This turn mentions 2 names with no lorebook entry: Saltreach, Captain Orrin/);
    fireEvent.click(screen.getByRole("button", { name: "✦ Add these 2 as NPCs, places or items" }));
    await screen.findByText(/Edit 3: Add NPC "Captain Orrin"/);
    expect(screen.getByText(/Edit 2: Add place "Saltreach"/)).toBeInTheDocument();
    expect(script.requests[2].tools.map((t) => t.name)).toEqual(["file_world"]);
    const scan = script.requests[2].messages.at(-1)!;
    expect(scan.role === "user" && scan.text).toContain("Captain Orrin owes her");
    // Covered now, so the offer is gone.
    expect(screen.queryByText(/This turn mentions/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept all 3 edits" }));
    expect(entries().map((e) => worldMeta(e)?.kind)).toEqual(["location", "npc"]);
  });
});

describe("Sort my lorebook", () => {
  beforeEach(() => {
    const book = emptyBook();
    book.entries.push(newEntry(book, { comment: "Mira", keys: ["Mira"], content: "Mira is a smuggler. She is in her 30s and speaks fast." }));
    book.entries.push(newEntry(book, { comment: "The Oath", keys: ["oath"], content: "Sworn at dusk." }));
    book.entries.push(worldEntry(book, "npc", { name: "Holt" }));
    useEditor.getState().replaceData({ ...data(), character_book: book });
  });

  it("files plain entries under their pages with the co-writer, after review", async () => {
    script.replies.push(
      reply("", [
        [
          "file_world",
          {
            items: [
              { id: "0", kind: "npc", name: "Mira", age: "30s", voice: "Fast.", notes: "A smuggler." },
              { id: "1", kind: "other" },
            ],
          },
        ],
      ]),
    );
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Sort my lorebook" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/2 entries are plain text/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "✦ Sort with the co-writer" }));
    await within(dialog).findByText("Mira");
    const sent = script.requests[0].messages[0];
    expect(sent.role === "user" && sent.text).toContain('<entry id="0" title="Mira" keys="Mira">');
    expect(sent.role === "user" && sent.text).not.toContain(`<entry id="2"`);
    fireEvent.click(within(dialog).getByRole("button", { name: "Move 1 entry" }));
    const mira = entries()[0];
    expect(mira.id).toBe(0);
    expect(worldMeta(mira)).toEqual({ kind: "npc", fields: { name: "Mira", age: "30s", voice: "Fast.", notes: "A smuggler." } });
    expect(entries()[1].content).toBe("Sworn at dusk.");
    // Only The Oath is plain now.
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    expect(screen.getByRole("button", { name: /Mira/ })).toBeInTheDocument();
  });

  it("has a quick sort without AI, and the page can be changed before moving", async () => {
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Sort my lorebook" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Quick sort without AI" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Page for Mira" }), { target: { value: "location" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move 1 entry" }));
    expect(worldMeta(entries()[0])).toEqual({
      kind: "location",
      fields: { name: "Mira", details: "Mira is a smuggler. She is in her 30s and speaks fast." },
    });
    expect(script.requests).toHaveLength(0);
  });
});

describe("the antagonist on the NPC page", () => {
  it("is listed from the story arc, masked while the arc is secret", async () => {
    const arc = {
      ...newArc(),
      title: "T",
      beats: [{ title: "B", summary: "", direction: "", antagonist: "" }],
      antagonist: { name: "Vale", role: "the regent", age: "", look: "", voice: "", goal: "", methods: "", moves: "", secret: "", aliases: "" },
    };
    useEditor.getState().replaceData(applyArc(data(), arc));
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    expect(screen.getByText("kept secret by the story arc")).toBeInTheDocument();
    expect(screen.queryByText("Vale")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /The antagonist/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Story arc" })).toHaveAttribute("aria-selected", "true"));

    useEditor.getState().replaceData(applyArc(data(), { ...arc, hidden: false }));
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    expect(screen.getByText("Vale")).toBeInTheDocument();
  });
});
