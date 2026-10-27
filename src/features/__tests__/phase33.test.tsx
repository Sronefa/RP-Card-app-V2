import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings, DEFAULT_IMAGE_STYLES } from "../../ai/settings";
import type { CompletionRequest, CompletionResult } from "../../ai/types";
import { newCard, type CardDataV3 } from "../../card";
import { createCard, createProject, getProject, resetDbForTests } from "../../db/db";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { worldEntry } from "../../editor/world";
import { applyEngine, newEngine } from "../../engine/sheet";
import { writePrompt } from "../../images/prompt";
import { CORE_MOODS, loadStudio, mergeShots, proposeShots, ST_EXPRESSIONS, type Shot } from "../../images/shots";
import { mergeSheet, newSheet, newStyleLock, readSheets, subjectsOf, writeSheet, type StyleLock } from "../../images/visual";
import { AssetsView } from "../assets/AssetsView";

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

/** Sera, with an NPC, a place and an item. */
function card(): CardDataV3 {
  const d = newCard("Sera").data;
  d.description = "A ranger with a scar over one eye and a green cloak.";
  d.first_mes = "Sera looks up from the fire.";
  d.alternate_greetings = ["Rain on the roof."];
  let book = emptyBook();
  for (const [kind, name] of [
    ["npc", "Holt"],
    ["location", "The Ferry"],
    ["item", "Moon Lantern"],
  ] as const)
    book = { ...book, entries: [...book.entries, worldEntry(book, kind, { name })] };
  return { ...d, character_book: book };
}

const lock = (patch: Partial<StyleLock> = {}): StyleLock => ({ ...newStyleLock(), style: "anime style", fixedTags: "masterpiece", ...patch });

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  script.replies = [];
  script.requests = [];
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useAiSettings.setState({
    loaded: true,
    settings: {
      providers: [{ id: "p", kind: "openai", name: "Nano", baseUrl: "https://x/v1", apiKey: "k" }],
      defaultModel: { providerId: "p", model: "big-model" },
      modeModels: {},
      noToolModels: [],
      imageStyles: DEFAULT_IMAGE_STYLES,
      presets: [],
    },
  });
  const project = await createProject("P");
  const record = await createCard(project.id, "character");
  await useEditor.getState().open(record.id);
  useEditor.getState().replaceData(card());
});

describe("visual bible", () => {
  it("has a sheet for the character, NPCs, places and items", () => {
    expect(subjectsOf(card(), "character").map((s) => [s.name, s.kind])).toEqual([
      ["Sera", "character"],
      ["Holt", "character"],
      ["The Ferry", "place"],
      ["Moon Lantern", "item"],
    ]);
  });

  it("merges the co-writer's fill but keeps locked fields and outfits", () => {
    const sheet = { ...newSheet("character"), fields: { eyes: "grey" }, locked: ["eyes", "outfit:default"] };
    const next = mergeSheet(sheet, {
      fields: { eyes: "green", hair: "short black hair", nonsense: "x", face: "" },
      outfits: [
        { name: "Default", garments: "robe", colors: "", materials: "", accessories: "", footwear: "" },
        { name: "combat", garments: "leather armour", colors: "brown", materials: "", accessories: "", footwear: "boots" },
      ],
      signature: ["scar over the left eye", "green cloak", "silver ring", "freckles", "fifth"],
    });
    expect(next.fields).toEqual({ eyes: "grey", hair: "short black hair" });
    expect(next.outfits.map((o) => [o.name, o.garments])).toEqual([
      ["default", ""],
      ["combat", "leather armour"],
    ]);
    expect(next.signature).toHaveLength(4);
  });
});

describe("shot list", () => {
  it("proposes character art, emotions, backgrounds, scenes and avatars, and engine art only on the engine", () => {
    const shots = proposeShots(card(), "character", { emotions: CORE_MOODS });
    const count = (g: Shot["group"]) => shots.filter((s) => s.group === g).length;
    expect(count("character")).toBe(4);
    expect(count("emotions")).toBe(8);
    expect(count("backgrounds")).toBe(2);
    expect(count("scenes")).toBe(2);
    expect(count("avatars")).toBe(1);
    expect(count("engine")).toBe(0);
    const engine = proposeShots(applyEngine(card(), newEngine()), "character", { emotions: ST_EXPRESSIONS });
    expect(engine.filter((s) => s.group === "emotions")).toHaveLength(28);
    expect(engine.filter((s) => s.group === "engine").map((s) => s.label)).toEqual([
      "Title screen",
      "World map",
      "Phone wallpaper",
      "Icon: Moon Lantern",
    ]);
    // Suggesting again adds nothing new.
    expect(mergeShots(shots, proposeShots(card(), "character", { emotions: CORE_MOODS }))).toHaveLength(shots.length);
  });
});

describe("prompt writer", () => {
  const withSheet = () => {
    const sheet = {
      ...newSheet("character"),
      fields: { hair: "short black hair", eyes: "green eyes", build: "tall, lean", makeup: "dark eyeliner", posture: "relaxed" },
      signature: ["scar over the left eye", "green hooded cloak"],
      lora: { name: "sera.safetensors", trigger: "srn_ranger" },
    };
    return writeSheet(card(), "card", sheet);
  };
  const portrait = () => proposeShots(withSheet(), "character", { emotions: ["joy"] }).find((s) => s.emotion === "joy")!;

  it("builds a tag prompt from the style lock, sheet, emotion and framing", () => {
    const p = writePrompt(withSheet(), "character", portrait(), lock());
    expect(p.positive).toMatch(/^masterpiece, srn_ranger, cowboy shot, upper body, scar over the left eye/);
    expect(p.positive).toContain("joy expression");
    expect(p.positive).toContain("anime style");
    expect(p.trimmed).toEqual([]);
  });

  it("trims the least important parts first and never the signature", () => {
    const p = writePrompt(withSheet(), "character", portrait(), lock({ family: "sd", style: "x ".repeat(120) }));
    expect(p.trimmed[0]).toBe("makeup");
    expect(p.positive).toContain("scar over the left eye");
    expect(p.positive).toContain("srn_ranger");
  });

  it("writes sentences for prose models and keeps the user's edit", () => {
    const p = writePrompt(withSheet(), "character", portrait(), lock({ format: "prose", fixedTags: "" }));
    expect(p.positive).toMatch(/^Srn_ranger\. A half-body shot\. Sera\./);
    const edited = { ...portrait(), prompt: { positive: "my own", negative: "none" } };
    expect(writePrompt(withSheet(), "character", edited, lock()).positive).toBe("my own");
  });
});

describe("Image Studio page", () => {
  const openStudio = async () => {
    render(<AssetsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Image Studio" }));
    return screen.findByRole("region", { name: "Image Studio" });
  };

  it("fills a sheet from the card, leaves locked fields, and asks about the gaps", async () => {
    await openStudio();
    fireEvent.click(screen.getByRole("button", { name: "Lock Eyes" }));
    script.replies.push({
      text: "",
      stop: "tool_use",
      toolCalls: [
        {
          id: "f1",
          name: "fill_visual_sheet",
          input: {
            fields: { eyes: "grey", marks: "scar over one eye" },
            outfits: [{ name: "default", garments: "green cloak, leathers" }],
            signature: ["scar over one eye", "green cloak"],
            questions: ["What colour is Sera's hair?"],
          },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "✦ Fill from the card" }));
    expect(await screen.findByText("What colour is Sera's hair?")).toBeTruthy();
    const sheet = readSheets(useEditor.getState().record!.card.data).card;
    expect(sheet.fields).toEqual({ marks: "scar over one eye" });
    expect(sheet.outfits[0].garments).toBe("green cloak, leathers");
    expect(sheet.signature).toEqual(["scar over one eye", "green cloak"]);
    expect(script.requests[0].tools[0].parameters.properties).toHaveProperty("outfits");
    expect(script.requests[0].messages[0]).toMatchObject({ text: expect.stringContaining("eyes: colour, shape, anything unusual (locked") });
  });

  it("suggests shots with a count, shows each prompt, and saves the style lock to the project", async () => {
    await openStudio();
    fireEvent.click(screen.getByRole("tab", { name: "Style lock" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Start from a saved style" }), { target: { value: "anime" } });
    await waitFor(async () =>
      expect((await getProject(useEditor.getState().record!.projectId))?.cowriter?.styleLock?.style).toMatch(/anime style/),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Shot list" }));
    fireEvent.click(await screen.findByRole("radio", { name: "8 core moods" }));
    fireEvent.click(screen.getByRole("button", { name: "✦ Suggest shots from the card" }));
    expect(await screen.findByText(/17 images planned/)).toBeTruthy();
    const emotions = screen.getByRole("region", { name: "Emotion sets" });
    fireEvent.click(within(emotions).getByRole("button", { name: "Sera: joy" }));
    expect((screen.getByRole("textbox", { name: "Prompt for Sera: joy" }) as HTMLTextAreaElement).value).toMatch(/anime style/);
    fireEvent.click(within(emotions).getByRole("checkbox", { name: "Include Sera: anger" }));
    expect(await screen.findByText(/16 images planned/)).toBeTruthy();
    await waitFor(async () => expect((await loadStudio(useEditor.getState().record!.id)).shots.filter((s) => s.skip)).toHaveLength(1));
  });
});
