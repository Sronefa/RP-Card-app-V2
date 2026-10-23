import { create } from "zustand";
import type { GroupId } from "../features/editor/fields";
import type { SectionId } from "./sections";

export type LibraryTab = "projects" | "personas";

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
}));
