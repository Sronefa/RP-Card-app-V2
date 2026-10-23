export type SectionId = "library" | "editor" | "lorebook" | "assets" | "cowriter";

export interface Section {
  id: SectionId;
  label: string;
  icon: string;
}

export const SECTIONS: Section[] = [
  { id: "library", label: "Library", icon: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" },
  { id: "editor", label: "Editor", icon: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4" },
  { id: "lorebook", label: "Lorebook", icon: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" },
  { id: "assets", label: "Assets", icon: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01" },
  { id: "cowriter", label: "Co-writer", icon: "M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" },
];
