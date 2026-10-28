/** A module's living screens: feeds the model writes during play, with their content packs and cost. */
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { LIVE_LIMITS, liveCadence, liveTokens, newLiveFeed, PACK_HELP } from "../../engine/modules/live";
import type { LiveFeed, LivePack } from "../../engine/modules/types";
import { ListInput } from "./ScreenEditors";
import { selectClass } from "./VarEditor";

const NUMBERS: { key: "count" | "every" | "history" | "keep"; label: string }[] = [
  { key: "count", label: "Items per run" },
  { key: "every", label: "Runs every N replies (0: only on changes)" },
  { key: "history", label: "Chat messages it reads" },
  { key: "keep", label: "Items the screen keeps" },
];

export function LiveFeedsEditor({
  feeds,
  lists,
  onChange,
}: {
  feeds: LiveFeed[];
  /** The card's list values, which a feed's items can also go into. */
  lists: string[];
  onChange: (feeds: LiveFeed[], key: string) => void;
}) {
  const set = (i: number, patch: Partial<LiveFeed>, key: string) => onChange(feeds.map((f, j) => (j === i ? { ...f, ...patch } : f)), `live.${i}.${key}`);
  const add = () => {
    let id = "texts";
    for (let n = 2; feeds.some((f) => f.id === id); n++) id = `texts-${n}`;
    onChange([...feeds, newLiveFeed(feeds.length ? "New feed" : "Texts", { id })], "live");
  };
  return (
    <details className="rounded-lg border border-border p-2" open={feeds.length > 0}>
      <summary className="cursor-pointer font-medium">Living screen ({feeds.length})</summary>
      <p className="mt-2 text-xs text-ink-muted">
        After a reply, a background call writes new items for this screen in the voice you describe: an NPC's texts, a news feed, posts. Each run
        costs tokens on the player's API, so a feed is off until you turn it on, and players can turn it off in the settings app. Screens read the
        items with <code>app.live(id)</code>.
      </p>
      <ul className="mt-2 flex flex-col gap-3">
        {feeds.map((f, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2" aria-label={`Feed ${f.name}`}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4" checked={f.enabled} onChange={(e) => set(i, { enabled: e.target.checked }, "enabled")} />
                On
              </label>
              <span className="text-xs text-ink-muted" data-testid="live-cost">
                About {liveTokens(f).toLocaleString()} tokens each run, {liveCadence(f)}.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <TextInput value={f.name} onChange={(e) => set(i, { name: e.target.value }, "name")} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Id
                <TextInput value={f.id} onChange={(e) => set(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }, "id")} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Written by
                <TextInput value={f.from} placeholder="Mina (empty for news)" onChange={(e) => set(i, { from: e.target.value }, "from")} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Also add to
                <select className={selectClass} value={f.into} onChange={(e) => set(i, { into: e.target.value }, "into")}>
                  <option value="">Nothing (the screen only)</option>
                  {f.into && !lists.includes(f.into) && <option value={f.into}>{f.into} (missing)</option>}
                  {lists.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Content pack</legend>
              {(Object.keys(PACK_HELP) as (keyof LivePack)[]).map((k) => (
                <label key={k} className="flex flex-col gap-1 text-sm">
                  {PACK_HELP[k].label}
                  <AutoTextarea rows={1} value={f.pack[k]} placeholder={PACK_HELP[k].placeholder} onChange={(e) => set(i, { pack: { ...f.pack, [k]: e.target.value } }, `pack.${k}`)} />
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              {NUMBERS.map(({ key, label }) => (
                <label key={key} className="flex flex-col gap-1 text-sm">
                  {label}
                  <TextInput
                    type="number"
                    min={LIVE_LIMITS[key][0]}
                    max={LIVE_LIMITS[key][1]}
                    value={f[key]}
                    onChange={(e) => {
                      const [min, max] = LIVE_LIMITS[key];
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) set(i, { [key]: Math.max(min, Math.min(max, Math.round(n))) }, key);
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Also runs when these values change
              <ListInput value={f.on} placeholder="Mina.Mood, World.Danger" onChange={(on) => set(i, { on }, "on")} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fallback lines, one per line (used when the call fails)
              <AutoTextarea
                rows={2}
                value={f.fallback.join("\n")}
                placeholder="Mina: you up?"
                onChange={(e) => set(i, { fallback: e.target.value.split("\n") }, "fallback")}
              />
            </label>
            <Button className="self-start" onClick={() => onChange(feeds.filter((_, j) => j !== i), "live")}>
              Remove this feed
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-2" onClick={add}>
        Add a living screen
      </Button>
    </details>
  );
}
