import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { isKind, worldMeta } from "../../editor/world";
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

describe("NPC roster", () => {
  it("adds and edits an NPC as a lorebook entry, with a cast list", () => {
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    fireEvent.click(screen.getByRole("button", { name: "Add NPC" }));
    const page = screen.getByRole("region", { name: "NPCs" });
    fireEvent.change(within(page).getByRole("textbox", { name: "Name" }), { target: { value: "Ada" } });
    fireEvent.change(within(page).getByRole("textbox", { name: "Voice" }), { target: { value: "Loud, swears by her anvil." } });
    expect(entries()[0]).toMatchObject({ comment: "Ada", keys: ["Ada"], content: "Ada\nVoice: Loud, swears by her anvil." });
    fireEvent.click(within(page).getByRole("checkbox", { name: /Keep a cast list always on/ }));
    expect(entries().find((e) => isKind(e, "cast"))!.content).toContain("- Ada: Loud, swears by her anvil.");
    // The cast list is its own undo step.
    useEditor.getState().undo();
    expect(entries().some((e) => isKind(e, "cast"))).toBe(false);
  });

  it("adds NPCs the co-writer pitches", async () => {
    script.replies.push({
      text: "",
      stop: "tool_use",
      toolCalls: [
        {
          id: "c1",
          name: "pitch",
          input: {
            items: [
              { name: "Varen", role: "ferryman", age: "50s", look: "one ear", voice: "Counts coins aloud.", notes: "", aliases: "" },
              { name: "Lia", role: "smuggler", age: "30", look: "", voice: "Sings.", notes: "", aliases: "" },
            ],
          },
        },
      ],
    });
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask the co-writer" }), { target: { value: "someone at the docks" } });
    fireEvent.click(screen.getByRole("button", { name: "✦ Suggest NPCs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Varen" }));
    expect(worldMeta(entries()[0])).toMatchObject({ kind: "npc", fields: { name: "Varen", role: "ferryman" } });
    expect(screen.queryByRole("button", { name: "Add Varen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Lia" })).toBeInTheDocument();
    const req = script.requests[0];
    expect(req.system).toContain("filling in the world's pages");
    expect(req.tools[0].name).toBe("pitch");
    expect(lastText(req)).toContain("Pitch 3 NPCs. The user asks: someone at the docks");
    expect(lastText(req)).toContain("Silverwood");
  });
});

describe("economy", () => {
  it("keeps one currency and lists items and shops", async () => {
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "Economy" }));
    fireEvent.click(screen.getByRole("button", { name: "Add currency" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Currency" }), { target: { value: "crowns" } });
    expect(screen.queryByRole("button", { name: "Add currency" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Item" }), { target: { value: "Rope" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "2 shillings" } });
    await waitFor(() => expect(entries().map((e) => e.content)).toEqual(["Money: crowns.", "Rope: costs 2 shillings."]));
    fireEvent.click(screen.getByRole("tab", { name: "Entries" }));
    expect(screen.getAllByText("Rope").length).toBeGreaterThan(0);
  });
});
