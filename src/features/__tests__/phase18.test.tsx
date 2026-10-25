import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { addAddon, applyTracker, newTracker, readTracker } from "../../editor/trackers";
import { NOTE, readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

const data = () => useEditor.getState().record!.card.data;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mina");
});

describe("Immersive Engine section", () => {
  it("turns the engine on, edits a value and writes it into the card", () => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    expect(readEngine(data())?.vars.map((v) => v.name)).toEqual(["Health"]);
    expect(data().creator_notes).toContain(NOTE);
    const helper = data().extensions.tavern_helper as { scripts: { name: string }[] };
    expect(helper.scripts.map((s) => s.name)).toEqual(["CardForge engine"]);

    fireEvent.click(screen.getByRole("button", { name: "Add a value" }));
    const values = screen.getByRole("list", { name: "Values" });
    fireEvent.change(within(values).getByRole("textbox", { name: "Name" }), { target: { value: "Gold" } });
    fireEvent.change(within(values).getByRole("textbox", { name: "Starts at" }), { target: { value: "25" } });
    fireEvent.click(within(values).getByRole("checkbox", { name: /Hidden from the AI/ }));
    const engine = readEngine(data())!;
    expect(engine.vars[1]).toMatchObject({ group: "Player", name: "Gold", start: "25", hidden: true });
    const initvar = data().character_book!.entries.find((e) => e.comment === "[initvar] Starting values")!;
    expect(initvar.content).toBe("Player:\n  Health: 100\n  $Gold: 25");
    expect(screen.getByText(/What the model is told/)).toBeInTheDocument();
  });

  it("flags a name that can't be a path", () => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("button", { name: /^Player\.Health/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "HP.max" } });
    expect(screen.getByText("Names can't contain . [ ] / ~ or quotes.")).toBeInTheDocument();
  });

  it("starts from the status tracker and turns the tracker off", () => {
    useEditor.getState().replaceData(applyTracker(data(), addAddon(newTracker(), "stats")));
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Start from the status tracker" }));
    expect(readEngine(data())?.vars.map((v) => `${v.group}.${v.name}`)).toEqual(["Player.Health", "Player.Stamina"]);
    expect(readTracker(data())).toBeUndefined();
    // One undo brings the tracker back and takes the engine out.
    useEditor.getState().undo();
    expect(readTracker(data())).toBeDefined();
  });

  it("runs a sample reply through the updater", () => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("tab", { name: "Test a reply" }));
    fireEvent.change(screen.getByRole("textbox", { name: "A reply" }), {
      target: {
        value:
          'Ouch.\n<UpdateVariable><JSONPatch>[{ "op": "delta", "path": "/Player/Health", "value": -130 }, { "op": "replace", "path": "/Player/_Nope", "value": 1 }]</JSONPatch></UpdateVariable>',
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run the update" }));
    const result = screen.getByRole("region", { name: "Result" });
    // The schema clamps Health at its lowest value.
    expect(within(result).getByText(/100 → 0/)).toBeInTheDocument();
    expect(within(result).getByRole("list", { name: "Skipped" })).toHaveTextContent("read-only field");
    expect(within(result).getByTitle("Status panel preview")).toBeInTheDocument();
  });

  it("turns the engine off again", () => {
    render(<EngineView />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn the engine off" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn it off" }));
    expect(readEngine(data())).toBeUndefined();
    expect(data().extensions.tavern_helper).toBeUndefined();
    expect(data().creator_notes).toBe("");
  });
});
