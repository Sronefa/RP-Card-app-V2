import { useEffect, useState } from "react";
import { Button, Dialog, TextInput } from "../../components/ui";
import { listVersions, type VersionRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { toast } from "../../components/toast";

export function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cardId = useEditor((s) => s.record?.id);
  const { saveVersion, restoreVersion } = useEditor();
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (open && cardId) void listVersions(cardId).then(setVersions);
  }, [open, cardId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await saveVersion(label.trim() || "Saved version");
    setLabel("");
    setVersions(await listVersions(cardId!));
  }

  async function restore(v: VersionRecord) {
    await restoreVersion(v);
    toast(`Restored "${v.label}". Undo or History can bring the previous text back.`);
    onClose();
  }

  return (
    <Dialog open={open} title="Version history" onClose={onClose}>
      <form onSubmit={save} className="mb-4 flex gap-2">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version" aria-label="Version name" />
        <Button type="submit" variant="primary" className="shrink-0">
          Save version
        </Button>
      </form>
      <p className="mb-2 text-xs text-ink-muted">
        Versions are also saved automatically every few minutes while you edit. Images are not versioned.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{v.label}</div>
              <div className="text-xs text-ink-muted">
                {new Date(v.createdAt).toLocaleString()} · {v.card.data.name}
              </div>
            </div>
            <Button onClick={() => void restore(v)}>Restore</Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
