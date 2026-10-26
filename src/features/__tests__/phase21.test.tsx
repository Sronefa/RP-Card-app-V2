import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { engineerHooks, useEngineer } from "../../engine/engineer/session";
import { readEngine } from "../../engine/sheet";
import { EngineView } from "../engine/EngineView";

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

const reply = (text: string, calls: [string, Record<string, unknown>][] = []): CompletionResult => ({
  text,
  toolCalls: calls.map(([name, input], i) => ({ id: `t${script.replies.length}-${i}-${name}`, name, input })),
  stop: calls.length ? "tool_use" : "end",
});

const data = () => useEditor.getState().record!.card.data;
const engine = () => readEngine(data())!;

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  engineerHooks.preview = () => undefined;
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useEngineer.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "anthropic", name: "Claude", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "strong" },
      modeModels: {},
      noToolModels: [],
      imageStyles: [],
      presets: [],
    },
  });
  const project = await createProject("P");
  const card = await createCard(project.id, "character");
  await useEditor.getState().open(card.id);
  useEditor.getState().setField("name", "Mina");
  render(<EngineView />);
  fireEvent.click(screen.getByRole("button", { name: "Turn on the engine" }));
  fireEvent.click(screen.getByRole("tab", { name: "Engineer" }));
});

describe("UI engineer", () => {
  it("builds in a loop with its tools and hands over one proposal that one undo takes back", async () => {
    script.replies = [
      reply("I'll look first.", [
        ["list_modules", {}],
        ["load_skill", { id: "hub-app" }],
      ]),
      reply("Building the bank.", [
        ["create_module", { id: "bank", name: "Bank", slot: "overlay", button: "🏦 Bank", js: "root.textContent = app.state('Player.Health');" }],
        ["add_rule", { module: "bank", name: "Bank actions", content: '<action app="bank"> means a deposit.', constant: true }],
        ["write_file", { module: "nope", file: "js", content: "" }],
      ]),
      reply("A bank screen is ready: tap 🏦 Bank above the input box."),
    ];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Make a bank app" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const proposal = await screen.findByRole("region", { name: "Proposal 1" });

    // Its own model settings: max thinking and a long reply limit.
    expect(script.requests[0]).toMatchObject({ effort: "max", maxTokens: 64000 });
    expect(script.requests[0].system).toContain("Never guess an API");
    expect(script.requests[0].tools.map((t) => t.name)).toContain("render_preview");
    const first = script.requests[0].messages[0];
    expect(first.role === "user" && first.text).toContain("<engine>");
    // Tool results went back to the model, a mistake as an error.
    const results = script.requests[2].messages.filter((m) => m.role === "tool").flatMap((m) => (m.role === "tool" ? m.results : []));
    expect(results.find((r) => r.id.endsWith("load_skill"))!.content).toContain("Build a hub app");
    expect(results.find((r) => r.id.endsWith("write_file"))).toMatchObject({ isError: true });

    // Nothing reached the card yet.
    expect(engine().modules!.some((m) => m.id === "bank")).toBe(false);
    expect(within(proposal).getByText("modules/bank/js")).toBeInTheDocument();
    expect(within(proposal).getByText(/Create the hub screen module "Bank"/i)).toBeInTheDocument();
    expect(screen.getByText("Created bank")).toBeInTheDocument();

    const before = useEditor.getState().past.length;
    fireEvent.click(within(proposal).getByRole("button", { name: "Accept" }));
    expect(engine().modules!.find((m) => m.id === "bank")!.rules).toHaveLength(1);
    expect(useEditor.getState().past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(engine().modules!.some((m) => m.id === "bank")).toBe(false);
    expect(useEngineer.getState().chat!.unreported[0]).toContain("accepted proposal 1");
  });

  it("builds on an open proposal and stops at the loop limit", async () => {
    await useAiSettings.getState().update({ engineer: { maxRounds: 2 } });
    script.replies = [
      reply("", [["set_panel", { title: "Vitals" }]]),
      reply("", [["set_theme", { preset: "cyberpunk" }]]),
    ];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Restyle it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("region", { name: "Proposal 1" });
    expect(screen.getByRole("alert")).toHaveTextContent("stopped after 2 model calls");

    script.replies = [reply("", [["set_value", { group: "Player", name: "Mana", type: "number", start: "5" }]]), reply("Done.")];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Add mana too" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const second = await screen.findByRole("region", { name: "Proposal 2" });
    expect(screen.getByText("Built on in a later proposal")).toBeInTheDocument();
    fireEvent.click(within(second).getByRole("button", { name: "Accept" }));
    expect(engine().panel.title).toBe("Vitals");
    expect(engine().theme!.preset).toBe("cyberpunk");
    expect(engine().vars.map((v) => v.name)).toContain("Mana");
  });

  it("edits, adds and removes skills", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    const dialog = screen.getByRole("dialog", { name: "UI engineer skills" });
    fireEvent.change(within(dialog).getByLabelText("New skill id"), { target: { value: "gacha" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    const editor = screen.getByRole("dialog", { name: "Skill: gacha" });
    fireEvent.change(within(editor).getByLabelText("Skill text"), { target: { value: "# Gacha screen\n\nWhen: pulls and banners.\n\n1. Roll." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useAiSettings.getState().settings.engineerSkills!.edited.gacha).toContain("Gacha screen"));
    const list = screen.getByRole("dialog", { name: "UI engineer skills" });
    fireEvent.click(within(list).getByRole("button", { name: /Build a status panel section/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /Skill:/ })).getByRole("button", { name: "Remove" }));
    expect(useAiSettings.getState().settings.engineerSkills!.removed).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Bring back 1 removed/ })).toBeInTheDocument();
  });
});
