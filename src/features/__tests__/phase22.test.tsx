import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { worldEntry } from "../../editor/world";
import { CREATOR_TAG } from "../../engine/modules/creator";
import { applyEngine, newVar, readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

const data = () => useEditor.getState().record!.card.data;
const engine = () => readEngine(data())!;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mina");
});

function openTab(name: string) {
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("built-in screens", () => {
  it("adds the phone, fills it from the world and orders its apps", () => {
    const book = { name: "", entries: [] as never[], extensions: {} };
    const npc = worldEntry(book as never, "npc", { name: "Rhea", role: "barista" });
    const place = worldEntry(book as never, "location", { name: "Harbor", mood: "salty" });
    useEditor.getState().replaceData({ ...data(), character_book: { ...book, entries: [npc, { ...place, id: 2 }] } as never });
    openTab("Modules");
    fireEvent.click(screen.getByRole("button", { name: "Add the phone" }));
    expect(engine().modules!.some((m) => m.core === "phone")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill from the world" }));
    const phone = () => engine().modules!.find((m) => m.core === "phone")!;
    expect((phone().settings.contacts as { name: string }[]).map((c) => c.name)).toEqual(["Rhea"]);
    expect(phone().vars.map((v) => `${v.group}.${v.name}`)).toContain("Rhea.Affection");
    const apps = within(screen.getByRole("list", { name: "Apps on the home screen" }));
    fireEvent.click(apps.getByRole("button", { name: "Move Contacts up" }));
    expect((phone().settings.apps as string[]).slice(0, 2)).toEqual(["contacts", "messages"]);
    fireEvent.click(screen.getByRole("button", { name: "+ System" }));
    expect(phone().settings.apps).toContain("system");
    expect(screen.queryByRole("button", { name: "Add the phone" })).toBeNull();
  });

  it("adds the character creator and puts it in the first message", () => {
    useEditor.getState().setField("first_mes", "The gate opens.");
    openTab("Modules");
    fireEvent.click(screen.getByRole("button", { name: "Add the character creator" }));
    fireEvent.click(screen.getByRole("button", { name: "Put it in the first message" }));
    expect(data().first_mes).toBe(`The gate opens.\n\n${CREATOR_TAG}`);
    expect(screen.getByText("It's in the first message.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Points to spend"), { target: { value: "9" } });
    expect(engine().modules!.find((m) => m.core === "creator")!.settings.points).toBe(9);
  });
});

describe("the status panel's tabs and buttons", () => {
  it("sets tabs by group and action buttons on the Look tab", () => {
    openTab("Look");
    act(() => useEditor.getState().replaceData(applyEngine(data(), { ...engine(), vars: [newVar({ group: "Mina", name: "Trust" })] })));
    fireEvent.click(screen.getByRole("button", { name: "Add a tab" }));
    fireEvent.change(screen.getByLabelText("Tab name"), { target: { value: "People" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mina" }));
    expect(engine().panel.tabs).toEqual([{ label: "People", groups: ["Mina"] }]);
    fireEvent.click(screen.getByRole("button", { name: "Add a button" }));
    fireEvent.change(screen.getByLabelText("Button label"), { target: { value: "Rest" } });
    fireEvent.change(screen.getByLabelText("Message or command"), { target: { value: "I rest." } });
    expect(engine().panel.actions).toEqual([{ label: "Rest", text: "I rest.", now: true }]);
  });
});
