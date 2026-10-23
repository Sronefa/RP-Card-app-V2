import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { Dialog } from "../../components/ui";
import { useCowriter } from "../../cowriter/store";
import { createCard, createProject, listPersonas, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { CheckDialog } from "../editor/CheckDialog";
import { TextField } from "../editor/TextField";
import { TEXT_FIELDS } from "../editor/fields";
import { PersonaLibrary } from "../library/PersonaLibrary";

const script = vi.hoisted(() => ({
  replies: [] as CompletionResult[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => [],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      return next;
    },
  }),
}));

let n = 0;
const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input]) => ({ id: `c${++n}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});
const lastText = (req: CompletionRequest) => (req.messages.at(-1) as { text: string }).text;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useUi.setState({ section: "editor", cowriterTab: "interview" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "m" },
      modeModels: {},
      noToolModels: [],
      presets: [],
    },
  });
});

async function openCard() {
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
}

describe("persona interview", () => {
  it("asks a round of questions and saves the written persona to the library", async () => {
    script.replies.push(
      reply("", [
        [
          "ask_questions",
          {
            questions: [
              { theme: "Look", question: "What do you look like?", suggestions: ["Tall and scarred", "Small and quick"] },
              { theme: "Manner", question: "How do you talk?", suggestions: ["Bluntly", "Softly"] },
            ],
          },
        ],
      ]),
      reply("", [["write_persona", { name: "Rook", description: "{{user}} is tall and scarred, and talks bluntly." }]]),
    );
    render(<PersonaLibrary />);
    fireEvent.click(await screen.findByRole("button", { name: "✦ Build with the co-writer" }));
    const dialog = screen.getByRole("dialog", { name: "Build a persona" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Your idea/ }), { target: { value: "a mercenary" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Tall and scarred" }));
    expect(lastText(script.requests[0])).toContain("My idea: a mercenary");
    expect(lastText(script.requests[0])).toContain("persona");

    fireEvent.click(within(dialog).getByRole("button", { name: "Write the persona" }));
    await within(dialog).findByDisplayValue("Rook");
    const write = lastText(script.requests[1]);
    expect(write).toContain("A: Tall and scarred");
    expect(write).toContain("A: (You decide.)");
    expect(script.requests[1].tools.map((t) => t.name)).toEqual(["write_persona"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save to library" }));
    await waitFor(async () => expect((await listPersonas()).map((p) => p.name)).toEqual(["Rook"]));
    // The new persona opens for editing.
    expect(await screen.findByRole("dialog", { name: "Persona" })).toBeInTheDocument();
  });
});

describe("asking the co-writer from elsewhere", () => {
  it("fixes a card checker finding with one tap", async () => {
    await openCard();
    script.replies.push(reply("Done."));
    const onClose = vi.fn();
    render(
      <CheckDialog
        open
        onClose={onClose}
        issues={[
          { level: "warning", message: "The description is empty.", target: { section: "editor", group: "description" } },
          { level: "tip", message: "The card has no image.", target: { section: "editor", group: "basics" }, manual: true },
        ]}
      />,
    );
    // The co-writer can't add an image, so that finding has no Fix button.
    expect(screen.getAllByRole("button", { name: /Fix with the co-writer/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Fix with the co-writer/ }));
    expect(onClose).toHaveBeenCalled();
    expect(useUi.getState()).toMatchObject({ section: "cowriter", cowriterTab: "chat" });
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toMatch(/The card checker found this: "The description is empty." Fix it.$/);
  });

  it("offers quick requests on a field", async () => {
    await openCard();
    const info = TEXT_FIELDS.description![0];
    render(<TextField info={info} />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Ask co-writer" }));
    // An empty field can only be written.
    expect(screen.queryByRole("button", { name: "Shorter" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Something else…" }));
    expect(useCowriter.getState().draft).toBe(`${info.label}: `);

    useEditor.getState().setField("description", "Sera is kind.");
    script.replies.push(reply("Shorter now."));
    fireEvent.click(screen.getByRole("button", { name: "✦ Ask co-writer" }));
    fireEvent.click(screen.getByRole("button", { name: "Shorter" }));
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toMatch(/Make the description shorter/);
  });
});

describe("dialogs", () => {
  it("closes only the top dialog on Escape", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const view = (withInner: boolean) => (
      <Dialog open title="Outer" onClose={outer}>
        {withInner && (
          <Dialog open title="Inner" onClose={inner}>
            x
          </Dialog>
        )}
      </Dialog>
    );
    // The inner dialog opens later, as a brainstorm does over the persona interview.
    const { rerender } = render(view(false));
    rerender(view(true));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
