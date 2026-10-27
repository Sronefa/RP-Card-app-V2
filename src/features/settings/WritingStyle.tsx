import { useState } from "react";
import { useAiSettings } from "../../ai/settings";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { BUILT_IN_PACKS, packsWith, type CraftPack, type StyleSample } from "../../cowriter/style";
import { newId } from "../../lib/id";

/** Style samples to imitate and the genre craft packs, shared by every project. */
export function WritingStyle() {
  const { settings, update } = useAiSettings();
  const samples = settings.styleSamples ?? [];
  const packs = packsWith(settings.craftPacks);
  const [sample, setSample] = useState<StyleSample>();
  const [pack, setPack] = useState<CraftPack>();

  const saveSample = (s: StyleSample) => {
    void update({ styleSamples: samples.some((x) => x.id === s.id) ? samples.map((x) => (x.id === s.id ? s : x)) : [...samples, s] });
    setSample(undefined);
  };
  const savePack = (p: CraftPack) => {
    const mine = (settings.craftPacks ?? []).filter((x) => x.id !== p.id);
    void update({ craftPacks: [...mine, { ...p, builtIn: undefined, match: p.match.map((m) => m.trim().toLowerCase()).filter(Boolean) }] });
    setPack(undefined);
  };
  const edited = (id: string) => (settings.craftPacks ?? []).some((p) => p.id === id);
  const builtIn = (id: string) => BUILT_IN_PACKS.some((p) => p.id === id);

  return (
    <>
      <section className="flex flex-col gap-3" aria-label="Style samples">
        <h2 className="font-medium">Style samples</h2>
        <p className="text-sm text-ink-muted">
          Passages you love, from cards, books or your own writing. A project or card that picks one has the co-writer imitate its
          rhythm, sentence length, register and dialogue, not its content.
        </p>
        <ul className="flex flex-col gap-2">
          {samples.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg bg-surface-raised p-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.label}</span> <span className="text-ink-muted">{s.text.slice(0, 80)}</span>
              </span>
              <Button variant="ghost" aria-label={`Edit ${s.label}`} onClick={() => setSample(s)}>
                Edit
              </Button>
              <Button variant="ghost" aria-label={`Delete ${s.label}`} onClick={() => void update({ styleSamples: samples.filter((x) => x.id !== s.id) })}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
        {sample ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <TextInput aria-label="Sample label" placeholder="e.g. Pratchett footnotes" value={sample.label} onChange={(e) => setSample({ ...sample, label: e.target.value })} />
            <AutoTextarea aria-label="Sample text" rows={5} placeholder="Paste a passage of a few paragraphs" value={sample.text} onChange={(e) => setSample({ ...sample, text: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSample(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!sample.label.trim() || !sample.text.trim()} onClick={() => saveSample(sample)}>
                Save sample
              </Button>
            </div>
          </div>
        ) : (
          <Button className="self-start" onClick={() => setSample({ id: newId(), label: "", text: "" })}>
            Add a style sample
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Craft packs">
        <h2 className="font-medium">Craft packs</h2>
        <p className="text-sm text-ink-muted">
          Short genre guides the co-writer reads when a project's genre or tone mentions one of their words. Projects can turn
          others on by hand.
        </p>
        <ul className="flex flex-col gap-2">
          {packs.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg bg-surface-raised p-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{p.name}</span>
                {edited(p.id) && builtIn(p.id) && <span className="ml-2 text-xs text-accent">edited</span>}
                <span className="ml-2 text-xs text-ink-muted">{p.match.join(", ")}</span>
              </span>
              <Button variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setPack(p)}>
                Edit
              </Button>
              {edited(p.id) && (
                <Button
                  variant="ghost"
                  aria-label={`${builtIn(p.id) ? "Reset" : "Delete"} ${p.name}`}
                  onClick={() => void update({ craftPacks: (settings.craftPacks ?? []).filter((x) => x.id !== p.id) })}
                >
                  {builtIn(p.id) ? "Reset" : "Delete"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {pack ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <TextInput aria-label="Pack name" value={pack.name} onChange={(e) => setPack({ ...pack, name: e.target.value })} />
            <TextInput
              aria-label="Loaded by these words"
              placeholder="Genre and tone words, comma-separated"
              value={pack.match.join(", ")}
              onChange={(e) => setPack({ ...pack, match: e.target.value.split(",") })}
            />
            <AutoTextarea aria-label="Pack text" rows={6} value={pack.text} onChange={(e) => setPack({ ...pack, text: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPack(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!pack.name.trim() || !pack.text.trim()} onClick={() => savePack(pack)}>
                Save pack
              </Button>
            </div>
          </div>
        ) : (
          <Button className="self-start" onClick={() => setPack({ id: newId(), name: "", match: [], text: "" })}>
            Add a craft pack
          </Button>
        )}
      </section>
    </>
  );
}
