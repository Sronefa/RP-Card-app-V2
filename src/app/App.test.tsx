import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCard, resetDbForTests } from "../db/db";
import { useEditor } from "../editor/store";
import App from "./App";
import { useUi } from "./store";

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useUi.setState({ section: "library", projectId: undefined, libraryTab: "projects" });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
});

describe("App", () => {
  it("opens on an empty library", async () => {
    render(<App />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("switches section from the nav", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Lorebook" })[0]);
    expect(useUi.getState().section).toBe("lorebook");
  });

  it("survives scrollTo returning a promise, as in newer WebView2", () => {
    // Chromium's newer scroll methods return a promise. Returning that from an effect crashed React.
    const scrollTo = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true });
    try {
      render(<App />);
      fireEvent.click(screen.getAllByRole("button", { name: "Editor" })[0]);
      expect(screen.getByText("No card open")).toBeInTheDocument();
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it("creates a project and a character, edits it, undoes and saves", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "Eldoria" } });
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.click(await screen.findByRole("button", { name: "New character" }));

    const name = await screen.findByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("New character");
    fireEvent.change(name, { target: { value: "Seraphina" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Description" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "A forest guardian." } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Description")).toHaveValue("");

    const id = useEditor.getState().record!.id;
    await useEditor.getState().flush();
    await waitFor(() => expect(screen.getByText(/Saved$/)).toBeInTheDocument());
    expect((await getCard(id))?.card.data.name).toBe("Seraphina");
  });

  it("keeps Ctrl+Z inside dialogs for the text box, not the card", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "P" } });
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.click(await screen.findByRole("button", { name: "New character" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Changed" } });

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.keyDown(screen.getByLabelText("Version name"), { key: "z", ctrlKey: true });
    expect(useEditor.getState().record?.card.data.name).toBe("Changed");

    fireEvent.keyDown(name, { key: "z", ctrlKey: true });
    expect(useEditor.getState().record?.card.data.name).toBe("New character");
  });
});
