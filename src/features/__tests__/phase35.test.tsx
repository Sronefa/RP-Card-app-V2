import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "../../app/store";
import { embeddedUri, newCard, type CardAsset, type CardDataV3 } from "../../card";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { worldEntry } from "../../editor/world";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { stageModule } from "../../engine/modules/stage";
import { BUILT_IN_PARTS, fillStage, installParts, portraitFor } from "../../engine/parts/catalog";
import { applyEngine, newEngine, readEngine, tavernHelperScript } from "../../engine/sheet";
import { fakeTavern, runScript } from "../../engine/testing";
import { artSlots, assetCall, requestedShot } from "../../images/engineArt";
import { readAssetTags, writeAssetTag, type AssetTag } from "../../images/filing";
import { assetManifest } from "../../images/manifest";
import { loadStudio } from "../../images/shots";
import { AssetsView } from "../assets/AssetsView";
import { ArtSlots } from "../engine/ArtSlots";

const asset = (type: string, name: string): CardAsset => ({ type, name, ext: "webp", uri: embeddedUri(`assets/${type}/images/${name}.webp`) });

/** Sera with an NPC, a place, and tagged art: two emotions, a portrait of Holt, a background and title art. */
function card(): CardDataV3 {
  let d = newCard("Sera").data;
  let book = emptyBook();
  book = { ...book, entries: [worldEntry(book, "npc", { name: "Holt" })] };
  book = { ...book, entries: [...book.entries, worldEntry(book, "location", { name: "The Ferry" })] };
  const holt = `entry:${String(book.entries[0].id)}`;
  const ferry = `entry:${String(book.entries[1].id)}`;
  const art: [CardAsset, AssetTag][] = [
    [asset("emotion", "joy"), { subject: "card", kind: "emotion", variant: "joy" }],
    [asset("emotion", "sadness"), { subject: "card", kind: "emotion", variant: "sadness" }],
    [asset("other", "holt_portrait"), { subject: holt, kind: "portrait" }],
    [asset("background", "the_ferry_night"), { subject: ferry, kind: "background", variant: "night" }],
    [asset("other", "title_screen"), { kind: "scene", variant: "title" }],
  ];
  d = { ...d, character_book: book, assets: [...(d.assets ?? []), ...art.map(([a]) => a)] };
  for (const [a, tag] of art) d = writeAssetTag(d, a.uri, tag);
  return d;
}

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useUi.setState({ section: "engine", assetPick: undefined });
  const project = await createProject("P");
  const record = await createCard(project.id, "character");
  await useEditor.getState().open(record.id);
  useEditor.getState().replaceData(card());
});

describe("art by meaning", () => {
  it("lists tagged art with subject names and where SillyTavern serves it", () => {
    const m = assetManifest(card());
    expect(m.map((e) => [e.s, e.k, e.v ?? ""])).toEqual([
      ["Sera", "emotion", "joy"],
      ["Sera", "emotion", "sadness"],
      ["Holt", "portrait", ""],
      ["The Ferry", "background", "night"],
      ["", "scene", "title"],
    ]);
    expect(m[0].u).toBe("/characters/Sera/joy.webp");
    expect(m[2].u).toBe("/user/images/Sera/holt_portrait.webp");
    expect(assetCall(m[0])).toBe('CF.assets.portrait("Sera", { emotion: "joy" })');
    expect(assetCall(m[4])).toBe('CF.assets.scene("title")');
  });

  it("finds art in the engine with fallbacks to a close emotion, the portrait, and null", async () => {
    const data = applyEngine(card(), newEngine());
    const tavern = fakeTavern([{ role: "assistant", message: "Hi." }]);
    await runScript(tavernHelperScript(readEngine(data)!, data.name, assetManifest(data)).content, tavern);
    const CF = tavern.globals.CardForge as {
      assets: {
        portrait: (n: string, o?: object) => string | null;
        background: (p: string, t?: string) => string | null;
        scene: (v: string) => string | null;
        icon: (n: string) => string | null;
      };
    };
    expect(CF.assets.portrait("Sera", { emotion: "joy" })).toBe("/characters/Sera/joy.webp");
    // Excitement isn't there; joy is the closest.
    expect(CF.assets.portrait("sera", { emotion: "excitement" })).toBe("/characters/Sera/joy.webp");
    expect(CF.assets.portrait("Holt", { emotion: "anger" })).toBe("/user/images/Sera/holt_portrait.webp");
    expect(CF.assets.background("The Ferry", "Night")).toBe("/backgrounds/the_ferry_night.webp");
    expect(CF.assets.background("The Ferry", "Morning")).toBe("/backgrounds/the_ferry_night.webp");
    expect(CF.assets.scene("title")).toBe("/user/images/Sera/title_screen.webp");
    expect(CF.assets.icon("Lantern")).toBeNull();
  });

  it("fills parts from tagged art", () => {
    expect(portraitFor(card(), "Holt")).toBe("holt_portrait.webp");
    const filled = fillStage({}, card());
    expect(filled.cast).toEqual([{ name: "Sera", moods: ["joy", "sadness"] }]);
    const stage = stageModule(filled);
    expect(stage.vars.map((v) => [v.group, v.name, v.options, v.start])).toEqual([["Sera", "mood", ["joy", "sadness"], "joy"]]);
    expect(BUILT_IN_PARTS.some((p) => p.id === "stage")).toBe(true);
  });
});

describe("engine art slots and the engineer", () => {
  it("shows empty slots for the installed parts, adds their shots, and picks from the assets", async () => {
    const parts = installParts(newEngine(), card(), ["people", "stage"], BUILT_IN_PARTS);
    useEditor.getState().replaceData(applyEngine(card(), parts.config));
    const slots = artSlots(useEditor.getState().record!.card.data);
    expect(slots.filter((s) => s.filled).map((s) => s.label)).toEqual(["Holt's portrait", "The Ferry background", "Sera, joy", "Sera, sadness"]);
    expect(slots.filter((s) => !s.filled).map((s) => s.label)).toEqual(["Sera's portrait"]);

    render(<ArtSlots />);
    fireEvent.click(screen.getByRole("button", { name: "Add a shot for Sera's portrait" }));
    await waitFor(async () => expect((await loadStudio(useEditor.getState().record!.id)).shots.map((s) => s.label)).toEqual(["Sera: portrait"]));

    fireEvent.click(screen.getByRole("button", { name: "Pick an image for The Ferry background" }));
    expect(useUi.getState()).toMatchObject({ section: "assets", assetPick: { label: "The Ferry background" } });
    render(<AssetsView />);
    expect(screen.getByRole("status")).toHaveTextContent(/Choose an image for The Ferry background/);
    const backgrounds = screen.getByRole("heading", { name: "Backgrounds" }).closest("section")!;
    fireEvent.click(within(backgrounds).getByRole("button", { name: /the_ferry_night/ }));
    const data = useEditor.getState().record!.card.data;
    const ferry = data.assets!.find((a) => a.name === "the_ferry_night")!;
    expect(readAssetTags(data)[ferry.uri]).toEqual({ kind: "background", subject: expect.stringMatching(/^entry:/) });
    expect(useUi.getState()).toMatchObject({ section: "engine", assetPick: undefined });
  });

  it("lists assets and asks for new ones onto the shot list", async () => {
    const record = useEditor.getState().record!;
    const data = applyEngine(record.card.data, newEngine());
    const ctx = { data, draft: readEngine(data)!, ops: [], skills: [], cardId: record.id } as EngineerContext;
    const listed = await runEngineerTool(ctx, { id: "a", name: "list_assets", input: { kind: "emotion" } });
    expect(listed.content).toBe(
      '- emotion of Sera, joy: CF.assets.portrait("Sera", { emotion: "joy" })\n- emotion of Sera, sadness: CF.assets.portrait("Sera", { emotion: "sadness" })',
    );
    const asked = await runEngineerTool(ctx, { id: "b", name: "request_asset", input: { kind: "scene", variant: "map", description: "An old sea chart" } });
    expect(asked.content).toMatch(/shot list/);
    const shots = (await loadStudio(record.id)).shots;
    expect(shots).toEqual([expect.objectContaining({ group: "engine", variant: "map", action: "An old sea chart", label: "Map" })]);
    expect(requestedShot(data, { kind: "emotion", subject: "Holt", variant: "anger", description: "x" })).toMatchObject({ kind: "emotion", emotion: "anger", subject: expect.stringMatching(/^entry:/) });
  });
});
