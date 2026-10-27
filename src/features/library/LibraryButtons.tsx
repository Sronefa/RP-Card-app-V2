import { useEffect, useState } from "react";
import { toast } from "../../components/toast";
import { Button, Dialog, TextInput } from "../../components/ui";
import { LIBRARY_KINDS, loadItems, saveItem, type LibraryItem, type LibraryKind, type Payloads } from "../../lib/libraries";

/** "Save to library": names the item, then keeps it for every project. */
export function SaveToLibrary<K extends LibraryKind>({
  kind,
  name,
  payload,
  label = "Save to library",
}: {
  kind: K;
  name: string;
  /** Read when saving, so it has the latest edits. */
  payload: () => Payloads[K];
  label?: string;
}) {
  const [naming, setNaming] = useState<string>();
  const one = LIBRARY_KINDS[kind].one;
  const save = async () => {
    const chosen = naming!.trim() || name;
    setNaming(undefined);
    await saveItem(kind, chosen, payload());
    toast(`Saved the ${one} "${chosen}" to your library`);
  };
  return (
    <>
      <Button variant="ghost" aria-label={`${label}: ${one}`} onClick={() => setNaming(name)}>
        {label}
      </Button>
      {naming !== undefined && (
        <Dialog open title={`Save the ${one}`} onClose={() => setNaming(undefined)}>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="flex flex-col gap-1">
              Name in the library
              <TextInput autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} />
            </label>
            <p className="text-xs text-ink-muted">One with the same name is replaced. Libraries are on the Library page, where they export as pack files.</p>
            <Button type="submit" variant="primary" className="self-end">
              Save
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** "From library": lists the saved items of one kind to use one. */
export function FromLibrary<K extends LibraryKind>({
  kind,
  onUse,
  label = "From library",
}: {
  kind: K;
  onUse: (item: LibraryItem<K>) => void;
  label?: string;
}) {
  const [items, setItems] = useState<LibraryItem<K>[]>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) void loadItems(kind).then(setItems);
  }, [open, kind]);
  const info = LIBRARY_KINDS[kind];
  return (
    <>
      <Button variant="ghost" aria-label={`${label}: ${info.label}`} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} title={info.label} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink-muted">{info.hint}</p>
          {items?.length === 0 && <p>No saved {info.label.toLowerCase()} yet. Save one with "Save to library", or import a pack on the Library page.</p>}
          <ul className="flex flex-col gap-1">
            {items?.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-lg bg-surface-sunken p-2">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <Button
                  aria-label={`Use ${item.name}`}
                  onClick={() => {
                    setOpen(false);
                    onUse(item);
                  }}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
