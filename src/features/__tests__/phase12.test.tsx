import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { readTracker, regexScripts } from "../../editor/trackers";
import { TrackersView } from "../trackers/TrackersView";

const data = () => useEditor.getState().record!.card.data;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
});

describe("trackers page", () => {
  it("adds the relationship add-on with a preview, and removes it all again", () => {
    render(<TrackersView />);
    expect(screen.queryByRole("region", { name: "Fields" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Relationship stages" }));
    expect(readTracker(data())!.fields.map((f) => f.label)).toEqual(["Affection", "Stage"]);
    expect(data().character_book!.entries.map((e) => e.comment)).toContain("Stage: Allies");

    const stages = screen.getByRole("region", { name: "Relationship stages" });
    fireEvent.change(within(stages).getAllByRole("textbox", { name: "Stage" })[2], { target: { value: "Partners" } });
    expect(data().character_book!.entries.map((e) => e.keys[0])).toContain("Stage: Partners");

    const preview = screen.getByRole("region", { name: "Preview" });
    fireEvent.change(within(preview).getByRole("textbox", { name: "Sample Affection" }), { target: { value: "55" } });
    const frame = screen.getByTitle("Preview of the reply in SillyTavern") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("<span>55/100</span>");
    expect(frame.getAttribute("srcdoc")).toContain("<em>{{char}} glances over");

    fireEvent.click(screen.getByRole("button", { name: "Remove the tracker" }));
    expect(readTracker(data())).toBeUndefined();
    expect(regexScripts(data())).toEqual([]);
    expect(data().character_book!.entries).toEqual([]);
    // One undo brings the whole tracker back.
    useEditor.getState().undo();
    expect(readTracker(data())!.stages!.map((s) => s.name)).toContain("Partners");
  });

  it("keeps the user's own regex scripts next to the tracker's", () => {
    render(<TrackersView />);
    fireEvent.click(screen.getByRole("button", { name: "Add Stats" }));
    fireEvent.click(screen.getByRole("tab", { name: "Regex scripts" }));
    expect(screen.getAllByText("Made by the status tracker. Change the tracker to change it.")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Add regex script" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find (regex)" }), { target: { value: "/<mood>(.*?)<\\/mood>/g" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "<b>$1</b>" } });
    fireEvent.change(screen.getByRole("textbox", { name: "An AI reply" }), { target: { value: "Hi <mood>sly</mood>" } });
    expect(screen.getByTitle("The reply after the scripts").getAttribute("srcdoc")).toContain("Hi <b>sly</b>");

    fireEvent.click(screen.getByRole("tab", { name: "Status tracker" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Stats" }));
    expect(regexScripts(data()).map((s) => s.findRegex)).toEqual(["/<mood>(.*?)<\\/mood>/g"]);
  });
});
