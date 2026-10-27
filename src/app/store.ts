import { create } from "zustand";
import type { GroupId } from "../features/editor/fields";
import type { SectionId } from "./sections";

export type LibraryTab = "projects" | "personas" | "libraries";
export type CowriterTab = "chat" | "interview";

interface UiState {
  section: SectionId;
  setSection: (section: SectionId) => void;
  /** Project open in the library, if any. */
  projectId?: string;
  setProjectId: (projectId: string | undefined) => void;
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  /** Editor group shown in the card editor. */
  editorGroup: GroupId;
  setEditorGroup: (group: GroupId) => void;
  /** Lorebook entry to open and scroll to, set when jumping from the card checker. */
  focusEntry?: number;
  setFocusEntry: (index: number | undefined) => void;
  /** Tab shown in the co-writer section. */
  cowriterTab: CowriterTab;
  setCowriterTab: (tab: CowriterTab) => void;
  /** An engine art slot being filled: the Assets page shows the images that fit it. */
  assetPick?: AssetPick;
  setAssetPick: (pick: AssetPick | undefined) => void;
  /** A tab another screen asked a section to open on, taken once by that section. */
  tabRequest?: { section: SectionId; tab: string };
  /** Opens a section, on one of its tabs. */
  goTo: (section: SectionId, tab?: string) => void;
  takeTabRequest: () => void;
}

export interface AssetPick {
  label: string;
  tag: { kind: string; subject?: string; variant?: string };
}

export const useUi = create<UiState>((set) => ({
  section: "library",
  setSection: (section) => set({ section }),
  setProjectId: (projectId) => set({ projectId }),
  libraryTab: "projects",
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  editorGroup: "basics",
  setEditorGroup: (editorGroup) => set({ editorGroup }),
  setFocusEntry: (focusEntry) => set({ focusEntry }),
  cowriterTab: "chat",
  setCowriterTab: (cowriterTab) => set({ cowriterTab }),
  setAssetPick: (assetPick) => set({ assetPick }),
  goTo: (section, tab) => set({ section, tabRequest: tab ? { section, tab } : undefined }),
  takeTabRequest: () => set({ tabRequest: undefined }),
}));
