/**
 * Local storage for projects, cards, versions and personas, in IndexedDB.
 * IndexedDB persists in the Tauri webview on Windows and Android, and works in the browser and tests.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { newCard } from "../card";
import type { CardPackage, CharacterCardV3 } from "../card";
import { newId } from "../lib/id";

export type CardKind = "character" | "world";

export interface ProjectRecord {
  id: string;
  name: string;
  /** Personas from the shared library used in this project. */
  personaIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CardRecord extends CardPackage {
  id: string;
  projectId: string;
  kind: CardKind;
  createdAt: number;
  updatedAt: number;
}

export interface VersionRecord {
  id: string;
  cardId: string;
  createdAt: number;
  label: string;
  /** Snapshot of the card JSON. Asset files are not versioned. */
  card: CharacterCardV3;
}

export interface PersonaRecord {
  id: string;
  name: string;
  description: string;
  /** Avatar as PNG bytes. */
  avatar?: Uint8Array;
  createdAt: number;
  updatedAt: number;
}

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectRecord };
  cards: { key: string; value: CardRecord; indexes: { projectId: string } };
  versions: { key: string; value: VersionRecord; indexes: { cardId: string } };
  personas: { key: string; value: PersonaRecord };
}

/** Versions kept per card; older ones are pruned. */
export const MAX_VERSIONS = 50;

const DB_NAME = "cardforge";
let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore("projects", { keyPath: "id" });
      d.createObjectStore("cards", { keyPath: "id" }).createIndex("projectId", "projectId");
      d.createObjectStore("versions", { keyPath: "id" }).createIndex("cardId", "cardId");
      d.createObjectStore("personas", { keyPath: "id" });
    },
  });
  return dbPromise;
}

/** Test helper: closes and forgets the connection so a fresh database can be used. */
export async function resetDbForTests() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = undefined;
}

const byUpdated = <T extends { updatedAt: number }>(a: T, b: T) => b.updatedAt - a.updatedAt;

// Projects

export async function listProjects(): Promise<ProjectRecord[]> {
  return (await (await db()).getAll("projects")).sort(byUpdated);
}

export async function getProject(id: string) {
  return (await db()).get("projects", id);
}

export async function createProject(name: string): Promise<ProjectRecord> {
  const now = Date.now();
  const project: ProjectRecord = { id: newId(), name, personaIds: [], createdAt: now, updatedAt: now };
  await (await db()).put("projects", project);
  return project;
}

export async function saveProject(project: ProjectRecord): Promise<ProjectRecord> {
  const saved = { ...project, updatedAt: Date.now() };
  await (await db()).put("projects", saved);
  return saved;
}

export async function deleteProject(id: string) {
  const d = await db();
  const cards = await d.getAllKeysFromIndex("cards", "projectId", id);
  for (const cardId of cards) await deleteCard(cardId);
  await d.delete("projects", id);
}

// Cards

export async function listCards(projectId: string): Promise<CardRecord[]> {
  return (await (await db()).getAllFromIndex("cards", "projectId", projectId)).sort(byUpdated);
}

export async function getCard(id: string) {
  return (await db()).get("cards", id);
}

export async function createCard(
  projectId: string,
  kind: CardKind,
  pkg: CardPackage = { card: newCard(kind === "world" ? "New world" : "New character"), files: {} },
): Promise<CardRecord> {
  const now = Date.now();
  const record: CardRecord = { ...pkg, id: newId(), projectId, kind, createdAt: now, updatedAt: now };
  await (await db()).put("cards", record);
  await touchProject(projectId);
  return record;
}

/** Saves a card, stamping its modification time in the record and in the card itself. */
export async function saveCard(record: CardRecord): Promise<CardRecord> {
  const now = Date.now();
  const saved: CardRecord = {
    ...record,
    updatedAt: now,
    card: { ...record.card, data: { ...record.card.data, modification_date: Math.floor(now / 1000) } },
  };
  await (await db()).put("cards", saved);
  await touchProject(record.projectId);
  return saved;
}

export async function deleteCard(id: string) {
  const d = await db();
  const versions = await d.getAllKeysFromIndex("versions", "cardId", id);
  const tx = d.transaction(["cards", "versions"], "readwrite");
  await Promise.all([...versions.map((v) => tx.objectStore("versions").delete(v)), tx.objectStore("cards").delete(id), tx.done]);
}

async function touchProject(projectId: string) {
  const project = await getProject(projectId);
  if (project) await (await db()).put("projects", { ...project, updatedAt: Date.now() });
}

// Versions

export async function listVersions(cardId: string): Promise<VersionRecord[]> {
  const versions = await (await db()).getAllFromIndex("versions", "cardId", cardId);
  return versions.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addVersion(cardId: string, card: CharacterCardV3, label: string): Promise<VersionRecord> {
  const d = await db();
  const existing = await listVersions(cardId);
  // Keep times strictly increasing so versions made in the same millisecond still sort in order.
  const createdAt = Math.max(Date.now(), (existing[0]?.createdAt ?? 0) + 1);
  const version: VersionRecord = { id: newId(), cardId, createdAt, label, card: structuredClone(card) };
  await d.put("versions", version);
  for (const old of existing.slice(MAX_VERSIONS - 1)) await d.delete("versions", old.id);
  return version;
}

// Personas

export async function listPersonas(): Promise<PersonaRecord[]> {
  return (await (await db()).getAll("personas")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPersona(name: string, description = ""): Promise<PersonaRecord> {
  const now = Date.now();
  const persona: PersonaRecord = { id: newId(), name, description, createdAt: now, updatedAt: now };
  await (await db()).put("personas", persona);
  return persona;
}

export async function savePersona(persona: PersonaRecord): Promise<PersonaRecord> {
  const saved = { ...persona, updatedAt: Date.now() };
  await (await db()).put("personas", saved);
  return saved;
}

/** Deletes a persona from the library and unlinks it from every project. */
export async function deletePersona(id: string) {
  const d = await db();
  for (const project of await d.getAll("projects")) {
    if (project.personaIds.includes(id)) {
      await d.put("projects", { ...project, personaIds: project.personaIds.filter((p) => p !== id) });
    }
  }
  await d.delete("personas", id);
}
