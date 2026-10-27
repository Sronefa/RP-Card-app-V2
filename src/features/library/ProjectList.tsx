import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { Button, Dialog, EmptyState, TextInput } from "../../components/ui";
import { createProject, listProjects, type ProjectRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { BUNDLE_EXT, importBundle, peekBundle, type BundleInfo } from "../../lib/bundle";
import { pickFiles, readFileBytes } from "../../lib/files";

export function ProjectList() {
  const setProjectId = useUi((s) => s.setProjectId);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<{ bytes: Uint8Array; info: BundleInfo }>();

  useEffect(() => {
    void listProjects().then(setProjects);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const project = await createProject(name.trim() || "Untitled project");
    setName("");
    setProjectId(project.id);
  }

  async function pick() {
    const [file] = await pickFiles(`.${BUNDLE_EXT},.zip`);
    if (!file) return;
    try {
      const bytes = await readFileBytes(file);
      const info = await peekBundle(bytes);
      if (info.exists) setPending({ bytes, info });
      else await bringIn(bytes, "copy", info);
    } catch (e) {
      toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
    }
  }

  async function bringIn(bytes: Uint8Array, mode: "replace" | "copy", info: BundleInfo) {
    setPending(undefined);
    try {
      // The open card may be one the bundle replaces.
      if (mode === "replace" && useEditor.getState().record?.projectId === info.id) await useEditor.getState().close();
      const id = await importBundle(bytes, mode);
      toast(`Imported ${info.name} with ${info.cards === 1 ? "1 card" : `${info.cards} cards`}`);
      setProjects(await listProjects());
      setProjectId(id);
    } catch (e) {
      toast(`Couldn't import ${info.name}: ${(e as Error).message}`, "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          aria-label="New project name"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" className="shrink-0">
          New project
        </Button>
        <Button type="button" className="shrink-0" onClick={() => void pick()}>
          Import project
        </Button>
      </form>
      {projects?.length === 0 && (
        <EmptyState title="No projects yet">
          <p className="text-ink-muted">
            A project holds one world, its characters and the personas you play. Create one to start, or import a project
            file from another device.
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
      {pending && (
        <Dialog open title="This project is already here" onClose={() => setPending(undefined)}>
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {pending.info.name} is on this device already. Replace it with the file, or keep both and bring the file in as a
              copy?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => void bringIn(pending.bytes, "copy", pending.info)}>Keep both</Button>
              <Button variant="danger" onClick={() => void bringIn(pending.bytes, "replace", pending.info)}>
                Replace it
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
