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
  it("plans, hands the building to a worker with a brief, and hands over one proposal that one undo takes back", async () => {
    script.replies = [
      reply("I'll look first.", [
        ["list_modules", {}],
        ["run_worker", { task: "Build a bank hub app.", modules: ["bank"], skills: ["hub-app"], docs: ["core-api"], notes: "Gold is Player.Gold." }],
      ]),
      reply("Building the bank.", [
        ["create_module", { id: "bank", name: "Bank", slot: "overlay", button: "🏦 Bank", js: "root.textContent = app.state('Player.Health');" }],
        ["add_rule", { module: "bank", name: "Bank actions", content: '<action app="bank"> means a deposit.', constant: true }],
        ["write_file", { module: "nope", file: "js", content: "" }],
      ]),
      reply("Done building."),
      // The design self-review before the report.
      reply("Built the bank screen and its rule."),
      reply("A bank screen is ready: tap 🏦 Bank above the input box."),
    ];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Make a bank app" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const proposal = await screen.findByRole("region", { name: "Proposal 1" });

    // The lead: its own model settings, planning tools only, and the engine in the message.
    const [lead, worker, , review, leadAgain] = script.requests;
    expect(lead).toMatchObject({ effort: "max", maxTokens: 64000 });
    expect(lead.system).toContain("You are the lead");
    expect(lead.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["run_worker", "list_lore", "lint"]));
    expect(lead.tools.map((t) => t.name)).not.toContain("create_module");
    const first = lead.messages[0];
    expect(first.role === "user" && first.text).toContain("<engine>");

    // The worker: the building method and tools, and a fresh context with everything attached.
    expect(worker).toMatchObject({ effort: "max", maxTokens: 64000 });
    expect(worker.system).toContain("Never guess an API");
    expect(worker.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["render_preview", "create_module"]));
    expect(worker.messages).toHaveLength(1);
    const brief = worker.messages[0].role === "user" ? worker.messages[0].text : "";
    expect(brief).toContain("<task>\nBuild a bank hub app.\n</task>");
    expect(brief).toContain("only these modules: bank");
    expect(brief).toContain("Build a hub app");
    expect(brief).toContain('<doc id="core-api">');
    expect(brief).toContain("Gold is Player.Gold.");
    // A write outside the brief is refused.
    const workerResults = script.requests[2].messages.flatMap((m) => (m.role === "tool" ? m.results : []));
    expect(workerResults.find((r) => r.id.endsWith("write_file"))).toMatchObject({ isError: true });
    expect(workerResults.find((r) => r.id.endsWith("write_file"))!.content).toMatch(/isn't in your brief/);

    // Having built a screen, the worker reviews it against the style checklist before it reports.
    const asked = review.messages.at(-1)!;
    expect(asked.role === "user" && asked.text).toContain("Before you report");
    expect(asked.role === "user" && asked.text).toContain("**Focus:**");

    // The lead keeps only the worker's report, never its history.
    expect(leadAgain.messages.some((m) => m.role === "assistant" && m.toolCalls.some((c) => c.name === "create_module"))).toBe(false);
    const report = leadAgain.messages.flatMap((m) => (m.role === "tool" ? m.results : [])).find((r) => r.id.endsWith("run_worker"))!;
    expect(report.content).toContain("Worker's report:\nBuilt the bank screen and its rule.");
    expect(report.content).toContain("modules/bank/js");
    expect(report.content).toMatch(/Lint on the draft: \d+ errors/);

    // Nothing reached the card yet.
    expect(engine().modules!.some((m) => m.id === "bank")).toBe(false);
    expect(within(proposal).getByText("modules/bank/js")).toBeInTheDocument();
    expect(within(proposal).getByText(/Create the hub screen module "Bank"/i)).toBeInTheDocument();
    expect(screen.getByText(/Worker: Build a bank hub app\. \(4 steps\)/)).toBeInTheDocument();
    expect(screen.getByText("Created bank")).toBeInTheDocument();

    const before = useEditor.getState().past.length;
    fireEvent.click(within(proposal).getByRole("button", { name: "Accept" }));
    expect(engine().modules!.find((m) => m.id === "bank")!.rules).toHaveLength(1);
    expect(useEditor.getState().past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(engine().modules!.some((m) => m.id === "bank")).toBe(false);
    expect(useEngineer.getState().chat!.unreported[0]).toContain("accepted proposal 1");
  });

  it("refuses building tools to the lead, shows the worker live, and runs the worker on its own model", async () => {
    await useAiSettings.getState().update({
      providers: [{ id: "p", kind: "anthropic", name: "Claude", apiKey: "k", models: ["strong", "cheap"] }],
      modeModels: { worker: { providerId: "p", model: "cheap" } },
    });
    script.replies = [
      reply("", [["create_module", { id: "x", name: "X", slot: "panel" }]]),
      reply("", [["run_worker", { task: "Add a panel" }]]),
      reply("", [["create_module", { id: "x", name: "X", slot: "panel" }]]),
      reply("Done."),
      reply("Finished."),
    ];
    const seen: string[] = [];
    const unsubscribe = useEngineer.subscribe((st) => {
      if (st.worker) seen.push(`${st.worker.status}:${st.worker.steps.map((x) => x.label).join("|")}`);
    });
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("region", { name: "Proposal 1" });
    const refused = script.requests[1].messages.flatMap((m) => (m.role === "tool" ? m.results : []))[0];
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content).toMatch(/worker's tool/);
    expect(script.requests.map((r) => r.model)).toEqual(["strong", "strong", "cheap", "cheap", "strong"]);
    unsubscribe();
    // The steps showed while the worker ran, and it's gone once it finished.
    expect(seen).toContain("running:Created x");
    expect(seen.at(-1)).toBe("done:Created x");
    expect(useEngineer.getState().worker).toBeUndefined();
  });

  it("builds on an open proposal and stops at the loop limit", async () => {
    await useAiSettings.getState().update({ engineer: { maxRounds: 2 } });
    script.replies = [
      reply("", [["run_worker", { task: "Restyle" }]]),
      reply("", [["set_panel", { title: "Vitals" }]]),
      reply("", [["set_theme", { preset: "cyberpunk" }]]),
      reply("", [["lint", { screens: false }]]),
    ];
    fireEvent.change(screen.getByLabelText("Message to the UI engineer"), { target: { value: "Restyle it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("region", { name: "Proposal 1" });
    expect(screen.getByRole("alert")).toHaveTextContent("stopped after 2 model calls");
    const report = script.requests[3].messages.flatMap((m) => (m.role === "tool" ? m.results : []))[0];
    expect(report).toMatchObject({ isError: true });
    expect(report.content).toMatch(/worker stopped after 2 model calls/);
    expect(screen.getByText(/Worker: Restyle \(2 steps, didn't finish\)/)).toBeInTheDocument();

    script.replies = [
      reply("", [["run_worker", { task: "Add mana", modules: ["sheet"] }]]),
      reply("", [["set_value", { group: "Player", name: "Mana", type: "number", start: "5" }]]),
      reply("Added."),
      reply("Done."),
    ];
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
