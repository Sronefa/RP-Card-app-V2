/**
 * The parts browser on the Modules tab: finished parts to add to the card (CardForge's own and the
 * author's saved modules), searchable by words and tags, each with a live preview on sample values.
 * Adding a part brings the parts it needs and fills it from the card. Below it, kits: a theme plus a
 * set of parts, CardForge's starter and the author's own, saved from a card.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import { EnginePreview } from "../../engine/engineer/preview";
import type { EngineModule } from "../../engine/modules/types";
import {
  allParts,
  applyKit,
  BUILT_IN_KITS,
  hasPart,
  installParts,
  kitFromConfig,
  partTags,
  searchParts,
  withMessageTags,
  type Installed,
  type Kit,
  type Part,
} from "../../engine/parts/catalog";
import { loadSandboxLibs } from "../../engine/sandbox/sandbox";
import { applyEngine, type EngineConfig } from "../../engine/sheet";
import { loadKits, removeKit, saveKit } from "./kitLibrary";
import { loadModuleLibrary } from "./moduleLibrary";
import { selectClass } from "./VarEditor";

/** Writes what an install did into the card: the engine and the opening message's tags. */
function commit(out: Installed) {
  const { record, replaceData } = useEditor.getState();
  const data = record!.card.data;
  replaceData(applyEngine({ ...data, first_mes: withMessageTags(data.first_mes, out.messageTags) }, out.config));
}

const names = (out: Installed) => out.added.map((m) => m.name).join(", ");

/** `onAdded` gets the index of the added part's module, to open its settings. */
export function PartsBrowser({ config, onAdded }: { config: EngineConfig; onAdded?: (index: number) => void }) {
  const [library, setLibrary] = useState<EngineModule[]>([]);
  useEffect(() => void loadModuleLibrary().then(setLibrary), []);
  const parts = allParts(library);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [preview, setPreview] = useState<Part>();
  const shown = searchParts(parts, query, tag);

  const install = (part: Part) => {
    try {
      const out = installParts(config, useEditor.getState().record!.card.data, [part.id], parts);
      commit(out);
      const index = (out.config.modules ?? []).findIndex((m) => m.id === part.id || m.core === part.id);
      if (index >= 0) onAdded?.(index);
      toast(out.added.length > 1 ? `Added ${names(out)}` : `Added ${part.name}${out.messageTags.length ? " to the first message" : ""}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Parts">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Parts</h2>
        <p className="text-xs text-ink-muted">
          Finished screens and systems to mix into the card. Each one fills itself from the card's world pages and brings
          the parts it needs. "Shared" ones are in every kit.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <TextInput aria-label="Search parts" placeholder="Search parts, e.g. relationships" className="min-w-0 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Tag" className={selectClass} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {partTags(parts).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">No parts match.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Parts to add">
          {shown.map((p) => {
            const installed = hasPart(config, p.id);
            return (
              <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {p.name}
                    {p.source === "mine" && <span className="ml-2 rounded-full bg-accent/15 px-2 text-xs text-accent">Mine</span>}
                  </div>
                  <div className="text-xs text-ink-muted">{p.summary}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <button key={t} type="button" className="rounded-full border border-border px-2 text-xs text-ink-muted" onClick={() => setTag(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                  {p.requires.length > 0 && <div className="mt-1 text-xs text-ink-muted">Brings {p.requires.map((r) => parts.find((x) => x.id === r)?.name ?? r).join(", ")}</div>}
                </div>
                <div className="mt-auto flex gap-2">
                  <Button variant="ghost" aria-label={`Preview the ${p.name.toLowerCase()}`} onClick={() => setPreview(p)}>
                    Preview
                  </Button>
                  {installed ? (
                    <span className="ml-auto self-center text-xs text-ink-muted">In the card</span>
                  ) : (
                    <Button className="ml-auto" aria-label={`Add the ${p.name.toLowerCase()}`} onClick={() => install(p)}>
                      Add
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Kits config={config} parts={parts} />
      {preview && <PartPreview part={preview} parts={parts} config={config} onClose={() => setPreview(undefined)} />}
    </section>
  );
}

function Kits({ config, parts }: { config: EngineConfig; parts: Part[] }) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [name, setName] = useState("");
  useEffect(() => void loadKits().then(setKits), []);
  const use = (kit: Kit) => {
    try {
      const out = applyKit(config, useEditor.getState().record!.card.data, kit, parts);
      commit(out);
      toast(out.added.length ? `Installed ${kit.name}: ${names(out)}` : `${kit.name} is already in the card${kit.theme ? "; its theme is on" : ""}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const save = async () => {
    const kit = kitFromConfig(config, name);
    setKits(await saveKit(kit));
    setName("");
    toast(`Saved the kit "${kit.name}"`);
  };
  return (
    <section className="flex flex-col gap-2" aria-label="Kits">
      <h2 className="text-sm font-medium">Kits</h2>
      <p className="text-xs text-ink-muted">A kit is a theme plus a set of parts. Installing one adds what the card doesn't have yet, filled from this card.</p>
      <ul className="flex flex-col gap-2">
        {[...BUILT_IN_KITS, ...kits].map((k) => (
          <li key={k.id} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{k.name}</div>
              <div className="text-xs text-ink-muted">
                {k.description || `${k.parts.length + k.modules.length} parts${k.theme ? `, the ${k.theme.preset} theme` : ""}`}
              </div>
            </div>
            <Button aria-label={`Install ${k.name}`} onClick={() => use(k)}>
              Install
            </Button>
            {!k.builtIn && (
              <Button variant="ghost" aria-label={`Delete ${k.name}`} onClick={() => void removeKit(k.id).then(setKits)}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <TextInput aria-label="Kit name" placeholder="Kit name, e.g. My noir kit" className="min-w-0 flex-1" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!name.trim()} onClick={() => void save()}>
          Save this card as a kit
        </Button>
      </div>
      <p className="text-xs text-ink-muted">It keeps the theme and the parts with their settings, without this card's names, places and pictures.</p>
    </section>
  );
}

/** A part running alone in the sandbox, on sample values. */
function PartPreview({ part, parts, config, onClose }: { part: Part; parts: Part[]; config: EngineConfig; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading the preview…");
  const script = part.make().slot === "script";
  useEffect(() => {
    if (script || !host.current) return;
    const preview = new EnginePreview(host.current, true);
    let live = true;
    void (async () => {
      try {
        const libs = await loadSandboxLibs();
        const data = useEditor.getState().record!.card.data;
        // The menu shows the card's own screens; any other part runs on its own.
        const base = part.id === "menu" ? config : { ...config, modules: [] };
        const settings = part.previewSettings ? { [part.id]: part.previewSettings } : {};
        const out = installParts(base, data, [part.id], parts, settings);
        const card = applyEngine({ ...data, first_mes: withMessageTags(`A preview of the ${part.name.toLowerCase()}.`, out.messageTags), alternate_greetings: [] }, out.config);
        await preview.load({ data: card, libs, device: "phone", scenario: [] });
        if (!live) return;
        if (part.sample) await preview.setSample(part.sample);
        if (out.config.modules?.find((m) => m.id === part.id)?.slot === "overlay") await preview.open(part.id);
        if (live) setStatus("");
      } catch (e) {
        if (live) setStatus(`The preview didn't run: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
      preview.dispose();
    };
    // The preview starts once per part; the card changing under the dialog doesn't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);
  return (
    <Dialog open title={`Preview: ${part.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-ink-muted">{part.summary}</p>
        {script ? (
          <p className="rounded-lg border border-border p-3">This part has no screen of its own: it works behind the scenes after every reply.</p>
        ) : (
          <>
            {status && <p role="status">{status}</p>}
            <div ref={host} className="mx-auto h-[560px] w-full max-w-[390px] overflow-hidden rounded-xl border border-border" />
            <p className="text-xs text-ink-muted">Sample values; the part fills itself from your card when you add it.</p>
          </>
        )}
        <p className="text-xs text-ink-muted">To tailor after adding: {part.tailor}</p>
        <Button className="self-end" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
