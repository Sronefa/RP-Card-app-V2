import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COWRITER } from "../../ai/records";
import { DEFAULT_IMAGE_STYLES, useAiSettings, type AiSettings } from "../../ai/settings";
import { gatherContext } from "../../cowriter/engine";
import { activePacks, BUILT_IN_PACKS, cardSampleIds, matchedPacks, packsWith } from "../../cowriter/style";
import { createCard, createProject, getProject, resetDbForTests, saveProject } from "../../db/db";
import { useEditor } from "../../editor/store";
import { ProjectStyleDialog } from "../cowriter/ProjectStyleDialog";
import { WritingStyle } from "../settings/WritingStyle";

const ai = (patch: Partial<AiSettings> = {}): AiSettings => ({
  providers: [],
  modeModels: {},
  noToolModels: [],
  presets: [],
  imageStyles: DEFAULT_IMAGE_STYLES,
  ...patch,
});

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useAiSettings.setState({ loaded: true, settings: ai() });
});

describe("craft packs", () => {
  it("loads packs by genre, tone and Horror content, plus the ones turned on by hand", () => {
    const packs = packsWith(undefined);
    const names = (s: Parameters<typeof activePacks>[0]) => activePacks(s, packs).map((p) => p.id);
    expect(names({ genre: "noir detective", tone: "slow-burn", dark: "off" })).toEqual(["romance", "mystery"]);
    expect(names({ genre: "", tone: "", dark: "horror" })).toEqual(["horror"]);
    expect(names({ genre: "", tone: "", dark: "off", craftPackIds: ["comedy"] })).toEqual(["comedy"]);
    expect(matchedPacks({ genre: "", tone: "", dark: "off" }, packs)).toEqual([]);
  });

  it("keeps the user's edits over the built-in text and adds their own packs", () => {
    const packs = packsWith([
      { id: "horror", name: "Horror", match: ["horror"], text: "My horror rules." },
      { id: "x", name: "Cyberpunk", match: ["cyberpunk"], text: "Chrome and rain." },
    ]);
    expect(packs).toHaveLength(BUILT_IN_PACKS.length + 1);
    expect(packs.find((p) => p.id === "horror")).toMatchObject({ text: "My horror rules.", builtIn: true });
    expect(packs.at(-1)).toMatchObject({ name: "Cyberpunk" });
  });
});

describe("style anchors", () => {
  it("sends the project's and the card's samples, its packs and the reference examples", async () => {
    useAiSettings.setState({
      settings: ai({
        styleSamples: [
          { id: "a", label: "Terse noir", text: "Rain. Neon. A debt." },
          { id: "b", label: "Lush gothic", text: "The house exhaled." },
          { id: "c", label: "Unused", text: "Nope." },
        ],
      }),
    });
    const p = await createProject("P");
    await saveProject({ ...p, cowriter: { ...DEFAULT_COWRITER, genre: "horror", styleSampleIds: ["a"] } });
    const record = await createCard(p.id, "character");
    record.card.data.extensions = { cardforge: { styleSamples: ["b"] } };
    const parts = await gatherContext(record);
    const by = Object.fromEntries(parts.map((x) => [x.key, x.text]));
    expect(by.style).toMatch(/^Imitate the style of these passages[\s\S]*label="Terse noir"[\s\S]*label="Lush gothic"/);
    expect(by.style).not.toContain("Nope.");
    expect(by.craft).toMatch(/^Craft notes for Horror:/);
    expect(by.examples).toContain('<greeting genre="noir">');

    await saveProject({ ...(await getProject(p.id))!, cowriter: { ...DEFAULT_COWRITER, referenceExamples: false } });
    expect((await gatherContext({ ...record, card: { ...record.card, data: { ...record.card.data, extensions: {} } } })).map((x) => x.key)).not.toContain(
      "examples",
    );
  });

  it("adds samples in Settings and picks them for the project and the open card", async () => {
    const updates: Partial<AiSettings>[] = [];
    useAiSettings.setState({
      update: async (patch: Partial<AiSettings>) => {
        updates.push(patch);
        useAiSettings.setState((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    });
    const settingsView = render(<WritingStyle />);
    fireEvent.click(screen.getByRole("button", { name: "Add a style sample" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sample label" }), { target: { value: "Terse noir" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Sample text" }), { target: { value: "Rain. Neon." } });
    fireEvent.click(screen.getByRole("button", { name: "Save sample" }));
    expect(useAiSettings.getState().settings.styleSamples).toEqual([expect.objectContaining({ label: "Terse noir", text: "Rain. Neon." })]);
    fireEvent.click(within(screen.getByRole("region", { name: "Craft packs" })).getByRole("button", { name: "Edit Comedy" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pack text" }), { target: { value: "Bits." } });
    fireEvent.click(screen.getByRole("button", { name: "Save pack" }));
    expect(screen.getByRole("button", { name: "Reset Comedy" })).toBeInTheDocument();
    settingsView.unmount();

    const p = await createProject("P");
    const record = await createCard(p.id, "character");
    await useEditor.getState().open(record.id);
    render(<ProjectStyleDialog projectId={p.id} open onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Terse noir for this project" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Terse noir for this card" }));
    await waitFor(async () => expect((await getProject(p.id))!.cowriter!.styleSampleIds).toHaveLength(1));
    expect(cardSampleIds(useEditor.getState().record!.card.data)).toHaveLength(1);
  });
});
