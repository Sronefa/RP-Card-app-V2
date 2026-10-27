import { useUi, type LibraryTab } from "../../app/store";
import { LibrariesPage } from "./LibrariesPage";
import { PersonaLibrary } from "./PersonaLibrary";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectList } from "./ProjectList";

const TABS: { id: LibraryTab; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "personas", label: "Personas" },
  { id: "libraries", label: "Libraries" },
];

export function LibraryView() {
  const { libraryTab, setLibraryTab, projectId } = useUi();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-6">
      <div role="tablist" className="flex gap-1 self-start rounded-lg border border-border bg-surface-sunken p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={libraryTab === t.id}
            onClick={() => setLibraryTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm ${libraryTab === t.id ? "bg-surface-raised text-ink" : "text-ink-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {libraryTab === "libraries" ? <LibrariesPage /> : libraryTab === "personas" ? <PersonaLibrary /> : projectId ? <ProjectDetail projectId={projectId} /> : <ProjectList />}
    </div>
  );
}
