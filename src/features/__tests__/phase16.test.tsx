import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { worldMeta } from "../../editor/world";
import { LorebookView } from "../lorebook/LorebookView";

const script = vi.hoisted(() => ({ replies: [] as CompletionResult[], requests: [] as CompletionRequest[] }));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      return next;
    },
  }),
}));

const entries = () => useEditor.getState().record!.card.data.character_book?.entries ?? [];
const lastText = (req: CompletionRequest) => (req.messages.at(-1) as { text: string }).text;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useUi.setState({ section: "lorebook" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "m" },
      modeModels: {},
      noToolModels: [],
      presets: [],
      imageStyles: [],
    },
  });
  const project = await createProject("P");
  const card = await createCard(project.id, "world");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Silverwood");
});

const tool = (name: string, input: Record<string, unknown>): CompletionResult => ({
  text: "",
  stop: "tool_use",
  toolCalls: [{ id: name, name, input }],
});
const npc = (name: string) => ({ name, role: "smuggler", age: "30s", look: "", voice: "Whispers.", notes: "", aliases: "" });

describe("NPC scan", () => {
  it("finds the card's NPCs and adds them all at once", async () => {
    useEditor.getState().setField("description", "Varen the ferryman and Lia the smuggler work the docks.");
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    script.replies.push(tool("pitch", { items: [npc("Varen"), npc("Lia")] }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Find NPCs in the card" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add all 2" }));
    expect(entries().map((e) => worldMeta(e)!.fields.name)).toEqual(["Varen", "Lia"]);
    expect(lastText(script.requests[0])).toContain("Find every character the card already establishes");
    expect(lastText(script.requests[0])).toContain("Varen the ferryman");

    script.replies.push(tool("pitch", { items: [] }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Find NPCs in the card" }));
    await screen.findByText("The card doesn't mention anyone who isn't on this page yet.");
    expect(lastText(script.requests[1])).toContain("Already on the NPC page: Varen, Lia.");
  });
});

describe("currency interview", () => {
  it("asks about the economy and the coin, then saves the currency", async () => {
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "Economy" }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Build it with an interview" }));
    const dialog = screen.getByRole("dialog", { name: "Build the currency" });
    script.replies.push(
      tool("ask_questions", { questions: [{ theme: "Coin", question: "What is the coin made of?", suggestions: ["Iron", "Glass"] }] }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Iron" }));
    expect(lastText(script.requests[0])).toContain("the coin itself");
    script.replies.push(
      tool("pitch", {
        items: [
          {
            name: "nails",
            units: "1 spike = 10 nails",
            wages: "A docker earns 6 nails a day; a meal costs 1.",
            economy: "The harbour guild mints them.",
            notes: "",
          },
        ],
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the currency" }));
    await within(dialog).findByRole("button", { name: "Use this currency" });
    expect(lastText(script.requests[1])).toContain("Q: What is the coin made of?\nA: Iron");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this currency" }));
    expect(entries().map((e) => e.content)).toEqual([
      '<currency name="nails">\nCoins: 1 spike = 10 nails\nWages and prices: A docker earns 6 nails a day; a meal costs 1.\nEconomy: The harbour guild mints them.\n</currency>',
    ]);
    // Doing it again replaces the currency instead of adding a second one.
    fireEvent.click(screen.getByRole("button", { name: "✦ Redo it with an interview" }));
    expect(screen.getByRole("dialog", { name: "Build the currency" })).toBeTruthy();
  });
});

describe("bulk items", () => {
  it("makes a batch to the chosen settings and adds the picked ones as tagged entries", async () => {
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "Economy" }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Make items in bulk" }));
    const dialog = screen.getByRole("dialog", { name: "Make items in bulk" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "What to make" }), { target: { value: "healing items" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "How many" }), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Price" }), { target: { value: "expensive" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Quality" }), { target: { value: "fine" } });
    const item = (name: string) => ({
      name,
      category: "healing",
      type: "item",
      price: "2 crowns",
      quality: "fine",
      rarity: "common",
      effect: "Closes a wound.",
      shop: "The Green Jar",
      notes: "",
      aliases: "",
    });
    script.replies.push(tool("pitch", { items: [item("Salve"), item("Tonic"), item("Poultice")] }));
    fireEvent.click(within(dialog).getByRole("button", { name: "✦ Make 3" }));
    await within(dialog).findByText("Tonic");
    const request = lastText(script.requests[0]);
    expect(request).toContain("Make 3 items: healing items.");
    expect(request).toContain("Price: expensive for the world");
    expect(request).toContain("Quality: fine quality.");
    expect(request).toContain('set type to "item"');
    fireEvent.click(within(dialog).getAllByRole("checkbox")[1]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 to the page" }));
    expect(entries().map((e) => worldMeta(e)!.fields.name)).toEqual(["Salve", "Poultice"]);
    expect(entries()[0].content).toBe(
      '<item name="Salve" category="healing" type="item" price="2 crowns" quality="fine" rarity="common">\nCloses a wound.\nSold at: The Green Jar\n</item>',
    );
  });
});
