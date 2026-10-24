import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { applyMechanics, cleanModule, readMechanics } from "../../editor/mechanics";
import { readTracker } from "../../editor/trackers";
import { TrackersView } from "../trackers/TrackersView";
import { loadLibrary, saveToLibrary } from "../mechanics/library";

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
  useUi.setState({ section: "trackers" });
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
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mira");
});

const tool = (name: string, input: Record<string, unknown>): CompletionResult => ({
  text: "",
  stop: "tool_use",
  toolCalls: [{ id: name, name, input }],
});
const moduleInput = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  tag: name.toLowerCase(),
  summary: `${name} rules.`,
  rules: `Each spell costs 10 ${name}.`,
  example: `*Your ${name} drops to 40.*`,
  activation: "keyed",
  keys: ["spell"],
  secondary_keys: [],
  logic: "and_any",
  depth: 3,
  sticky: 2,
  cooldown: 0,
  group: "",
  exclude_recursion: false,
  prevent_recursion: false,
  priority: 4,
  tracked: [{ label: name, kind: "bar", start: "50", max: 50, rule: "Spells cost 10." }],
  images: [],
  ...extra,
});

async function openWizard() {
  render(<TrackersView />);
  fireEvent.click(screen.getByRole("tab", { name: "Mechanics" }));
  fireEvent.click(await screen.findByRole("button", { name: "✦ Game Wizard" }));
  return screen.getByRole("dialog", { name: "Game Wizard" });
}

describe("Game Wizard", () => {
  it("asks questions, writes a module with its tracker field and saves it to the library", async () => {
    const dialog = await openWizard();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "The mechanic" }), {
      target: { value: "mana for spells" },
    });
    script.replies.push(
      tool("ask_questions", {
        questions: [{ theme: "Limits", question: "What happens at 0?", suggestions: ["Spells fizzle", "Pass out"] }],
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Spells fizzle" }));
    expect(lastText(script.requests[0])).toContain("The mechanic I want: mana for spells");
    expect(script.requests[0].system).toContain("Game Wizard");

    script.replies.push(tool("write_module", moduleInput("Mana")));
    fireEvent.click(within(dialog).getByRole("button", { name: "Write the module" }));
    await within(dialog).findByText("No contradictions: the rules fit together.");
    expect(lastText(script.requests[1])).toContain("Q: What happens at 0?\nA: Spells fizzle");
    // Nothing to check against yet, so no second call.
    expect(script.requests).toHaveLength(2);
    expect(within(dialog).getByText(/When the chat mentions "spell", at depth 3/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /save it to my library/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to the card" }));
    expect(readMechanics(useEditor.getState().record!.card.data).map((m) => m.name)).toEqual(["Mana"]);
    expect(entries().find((e) => e.comment === "Mechanic: Mana")!.content).toContain("<mana>");
    expect(readTracker(useEditor.getState().record!.card.data)!.fields.map((f) => f.label)).toEqual(["Mana"]);
    await waitFor(async () => expect((await loadLibrary()).map((m) => m.name)).toEqual(["Mana"]));

    // The tracker shows the value as the mechanic's.
    fireEvent.click(screen.getByRole("tab", { name: "Status tracker" }));
    expect(screen.getByText(/Tracked for the Mana mechanic/)).toBeTruthy();
  });

  it("checks a new module against the others and rewrites it to fit", async () => {
    useEditor
      .getState()
      .replaceData(
        applyMechanics(useEditor.getState().record!.card.data, [
          cleanModule({ name: "Mana", rules: "Spells cost 10 Mana." }),
        ]),
      );
    const dialog = await openWizard();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "The mechanic" }), {
      target: { value: "cheap spells" },
    });
    script.replies.push(
      tool("write_module", moduleInput("Focus", { rules: "Spells are free." })),
      tool("report_conflicts", {
        conflicts: [
          {
            modules: ["Focus", "Mana"],
            problem: "Mana says spells cost 10; Focus says free.",
            fix: "Make Focus halve the cost.",
          },
        ],
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip the questions" }));
    await within(dialog).findByText(/Mana says spells cost 10/);
    expect(lastText(script.requests[1])).toContain('<new_module>\n<module name="Focus" tag="focus">');
    expect(lastText(script.requests[1])).toContain('<module name="Mana" tag="mana">');

    script.replies.push(
      tool("write_module", moduleInput("Focus", { rules: "Focus halves a spell's Mana cost." })),
      tool("report_conflicts", { conflicts: [] }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "✦ Rewrite it to fit" }));
    await within(dialog).findByText("No contradictions: the rules fit together.");
    expect(lastText(script.requests[2])).toContain(
      "Your last version contradicted the existing modules:\n- Mana says spells cost 10; Focus says free. Make Focus halve the cost.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to the card" }));
    expect(readMechanics(useEditor.getState().record!.card.data).map((m) => m.name)).toEqual(["Mana", "Focus"]);

    script.replies.push(tool("report_conflicts", { conflicts: [] }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Check for contradictions" }));
    await screen.findByText("No contradictions: the rules fit together.");
    expect(lastText(script.requests[4])).toContain("Check these modules against each other");
  });

  it("reuses a module from the library and edits its trigger by hand", async () => {
    await saveToLibrary(
      cleanModule({ name: "Corruption", rules: "Corruption rises with dark deeds.", keys: ["dark"] }),
    );
    render(<TrackersView />);
    fireEvent.click(screen.getByRole("tab", { name: "Mechanics" }));
    fireEvent.click(screen.getByRole("button", { name: "From my library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Corruption" }));
    const [m] = readMechanics(useEditor.getState().record!.card.data);
    expect(m.name).toBe("Corruption");
    expect(m.id).not.toBe((await loadLibrary())[0].id);
    fireEvent.change(screen.getByRole("combobox", { name: "Activation" }), { target: { value: "always" } });
    expect(entries().find((e) => e.comment === "Mechanic: Corruption")!.constant).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete module" }));
    expect(entries()).toEqual([]);
  });
});
