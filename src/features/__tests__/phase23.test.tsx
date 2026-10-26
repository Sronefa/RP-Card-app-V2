import { act, fireEvent, render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { readEngine } from "../../engine/sheet";
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

function start() {
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
}

describe("side calls in the editor", () => {
  it("switches who writes the updates and shows the cost", () => {
    start();
    fireEvent.click(screen.getByRole("radio", { name: /A side call after each reply/ }));
    expect(readEngine(data())!.updateMode).toBe("side");
    expect(screen.getByText(/extra tokens a turn/)).toBeTruthy();
    expect(data().character_book!.entries.some((e) => e.comment === "[mvu_update] Update rules")).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /The roleplay model, at the end of each reply/ }));
    expect(readEngine(data())!.updateMode).toBe("reply");
    expect(data().character_book!.entries.some((e) => e.comment === "[mvu_update] Update rules")).toBe(true);
  });
});

describe("the playtest tab", () => {
  it("asks for a model before it plays", async () => {
    start();
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Playtest" })));
    expect(await screen.findByText(/Pick a model for "Playtest roleplay"/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Auto-play" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
