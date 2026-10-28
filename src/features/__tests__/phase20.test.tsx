import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";
import { loadModuleLibrary } from "../engine/moduleLibrary";

const data = () => useEditor.getState().record!.card.data;
const engine = () => readEngine(data())!;
const buttons = () => (data().extensions.tavern_helper as { scripts: { button: { buttons: { name: string }[] } }[] }).scripts[0].button.buttons.map((b) => b.name);

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mina");
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
});

describe("engine modules", () => {
  it("lists the core modules and turns one off", () => {
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    const list = screen.getByRole("list", { name: "Modules" });
    expect(within(list).getAllByText("Core")).toHaveLength(2);
    expect(buttons()).toEqual(["📊 Status", "⚙ Settings"]);
    const settingsRow = within(list).getByRole("button", { name: /Settings app/ }).closest("li")!;
    fireEvent.click(within(settingsRow).getByRole("checkbox", { name: "On" }));
    expect(buttons()).toEqual(["📊 Status"]);
  });

  it("sets the clock's start and adds a routine", () => {
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    fireEvent.click(screen.getByRole("button", { name: /In-game time/ }));
    fireEvent.change(screen.getByLabelText("Starting time"), { target: { value: "21:30" } });
    const weathers = screen.getByRole("textbox", { name: "Weathers, separated by commas" });
    fireEvent.change(weathers, { target: { value: "Clear, Ash," } });
    expect(weathers).toHaveValue("Clear, Ash,");
    expect(engine().modules!.find((m) => m.core === "time")!.settings.weathers).toEqual(["Clear", "Ash"]);
    fireEvent.click(screen.getByRole("button", { name: "Add a routine" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Who" }), { target: { value: "Mina" } });
    const time = engine().modules!.find((m) => m.core === "time")!;
    expect(time.settings).toMatchObject({ startClock: "21:30", routines: [{ npc: "Mina" }] });
    const initvar = data().character_book!.entries.find((e) => e.comment === "[initvar] Starting values")!;
    expect(initvar.content).toContain('Clock: "21:30"');
    expect(initvar.content).toContain("_PartOfDay: Night");
    expect(initvar.content).toContain("_Whereabouts:");
  });

  it("makes a module of the author's own, flags a clash and saves it to the library", async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    fireEvent.click(screen.getByRole("button", { name: "New module" }));
    expect(buttons()).toContain("✦ New module");
    fireEvent.change(screen.getByRole("textbox", { name: "Hub button" }), { target: { value: "⚙ Settings" } });
    expect(screen.getByRole("region", { name: "Conflicts" })).toHaveTextContent('Both use the hub button "⚙ Settings".');
    fireEvent.change(screen.getByRole("textbox", { name: "Hub button" }), { target: { value: "📱 Phone" } });
    expect(screen.queryByRole("region", { name: "Conflicts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save to my library" }));
    await waitFor(async () => expect((await loadModuleLibrary()).map((m) => m.button)).toEqual(["📱 Phone"]));
    expect(screen.getByText(/The card's engine script is/)).toBeInTheDocument();
  });
});

describe("engine look", () => {
  it("picks a preset, changes the accent and keeps the panel settings", () => {
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    fireEvent.click(screen.getByRole("radio", { name: /Fantasy parchment/ }));
    expect(engine().theme?.preset).toBe("parchment");
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    expect(engine().theme?.overrides.accent).toBe("#123456");
    fireEvent.click(screen.getByRole("button", { name: "Back to the preset's" }));
    expect(engine().theme?.overrides.accent).toBeUndefined();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Stats" } });
    expect(buttons()[0]).toBe("📊 Stats");
    expect(screen.getByTitle("Theme preview")).toBeInTheDocument();
    // The panel at its start, low and high states.
    expect(screen.getAllByTitle("Status panel preview")).toHaveLength(3);
  });
});
