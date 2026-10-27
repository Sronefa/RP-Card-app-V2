import { useEffect, useRef, useState } from "react";
import {
  importCard,
  importLorebook,
  toLorebookV3File,
  toWorldInfo,
  type Lorebook,
  type LorebookEntry,
} from "../../card";
import { utf8Encode } from "../../card/bytes";
import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { Button, Dialog, TextInput } from "../../components/ui";
import { emptyBook, entryTitle, mergeBooks, newEntry } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { pickFiles, readFileBytes, safeFileName, saveFile } from "../../lib/files";
import { CardBar } from "../editor/CardBar";
import { NoCard } from "../editor/NoCard";
import { EntryEditor } from "./EntryEditor";
import { EconomyPage, WorldPage } from "../world/WorldPage";
import { LoreBrainstorm } from "./LoreBrainstorm";
import { SortLorebook } from "./SortLorebook";
import { isPlainEntry } from "../../editor/world";
import { ArcPage } from "../arc/ArcPage";
import { arcHidden, constantTokens, isArcEntry } from "../../editor/arc";
import { useViewTab } from "../../app/useViewTab";
import { LorePacks } from "./LorePack";

const TABS = {
  entries: "Entries",
  npcs: "NPCs",
  places: "Places",
  economy: "Economy",
  arc: "Story arc",
  brainstorm: "Brainstorm",
} as const;
type Tab = keyof typeof TABS;

export function LorebookView() {
  const record = useEditor((s) => s.record);
  const setField = useEditor((s) => s.setField);
  const { focusEntry, setFocusEntry } = useUi();
  const [open, setOpen] = useState<number | undefined>(focusEntry);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"settings" | "export" | "sort">();
  const [tab, setTab] = useViewTab<Tab>("lorebook", "entries");
  const list = useRef<HTMLUListElement>(null);

  // Jump to the entry the card checker pointed at.
  useEffect(() => {
    if (focusEntry === undefined) return;
    setOpen(focusEntry);
    setQuery("");
    setTab("entries");
    setFocusEntry(undefined);
    requestAnimationFrame(() => list.current?.children[focusEntry]?.scrollIntoView?.({ block: "start" }));
  }, [focusEntry, setFocusEntry]);

  if (!record) return <NoCard />;

  const book = record.card.data.character_book ?? emptyBook();
  const setBook = (next: Lorebook, coalesceKey?: string) => setField("character_book", next, coalesceKey ?? null);
  const setEntries = (entries: LorebookEntry[], coalesceKey?: string) => setBook({ ...book, entries }, coalesceKey);

  function add() {
    setEntries([...book.entries, newEntry(book)]);
    setOpen(book.entries.length);
    setQuery("");
  }

  async function importFiles() {
    for (const file of await pickFiles(".json,.png,.charx,application/json,image/png", true)) {
      try {
        const bytes = await readFileBytes(file);
        const incoming = /\.json$/i.test(file.name)
          ? importLorebook(bytes)
          : importCard(bytes).card.data.character_book;
        if (!incoming || incoming.entries.length === 0) throw new Error("no lorebook entries in this file");
        const current = useEditor.getState().record?.card.data.character_book;
        setField("character_book", current ? mergeBooks(current, incoming) : incoming, null);
        toast(`Added ${incoming.entries.length} entries from ${file.name}`);
      } catch (e) {
        toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
      }
    }
  }

  async function exportAs(format: "v3" | "worldinfo") {
    setDialog(undefined);
    const json = format === "v3" ? toLorebookV3File(book) : toWorldInfo(book);
    const base = safeFileName(book.name || `${record!.card.data.name} lorebook`, "lorebook");
    await saveFile(`${base}.json`, utf8Encode(JSON.stringify(json, null, 2)), {
      filterName: "Lorebook",
      extensions: ["json"],
      mime: "application/json",
    });
  }

  const q = query.trim().toLowerCase();
  const secret = arcHidden(record.card.data);
  // A secret arc shows as one line in the list.
  const firstArc = book.entries.findIndex(isArcEntry);
  const arcCount = book.entries.filter(isArcEntry).length;
  const matches = (e: LorebookEntry) =>
    !q ||
    (!(secret && isArcEntry(e)) &&
      [entryTitle(e), e.content, ...e.keys, ...(e.secondary_keys ?? [])].some((t) => t.toLowerCase().includes(q)));
  const alwaysOn = constantTokens(book.entries);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 pb-3 backdrop-blur">
        <CardBar detail={`${book.entries.length} entries · ~${alwaysOn} always-on tokens`} />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
        <div role="tablist" aria-label="Lorebook" className="grid grid-cols-3 rounded-lg border border-border p-0.5 sm:flex">
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-9 flex-1 rounded-md px-1.5 text-sm whitespace-nowrap ${tab === t ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
            >
              {TABS[t]}
            </button>
          ))}
        </div>
        {tab === "brainstorm" ? (
          <LoreBrainstorm />
        ) : tab === "npcs" ? (
          <WorldPage
            kind="npc"
            onOpenArc={() => setTab("arc")}
            intro="Everyone the narrator may voice. Each NPC is a lorebook entry that comes up when they're named; the voice note keeps them from all sounding alike."
          />
        ) : tab === "places" ? (
          <WorldPage
            kind="location"
            intro="Places with their mood and what they feel like to be in. Each one is a lorebook entry that comes up when the place is named."
          />
        ) : tab === "economy" ? (
          <EconomyPage />
        ) : tab === "arc" ? (
          <ArcPage />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Entries are added to the prompt only when one of their keys appears in the chat, so details that aren't
              always needed cost no tokens. Constant entries are always sent.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={add}>
                Add entry
              </Button>
              <Button onClick={() => void importFiles()}>Import</Button>
              <Button disabled={book.entries.length === 0} onClick={() => setDialog("export")}>
                Export
              </Button>
              <Button onClick={() => setDialog("settings")}>Book settings</Button>
              {book.entries.some(isPlainEntry) && <Button onClick={() => setDialog("sort")}>✦ Sort my lorebook</Button>}
              <LorePacks book={book} onAdd={(next) => setBook(next)} />
            </div>
            {book.entries.length > 3 && (
              <TextInput
                type="search"
                aria-label="Search entries"
                placeholder="Search entries"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            {book.entries.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-ink-muted">
                No entries yet. Add one, or import a lorebook or SillyTavern World Info file.
              </p>
            )}
            <ul ref={list} className="flex flex-col gap-2">
              {book.entries.map((entry, i) => (
                <li
                  key={i}
                  hidden={!matches(entry) || (secret && isArcEntry(entry) && i !== firstArc)}
                  className="scroll-mt-32"
                >
                  {secret && isArcEntry(entry) ? (
                    <button
                      type="button"
                      onClick={() => setTab("arc")}
                      className="w-full rounded-xl border border-dashed border-border p-3 text-left text-sm text-ink-muted"
                    >
                      {arcCount} story arc entries, kept secret. Reveal them on the Story arc tab.
                    </button>
                  ) : (
                    <EntryEditor
                      entry={entry}
                      index={i}
                      count={book.entries.length}
                      open={open === i}
                      onToggle={() => setOpen(open === i ? undefined : i)}
                      onChange={(next, coalesceKey) =>
                        setEntries(
                          book.entries.map((e, j) => (j === i ? next : e)),
                          coalesceKey && `lore.${i}.${coalesceKey}`,
                        )
                      }
                      onMove={(by) => {
                        const next = [...book.entries];
                        [next[i], next[i + by]] = [next[i + by], next[i]];
                        setEntries(next);
                        if (open === i) setOpen(i + by);
                      }}
                      onDuplicate={() => {
                        const copy = { ...structuredClone(entry), id: newEntry(book).id };
                        setEntries([...book.entries.slice(0, i + 1), copy, ...book.entries.slice(i + 1)]);
                        setOpen(i + 1);
                      }}
                      onDelete={() => {
                        setEntries(book.entries.filter((_, j) => j !== i));
                        setOpen(undefined);
                        toast("Entry deleted. Undo with ↶ if that was a mistake.");
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Dialog open={dialog === "settings"} title="Book settings" onClose={() => setDialog(undefined)}>
        <BookSettings book={book} onChange={setBook} />
      </Dialog>
      <SortLorebook open={dialog === "sort"} onClose={() => setDialog(undefined)} />
      <Dialog open={dialog === "export"} title="Export lorebook" onClose={() => setDialog(undefined)}>
        <p className="mb-4 text-sm text-ink-muted">
          The lorebook is already inside the card when you export it. Export it on its own to share it or to use it as a
          SillyTavern World.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={() => void exportAs("worldinfo")}>
            SillyTavern World Info (.json)
          </Button>
          <Button onClick={() => void exportAs("v3")}>Character Card V3 lorebook (.json)</Button>
        </div>
      </Dialog>
    </div>
  );
}

function BookSettings({
  book,
  onChange,
}: {
  book: Lorebook;
  onChange: (book: Lorebook, coalesceKey?: string) => void;
}) {
  const num = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.round(Number(v)) || 0));
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput
          value={book.name ?? ""}
          onChange={(e) => onChange({ ...book, name: e.target.value || undefined }, "book.name")}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description
        <TextInput
          value={book.description ?? ""}
          onChange={(e) => onChange({ ...book, description: e.target.value || undefined }, "book.description")}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Scan depth
        <span className="text-xs text-ink-muted">
          How many recent messages are searched for keys. Empty uses the app's setting.
        </span>
        <TextInput
          type="number"
          min={0}
          inputMode="numeric"
          value={book.scan_depth ?? ""}
          onChange={(e) => onChange({ ...book, scan_depth: num(e.target.value) }, "book.scan_depth")}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Token budget
        <span className="text-xs text-ink-muted">
          Most tokens the lorebook may add to one prompt. Empty uses the app's setting.
        </span>
        <TextInput
          type="number"
          min={0}
          inputMode="numeric"
          value={book.token_budget ?? ""}
          onChange={(e) => onChange({ ...book, token_budget: num(e.target.value) }, "book.token_budget")}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={book.recursive_scanning ?? false}
          onChange={(e) => onChange({ ...book, recursive_scanning: e.target.checked })}
        />
        Recursive scanning: entries can trigger other entries
      </label>
    </div>
  );
}
