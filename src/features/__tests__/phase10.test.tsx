import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { useCowriter } from "../../cowriter/store";
import { useInterview } from "../../cowriter/interview";
import { loadPlan } from "../../cowriter/greetingPlan";
import { createCard, createProject, listCards, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { GreetingPlanner } from "../greetings/GreetingPlanner";
import { ProjectDetail } from "../library/ProjectDetail";

const script = vi.hoisted(() => ({ replies: [] as CompletionResult[], requests: [] as CompletionRequest[] }));
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

let projectId = "";
beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useCowriter.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useInterview.setState({ interview: undefined, busy: false, error: undefined });
  useUi.setState({ section: "library", cowriterTab: "chat" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "m" },
      modeModels: {},
      noToolModels: [],
      presets: [],
      imageStyles: [],
    },
  });
  projectId = (await createProject("P")).id;
});

describe("greeting planner", () => {
  it("sorts greetings into the grid and asks for the gaps", async () => {
    const card = await createCard(projectId, "character");
    await useEditor.getState().open(card.id);
    useEditor.getState().setField("first_mes", "Rain on the gate.");
    useEditor.getState().setField("alternate_greetings", ["A kiss at the tavern."]);
    script.replies.push(
      reply("", [
        [
          "sort_greetings",
          {
            greetings: [
              { index: 0, mood: "Tense", place: "The gate", stage: "Strangers" },
              { index: 1, mood: "Tender", place: "Tavern", stage: "Lovers" },
            ],
          },
        ],
      ]),
      reply("Done."),
    );
    render(<GreetingPlanner onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sort my greetings" }));
    expect(await screen.findByText("All 2 greetings sorted.")).toBeInTheDocument();
    const sent = lastText(script.requests[0]);
    expect(sent).toContain('<greeting index="1">\nA kiss at the tavern.\n</greeting>');
    expect(sent).toContain("Places: name them yourself.");
    expect(screen.getByLabelText("Tense, Strangers: first message")).toHaveTextContent("1st");
    expect(screen.getByLabelText("Tender, Lovers: alternate greeting 1")).toBeInTheDocument();
    expect((await loadPlan(card.id)).places).toEqual(["The gate", "Tavern"]);

    // Filtering by place hides greetings elsewhere.
    fireEvent.change(screen.getByRole("combobox", { name: "Place" }), { target: { value: "Tavern" } });
    expect(screen.queryByLabelText("Tense, Strangers: first message")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write a greeting: Playful, Rivals, Tavern" }));
    await waitFor(() => expect(script.requests).toHaveLength(2));
    expect(lastText(script.requests[1])).toContain("- mood: Playful; relationship stage: Rivals; place: Tavern");
    expect(script.requests[1].tools.map((t) => t.name)).toContain("add_greeting");
  });
});

describe("remix and surprise me", () => {
  it("copies a card and asks the co-writer to remix the copy", async () => {
    const card = await createCard(projectId, "character");
    await useEditor.getState().open(card.id);
    useEditor.getState().setField("name", "Mira");
    useEditor.getState().setField("description", "A ranger.");
    await useEditor.getState().flush();
    script.replies.push(reply("Remixing."));
    render(<ProjectDetail projectId={projectId} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Mira" }));
    fireEvent.click(await screen.findByRole("button", { name: "✦ Remix…" }));
    const dialog = screen.getByRole("dialog", { name: "Remix Mira" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Older" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "How much older?" }), { target: { value: "in her fifties" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make the remix" }));
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toContain("This card is a copy of Mira. Turn it into an older version of Mira: in her fifties.");
    const cards = await listCards(projectId);
    expect(cards.map((c) => c.card.data.name).sort()).toEqual(["Mira", "Mira (older)"]);
    expect(useEditor.getState().record!.card.data).toMatchObject({ name: "Mira (older)", description: "A ranger." });
    expect(useUi.getState().section).toBe("cowriter");
  });

  it("starts an interview from a drawn hand", async () => {
    script.replies.push(reply("", [["ask_questions", { questions: [{ theme: "Core", question: "Why?", suggestions: ["A", "B", "C"] }] }]]));
    render(<ProjectDetail projectId={projectId} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "✦ Surprise me" }))[1]);
    const dialog = screen.getByRole("dialog", { name: "Surprise me" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draw another Twist card" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "The idea" }), { target: { value: "A pirate queen. Twist: she's dead." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the interview" }));
    await waitFor(() => expect(script.requests).toHaveLength(1));
    expect(lastText(script.requests[0])).toContain("A pirate queen. Twist: she's dead.");
    expect(useUi.getState()).toMatchObject({ section: "cowriter", cowriterTab: "interview" });
    expect((await listCards(projectId)).map((c) => c.kind)).toEqual(["character"]);
  });
});
