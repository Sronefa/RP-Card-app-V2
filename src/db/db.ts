/**
 * Local storage for projects, cards, versions and personas, in IndexedDB.
 * IndexedDB persists in the Tauri webview on Windows and Android, and works in the browser and tests.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { newCard } from "../card";
import type { CardPackage, CharacterCardV3 } from "../card";
import { newId } from "../lib/id";
import type { ChatRecord, CowriterSettings, InterviewRecord } from "../ai/records";
import type { GuideState } from "../app/guide";

export type CardKind = "character" | "world";

export interface ProjectRecord {
  id: string;
  name: string;
  /** Personas from the shared library used in this project. */
  personaIds: string[];
  /** Co-writer settings for this project; defaults apply when missing. */
  cowriter?: CowriterSettings;
  /** The guided path's switch, skipped steps and steps marked done. */
  guide?: GuideState;
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
  /** App settings by key, such as the co-writer's providers and prompt library. */
  settings: { key: string; value: { key: string; value: unknown } };
  /** Co-writer conversations, keyed by card id (or `lore:<card id>` for the lorebook brainstorm). */
  chats: { key: string; value: ChatRecord };
  /** The interview and story bible per card. */
  interviews: { key: string; value: InterviewRecord };
}

/** Versions kept per card; older ones are pruned. */
export const MAX_VERSIONS = 50;

const DB_NAME = "cardforge";
let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db() {
  dbPromise ??= openDB<Schema>(DB_NAME, 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("projects", { keyPath: "id" });
        d.createObjectStore("cards", { keyPath: "id" }).createIndex("projectId", "projectId");
        d.createObjectStore("versions", { keyPath: "id" }).createIndex("cardId", "cardId");
        d.createObjectStore("personas", { keyPath: "id" });
      }
      if (oldVersion < 2) {
        d.createObjectStore("settings", { keyPath: "key" });
        d.createObjectStore("chats", { keyPath: "cardId" });
      }
      if (oldVersion < 3) d.createObjectStore("interviews", { keyPath: "cardId" });
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

/** Keys of the records kept for a card: its own id, or `<what>:<card id>`. */
const ofCard = (key: string, id: string) => key === id || key.endsWith(`:${id}`);

export async function deleteCard(id: string) {
  const d = await db();
  const versions = await d.getAllKeysFromIndex("versions", "cardId", id);
  const chats = (await d.getAllKeys("chats")).filter((k) => ofCard(k, id));
  const settings = (await d.getAllKeys("settings")).filter((k) => k.endsWith(`:${id}`));
  const tx = d.transaction(["cards", "versions", "chats", "interviews", "settings"], "readwrite");
  await Promise.all([
    ...versions.map((v) => tx.objectStore("versions").delete(v)),
    tx.objectStore("cards").delete(id),
    // The chats, the lorebook brainstorm, the engineer, the Image Studio, the inbox and the playtest.
    ...chats.map((k) => tx.objectStore("chats").delete(k)),
    // The change log and the greeting plan.
    ...settings.map((k) => tx.objectStore("settings").delete(k)),
    tx.objectStore("interviews").delete(id),
    tx.done,
  ]);
}

/** Everything a project holds, for a bundle file. */
export interface ProjectSnapshot {
  project: ProjectRecord;
  cards: CardRecord[];
  versions: VersionRecord[];
  /** Records in the chats store: chats, the engineer, the Image Studio, the inbox, playtests. */
  chats: { cardId: string }[];
  interviews: InterviewRecord[];
  /** Per-card settings: the change log and the greeting plan. */
  settings: { key: string; value: unknown }[];
  personas: PersonaRecord[];
}

export async function snapshotProject(id: string): Promise<ProjectSnapshot | undefined> {
  const d = await db();
  const project = await d.get("projects", id);
  if (!project) return undefined;
  const cards = await d.getAllFromIndex("cards", "projectId", id);
  const ids = cards.map((c) => c.id);
  const mine = (key: string) => ids.some((c) => ofCard(key, c));
  const versions = (await Promise.all(ids.map((c) => d.getAllFromIndex("versions", "cardId", c)))).flat();
  const chats = (await d.getAll("chats")).filter((c) => mine(c.cardId));
  const interviews = (await Promise.all(ids.map((c) => d.get("interviews", c)))).filter((i): i is InterviewRecord => !!i);
  const settings = (await d.getAll("settings")).filter((s) => ids.some((c) => s.key.endsWith(`:${c}`)));
  const personas = (await d.getAll("personas")).filter((p) => project.personaIds.includes(p.id));
  return { project, cards, versions, chats, interviews, settings, personas };
}

/** Writes a snapshot as it is. Personas already in the library are kept as they are. */
export async function restoreSnapshot(s: ProjectSnapshot) {
  const d = await db();
  const existing = new Set(await d.getAllKeys("personas"));
  const tx = d.transaction(["projects", "cards", "versions", "chats", "interviews", "settings", "personas"], "readwrite");
  await Promise.all([
    tx.objectStore("projects").put(s.project),
    ...s.cards.map((c) => tx.objectStore("cards").put(c)),
    ...s.versions.map((v) => tx.objectStore("versions").put(v)),
    ...s.chats.map((c) => tx.objectStore("chats").put(c as ChatRecord)),
    ...s.interviews.map((i) => tx.objectStore("interviews").put(i)),
    ...s.settings.map((x) => tx.objectStore("settings").put(x)),
    ...s.personas.filter((p) => !existing.has(p.id)).map((p) => tx.objectStore("personas").put(p)),
    tx.done,
  ]);
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

// Settings

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("settings", key))?.value as T | undefined;
}

export async function putSetting(key: string, value: unknown) {
  await (await db()).put("settings", { key, value });
}

// Co-writer chats and interviews

/** Key of a card's lorebook brainstorm chat. */
export const loreChatKey = (cardId: string) => `lore:${cardId}`;
/** Key of a card's UI engineer chat. */
export const engineerChatKey = (cardId: string) => `engineer:${cardId}`;
/** Key of a card's playtest record: the persona and saved game states. */
export const playtestKey = (cardId: string) => `playtest:${cardId}`;

/** A chat of another shape, kept in the same store under its own key. */
export async function getRecord<T extends { cardId: string }>(key: string): Promise<T | undefined> {
  return (await (await db()).get("chats", key)) as unknown as T | undefined;
}

export async function saveRecord<T extends { cardId: string }>(record: T) {
  await (await db()).put("chats", record as unknown as ChatRecord);
}

export async function getChat(key: string): Promise<ChatRecord | undefined> {
  return (await db()).get("chats", key);
}

export async function saveChat(chat: ChatRecord) {
  await (await db()).put("chats", chat);
}

export async function deleteChat(key: string) {
  await (await db()).delete("chats", key);
}

export async function getInterview(cardId: string): Promise<InterviewRecord | undefined> {
  return (await db()).get("interviews", cardId);
}

export async function saveInterview(interview: InterviewRecord) {
  await (await db()).put("interviews", interview);
}

export async function deleteInterview(cardId: string) {
  await (await db()).delete("interviews", cardId);
}
