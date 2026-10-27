import { useState } from "react";
import type { Filed } from "../../ai/interviewTools";
import { Button, Dialog } from "../../components/ui";
import { plainEntries, sortLorebook } from "../../cowriter/worldScan";
import { emptyBook, entryTitle } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { guessWorldKind, KINDS, plainFields, syncCast, TYPED_KINDS, worldEntry, type TypedKind } from "../../editor/world";
import { useRun } from "../cowriter/useRun";

interface Row extends Filed {
  id: string;
  title: string;
  on: boolean;
}

/**
 * "Sort my lorebook": files plain entries that describe a person, place, item or shop under their
 * world page, so they show there and the co-writer edits them by their fields.
 */
export function SortLorebook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>();
  const { busy, run, status } = useRun();
  const record = useEditor((s) => s.record)!;
  const plain = plainEntries(record.card.data);
  const titles = new Map(plain.map((e) => [String(e.id), entryTitle(e)]));

  const show = (filed: Filed[]) =>
    setRows(
      filed
        .filter((f): f is Filed & { id: string } => f.kind !== "other" && !!f.id && titles.has(f.id))
        .map((f) => ({ ...f, title: titles.get(f.id)!, on: true })),
    );

  function quickSort() {
    show(
      plain.flatMap((e): Filed[] => {
        const kind = guessWorldKind(entryTitle(e), e.content);
        return kind ? [{ id: String(e.id), kind, fields: plainFields(kind, entryTitle(e), e.keys, e.content) }] : [];
      }),
    );
  }

  function apply() {
    const chosen = new Map(rows!.filter((r) => r.on).map((r) => [r.id, r]));
    const book = useEditor.getState().record!.card.data.character_book ?? emptyBook();
    const entries = book.entries.map((e) => {
      const r = chosen.get(String(e.id));
      return r ? worldEntry(book, r.kind as TypedKind, r.fields, e) : e;
    });
    useEditor.getState().setField("character_book", syncCast({ ...book, entries }), null);
    close();
  }

  function close() {
    setRows(undefined);
    onClose();
  }

  const picked = rows?.filter((r) => r.on).length ?? 0;
  return (
    <Dialog open={open} title="Sort my lorebook" onClose={close}>
      <div className="flex flex-col gap-3 text-sm">
        {!rows ? (
          <>
            <p className="text-ink-muted">
              {plain.length} {plain.length === 1 ? "entry is" : "entries are"} plain text. Entries about one person, place,
              item or shop can move onto the NPCs, Places and Economy pages, where they're kept as fields and the co-writer
              edits them without drift. You review the list before anything moves.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={!!busy || !plain.length}
                onClick={() =>
                  void run("The co-writer is reading the entries…", async (signal) => {
                    const filed = await sortLorebook(useEditor.getState().record!, signal);
                    show(filed);
                  })
                }
              >
                ✦ Sort with the co-writer
              </Button>
              <Button disabled={!!busy || !plain.length} onClick={quickSort}>
                Quick sort without AI
              </Button>
            </div>
            {status}
          </>
        ) : rows.length === 0 ? (
          <>
            <p className="text-ink-muted">None of the plain entries is about a single person, place, item or shop.</p>
            <Button className="self-end" onClick={close}>
              Close
            </Button>
          </>
        ) : (
          <>
            <p className="text-ink-muted">
              Each entry keeps its id, keys and settings; its text is rewritten from the fields. Undo puts everything back.
            </p>
            <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto" aria-label="Entries to move">
              {rows.map((r, i) => (
                <li key={r.id} className="flex flex-col gap-1 rounded-lg bg-surface-sunken p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={r.on}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                      />
                      <span className="truncate font-medium">{r.title}</span>
                    </label>
                    <select
                      aria-label={`Page for ${r.title}`}
                      value={r.kind}
                      className="rounded-md border border-border bg-surface px-2 py-1"
                      onChange={(e) => {
                        const kind = e.target.value as TypedKind;
                        // Fields carry over where the kinds share them; the rest stays in the text field.
                        const entry = plain.find((p) => String(p.id) === r.id)!;
                        const fields = { ...plainFields(kind, r.fields.name || r.title, entry.keys, entry.content) };
                        for (const f of KINDS[kind].fields) if (r.fields[f.key]) fields[f.key] = r.fields[f.key];
                        setRows(rows.map((x, j) => (j === i ? { ...x, kind, fields } : x)));
                      }}
                    >
                      {TYPED_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k === "npc" ? "NPC" : KINDS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-xs text-ink-muted">
                    {KINDS[r.kind as TypedKind].fields
                      .slice(1)
                      .filter((f) => r.fields[f.key])
                      .map((f) => f.label)
                      .join(", ") || "Name only"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!picked} onClick={apply}>
                Move {picked} {picked === 1 ? "entry" : "entries"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
