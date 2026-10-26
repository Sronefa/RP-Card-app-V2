/**
 * Settings of the space and mystery kit parts on the Modules tab (Sci-fi / space, Horror /
 * mystery): the ship and the case file. The case fills its suspects from the card's world pages.
 */
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import { caseSettings, type CaseSettings } from "../../engine/modules/casefile";
import type { ShipSettings } from "../../engine/modules/ship";
import { fillCase, worldOf } from "../../engine/parts/catalog";
import { Labelled, Rows } from "./ScreenEditors";

type Change<T> = (s: T, key?: string) => void;
const raw = <T,>(s: T) => s as unknown as Record<string, unknown>;

export function ShipEditor({ settings, onChange }: { settings: ShipSettings; onChange: Change<ShipSettings> }) {
  const set = (patch: Partial<ShipSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const asked = settings.systems.reduce((n, x) => n + x.power, 0);
  const number = (key: keyof ShipSettings, label: string) => (
    <Labelled label={label}>
      <TextInput inputMode="numeric" value={String(settings[key])} onChange={(e) => set({ [key]: Number(e.target.value) || 0 } as Partial<ShipSettings>, key)} />
    </Labelled>
  );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model plays hits, repairs and trade; the engine caps the values, recharges the shields with the clock by the power
        they get, and burns fuel on each jump when the card has a map (the star chart).
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Ship's name">
          <TextInput value={settings.shipName} onChange={(e) => set({ shipName: e.target.value }, "shipName")} />
        </Labelled>
        <Labelled label="Class">
          <TextInput value={settings.shipClass} onChange={(e) => set({ shipClass: e.target.value }, "shipClass")} />
        </Labelled>
        {number("hull", "Hull")}
        {number("shields", "Shields (0 for none)")}
        {number("recharge", "Shields an hour per power")}
        {number("fuel", "Fuel tanks")}
        {number("jumpFuel", "Fuel a jump burns")}
        {number("reactor", "Reactor power")}
        {number("capacity", "Cargo hold (0 for no limit)")}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Systems</legend>
        <p className="text-xs text-ink-muted">
          The power each starts with, the most it takes, and what power does for it. {asked > settings.reactor ? `They start with ${asked} but the reactor gives ${settings.reactor}: the last ones get less.` : ""}
        </p>
        <Rows
          label="a system"
          rows={settings.systems}
          blank={{ name: "", power: 1, max: 3, effect: "" }}
          fields={[
            { key: "name", label: "System" },
            { key: "power", label: "Starting power", type: "number" },
            { key: "max", label: "Most power", type: "number" },
            { key: "effect", label: "What power does", wide: true },
          ]}
          onChange={(systems, key) => set({ systems }, `sys.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Crew</legend>
        <Rows label="a crew member" rows={settings.crew} blank={{ name: "", role: "" }} fields={[{ key: "name", label: "Name" }, { key: "role", label: "Role" }]} onChange={(crew, key) => set({ crew }, `crew.${key}`)} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Cargo at the start</legend>
        <Rows label="cargo" rows={settings.cargo} blank={{ name: "", count: 1 }} fields={[{ key: "name", label: "Cargo" }, { key: "count", label: "Units", type: "number" }]} onChange={(cargo, key) => set({ cargo }, `cargo.${key}`)} />
      </fieldset>
    </div>
  );
}

export function CaseEditor({ settings, onChange }: { settings: CaseSettings; onChange: Change<CaseSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<CaseSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The truth goes to the model only, so every clue it plants points the same way. The player pins clues to suspects on
        the board and accuses with what's pinned.
      </p>
      <Button
        className="self-start"
        onClick={() => {
          const filled = caseSettings(fillCase(raw(settings), data));
          onChange(filled, "world");
          toast(worldOf(data, "npc").length > 1 ? "Made the world's people the suspects" : "The world needs two people or more");
        }}
      >
        Suspects from the world
      </Button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Case name">
          <TextInput value={settings.caseName} onChange={(e) => set({ caseName: e.target.value }, "caseName")} />
        </Labelled>
        <Labelled label="Fear meter">
          <TextInput value={settings.dread} placeholder="Empty for none" onChange={(e) => set({ dread: e.target.value }, "dread")} />
        </Labelled>
      </div>
      <Labelled label="The question">
        <TextInput value={settings.question} placeholder="What happened to…?" onChange={(e) => set({ question: e.target.value }, "question")} />
      </Labelled>
      <Labelled label="The truth (the model only)">
        <AutoTextarea value={settings.truth} placeholder="Who did it, how and why, and what the clues are" onChange={(e) => set({ truth: e.target.value }, "truth")} />
      </Labelled>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Suspects</legend>
        <Rows
          label="a suspect"
          rows={settings.suspects}
          blank={{ name: "", description: "", avatar: "" }}
          fields={[
            { key: "name", label: "Name" },
            { key: "avatar", label: "Photo file" },
            { key: "description", label: "What the player knows", wide: true },
          ]}
          onChange={(suspects, key) => set({ suspects }, `sus.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Clues at the start</legend>
        <Rows label="a clue" rows={settings.clues} blank={{ name: "", where: "" }} fields={[{ key: "name", label: "Clue" }, { key: "where", label: "Where it was found" }]} onChange={(clues, key) => set({ clues }, `clue.${key}`)} />
      </fieldset>
    </div>
  );
}
