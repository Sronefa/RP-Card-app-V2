import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { worldEntry } from "../../editor/world";
import { TITLE_TAG } from "../../engine/modules/title";
import { readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

const data = () => useEditor.getState().record!.card.data;
const engine = () => readEngine(data())!;
const ids = () => engine().modules!.map((m) => m.id);

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Port Noir");
  useEditor.getState().setField("first_mes", "The rain.");
  const book = { name: "", entries: [] as never[], extensions: {} };
  const npc = worldEntry(book as never, "npc", { name: "Rhea", role: "barista" });
  useEditor.getState().replaceData({ ...data(), character_book: { ...book, entries: [npc] } as never });
});

async function openModules() {
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
  await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Modules" })));
}

describe("the parts browser", () => {
  it("searches by words and tags and adds a part filled from the card", async () => {
    await openModules();
    const list = () => within(screen.getByRole("list", { name: "Parts to add" }));
    fireEvent.change(screen.getByLabelText("Search parts"), { target: { value: "cast" } });
    expect(list().getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search parts"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "memory" } });
    expect(list().getByText("Journal")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Add the people" }));
    const people = engine().modules!.find((m) => m.id === "people")!;
    expect((people.settings.people as { name: string }[]).map((p) => p.name)).toEqual(["Rhea"]);
    // Its settings open, and the browser marks it as in the card.
    expect(screen.getAllByRole("textbox", { name: "Name" }).some((i) => (i as HTMLInputElement).value === "Rhea")).toBe(true);
    expect(screen.queryByRole("button", { name: "Add the people" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add the title screen" }));
    expect(data().first_mes).toBe(`${TITLE_TAG}\n\nThe rain.`);
    expect(engine().modules!.find((m) => m.id === "title")!.settings.title).toBe("Port Noir");

    fireEvent.click(screen.getByRole("button", { name: "Add the journal" }));
    expect(ids()).toEqual(expect.arrayContaining(["time", "journal"]));
  });

  it("previews a part, and says so for one without a screen", async () => {
    await openModules();
    fireEvent.click(screen.getByRole("button", { name: "Preview the events" }));
    expect(screen.getByRole("dialog", { name: "Preview: Events" }).textContent).toContain("no screen of its own");
  });

  it("saves the card as a kit and installs kits", async () => {
    await openModules();
    fireEvent.click(screen.getByRole("button", { name: "Add the menu" }));
    fireEvent.change(screen.getByLabelText("Kit name"), { target: { value: "Noir" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save this card as a kit" })));
    expect(await screen.findByRole("button", { name: "Install Noir" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install Starter game" }));
    expect(ids()).toEqual(expect.arrayContaining(["title", "creator", "menu", "people", "events", "journal", "notify"]));
    expect(data().first_mes).toContain(TITLE_TAG);
    expect(data().first_mes).toContain('<cf-module id="creator"/>');
  });
});
