import { useEffect, useState } from "react";
import { importPersona, toPersonaFile } from "../../card";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog, EmptyState, TextInput } from "../../components/ui";
import { createPersona, deletePersona, listPersonas, savePersona, type PersonaRecord } from "../../db/db";
import { pickFiles, readFileBytes, safeFileName, saveFile, toPng } from "../../lib/files";
import { useObjectUrl } from "../../lib/useObjectUrl";
import { utf8Encode } from "../../card/bytes";
import { estimateTokens } from "../../lib/tokens";

export function PersonaLibrary() {
  const [personas, setPersonas] = useState<PersonaRecord[]>();
  const [editing, setEditing] = useState<PersonaRecord>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = () => void listPersonas().then(setPersonas);
  useEffect(reload, []);

  async function create() {
    setEditing(await createPersona("New persona"));
    reload();
  }

  async function importFiles() {
    for (const file of await pickFiles(".json,application/json", true)) {
      try {
        const p = importPersona(await readFileBytes(file));
        await createPersona(p.name, p.description);
        toast(`Imported ${p.name}`);
      } catch (e) {
        toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
      }
    }
    reload();
  }

  async function save(persona: PersonaRecord) {
    setEditing(await savePersona(persona));
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">Personas are the characters you play. They are shared by all your projects.</p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void create()}>
          New persona
        </Button>
        <Button onClick={() => void importFiles()}>Import</Button>
      </div>
      {personas?.length === 0 && <EmptyState title="No personas yet" />}
      <ul className="grid gap-2 sm:grid-cols-2">
        {personas?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setEditing(p)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-raised p-3 text-left hover:border-ink-muted"
            >
              <PersonaAvatar persona={p} />
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-ink-muted">{p.description || "No description yet"}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={!!editing && !confirmDelete} title="Persona" onClose={() => setEditing(undefined)}>
        {editing && (
          <PersonaForm
            key={editing.id}
            persona={editing}
            onSave={(p) => void save(p)}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
      </Dialog>
      <Dialog open={confirmDelete} title={`Delete ${editing?.name}?`} onClose={() => setConfirmDelete(false)}>
        <p className="mb-4 text-ink-muted">It will be removed from every project that uses it.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              void deletePersona(editing!.id).then(reload);
              setConfirmDelete(false);
              setEditing(undefined);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function PersonaAvatar({ persona, className = "size-12" }: { persona: PersonaRecord; className?: string }) {
  const url = useObjectUrl(persona.avatar);
  return url ? (
    <img src={url} alt="" className={`${className} shrink-0 rounded-full object-cover`} />
  ) : (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted`}>
      {persona.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function PersonaForm({
  persona,
  onSave,
  onDelete,
}: {
  persona: PersonaRecord;
  onSave: (p: PersonaRecord) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(persona);
  const changed = draft !== persona;

  async function pickAvatar() {
    const [file] = await pickFiles("image/*");
    if (!file) return;
    try {
      setDraft({ ...draft, avatar: await toPng(file, 512) });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function exportPersona() {
    const json = JSON.stringify(toPersonaFile({ name: draft.name, description: draft.description, extensions: {} }), null, 2);
    const base = safeFileName(draft.name, "persona");
    await saveFile(`${base}.persona.json`, utf8Encode(json), { filterName: "Persona", extensions: ["json"], mime: "application/json" });
    if (draft.avatar) await saveFile(`${base}.png`, draft.avatar, { filterName: "PNG image", extensions: ["png"], mime: "image/png" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PersonaAvatar persona={draft} className="size-16" />
        <Button onClick={() => void pickAvatar()}>Change avatar</Button>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="flex justify-between">
          Description <span className="text-ink-muted">~{estimateTokens(draft.description)} tokens</span>
        </span>
        <AutoTextarea
          value={draft.description}
          placeholder="Who you play: appearance, personality, anything {{char}} should know. Keep it short (100 to 300 tokens)."
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
          <Button onClick={() => void exportPersona()}>Export</Button>
        </div>
        <Button variant="primary" disabled={!changed || !draft.name.trim()} onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </div>
  );
}
