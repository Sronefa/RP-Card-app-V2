import { create } from "zustand";

/** Bumped when parked items or handoff tasks change, so the inbox counts again. */
export const useInboxVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
