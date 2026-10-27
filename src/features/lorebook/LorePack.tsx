import { useState } from "react";
import type { Lorebook } from "../../card";
import { toast } from "../../components/toast";
import { Button, Dialog, TextInput } from "../../components/ui";
import { isArcEntry } from "../../editor/arc";
import { entryTitle, mergeBooks } from "../../editor/lorebook";
import { saveItem } from "../../lib/libraries";
import { FromLibrary } from "../library/LibraryButtons";

/** Saving chosen entries as a lore pack, and adding a saved pack to this lorebook. */
export function LorePacks({ book, onAdd }: { book: Lorebook; onAdd: (next: Lorebook) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // Story arc beats belong to their card's story.
  const entries = book.entries.map((entry, i) => ({ entry, i })).filter(({ entry }) => !isArcEntry(entry));

  const save = async () => {
    const chosen = entries.filter(({ i }) => picked.has(i)).map(({ entry }) => entry);
    await saveItem("lore", name, { entries: chosen });
    toast(`Saved the lore pack "${name.trim()}" with ${chosen.length === 1 ? "1 entry" : `${chosen.length} entries`}`);
    setOpen(false);
    setPicked(new Set());
    setName("");
  };

  return (
    <>
      {entries.length > 0 && <Button onClick={() => setOpen(true)}>Save a lore pack</Button>}
      <FromLibrary
        kind="lore"
        label="Add a lore pack"
        onUse={(item) => {
          onAdd(mergeBooks(book, { entries: item.payload.entries, extensions: {} }));
          toast(`Added ${item.name}: ${item.payload.entries.length} entries`);
        }}
      />
      <Dialog open={open} title="Save a lore pack" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-ink-muted">A magic system, a city, an economy: entries that go together, to add to other cards.</p>
          <label className="flex flex-col gap-1">
            Pack name
            <TextInput value={name} placeholder="e.g. The tide magic" onChange={(e) => setName(e.target.value)} />
          </label>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {entries.map(({ entry, i }) => (
              <li key={i}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setPicked(next);
                    }}
                  />
                  {entryTitle(entry)}
                </label>
              </li>
            ))}
          </ul>
          <Button variant="primary" className="self-end" disabled={!name.trim() || picked.size === 0} onClick={() => void save()}>
            Save {picked.size || ""} to the library
          </Button>
        </div>
      </Dialog>
    </>
  );
}
