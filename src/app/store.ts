import { create } from "zustand";
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
}

export const useUi = create<UiState>((set) => ({
  section: "library",
  setSection: (section) => set({ section }),
  setProjectId: (projectId) => set({ projectId }),
  libraryTab: "projects",
  setLibraryTab: (libraryTab) => set({ libraryTab }),
}));
