import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "../../app/store";
import { newCard } from "../../card";
import {
  addVersion,
  createCard,
  createPersona,
  createProject,
  getCard,
  getChat,
  getInterview,
  getRecord,
  getSetting,
  listCards,
  listProjects,
  listVersions,
  putSetting,
  resetDbForTests,
  saveChat,
  saveInterview,
  saveProject,
} from "../../db/db";
import { newChat } from "../../ai/records";
import { useEditor } from "../../editor/store";
import { worldMeta } from "../../editor/world";
import { exportBundle, importBundle, peekBundle } from "../../lib/bundle";
import { importPack, loadItems, makePack, packBytes, readPack, saveItem, shotsFor, storyTemplateText } from "../../lib/libraries";
import { newStudio, saveStudio, loadStudio, type Shot } from "../../images/shots";
import { LibrariesPage } from "../library/LibrariesPage";
import { LorebookView } from "../lorebook/LorebookView";

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  useUi.setState({ section: "lorebook", tabRequest: undefined });
});

const shot: Shot = { id: "s1", group: "avatars", kind: "avatar", label: "Sera: portrait", subject: "card", outfit: "default", framing: "portrait" };

/** A project with a card, its image and files, a version, chats, an interview, the studio and a persona. */
async function project() {
  const persona = await createPersona("Wren", "A courier.");
  const p = await saveProject({ ...(await createProject("Ferry")), personaIds: [persona.id] });
  const pkg = { card: newCard("Sera"), files: { "assets/other/images/a.webp": new Uint8Array([1, 2, 3]) }, image: new Uint8Array([9, 9]) };
  const card = await createCard(p.id, "character", pkg);
  await addVersion(card.id, pkg.card, "First");
  await saveChat({ ...newChat(card.id), messages: [{ role: "user", text: "Hi" }] });
  await saveChat({ ...newChat(`engineer:${card.id}`) });
  await saveStudio({ ...newStudio(card.id), shots: [shot], candidates: { s1: [{ id: "c", bytes: new Uint8Array([7]), mime: "image/png", model: "m", at: 1 }] } });
  await saveInterview({ cardId: card.id, depth: "quick", stage: "done", messages: [], rounds: [], phaseRounds: 0, facts: ["She rows."], memos: [] } as never);
  await putSetting(`changes:${card.id}`, [{ at: 1, by: "cowriter", summary: "x" }]);
  return { p, card, persona };
}

describe("project bundle", () => {
  it("round-trips a whole project as a copy next to the original", async () => {
    const { p, card } = await project();
    const bytes = (await exportBundle(p.id))!;
    expect(await peekBundle(bytes)).toMatchObject({ name: "Ferry", cards: 1, exists: true });

    const id = await importBundle(bytes, "copy");
    expect(id).not.toBe(p.id);
    expect((await listProjects()).map((x) => x.name).sort()).toEqual(["Ferry", "Ferry (copy)"]);
    const [copy] = await listCards(id);
    expect(copy.id).not.toBe(card.id);
    expect([...copy.files["assets/other/images/a.webp"]]).toEqual([1, 2, 3]);
    expect([...copy.image!]).toEqual([9, 9]);
    expect((await listVersions(copy.id)).map((v) => v.label)).toEqual(["First"]);
    expect((await getChat(copy.id))!.messages).toHaveLength(1);
    expect(await getRecord(`engineer:${copy.id}`)).toBeTruthy();
    expect([...(await loadStudio(copy.id)).candidates!.s1[0].bytes]).toEqual([7]);
    expect((await getInterview(copy.id))!.facts).toEqual(["She rows."]);
    expect(await getSetting(`changes:${copy.id}`)).toHaveLength(1);
  });

  it("brings a project to a fresh device, personas and all, and can replace it", async () => {
    const { p, card } = await project();
    const bytes = (await exportBundle(p.id))!;
    await resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
    expect(await peekBundle(bytes)).toMatchObject({ exists: false });
    expect(await importBundle(bytes, "copy")).toBe(p.id);
    expect((await getCard(card.id))!.card.data.name).toBe("Sera");

    await saveProject({ ...(await listProjects())[0], name: "Changed" });
    await importBundle(bytes, "replace");
    expect((await listProjects()).map((x) => x.name)).toEqual(["Ferry"]);
    expect(await listCards(p.id)).toHaveLength(1);
  });

  it("refuses files that aren't bundles", async () => {
    await expect(peekBundle(new Uint8Array([1, 2, 3]))).rejects.toThrow("isn't a CardForge project bundle");
  });
});

describe("libraries", () => {
  it("packs every library, the older ones too, and imports by name", async () => {
    await saveItem("npc", "Holt", { fields: { name: "Holt", role: "Ferryman" } });
    await saveItem("greetings", "Noir grid", { moods: ["Tense"], places: ["Docks"], stages: ["Strangers"] });
    await putSetting("mechanicsLibrary", [{ id: "m1", name: "Mana" }]);
    const pack = readPack(packBytes(await makePack(["npc", "greetings", "mechanics"])));
    expect(pack.items.map((i) => i.name)).toEqual(["Holt", "Noir grid"]);

    await resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
    await saveItem("npc", "Holt", { fields: { name: "Holt", role: "Old" } });
    await importPack(pack);
    expect((await loadItems("npc")).map((i) => i.payload.fields.role)).toEqual(["Ferryman"]);
    expect((await loadItems("greetings"))[0].payload.places).toEqual(["Docks"]);
    expect(await getSetting("mechanicsLibrary")).toEqual([{ id: "m1", name: "Mana" }]);
    expect(() => readPack(new TextEncoder().encode("{}"))).toThrow("isn't a CardForge pack");
  });

  it("adapts saved shots and story templates to a new card", () => {
    const shots = shotsFor([{ ...shot, subject: "entry:9", place: "entry:4" }], new Set(["card"]));
    expect(shots[0]).toMatchObject({ subject: "card", place: undefined });
    expect(shots[0].id).not.toBe("s1");
    expect(storyTemplateText({ settings: {} as never, beats: [{ title: "The debt", summary: "A debt comes due." }], ending: "Paid in full." })).toMatch(
      /keep its structure[\s\S]*1\. The debt: A debt comes due\.\nEnding: Paid in full\./,
    );
  });

  it("saves an NPC from the world pages and brings it into another card", async () => {
    const p = await createProject("P");
    const first = await createCard(p.id, "character");
    await useEditor.getState().open(first.id);
    useUi.setState({ tabRequest: { section: "lorebook", tab: "npcs" } });
    const view = render(<LorebookView />);
    fireEvent.click(screen.getByRole("button", { name: "Add NPC" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Holt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to library: NPC" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await loadItems("npc")).map((i) => i.name)).toEqual(["Holt"]));
    view.unmount();

    const second = await createCard(p.id, "character");
    await useEditor.getState().open(second.id);
    useUi.setState({ tabRequest: { section: "lorebook", tab: "npcs" } });
    render(<LorebookView />);
    fireEvent.click(screen.getByRole("button", { name: "From library: NPCs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Holt" }));
    const names = useEditor.getState().record!.card.data.character_book!.entries.map((e) => worldMeta(e)?.fields?.name);
    expect(names).toContain("Holt");
  });

  it("lists and deletes saved items on the Libraries page", async () => {
    await saveItem("lore", "Tide magic", { entries: [] });
    render(<LibrariesPage />);
    const lore = await screen.findByRole("region", { name: "Lore packs" });
    expect(await within(lore).findByText("Tide magic")).toBeInTheDocument();
    fireEvent.click(within(lore).getByRole("button", { name: "Delete Tide magic" }));
    await waitFor(() => expect(within(lore).queryByText("Tide magic")).toBeNull());
  });
});
