import { useRef, useState } from "react";
import { pitchWorldTool, readWorldPitches } from "../../ai/interviewTools";
import { npcScanRequest, systemPrompt, worldPitchRequest } from "../../ai/prompts";
import type { CardDataV3, Lorebook, LorebookEntry } from "../../card";
import { isArcEntry, readArc } from "../../editor/arc";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { complete, gatherContext, isAbort, partsText } from "../../cowriter/engine";
import { emptyBook } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";
import { isKind, KINDS, setCastList, syncCast, worldEntry, worldMeta, type WorldKind } from "../../editor/world";
import { estimateTokens } from "../../lib/tokens";
import { BulkItems, CurrencyInterview } from "./EconomyTools";

function useBook() {
  const record = useEditor((s) => s.record)!;
  const setField = useEditor((s) => s.setField);
  const book = record.card.data.character_book ?? emptyBook();
  const setBook = (next: Lorebook, coalesceKey?: string) =>
    setField("character_book", syncCast(next), coalesceKey ?? null);
  return { record, book, setBook };
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One page of the world: a list of NPCs, places, items or shops, or the single currency. */
export function WorldPage({
  kind,
  intro,
  single,
  onOpenArc,
}: {
  kind: WorldKind;
  intro?: string;
  single?: boolean;
  /** Opens the story arc tab, where the antagonist is edited. */
  onOpenArc?: () => void;
}) {
  const { record, book, setBook } = useBook();
  const def = KINDS[kind];
  const [open, setOpen] = useState<number>();
  const items = book.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => isKind(entry, kind));
  const castOn = book.entries.some((e) => isKind(e, "cast"));

  function add(fields: Record<string, string>) {
    // Read the book fresh: several pitches can be added in one go.
    const current = useEditor.getState().record!.card.data.character_book ?? emptyBook();
    const entry = worldEntry(current, kind, fields);
    setBook({ ...current, entries: [...current.entries, entry] });
    return current.entries.length;
  }
  const update = (index: number, fields: Record<string, string>, key: string) =>
    setBook(
      { ...book, entries: book.entries.map((e, i) => (i === index ? worldEntry(book, kind, fields, e) : e)) },
      `world.${index}.${key}`,
    );
  const remove = (index: number) => {
    setBook({ ...book, entries: book.entries.filter((_, i) => i !== index) });
    setOpen(undefined);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={def.plural}>
      {intro && <p className="text-sm text-ink-muted">{intro}</p>}
      {kind === "npc" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={castOn}
            onChange={(e) => setBook(setCastList(book, e.target.checked))}
          />
          <span>
            Keep a cast list always on: one line per NPC with their voice, so the narrator never mixes them up
            {castOn && ` (~${estimateTokens(book.entries.find((e) => isKind(e, "cast"))!.content)} tokens)`}.
          </span>
        </label>
      )}
      <ul className="flex flex-col gap-2">
        {kind === "npc" && <Antagonist data={record.card.data} onOpenArc={onOpenArc} />}
        {items.map(({ entry, index }) => (
          <li key={index}>
            <WorldItem
              kind={kind}
              entry={entry}
              open={single || open === index}
              onToggle={() => setOpen(open === index ? undefined : index)}
              onChange={(fields, key) => update(index, fields, key)}
              onDelete={single ? undefined : () => remove(index)}
            />
          </li>
        ))}
      </ul>
      {!(single && items.length > 0) && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen(add({ name: "" }))}>Add {def.label}</Button>
        </div>
      )}
      <Pitches
        kind={kind}
        count={single ? 1 : 3}
        existing={[
          ...items.map(({ entry }) => worldMeta(entry)!.fields.name),
          kind === "npc" ? (readArc(record.card.data)?.antagonist?.name ?? "") : "",
        ].filter(Boolean)}
        record={record}
        disabled={single && items.length > 0}
        onAdd={add}
      />
    </section>
  );
}

/** The story arc's antagonist is an NPC too; it is edited on the arc page and stays masked while the arc is secret. */
function Antagonist({ data, onOpenArc }: { data: CardDataV3; onOpenArc?: () => void }) {
  const arc = readArc(data);
  const a = arc?.antagonist;
  if (!arc || !a?.name.trim() || arc.settings.antagonist === "none" || !data.character_book?.entries.some(isArcEntry)) return null;
  return (
    <li>
      <button
        type="button"
        onClick={onOpenArc}
        className="flex w-full items-baseline justify-between gap-2 rounded-xl border border-dashed border-border p-3 text-left"
      >
        <span className="min-w-0">
          <span className="font-medium">{arc.hidden ? "The antagonist" : a.name}</span>
          <span className="ml-2 truncate text-sm text-ink-muted">
            {arc.hidden ? "kept secret by the story arc" : a.role || "antagonist"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-ink-muted">Story arc</span>
      </button>
    </li>
  );
}

function WorldItem({
  kind,
  entry,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  kind: WorldKind;
  entry: LorebookEntry;
  open: boolean;
  onToggle: () => void;
  onChange: (fields: Record<string, string>, key: string) => void;
  onDelete?: () => void;
}) {
  const def = KINDS[kind];
  const fields = worldMeta(entry)!.fields;
  const summary = def.fields
    .slice(1)
    .map((f) => fields[f.key])
    .find((v) => v?.trim());
  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-baseline justify-between gap-2 p-3 text-left"
      >
        <span className="min-w-0">
          <span className="font-medium">{fields.name || `New ${def.label}`}</span>
          {summary && <span className="ml-2 truncate text-sm text-ink-muted">{summary}</span>}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">~{estimateTokens(entry.content)} tokens</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {def.fields.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              {f.label}
              {f.multiline ? (
                <AutoTextarea
                  rows={2}
                  value={fields[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => onChange({ ...fields, [f.key]: e.target.value }, f.key)}
                />
              ) : (
                <TextInput
                  value={fields[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => onChange({ ...fields, [f.key]: e.target.value }, f.key)}
                />
              )}
            </label>
          ))}
          <p className="text-xs text-ink-muted">
            Triggers on: {entry.keys.join(", ") || "nothing yet, add a name"}. The lorebook entry is written from these
            fields.
          </p>
          {onDelete && (
            <Button variant="danger" className="self-start" onClick={onDelete}>
              Delete {def.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Asks the co-writer for ideas for this page and lists them to add. */
function Pitches({
  kind,
  count,
  existing,
  record,
  disabled,
  onAdd,
}: {
  kind: WorldKind;
  count: number;
  existing: string[];
  record: NonNullable<ReturnType<typeof useEditor.getState>["record"]>;
  disabled?: boolean;
  onAdd: (fields: Record<string, string>) => void;
}) {
  const def = KINDS[kind];
  const [ask, setAsk] = useState("");
  const [pitches, setPitches] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);

  async function suggest(scan = false) {
    setBusy(true);
    setError(undefined);
    controller.current = new AbortController();
    try {
      const tool = pitchWorldTool(kind);
      const parts = await gatherContext(record);
      const request = scan ? npcScanRequest(existing) : worldPitchRequest({ many: def.many, existing, count, ask });
      const result = await complete("world", {
        system: systemPrompt("world"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${request}` }],
        tools: [tool],
        signal: controller.current.signal,
      });
      const call = result.toolCalls.find((c) => c.name === tool.name);
      const next = call ? readWorldPitches(call, kind) : [];
      if (!next.length)
        throw new Error(
          scan
            ? "The card doesn't mention anyone who isn't on this page yet."
            : "The co-writer didn't pitch anything. Try again.",
        );
      setPitches(next);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (disabled && pitches.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          Ask the co-writer
          <TextInput
            value={ask}
            placeholder={kind === "npc" ? "e.g. someone at the docks who knows {{char}}" : "Optional: what you want"}
            onChange={(e) => setAsk(e.target.value)}
          />
        </label>
        <Button disabled={busy || disabled} onClick={() => void suggest()}>
          ✦ Suggest {count === 1 ? def.label : def.many}
        </Button>
        {kind === "npc" && (
          <Button disabled={busy} onClick={() => void suggest(true)}>
            ✦ Find NPCs in the card
          </Button>
        )}
        {busy && (
          <Button variant="ghost" onClick={() => controller.current?.abort()}>
            Stop
          </Button>
        )}
      </div>
      {busy && (
        <p className="text-sm text-ink-muted" aria-live="polite">
          Working on {count === 1 ? `a ${def.label}` : def.many}…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {pitches.length > 1 && !disabled && (
        <Button
          className="self-end"
          onClick={() => {
            pitches.forEach((p) => onAdd(p));
            setPitches([]);
          }}
        >
          Add all {pitches.length}
        </Button>
      )}
      {pitches.map((p, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-lg bg-surface-sunken p-3 text-sm">
          <span className="font-medium">{p.name}</span>
          {def.fields.slice(1).map(
            (f) =>
              p[f.key] && (
                <span key={f.key} className="text-ink-muted">
                  <span className="text-ink">{f.label}:</span> {p[f.key]}
                </span>
              ),
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPitches(pitches.filter((_, j) => j !== i))}>
              Skip
            </Button>
            <Button
              variant="primary"
              aria-label={`Add ${p.name}`}
              disabled={disabled}
              onClick={() => {
                onAdd(p);
                setPitches(pitches.filter((_, j) => j !== i));
              }}
            >
              Add
            </Button>
          </div>
        </div>
      ))}
      {pitches.length === 0 && !busy && (
        <p className="text-xs text-ink-muted">
          {capital(def.many)} are pitched from the card, the story bible and what's already here.
        </p>
      )}
    </div>
  );
}

/** Currency, items and shops on one page. */
export function EconomyPage() {
  const { record, setBook } = useBook();
  const [dialog, setDialog] = useState<"currency" | "items">();
  const fresh = () => useEditor.getState().record!.card.data.character_book ?? emptyBook();
  const named = (kind: WorldKind) =>
    fresh()
      .entries.filter((e) => isKind(e, kind))
      .map((e) => worldMeta(e)!.fields.name)
      .filter(Boolean);
  const hasCurrency = fresh().entries.some((e) => isKind(e, "currency"));

  function saveCurrency(fields: Record<string, string>) {
    const book = fresh();
    const i = book.entries.findIndex((e) => isKind(e, "currency"));
    const entry = worldEntry(book, "currency", fields, i === -1 ? undefined : book.entries[i]);
    setBook({
      ...book,
      entries: i === -1 ? [...book.entries, entry] : book.entries.map((e, j) => (j === i ? entry : e)),
    });
    setDialog(undefined);
  }
  function addItems(items: Record<string, string>[]) {
    let book = fresh();
    for (const fields of items) book = { ...book, entries: [...book.entries, worldEntry(book, "item", fields)] };
    setBook(book);
    setDialog(undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-muted">
        Money, what things cost and where to buy them. Each becomes an XML-tagged lorebook entry that only comes up when
        the chat talks about it.
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Currency</h3>
          <Button onClick={() => setDialog("currency")}>
            {hasCurrency ? "✦ Redo it with an interview" : "✦ Build it with an interview"}
          </Button>
        </div>
        <WorldPage kind="currency" single />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Items and prices</h3>
          <Button onClick={() => setDialog("items")}>✦ Make items in bulk</Button>
        </div>
        <WorldPage kind="item" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Shops</h3>
        <WorldPage kind="shop" />
      </div>
      {dialog === "currency" && (
        <CurrencyInterview record={record} onClose={() => setDialog(undefined)} onSave={saveCurrency} />
      )}
      {dialog === "items" && (
        <BulkItems
          record={record}
          existing={named("item")}
          shops={named("shop")}
          onClose={() => setDialog(undefined)}
          onAdd={addItems}
        />
      )}
    </div>
  );
}
