import { useCallback, useEffect, useState } from "react";
import { toast } from "../../components/toast";
import { Button } from "../../components/ui";
import { getSetting } from "../../db/db";
import { pickFiles, readFileBytes, safeFileName, saveFile } from "../../lib/files";
import {
  EXTRA_KEYS,
  EXTRA_LABELS,
  importPack,
  LIBRARY_KINDS,
  loadItems,
  makePack,
  PACK_EXT,
  packBytes,
  packSummary,
  readPack,
  removeItem,
  type ExtraKind,
  type LibraryItem,
  type LibraryKind,
} from "../../lib/libraries";

const KINDS = Object.keys(LIBRARY_KINDS) as LibraryKind[];
const EXTRAS = Object.keys(EXTRA_LABELS) as ExtraKind[];

/** Every library, with pack files to move them to another device or share them. */
export function LibrariesPage() {
  const [items, setItems] = useState<Partial<Record<LibraryKind, LibraryItem[]>>>({});
  const [extras, setExtras] = useState<Partial<Record<ExtraKind, number>>>({});

  const reload = useCallback(async () => {
    setItems(Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, await loadItems(k)]))));
    setExtras(Object.fromEntries(await Promise.all(EXTRAS.map(async (k) => [k, ((await getSetting<unknown[]>(EXTRA_KEYS[k])) ?? []).length]))));
  }, []);
  useEffect(() => void reload(), [reload]);

  const exportPack = async (name: string, kinds: (LibraryKind | ExtraKind)[], only?: LibraryItem[]) => {
    const pack = await makePack(kinds, only);
    const saved = await saveFile(`${safeFileName(name, "pack")}.${PACK_EXT}`, packBytes(pack), {
      filterName: "CardForge pack",
      extensions: [PACK_EXT],
      mime: "application/json",
    });
    if (saved) toast(`Exported ${packSummary(pack)}`);
  };

  const importFiles = async () => {
    for (const file of await pickFiles(`.${PACK_EXT},.json`, true)) {
      try {
        const pack = readPack(await readFileBytes(file));
        await importPack(pack);
        toast(`Added ${packSummary(pack)} from ${file.name}`);
      } catch (e) {
        toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
      }
    }
    await reload();
  };

  const total = KINDS.reduce((n, k) => n + (items[k]?.length ?? 0), 0) + EXTRAS.reduce((n, k) => n + (extras[k] ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">
          Things you saved to reuse in any project. A pack file carries them to another device or to a friend; importing one
          adds its items, replacing ones with the same name.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void importFiles()}>
            Import a pack
          </Button>
          <Button disabled={!total} onClick={() => void exportPack("CardForge libraries", [...KINDS, ...EXTRAS])}>
            Export everything as a pack
          </Button>
        </div>
      </div>
      {KINDS.map((kind) => {
        const list = items[kind] ?? [];
        const info = LIBRARY_KINDS[kind];
        return (
          <section key={kind} className="flex flex-col gap-2" aria-label={info.label}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {info.label} <span className="text-sm font-normal text-ink-muted">({list.length})</span>
              </h2>
              {list.length > 0 && (
                <Button variant="ghost" onClick={() => void exportPack(info.label, [kind])}>
                  Export as a pack
                </Button>
              )}
            </div>
            <p className="text-xs text-ink-muted">{info.hint}</p>
            {list.length > 0 && (
              <ul className="flex flex-col gap-1">
                {list.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg bg-surface-raised p-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-ink-muted">{new Date(item.createdAt).toLocaleDateString()}</span>
                    <Button variant="ghost" aria-label={`Export ${item.name}`} onClick={() => void exportPack(item.name, [], [item])}>
                      Export
                    </Button>
                    <Button variant="ghost" aria-label={`Delete ${item.name}`} onClick={() => void removeItem(kind, item.id).then(reload)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <section className="flex flex-col gap-2" aria-label="Engine and mechanics libraries">
        <h2 className="font-semibold">Mechanics, engine parts and kits</h2>
        <p className="text-xs text-ink-muted">Managed where you use them; they travel in packs too.</p>
        <ul className="flex flex-col gap-1 text-sm">
          {EXTRAS.map((k) => (
            <li key={k} className="flex items-center gap-2 rounded-lg bg-surface-raised p-2">
              <span className="flex-1">
                {EXTRA_LABELS[k]} <span className="text-ink-muted">({extras[k] ?? 0})</span>
              </span>
              {(extras[k] ?? 0) > 0 && (
                <Button variant="ghost" aria-label={`Export ${EXTRA_LABELS[k]}`} onClick={() => void exportPack(EXTRA_LABELS[k], [k])}>
                  Export
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
