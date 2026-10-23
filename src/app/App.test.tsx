import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { useUi } from "./store";

describe("App shell", () => {
  beforeEach(() => useUi.setState({ section: "editor" }));

  it("opens on the editor", () => {
    render(<App />);
    expect(screen.getAllByRole("heading", { name: "Card editor" }).length).toBeGreaterThan(0);
  });

  it("switches section from the nav", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Lorebook" })[0]);
    expect(screen.getByRole("heading", { name: "Lorebook" })).toBeInTheDocument();
    expect(useUi.getState().section).toBe("lorebook");
  });
});
