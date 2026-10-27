/**
 * Project bundles: a whole project in one file, to move it between devices by hand. The file is a
 * zip with `bundle.json` (the project, cards, history, chats, interviews, per-card settings and
 * linked personas) and every image and asset as its own entry under `bin/`.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { deleteProject, getProject, restoreSnapshot, snapshotProject, type ProjectSnapshot } from "../db/db";
import { newId } from "./id";

const FORMAT = "cardforge-bundle";
export const BUNDLE_EXT = "cardforge";

interface BundleJson {
  format: typeof FORMAT;
  version: 1;
  exportedAt: number;
  snapshot: ProjectSnapshot;
}

/** The project as bundle bytes, or undefined if it doesn't exist. */
export async function exportBundle(projectId: string): Promise<Uint8Array | undefined> {
  const snapshot = await snapshotProject(projectId);
  if (!snapshot) return undefined;
  const files: Record<string, Uint8Array> = {};
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: Date.now(), snapshot } satisfies BundleJson, (_, value) => {
    // Bytes read back from the database can come from another realm, so `instanceof` isn't enough.
    if (!ArrayBuffer.isView(value) || value instanceof DataView) return value;
    const path = `bin/${Object.keys(files).length}`;
    files[path] = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { $bin: path };
  });
  // Images are compressed already, so they are stored as they are.
  return zipSync({ "bundle.json": [strToU8(json), { level: 6 }], ...Object.fromEntries(Object.entries(files).map(([p, b]) => [p, [b, { level: 0 }]])) });
}

function readBundle(bytes: Uint8Array): ProjectSnapshot {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("This isn't a CardForge project bundle.");
  }
  const raw = entries["bundle.json"];
  if (!raw) throw new Error("This isn't a CardForge project bundle.");
  const parsed = JSON.parse(strFromU8(raw), (_, value) => {
    if (value && typeof value === "object" && typeof value.$bin === "string" && Object.keys(value).length === 1) {
      const file = entries[value.$bin];
      if (!file) throw new Error(`The bundle is missing ${value.$bin}.`);
      return file;
    }
    return value;
  }) as Partial<BundleJson>;
  if (parsed.format !== FORMAT || !parsed.snapshot?.project) throw new Error("This isn't a CardForge project bundle.");
  if ((parsed.version ?? 0) > 1) throw new Error("This bundle is from a newer CardForge. Update the app to open it.");
  const s = parsed.snapshot;
  return { ...s, cards: s.cards ?? [], versions: s.versions ?? [], chats: s.chats ?? [], interviews: s.interviews ?? [], settings: s.settings ?? [], personas: s.personas ?? [] };
}

export interface BundleInfo {
  id: string;
  name: string;
  cards: number;
  /** A project with the same id is on this device: the bundle can replace it or come in as a copy. */
  exists: boolean;
}

export async function peekBundle(bytes: Uint8Array): Promise<BundleInfo> {
  const s = readBundle(bytes);
  return { id: s.project.id, name: s.project.name, cards: s.cards.length, exists: !!(await getProject(s.project.id)) };
}

/** Swaps a card id inside a record key: `<id>` or `<what>:<id>`. */
function rekey(key: string, ids: Map<string, string>): string {
  const i = key.lastIndexOf(":");
  const [prefix, id] = i === -1 ? ["", key] : [key.slice(0, i + 1), key.slice(i + 1)];
  return ids.has(id) ? prefix + ids.get(id)! : key;
}

/** The same project under new ids, so it sits next to the original. */
function asCopy(s: ProjectSnapshot): ProjectSnapshot {
  const projectId = newId();
  const ids = new Map(s.cards.map((c) => [c.id, newId()]));
  const now = Date.now();
  return {
    ...s,
    project: { ...s.project, id: projectId, name: `${s.project.name} (copy)`, updatedAt: now },
    cards: s.cards.map((c) => ({ ...c, id: ids.get(c.id)!, projectId })),
    versions: s.versions.map((v) => ({ ...v, id: newId(), cardId: ids.get(v.cardId) ?? v.cardId })),
    chats: s.chats.map((c) => ({ ...c, cardId: rekey(c.cardId, ids) })),
    interviews: s.interviews.map((i) => ({ ...i, cardId: ids.get(i.cardId) ?? i.cardId })),
    settings: s.settings.map((x) => ({ ...x, key: rekey(x.key, ids) })),
  };
}

/** Brings a bundle in: replacing the project with the same id, or as a copy. Returns the project id. */
export async function importBundle(bytes: Uint8Array, mode: "replace" | "copy"): Promise<string> {
  const read = readBundle(bytes);
  const exists = !!(await getProject(read.project.id));
  const snapshot = exists && mode === "copy" ? asCopy(read) : read;
  if (exists && mode === "replace") await deleteProject(read.project.id);
  await restoreSnapshot(snapshot);
  return snapshot.project.id;
}
