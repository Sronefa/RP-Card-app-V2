import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../app/store";
import { DEFAULT_IMAGE_STYLES, useAiSettings } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { complete } from "../../cowriter/engine";
import { useCowriter, useLoreChat } from "../../cowriter/store";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { emptyBook, newEntry } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { CowriterPanel } from "../cowriter/CowriterPanel";
import { ImagePromptDialog } from "../images/ImagePromptDialog";
import { LorebookView } from "../lorebook/LorebookView";
import { SettingsView } from "../settings/SettingsView";

/** Scripted model; "hang" waits until the call is aborted. */
const script = vi.hoisted(() => ({
  replies: [] as (CompletionResult | "hang")[],
  requests: [] as CompletionRequest[],
}));
vi.mock("../../ai/settings", async (original) => ({
  ...(await original<typeof import("../../ai/settings")>()),
  createProvider: () => ({
    listModels: async () => ["alpha", "beta"],
    complete: async (req: CompletionRequest) => {
      script.requests.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
      const next = script.replies.shift();
      if (!next) throw new Error("no scripted reply");
      if (next === "hang")
        return new Promise<never>((_, reject) =>
          req.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        );
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
  useLoreChat.setState({ chat: undefined, busy: false, streaming: "", error: undefined, draft: "" });
  useUi.setState({ cowriterTab: "chat" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [
        { id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k", models: ["alpha", "beta"] },
        { id: "q", kind: "openai", name: "Other", baseUrl: "https://y/v1", apiKey: "k", models: ["gamma"] },
      ],
      defaultModel: { providerId: "p", model: "alpha" },
      modeModels: {},
      noToolModels: [],
      presets: [],
      imageStyles: DEFAULT_IMAGE_STYLES,
    },
  });
  projectId = (await createProject("P")).id;
});

describe("models and timeouts", () => {
  it("switches between saved models from the co-writer", async () => {
    const card = await createCard(projectId, "character");
    await useEditor.getState().open(card.id);
    render(<CowriterPanel />);
    const picker = screen.getByRole("combobox", { name: "Model" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["alpha", "beta", "gamma"]);
    fireEvent.change(picker, { target: { value: "q/gamma" } });
    expect(useAiSettings.getState().settings.defaultModel).toEqual({ providerId: "q", model: "gamma" });
  });

  it("saves models and a timeout on a provider", async () => {
    render(<SettingsView />);
    fireEvent.change(screen.getByRole("combobox", { name: "Add a model to Nano" }), { target: { value: "delta" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(useAiSettings.getState().settings.providers[0].models).toEqual(["alpha", "beta", "delta"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove alpha" }));
    expect(useAiSettings.getState().settings.providers[0].models).toEqual(["beta", "delta"]);
    fireEvent.change(screen.getAllByRole("spinbutton", { name: /Give up after/ })[0], { target: { value: "90" } });
    expect(useAiSettings.getState().settings.providers[0].timeoutSec).toBe(90);
  });

  it("gives up after the provider's timeout", async () => {
    const s = useAiSettings.getState().settings;
    useAiSettings.setState({ settings: { ...s, providers: s.providers.map((p) => ({ ...p, timeoutSec: 0.05 })) } });
    script.replies.push("hang");
    await expect(complete("refine", { system: "s", messages: [], tools: [] })).rejects.toThrow(
      "Nano didn't finish within 0.05 seconds",
    );
  });
});

describe("image prompts", () => {
  it("writes a prompt for a lorebook entry in a saved style", async () => {
    const card = await createCard(projectId, "character");
    await useEditor.getState().open(card.id);
    useEditor.getState().setField("name", "Mira");
    useEditor.getState().setField("description", "A ranger with silver hair.");
    const book = emptyBook();
    useEditor.getState().setField("character_book", { ...book, entries: [newEntry(book, { comment: "Ash Ford", content: "A ford of black stones." })] });
    script.replies.push(reply("", [["write_image_prompt", { positive: "masterpiece, river, black stones", negative: "lowres" }]]));

    render(<ImagePromptDialog onClose={() => {}} />);
    const what = await screen.findByRole("combobox", { name: "What to draw" });
    await waitFor(() => expect(within(what).getAllByRole("option").length).toBe(2));
    fireEvent.change(what, { target: { value: within(what).getByRole("option", { name: "Lorebook: Ash Ford" }).getAttribute("value") } });
    expect(screen.getByRole("combobox", { name: "Framing" })).toHaveValue("scene");
    fireEvent.change(screen.getByRole("textbox", { name: "Anything else" }), { target: { value: "at dawn" } });
    fireEvent.click(screen.getByRole("button", { name: "Write the prompt" }));

    expect(await screen.findByRole("textbox", { name: "Prompt" })).toHaveValue("masterpiece, river, black stones");
    expect(screen.getByRole("textbox", { name: "Negative prompt" })).toHaveValue("lowres");
    const req = script.requests[0];
    expect(req.system).toContain("prompts for image generators");
    const text = lastText(req);
    expect(text).toContain("A ford of black stones.");
    expect(text).toContain("Stable Diffusion / NovelAI");
    expect(text).toContain("Start the prompt with exactly: masterpiece, best quality, very aesthetic");
    expect(text).toContain("The user asks: at dawn");
  });
});

describe("bringing a character into a world", () => {
  it("sends the character card to the world's lorebook brainstorm", async () => {
    const character = await createCard(projectId, "character");
    const world = await createCard(projectId, "world");
    await useEditor.getState().open(character.id);
    useEditor.getState().setField("name", "Mira");
    useEditor.getState().setField("description", "A ranger with silver hair.");
    await useEditor.getState().flush?.();
    await useEditor.getState().open(world.id);
    script.replies.push(reply("She fits in the north.", [["add_lore_entry", { title: "Mira", keys: ["mira"], content: "A ranger." }]]), reply("Pitched."));

    render(<LorebookView />);
    fireEvent.click(screen.getByRole("tab", { name: "Brainstorm" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bring in a character" }));
    fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: "Mira" }));
    await screen.findByText("She fits in the north.");
    expect(screen.getByText("Bring Mira into this world")).toBeInTheDocument();
    const text = lastText(script.requests[0]);
    expect(text).toContain("<character_card>");
    expect(text).toContain("A ranger with silver hair.");
    expect(text).toContain("Bring this character into this world");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(useEditor.getState().record!.card.data.character_book?.entries[0].comment).toBe("Mira");
  });
});
