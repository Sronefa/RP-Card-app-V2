import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_VERSIONS,
  addVersion,
  createCard,
  createPersona,
  createProject,
  deleteCard,
  deletePersona,
  deleteProject,
  getCard,
  listCards,
  listProjects,
  listVersions,
  resetDbForTests,
  saveCard,
  saveProject,
} from "./db";

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
});

describe("db", () => {
  it("creates projects with world and character cards", async () => {
    const project = await createProject("Eldoria");
    const world = await createCard(project.id, "world");
    await createCard(project.id, "character");
    expect(world.card.data.name).toBe("New world");
    expect((await listCards(project.id)).map((c) => c.kind).sort()).toEqual(["character", "world"]);
    expect((await listProjects()).map((p) => p.name)).toEqual(["Eldoria"]);
  });

  it("stamps the modification date on save", async () => {
    const project = await createProject("p");
    const card = await createCard(project.id, "character");
    const saved = await saveCard({ ...card, card: { ...card.card, data: { ...card.card.data, modification_date: 1 } } });
    expect(saved.card.data.modification_date).toBeGreaterThan(1_600_000_000);
    expect((await getCard(card.id))?.card.data.modification_date).toBe(saved.card.data.modification_date);
  });

  it("prunes old versions and deletes them with the card", async () => {
    const project = await createProject("p");
    const card = await createCard(project.id, "character");
    for (let i = 0; i < MAX_VERSIONS + 3; i++) await addVersion(card.id, card.card, `v${i}`);
    const versions = await listVersions(card.id);
    expect(versions).toHaveLength(MAX_VERSIONS);
    // Newest first and the newest are kept, even when several are made in the same millisecond.
    expect(versions[0].label).toBe(`v${MAX_VERSIONS + 2}`);
    expect(versions.at(-1)?.label).toBe("v3");
    await deleteCard(card.id);
    expect(await listVersions(card.id)).toHaveLength(0);
  });

  it("deletes a project with its cards", async () => {
    const project = await createProject("p");
    const card = await createCard(project.id, "character");
    await deleteProject(project.id);
    expect(await getCard(card.id)).toBeUndefined();
    expect(await listProjects()).toEqual([]);
  });

  it("unlinks a deleted persona from projects", async () => {
    const persona = await createPersona("Alex");
    const project = await createProject("p");
    await saveProject({ ...project, personaIds: [persona.id] });
    await deletePersona(persona.id);
    expect((await listProjects())[0].personaIds).toEqual([]);
  });
});
