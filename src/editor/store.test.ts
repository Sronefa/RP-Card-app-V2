import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCard, createProject, getCard, listVersions, resetDbForTests } from "../db/db";
import { AUTO_VERSION_MS, COALESCE_MS, installSaveOnExit, useEditor } from "./store";

async function openNewCard() {
  const project = await createProject("p");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  return card;
}

beforeEach(async () => {
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
});

describe("editor store", () => {
  it("snapshots an Original version when a card is first opened", async () => {
    const card = await openNewCard();
    expect((await listVersions(card.id)).map((v) => v.label)).toEqual(["Original"]);
  });

  it("coalesces typing in one field into a single undo step", async () => {
    await openNewCard();
    const { setField } = useEditor.getState();
    setField("name", "S");
    setField("name", "Se");
    setField("name", "Sera");
    setField("description", "A guardian");
    expect(useEditor.getState().past).toHaveLength(2);

    useEditor.getState().undo();
    expect(useEditor.getState().record?.card.data.description).toBe("");
    expect(useEditor.getState().record?.card.data.name).toBe("Sera");
    useEditor.getState().undo();
    expect(useEditor.getState().record?.card.data.name).toBe("New character");
    useEditor.getState().redo();
    expect(useEditor.getState().record?.card.data.name).toBe("Sera");
  });

  it("starts a new undo step after a pause", async () => {
    await openNewCard();
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now);
    useEditor.getState().setField("name", "A");
    spy.mockReturnValue(now + COALESCE_MS + 1);
    useEditor.getState().setField("name", "AB");
    spy.mockRestore();
    expect(useEditor.getState().past).toHaveLength(2);
  });

  it("never merges changes made with a null coalesce key", async () => {
    await openNewCard();
    useEditor.getState().setField("alternate_greetings", ["a"], null);
    useEditor.getState().setField("alternate_greetings", [], null);
    useEditor.getState().undo();
    expect(useEditor.getState().record?.card.data.alternate_greetings).toEqual(["a"]);
  });

  it("saves on flush and snapshots a version when the last one is old", async () => {
    const card = await openNewCard();
    useEditor.setState({ lastVersionAt: Date.now() - AUTO_VERSION_MS - 1 });
    useEditor.getState().setField("name", "Saved name");
    expect(useEditor.getState().saveState).toBe("unsaved");
    await useEditor.getState().flush();
    expect(useEditor.getState().saveState).toBe("saved");
    expect((await getCard(card.id))?.card.data.name).toBe("Saved name");
    expect((await listVersions(card.id)).map((v) => v.label)).toEqual(["Autosave", "Original"]);
  });

  it("restores a version as an undoable change", async () => {
    const card = await openNewCard();
    const [original] = await listVersions(card.id);
    useEditor.getState().setField("name", "Changed");
    await useEditor.getState().restoreVersion(original);
    expect(useEditor.getState().record?.card.data.name).toBe("New character");
    useEditor.getState().undo();
    expect(useEditor.getState().record?.card.data.name).toBe("Changed");
  });

  it("saves pending edits when the window is closed", async () => {
    const card = await openNewCard();
    installSaveOnExit();
    useEditor.getState().setField("name", "Before close");
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(async () => expect((await getCard(card.id))?.card.data.name).toBe("Before close"));
  });
});
