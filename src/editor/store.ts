/**
 * State of the card open in the editor: undo/redo history, autosave and version snapshots.
 */
import { create } from "zustand";
import type { CardDataV3 } from "../card";
import {
  addVersion,
  getCard,
  listVersions,
  saveCard,
  type CardKind,
  type CardRecord,
  type VersionRecord,
} from "../db/db";

/** Typing in the same field within this window is one undo step. */
export const COALESCE_MS = 1500;
/** Delay between the last change and the autosave. */
export const AUTOSAVE_MS = 700;
/** Autosave also snapshots a version when the last one is older than this. */
export const AUTO_VERSION_MS = 5 * 60 * 1000;
const MAX_UNDO = 200;

export type SaveState = "saved" | "unsaved" | "saving" | "error";

interface EditorState {
  record?: CardRecord;
  past: CardDataV3[];
  future: CardDataV3[];
  saveState: SaveState;
  lastEdit?: { key: string; at: number };
  lastVersionAt: number;

  open: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /**
   * Sets a card field. Changes with the same coalesceKey in quick succession are one undo step;
   * it defaults to the field name (typing in a text box). Pass null for a change that is always its own step.
   */
  setField: <K extends keyof CardDataV3>(field: K, value: CardDataV3[K], coalesceKey?: string | null) => void;
  replaceData: (data: CardDataV3) => void;
  setKind: (kind: CardKind) => void;
  setImage: (image: Uint8Array | undefined) => void;
  /** Adds asset files to the package. Files are not part of undo; unused ones are left out on export. */
  addFiles: (files: Record<string, Uint8Array>) => void;
  undo: () => void;
  redo: () => void;
  flush: () => Promise<void>;
  saveVersion: (label: string) => Promise<void>;
  restoreVersion: (version: VersionRecord) => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useEditor = create<EditorState>((set, get) => {
  /** Applies new card data, recording an undo step unless it continues the previous edit. */
  function apply(data: CardDataV3, coalesceKey?: string) {
    const { record, past, lastEdit } = get();
    if (!record) return;
    const now = Date.now();
    const continues = coalesceKey && lastEdit?.key === coalesceKey && now - lastEdit.at < COALESCE_MS;
    set({
      record: { ...record, card: { ...record.card, data } },
      past: continues ? past : [...past, record.card.data].slice(-MAX_UNDO),
      future: [],
      lastEdit: coalesceKey ? { key: coalesceKey, at: now } : undefined,
    });
    scheduleSave();
  }

  function scheduleSave() {
    set({ saveState: "unsaved" });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), AUTOSAVE_MS);
  }

  return {
    past: [],
    future: [],
    saveState: "saved",
    lastVersionAt: 0,

    async open(id) {
      if (get().record?.id === id) return;
      await get().close();
      const record = await getCard(id);
      if (!record) throw new Error("Card not found");
      const versions = await listVersions(id);
      let lastVersionAt = versions[0]?.createdAt ?? 0;
      if (versions.length === 0) lastVersionAt = (await addVersion(id, record.card, "Original")).createdAt;
      set({ record, past: [], future: [], saveState: "saved", lastEdit: undefined, lastVersionAt });
    },

    async close() {
      await get().flush();
      set({ record: undefined, past: [], future: [], lastEdit: undefined, saveState: "saved" });
    },

    setField(field, value, coalesceKey = String(field)) {
      const { record } = get();
      if (!record) return;
      apply({ ...record.card.data, [field]: value }, coalesceKey ?? undefined);
    },

    replaceData(data) {
      apply(data);
    },

    setKind(kind) {
      const { record } = get();
      if (!record || record.kind === kind) return;
      set({ record: { ...record, kind } });
      scheduleSave();
    },

    setImage(image) {
      const { record } = get();
      if (!record) return;
      set({ record: { ...record, image } });
      scheduleSave();
    },

    addFiles(files) {
      const { record } = get();
      if (!record) return;
      set({ record: { ...record, files: { ...record.files, ...files } } });
      scheduleSave();
    },

    undo() {
      const { record, past, future } = get();
      if (!record || past.length === 0) return;
      set({
        record: { ...record, card: { ...record.card, data: past[past.length - 1] } },
        past: past.slice(0, -1),
        future: [record.card.data, ...future],
        lastEdit: undefined,
      });
      scheduleSave();
    },

    redo() {
      const { record, past, future } = get();
      if (!record || future.length === 0) return;
      set({
        record: { ...record, card: { ...record.card, data: future[0] } },
        past: [...past, record.card.data],
        future: future.slice(1),
        lastEdit: undefined,
      });
      scheduleSave();
    },

    async flush() {
      clearTimeout(saveTimer);
      const { record, saveState, lastVersionAt } = get();
      if (!record || saveState === "saved") return;
      set({ saveState: "saving" });
      try {
        const saved = await saveCard(record);
        let versionAt = lastVersionAt;
        if (Date.now() - lastVersionAt > AUTO_VERSION_MS) {
          versionAt = (await addVersion(saved.id, saved.card, "Autosave")).createdAt;
        }
        // Keep edits made while saving; only mark saved if nothing changed meanwhile.
        const current = get().record;
        const unchanged =
          current?.card === record.card &&
          current.image === record.image &&
          current.kind === record.kind &&
          current.files === record.files;
        set({
          lastVersionAt: versionAt,
          saveState: unchanged ? "saved" : "unsaved",
          ...(unchanged ? { record: saved } : {}),
        });
      } catch {
        set({ saveState: "error" });
      }
    },

    async saveVersion(label) {
      await get().flush();
      const { record } = get();
      if (!record) return;
      const version = await addVersion(record.id, record.card, label);
      set({ lastVersionAt: version.createdAt });
    },

    async restoreVersion(version) {
      const { record } = get();
      if (!record) return;
      // Snapshot the current state first, so a restore can itself be undone from history.
      await addVersion(record.id, record.card, "Before restore");
      apply(structuredClone(version.card.data));
      await get().flush();
    },
  };
});

/**
 * Saves pending edits right away when the app is hidden or closed
 * (switching apps on Android, minimizing or closing the window on Windows).
 */
export function installSaveOnExit() {
  const save = () => void useEditor.getState().flush();
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save());
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);
}
