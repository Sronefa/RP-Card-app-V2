import { create } from "zustand";
import type { SectionId } from "./sections";

interface UiState {
  section: SectionId;
  setSection: (section: SectionId) => void;
}

export const useUi = create<UiState>((set) => ({
  section: "editor",
  setSection: (section) => set({ section }),
}));
