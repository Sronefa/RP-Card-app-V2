import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

vi.mock("../../engine/sandbox/sandbox", async (original) => ({
  ...(await original<typeof import("../../engine/sandbox/sandbox")>()),
  loadSandboxLibs: async () => ({ libs: "", jquery: "", vue: "" }),
}));

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

async function openSandbox() {
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
  fireEvent.click(screen.getByRole("tab", { name: "Sandbox" }));
  const frame = (await screen.findByTitle("Sandbox")) as HTMLIFrameElement;
  const sent: unknown[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((m: unknown) => void sent.push((m as { cfCommand: unknown }).cfCommand));
  const report = (cfSandbox: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { cfSandbox }, source: frame.contentWindow }));
    });
  return { frame, sent, report };
}

const chat = [
  { id: 0, role: "assistant", name: "Mina", message: "Hello.", swipe_id: 0, swipes: 1, variables: { stat_data: { Player: { Health: 100 } } } },
  {
    id: 1,
    role: "assistant",
    name: "Mina",
    message: "Ouch.<UpdateVariable>…</UpdateVariable>",
    swipe_id: 0,
    swipes: 2,
    variables: { stat_data: { Player: { Health: 80 } }, delta_data: { "Player.Health": [100, 80] } },
  },
];

describe("engine sandbox", () => {
  it("loads the card offline and replays the scenario when it is ready", async () => {
    const { frame, sent, report } = await openSandbox();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(frame.src.startsWith("data:text/html;base64,")).toBe(true);
    report({ kind: "ready" });
    expect(sent).toEqual([{ type: "scenario", turns: [expect.objectContaining({ role: "user" }), expect.objectContaining({ role: "assistant" })] }]);
  });

  it("shows each message's values and changes, and edits them", async () => {
    const { sent, report } = await openSandbox();
    report({ kind: "ready" });
    report({ kind: "state", chat, chatVariables: {}, schema: ["message"] });
    const messages = screen.getByRole("list", { name: "Messages" });
    expect(within(messages).getAllByRole("listitem")).toHaveLength(2);
    expect(within(messages).getByText("1 change")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Changes" })).toHaveTextContent("Player.Health: 100 → 80");
    const yaml = screen.getByRole("textbox", { name: "stat_data (YAML)" });
    expect((yaml as HTMLTextAreaElement).value).toBe("Player:\n  Health: 80\n");
    fireEvent.change(yaml, { target: { value: "Player:\n  Health: 30\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Set these values" }));
    expect(sent.at(-1)).toEqual({
      type: "setVariables",
      id: 1,
      variables: { stat_data: { Player: { Health: 30 } }, delta_data: { "Player.Health": [100, 80] } },
    });
    expect(screen.getByRole("button", { name: "Previous swipe" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next swipe" }));
    expect(sent.at(-1)).toEqual({ type: "swipeTo", id: 1, swipe: 1 });
    // Time travel: the greeting's values, and the chat cut back to it.
    fireEvent.click(within(messages).getByRole("button", { name: /#0/ }));
    expect((screen.getByRole("textbox", { name: "stat_data (YAML)" }) as HTMLTextAreaElement).value).toBe("Player:\n  Health: 100\n");
    fireEvent.click(screen.getByRole("button", { name: "Rewind to here" }));
    expect(sent.at(-1)).toEqual({ type: "rewind", id: 1 });
  });

  it("puts errors over the frame and logs actions", async () => {
    const { report } = await openSandbox();
    report({ kind: "error", source: "TH-message--1--0", message: "Blocked a network request to https://cdn.example.com/x.js.", line: 7, column: 1, code: "<script src=…>", stack: "" });
    expect(screen.getByRole("alert")).toHaveTextContent("An error in TH-message--1--0, line 7");
    report({ kind: "log", source: "TH-message--1--0", action: "triggerSlash", detail: "/send hi" });
    fireEvent.click(screen.getByRole("tab", { name: "Actions (1)" }));
    expect(screen.getByRole("list", { name: "Action log" })).toHaveTextContent("triggerSlash");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Details" }));
    expect(screen.getByRole("list", { name: "Errors and warnings" })).toHaveTextContent("cdn.example.com");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves the scenario with the engine", async () => {
    await openSandbox();
    fireEvent.click(screen.getByRole("tab", { name: "Scenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a turn" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Turn 3" }), { target: { value: "I rest." } });
    expect(readEngine(data())?.scenario?.map((t) => [t.role, t.text.slice(0, 7)])).toEqual([
      ["user", "I look "],
      ["assistant", "{{char}"],
      ["user", "I rest."],
    ]);
  });
});
