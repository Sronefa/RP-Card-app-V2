import { fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../app/App";
import { useUi } from "../../app/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";

const picked = vi.hoisted(() => ({ files: [] as File[] }));
vi.mock("../../lib/files", async (original) => ({
  ...(await original<typeof import("../../lib/files")>()),
  pickFiles: async () => picked.files,
}));

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useUi.setState({ section: "library", projectId: undefined, editorGroup: "basics", focusEntry: undefined });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
});

const book = () => useEditor.getState().record!.card.data.character_book;

describe("lorebook", () => {
  it("adds an entry, edits keys and content, and undoes", () => {
    useUi.setState({ section: "lorebook" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));

    const keys = screen.getByRole("textbox", { name: "Keys" });
    fireEvent.change(keys, { target: { value: "dragon, wyrm," } });
    expect(book()?.entries[0].keys).toEqual(["dragon", "wyrm"]);
    fireEvent.change(keys, { target: { value: "/drakes?/i" } });
    fireEvent.keyDown(keys, { key: "Enter" });
    expect(book()?.entries[0].keys).toEqual(["dragon", "wyrm", "/drakes?/i"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove key wyrm" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Content/ }), { target: { value: "Dragons sleep in winter." } });
    expect(book()?.entries[0]).toMatchObject({ keys: ["dragon", "/drakes?/i"], content: "Dragons sleep in winter." });

    fireEvent.change(screen.getByRole("combobox", { name: "Position" }), { target: { value: "4" } });
    expect(screen.getByRole("spinbutton", { name: "Depth" })).toHaveValue(4);
    expect(book()?.entries[0].extensions.position).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(book()?.entries[0].extensions.position).toBeUndefined();
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("dragon");
  });

  it("imports SillyTavern World Info and merges it", async () => {
    useUi.setState({ section: "lorebook" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    const wi = { entries: { "0": { uid: 0, key: ["castle"], content: "Old.", comment: "Castle", position: 0 } } };
    picked.files = [new File([JSON.stringify(wi)], "world.json")];
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Castle")).toBeInTheDocument();
    expect(book()?.entries.map((e) => e.id)).toEqual([0, 1]);

    // Deleting right after the import is its own undo step.
    fireEvent.click(screen.getByRole("button", { name: /^Castle/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(book()?.entries).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(book()?.entries).toHaveLength(2);
  });
});

describe("card checker", () => {
  it("lists problems and jumps to the lorebook entry", () => {
    useEditor.getState().setField("character_book", {
      extensions: {},
      entries: [{ id: 0, keys: [], content: "x", comment: "Keyless", enabled: true, insertion_order: 100, use_regex: false, extensions: {} }],
    });
    useUi.setState({ section: "editor" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Check card, 3 problems/ }));
    const dialog = screen.getByRole("dialog", { name: "Card check" });
    expect(within(dialog).getByText(/The description is empty/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText(/never triggers/));
    expect(useUi.getState().section).toBe("lorebook");
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("Keyless");
  });

  it("jumps to the editor group", () => {
    useUi.setState({ section: "lorebook" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Check card/ }));
    fireEvent.click(screen.getByText(/The description is empty/));
    expect(useUi.getState().section).toBe("editor");
    expect(screen.getByRole("button", { name: "Description" })).toHaveAttribute("aria-current", "true");
  });
});

describe("assets", () => {
  it("adds expression sprites, renames one, makes an icon main and removes it", async () => {
    useUi.setState({ section: "assets" });
    render(<App />);
    picked.files = [new File([new Uint8Array([1, 2])], "joy.png"), new File([new Uint8Array([3])], "anger.webp")];
    fireEvent.click(screen.getByRole("button", { name: "Add expressions" }));
    expect(await screen.findByText("joy")).toBeInTheDocument();

    const record = () => useEditor.getState().record!;
    const assets = () => record().card.data.assets!;
    expect(assets().map((a) => [a.type, a.name, a.uri])).toEqual([
      ["icon", "main", "ccdefault:"],
      ["emotion", "joy", "embeded://assets/emotion/images/joy.png"],
      ["emotion", "anger", "embeded://assets/emotion/images/anger.webp"],
    ]);
    expect(record().files["assets/emotion/images/joy.png"]).toEqual(new Uint8Array([1, 2]));

    fireEvent.click(screen.getByText("anger"));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "angry" } });
    expect(assets()[2].name).toBe("angry");
    fireEvent.keyDown(window, { key: "Escape" });

    picked.files = [new File([new Uint8Array([4])], "alt.png")];
    fireEvent.click(screen.getByRole("button", { name: "Add icons" }));
    fireEvent.click(await screen.findByText("alt"));
    fireEvent.click(screen.getByRole("button", { name: "Make main" }));
    expect(assets().filter((a) => a.type === "icon").map((a) => a.name)).toEqual(["icon-1", "main"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(assets().map((a) => a.name)).toEqual(["icon-1", "joy", "angry"]);

    await useEditor.getState().flush();
    expect(useEditor.getState().saveState).toBe("saved");
    expect(record().files["assets/icon/images/alt.png"]).toBeDefined();
  });
});
