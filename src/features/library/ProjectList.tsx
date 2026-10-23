import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { Button, EmptyState, TextInput } from "../../components/ui";
import { createProject, listProjects, type ProjectRecord } from "../../db/db";

export function ProjectList() {
  const setProjectId = useUi((s) => s.setProjectId);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [name, setName] = useState("");

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const project = await createProject(name.trim() || "Untitled project");
    setName("");
    setProjectId(project.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label="New project name" />
        <Button type="submit" variant="primary" className="shrink-0">
          New project
        </Button>
      </form>
      {projects?.length === 0 && (
        <EmptyState title="No projects yet">
          <p className="text-ink-muted">
            A project holds one world, its characters and the personas you play. Create one to start.
          </p>
        </EmptyState>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {projects?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setProjectId(p.id)}
              className="w-full rounded-xl border border-border bg-surface-raised p-4 text-left hover:border-ink-muted"
            >
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-ink-muted">Edited {new Date(p.updatedAt).toLocaleString()}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
