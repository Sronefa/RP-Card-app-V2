/**
 * Settings of the RPG kit parts on the Modules tab (Fantasy RPG, Dark fantasy, Isekai): the hero
 * sheet, the inventory, the quest log, the world map and the combat HUD. The inventory and the map
 * fill themselves from the card's world pages.
 */
import { Button, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import type { CombatSettings } from "../../engine/modules/combat";
import { HERO_STYLES, xpFor, type HeroSettings, type HeroStyle } from "../../engine/modules/hero";
import { inventorySettings, ITEM_KINDS, type InventorySettings, type ItemKind } from "../../engine/modules/inventory";
import { mapSettings, type MapSettings } from "../../engine/modules/map";
import type { QuestsSettings } from "../../engine/modules/quests";
import { fillInventory, fillMap, worldOf } from "../../engine/parts/catalog";
import { Check, Labelled, ListInput, Rows } from "./ScreenEditors";
import { selectClass } from "./VarEditor";

type Change<T> = (s: T, key?: string) => void;
const raw = <T,>(s: T) => s as unknown as Record<string, unknown>;

export function HeroEditor({ settings, onChange }: { settings: HeroSettings; onChange: Change<HeroSettings> }) {
  const set = (patch: Partial<HeroSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const curve = [2, 5, 10].map((l) => `level ${l}: ${Array.from({ length: l - 1 }, (_, i) => xpFor(settings, i + 1)).reduce((a, b) => a + b, 0)} XP`).join(", ");
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model hands out XP and spends resources; the engine levels up, refills and caps the resources, regains them
        with the clock and grants the skills of each level. Stats the character creator makes are shared.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Style">
          <select className={selectClass} value={settings.style} onChange={(e) => set({ style: e.target.value as HeroStyle }, "style")}>
            {Object.entries(HERO_STYLES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Group">
          <TextInput value={settings.group} onChange={(e) => set({ group: e.target.value }, "group")} />
        </Labelled>
        <Labelled label="XP for level 2">
          <TextInput inputMode="numeric" value={settings.xpBase} onChange={(e) => set({ xpBase: Number(e.target.value) || 1 }, "xpBase")} />
        </Labelled>
        <Labelled label="Each level needs % more">
          <TextInput inputMode="numeric" value={Math.round((settings.xpGrowth - 1) * 100)} onChange={(e) => set({ xpGrowth: 1 + (Number(e.target.value) || 0) / 100 }, "xpGrowth")} />
        </Labelled>
        <Labelled label="Highest level">
          <TextInput inputMode="numeric" value={settings.maxLevel} onChange={(e) => set({ maxLevel: Number(e.target.value) || 2 }, "maxLevel")} />
        </Labelled>
        <Labelled label="Stat points a level">
          <TextInput inputMode="numeric" value={settings.pointsPerLevel} onChange={(e) => set({ pointsPerLevel: Number(e.target.value) || 0 }, "pointsPerLevel")} />
        </Labelled>
      </div>
      <p className="text-xs text-ink-muted">To reach {curve}.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Resources</legend>
        <p className="text-xs text-ink-muted">The most at level 1, what each level adds, and what an in-game hour gives back.</p>
        <Rows
          label="a resource"
          rows={settings.resources}
          blank={{ name: "", base: 50, perLevel: 5, regen: 0 }}
          fields={[
            { key: "name", label: "Resource" },
            { key: "base", label: "At level 1", type: "number" },
            { key: "perLevel", label: "Per level", type: "number" },
            { key: "regen", label: "Per hour", type: "number" },
          ]}
          onChange={(resources, key) => set({ resources }, `res.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Stats</legend>
        <Rows
          label="a stat"
          rows={settings.stats}
          blank={{ name: "", start: 5 }}
          fields={[
            { key: "name", label: "Stat", wide: true },
            { key: "start", label: "Start", type: "number" },
          ]}
          onChange={(stats, key) => set({ stats }, `stat.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Skills</legend>
        <p className="text-xs text-ink-muted">Unlocked at their level (0 for one only the story teaches). The cost comes out of the resource named.</p>
        <Rows
          label="a skill"
          rows={settings.abilities}
          blank={{ name: "", level: 1, cost: 0, resource: "", description: "" }}
          fields={[
            { key: "name", label: "Skill" },
            { key: "level", label: "Level", type: "number" },
            { key: "cost", label: "Cost", type: "number" },
            { key: "resource", label: "Resource" },
            { key: "description", label: "What it does", wide: true },
          ]}
          onChange={(abilities, key) => set({ abilities }, `skill.${key}`)}
        />
      </fieldset>
      <Check checked={settings.conditions} onChange={(conditions) => set({ conditions }, "conditions")}>
        Conditions that wear off ("Poisoned until Day 4")
      </Check>
      <Check checked={settings.titles} onChange={(titles) => set({ titles }, "titles")}>
        Titles to earn and wear
      </Check>
    </div>
  );
}

export function InventoryEditor({ settings, onChange }: { settings: InventorySettings; onChange: Change<InventorySettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<InventorySettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Equipping, dropping and trading change the state at once; using an item goes to the story. Gold is the phone's when
        the card has a wallet. A merchant with a place only trades when the map says you're there.
      </p>
      <Button
        className="self-start"
        onClick={() => {
          const filled = inventorySettings(fillInventory(raw(settings), data));
          set({ items: filled.items, merchants: filled.merchants }, "world");
          toast(worldOf(data, "item").length ? "Added the world's items and shops" : "The world has no items yet");
        }}
      >
        Fill from the world
      </Button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Currency">
          <TextInput value={settings.currency} onChange={(e) => set({ currency: e.target.value }, "currency")} />
        </Labelled>
        <Labelled label="Starting gold">
          <TextInput inputMode="numeric" value={settings.startGold} onChange={(e) => set({ startGold: Number(e.target.value) || 0 }, "startGold")} />
        </Labelled>
        <Labelled label="Bag slots (0 for no limit)">
          <TextInput inputMode="numeric" value={settings.capacity} onChange={(e) => set({ capacity: Number(e.target.value) || 0 }, "capacity")} />
        </Labelled>
        <Labelled label="Merchants pay (% of price)">
          <TextInput inputMode="numeric" value={settings.sellRate} onChange={(e) => set({ sellRate: Number(e.target.value) || 0 }, "sellRate")} />
        </Labelled>
        <Labelled label="Gold value" className="col-span-2">
          <TextInput value={settings.moneyPath} placeholder="The phone's, or its own" onChange={(e) => set({ moneyPath: e.target.value }, "moneyPath")} />
        </Labelled>
      </div>
      <Labelled label="Gear slots">
        <ListInput value={settings.slots} onChange={(slots) => set({ slots }, "slots")} />
      </Labelled>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Item catalog</legend>
        <p className="text-xs text-ink-muted">
          Kind: {ITEM_KINDS.join(", ")}. A weapon, armor or accessory fits the slot of the same name unless you name another.
        </p>
        <Rows
          label="an item"
          rows={settings.items}
          blank={{ name: "", kind: "other" as ItemKind, slot: "", effect: "", price: 0 }}
          fields={[
            { key: "name", label: "Item" },
            { key: "kind", label: "Kind", options: ITEM_KINDS },
            { key: "slot", label: "Slot" },
            { key: "price", label: "Price", type: "number" },
            { key: "effect", label: "What it does", wide: true },
          ]}
          onChange={(items, key) => set({ items: items.map((i) => ({ ...i, kind: (ITEM_KINDS as readonly string[]).includes(i.kind) ? i.kind : "other" })) }, `item.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Starting items</legend>
        <p className="text-xs text-ink-muted">When the character creator hands out items, the bag is its list and these are skipped.</p>
        <Rows
          label="a starting item"
          rows={settings.start}
          blank={{ name: "", count: 1 }}
          fields={[
            { key: "name", label: "Item", wide: true },
            { key: "count", label: "Count", type: "number" },
          ]}
          onChange={(start, key) => set({ start }, `start.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Merchants</legend>
        <Rows
          label="a merchant"
          rows={settings.merchants}
          blank={{ name: "", where: "", stock: "" }}
          fields={[
            { key: "name", label: "Merchant" },
            { key: "where", label: "Map place (empty: anywhere)" },
            { key: "stock", label: "Sells (item names, comma-separated)", wide: true },
          ]}
          onChange={(merchants, key) => set({ merchants }, `merchant.${key}`)}
        />
      </fieldset>
    </div>
  );
}

export function QuestsEditor({ settings, onChange }: { settings: QuestsSettings; onChange: Change<QuestsSettings> }) {
  const set = (patch: Partial<QuestsSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const fields = [
    { key: "name" as const, label: "Quest" },
    { key: "giver" as const, label: "Given by" },
    { key: "objective" as const, label: "Objective", wide: true },
    { key: "reward" as const, label: "Reward", wide: true },
  ];
  const blank = { name: "", objective: "", reward: "", giver: "" };
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model updates objectives, finishes and fails quests, and posts new offers. With a hero sheet, finished quests
        also give XP. Banners announce new, finished and failed quests and a new rank.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="The board is called">
          <TextInput value={settings.board} onChange={(e) => set({ board: e.target.value }, "board")} />
        </Labelled>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Quests at the start</legend>
        <Rows label="a quest" rows={settings.start} blank={blank} fields={fields} onChange={(start, key) => set({ start }, `start.${key}`)} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Offers on the board</legend>
        <Rows label="an offer" rows={settings.offers} blank={blank} fields={fields} onChange={(offers, key) => set({ offers }, `offer.${key}`)} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Ranks, from the renown each starts at (none for no ranks)</legend>
        <Rows
          label="a rank"
          rows={settings.ranks}
          blank={{ name: "", from: 0 }}
          fields={[
            { key: "name", label: "Rank", wide: true },
            { key: "from", label: "From", type: "number" },
          ]}
          onChange={(ranks, key) => set({ ranks }, `rank.${key}`)}
        />
      </fieldset>
    </div>
  );
}

export function MapEditor({ settings, onChange }: { settings: MapSettings; onChange: Change<MapSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<MapSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Roads go both ways. Across and down place a spot on the map from 0 to 100; leave them at −1 to put places on a ring.
        Danger: 0 safe, 1 some risk, 2 dangerous, 3 deadly.
      </p>
      <Button
        className="self-start"
        onClick={() => {
          const filled = mapSettings(fillMap(raw(settings), data));
          set({ places: filled.places, start: filled.start }, "world");
          toast(worldOf(data, "location").length > 1 ? "Put the world's places on the map, each with a road to the first" : "The world needs two places or more");
        }}
      >
        Fill from the world
      </Button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Start">
          <select className={selectClass} value={settings.start} onChange={(e) => set({ start: e.target.value }, "start")}>
            <option value="">The first place</option>
            {settings.places
              .filter((p) => p.name.trim())
              .map((p) => (
                <option key={p.name} value={p.name.trim()}>
                  {p.name}
                </option>
              ))}
          </select>
        </Labelled>
        <Labelled label="Hours a road takes">
          <TextInput inputMode="numeric" value={settings.hours} onChange={(e) => set({ hours: Number(e.target.value) || 0 }, "hours")} />
        </Labelled>
        <Labelled label="Map picture file" className="col-span-2">
          <TextInput value={settings.art} placeholder="Empty for the theme's own" onChange={(e) => set({ art: e.target.value }, "art")} />
        </Labelled>
      </div>
      <Check checked={settings.fog} onChange={(fog) => set({ fog }, "fog")}>
        Fog: places show once you reach one next to them
      </Check>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Places</legend>
        <Rows
          label="a place"
          rows={settings.places}
          blank={{ name: "", region: "", description: "", danger: 0, links: "", x: -1, y: -1 }}
          fields={[
            { key: "name", label: "Place" },
            { key: "region", label: "Region" },
            { key: "danger", label: "Danger (0–3)", type: "number" },
            { key: "links", label: "Roads to (comma-separated)" },
            { key: "x", label: "Across", type: "number" },
            { key: "y", label: "Down", type: "number" },
            { key: "description", label: "What it's like", wide: true },
          ]}
          onChange={(places, key) => set({ places }, `place.${key}`)}
        />
      </fieldset>
    </div>
  );
}

export function CombatEditor({ settings, onChange }: { settings: CombatSettings; onChange: Change<CombatSettings> }) {
  const set = (patch: Partial<CombatSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        During a fight the model ends each reply with the HUD; a tap sends the move at once. Skills come from the hero sheet
        and items from the inventory, when the card has them.
      </p>
      <Labelled label="How hard fights are">
        <select className={selectClass} value={settings.difficulty} onChange={(e) => set({ difficulty: e.target.value as CombatSettings["difficulty"] }, "difficulty")}>
          <option value="gentle">Gentle: you win most fights</option>
          <option value="fair">Fair: reckless moves are punished</option>
          <option value="brutal">Brutal: a bad choice can end you</option>
        </select>
      </Labelled>
      <Check checked={settings.defend} onChange={(defend) => set({ defend }, "defend")}>
        Defend
      </Check>
      <Check checked={settings.flee} onChange={(flee) => set({ flee }, "flee")}>
        Flee
      </Check>
    </div>
  );
}
