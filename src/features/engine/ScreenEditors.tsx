/**
 * Settings of the built-in screens on the Modules tab: the character creator and the phone. Both
 * can fill their lists from the card's world pages (NPCs, places and items).
 */
import { useState } from "react";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import { CREATOR_TAG, creatorSettings, type CreatorSettings } from "../../engine/modules/creator";
import { PHONE_APP_IDS, PHONE_APPS, phoneSettings, type PhoneAppId, type PhoneSettings } from "../../engine/modules/phone";
import { fillCreator, fillPhone, worldOf } from "../../engine/parts/catalog";

type Change<T> = (s: T, key?: string) => void;

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** A comma-separated list that keeps what's typed (a trailing comma, a space) until it means something else. */
export function ListInput({ value, onChange, ...props }: { value: string[]; onChange: (v: string[]) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value.join(", "));
  const shown = splitList(text).join("|") === value.join("|") ? text : value.join(", ");
  return (
    <TextInput
      {...props}
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitList(e.target.value));
      }}
    />
  );
}

/** One item per line, for lists whose items hold commas. */
function LinesInput({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  return <AutoTextarea aria-label={label} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />;
}

interface Field<T> {
  key: keyof T & string;
  label: string;
  type?: "number" | "color";
  /** Spans the whole row. */
  wide?: boolean;
}

/** Rows of a few fields each, with Remove on each row and Add under them. */
export function Rows<T>({ label, rows, fields, blank, onChange }: { label: string; rows: T[]; fields: Field<T>[]; blank: T; onChange: (rows: T[], key: string) => void }) {
  const set = (i: number, key: keyof T & string, value: string) =>
    onChange(
      rows.map((r, j) => (j === i ? { ...r, [key]: fields.find((f) => f.key === key)?.type === "number" ? Number(value) || 0 : value } : r)),
      `${i}.${key}`,
    );
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-4">
          {fields.map((f) => (
            <TextInput
              key={f.key}
              aria-label={f.label}
              placeholder={f.label}
              type={f.type === "color" ? "color" : "text"}
              inputMode={f.type === "number" ? "numeric" : undefined}
              className={`${f.wide ? "col-span-2" : ""} ${f.type === "color" ? "h-10 p-1" : ""}`}
              value={String(r[f.key] ?? "")}
              onChange={(e) => set(i, f.key, e.target.value)}
            />
          ))}
          <Button variant="ghost" className="col-span-2 sm:col-span-4 sm:justify-self-end" onClick={() => onChange(rows.filter((_, j) => j !== i), "rows")}>
            Remove
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => onChange([...rows, { ...blank }], "rows")}>
        Add {label}
      </Button>
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-8 items-center gap-2">
      <input type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Labelled({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label}
      {children}
    </label>
  );
}

export function CreatorEditor({ settings, onChange }: { settings: CreatorSettings; onChange: Change<CreatorSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<CreatorSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const shown = data.first_mes.includes(CREATOR_TAG);
  const fromWorld = () => {
    const filled = creatorSettings(fillCreator(settings as unknown as Record<string, unknown>, data));
    set({ choices: filled.choices, items: filled.items }, "world");
    toast(worldOf(data, "location").length || worldOf(data, "item").length ? "Added the world's places and items" : "The world has no places or items yet");
  };
  const setChoice = (i: number, patch: Partial<CreatorSettings["choices"][number]>, key: string) =>
    set({ choices: settings.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) }, `choice.${i}.${key}`);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Shows in the first message. The player makes their character step by step; Begin fills the game state and
        sends the opening message of the route they pick.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {shown ? (
          <span className="text-xs text-ink-muted">It's in the first message.</span>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              const d = useEditor.getState().record!.card.data;
              useEditor.getState().replaceData({ ...d, first_mes: d.first_mes.trim() ? `${d.first_mes.trim()}\n\n${CREATOR_TAG}` : CREATOR_TAG });
              toast("Added to the first message");
            }}
          >
            Put it in the first message
          </Button>
        )}
        <Button onClick={fromWorld}>Fill from the world</Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Group for the character's values">
          <TextInput value={settings.group} onChange={(e) => set({ group: e.target.value }, "group")} />
        </Labelled>
        <Labelled label="Intro" className="sm:col-span-2">
          <TextInput value={settings.intro} onChange={(e) => set({ intro: e.target.value }, "intro")} />
        </Labelled>
      </div>
      <Check checked={settings.askName} onChange={(askName) => set({ askName }, "askName")}>
        Ask for a name
      </Check>
      <Check checked={settings.askLook} onChange={(askLook) => set({ askLook }, "askLook")}>
        Ask for a look
      </Check>
      {settings.askLook && (
        <Labelled label="Ready-made looks, one per line">
          <LinesInput label="Ready-made looks" value={settings.lookIdeas} onChange={(lookIdeas) => set({ lookIdeas }, "lookIdeas")} />
        </Labelled>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Choices</legend>
        <p className="text-xs text-ink-muted">Each is one step, like an origin, a class or a role, and becomes a value.</p>
        {settings.choices.map((c, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <div className="flex gap-2">
              <TextInput aria-label="Choice name" placeholder="e.g. Class" value={c.name} onChange={(e) => setChoice(i, { name: e.target.value }, "name")} />
              <Button variant="ghost" onClick={() => set({ choices: settings.choices.filter((_, j) => j !== i) }, "choices")}>
                Remove
              </Button>
            </div>
            <Rows
              label="an option"
              rows={c.options}
              blank={{ name: "", description: "" }}
              fields={[
                { key: "name", label: "Option" },
                { key: "description", label: "What it means", wide: true },
              ]}
              onChange={(options, key) => setChoice(i, { options }, `option.${key}`)}
            />
          </div>
        ))}
        <Button className="self-start" onClick={() => set({ choices: [...settings.choices, { name: "", options: [] }] }, "choices")}>
          Add a choice
        </Button>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Stats</legend>
        <Labelled label="Points to spend" className="max-w-40">
          <TextInput inputMode="numeric" value={settings.points} onChange={(e) => set({ points: Number(e.target.value) || 0 }, "points")} />
        </Labelled>
        <Rows
          label="a stat"
          rows={settings.stats}
          blank={{ name: "", base: 1, max: 5 }}
          fields={[
            { key: "name", label: "Stat", wide: true },
            { key: "base", label: "Starts at", type: "number" },
            { key: "max", label: "Highest", type: "number" },
          ]}
          onChange={(stats, key) => set({ stats }, `stat.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Starting items</legend>
        <ListInput aria-label="Items to pick from" placeholder="Rope, Lantern, Knife" value={settings.items} onChange={(v) => set({ items: v }, "items")} />
        <Labelled label="How many the player picks" className="max-w-40">
          <TextInput inputMode="numeric" value={settings.pickItems} onChange={(e) => set({ pickItems: Number(e.target.value) || 0 }, "pickItems")} />
        </Labelled>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Routes</legend>
        <p className="text-xs text-ink-muted">One button each on the last step. Its message is what the player sends to start; {"{name}"} becomes their name.</p>
        <Rows
          label="a route"
          rows={settings.routes}
          blank={{ label: "", description: "", message: "" }}
          fields={[
            { key: "label", label: "Button" },
            { key: "description", label: "Under the button" },
            { key: "message", label: "Opening message", wide: true },
          ]}
          onChange={(routes, key) => set({ routes }, `route.${key}`)}
        />
      </fieldset>
      <Check checked={settings.summary} onChange={(summary) => set({ summary }, "summary")}>
        Start the opening message with a one-line summary of the character
      </Check>
    </div>
  );
}

const FIELD_LABELS: [keyof PhoneSettings["contactFields"], string][] = [
  ["affection", "Affection, with stages"],
  ["outfit", "Outfit"],
  ["location", "Where they are"],
  ["notes", "Notes"],
];

export function PhoneEditor({ settings, onChange }: { settings: PhoneSettings; onChange: Change<PhoneSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<PhoneSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const has = (app: PhoneAppId) => settings.apps.includes(app);
  const move = (i: number, by: number) => {
    const apps = [...settings.apps];
    const [a] = apps.splice(i, 1);
    apps.splice(Math.max(0, Math.min(apps.length, i + by)), 0, a);
    set({ apps }, "apps");
  };
  const fromWorld = () => {
    const filled = phoneSettings(fillPhone(settings as unknown as Record<string, unknown>, data));
    set({ contacts: filled.contacts, places: filled.places, shop: filled.shop }, "world");
    const found = worldOf(data, "npc").length + worldOf(data, "location").length + worldOf(data, "item").length;
    toast(found ? "Added the world's NPCs, places and items" : "The world has no NPCs, places or items yet");
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        A phone over the chat. What the player does on it (texting, buying, travelling, posting) goes into the input box
        as an action the model plays out; the model fills the phone in its updates.
      </p>
      <Button className="self-start" onClick={fromWorld}>
        Fill from the world
      </Button>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="Name">
          <TextInput value={settings.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Wallpaper (a card image's file name)">
          <TextInput value={settings.wallpaper} placeholder="The theme's colours" onChange={(e) => set({ wallpaper: e.target.value }, "wallpaper")} />
        </Labelled>
        <Labelled label="Texts, posts and news it keeps">
          <TextInput inputMode="numeric" value={settings.keep} onChange={(e) => set({ keep: Number(e.target.value) || 0 }, "keep")} />
        </Labelled>
      </div>
      <Check checked={settings.lock} onChange={(lock) => set({ lock }, "lock")}>
        Start on the lock screen
      </Check>
      <Check checked={settings.floating} onChange={(floating) => set({ floating }, "floating")}>
        A round button over the chat that opens it
      </Check>
      <Check checked={settings.inline} onChange={(inline) => set({ inline }, "inline")}>
        The model can show it inside a message when the character looks at their phone
      </Check>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Home screen</legend>
        <ol className="flex flex-col gap-1" aria-label="Apps on the home screen">
          {settings.apps.map((a, i) => (
            <li key={a} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-2">
              <span className="size-3 rounded-full" style={{ background: PHONE_APPS[a].color }} aria-hidden />
              <span className="flex-1">{a === "system" ? settings.system.name || PHONE_APPS[a].label : PHONE_APPS[a].label}</span>
              <Button variant="ghost" aria-label={`Move ${PHONE_APPS[a].label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button variant="ghost" aria-label={`Move ${PHONE_APPS[a].label} down`} disabled={i === settings.apps.length - 1} onClick={() => move(i, 1)}>
                ↓
              </Button>
              <Button variant="ghost" aria-label={`Remove ${PHONE_APPS[a].label}`} onClick={() => set({ apps: settings.apps.filter((x) => x !== a) }, "apps")}>
                ✕
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {PHONE_APP_IDS.filter((a) => !has(a)).map((a) => (
            <Button key={a} variant="ghost" onClick={() => set({ apps: [...settings.apps, a] }, "apps")}>
              + {PHONE_APPS[a].label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Hub modules of your own tagged "phone-app" show as apps too.</p>
      </fieldset>

      {has("contacts") && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Contacts</legend>
          <Rows
            label="a contact"
            rows={settings.contacts}
            blank={{ name: "", role: "", avatar: "" }}
            fields={[
              { key: "name", label: "Name" },
              { key: "role", label: "Who they are" },
              { key: "avatar", label: "Picture file", wide: true },
            ]}
            onChange={(contacts, key) => set({ contacts }, `contact.${key}`)}
          />
          <div className="flex flex-wrap gap-x-4">
            {FIELD_LABELS.map(([key, label]) => (
              <Check key={key} checked={settings.contactFields[key]} onChange={(on) => set({ contactFields: { ...settings.contactFields, [key]: on } }, `field.${key}`)}>
                {label}
              </Check>
            ))}
          </div>
          {settings.contactFields.affection && (
            <>
              <h3 className="text-xs font-medium text-ink-muted">Affection stages, from the value each starts at</h3>
              <Rows
                label="a stage"
                rows={settings.stages}
                blank={{ name: "", from: 0, color: "#94a3b8" }}
                fields={[
                  { key: "name", label: "Stage", wide: true },
                  { key: "from", label: "From", type: "number" },
                  { key: "color", label: "Colour", type: "color" },
                ]}
                onChange={(stages, key) => set({ stages }, `stage.${key}`)}
              />
            </>
          )}
        </fieldset>
      )}

      {(has("wallet") || has("shop") || has("map")) && (
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="mb-1 font-medium">Money, items and places</legend>
          {(has("wallet") || has("shop")) && (
            <>
              <Labelled label="Currency">
                <TextInput value={settings.currency} onChange={(e) => set({ currency: e.target.value }, "currency")} />
              </Labelled>
              <Labelled label="Use this value for money">
                <TextInput value={settings.moneyPath} placeholder="Phone.Money, or e.g. Player.Gold" onChange={(e) => set({ moneyPath: e.target.value }, "moneyPath")} />
              </Labelled>
              {!settings.moneyPath && (
                <Labelled label="Starting money">
                  <TextInput inputMode="numeric" value={settings.startMoney} onChange={(e) => set({ startMoney: Number(e.target.value) || 0 }, "startMoney")} />
                </Labelled>
              )}
            </>
          )}
          {has("shop") && (
            <Labelled label="Use this value for items">
              <TextInput value={settings.itemsPath} placeholder="Phone.Items, or e.g. Player.Bag" onChange={(e) => set({ itemsPath: e.target.value }, "itemsPath")} />
            </Labelled>
          )}
          {has("map") && (
            <>
              <Labelled label="Use this value for where the player is">
                <TextInput value={settings.locationPath} placeholder="Phone.Location" onChange={(e) => set({ locationPath: e.target.value }, "locationPath")} />
              </Labelled>
              {!settings.locationPath && (
                <Labelled label="Starting place">
                  <TextInput value={settings.startLocation} onChange={(e) => set({ startLocation: e.target.value }, "startLocation")} />
                </Labelled>
              )}
            </>
          )}
        </fieldset>
      )}

      {has("map") && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Places on the map</legend>
          <Rows
            label="a place"
            rows={settings.places}
            blank={{ name: "", description: "" }}
            fields={[
              { key: "name", label: "Place" },
              { key: "description", label: "One line about it", wide: true },
            ]}
            onChange={(places, key) => set({ places }, `place.${key}`)}
          />
        </fieldset>
      )}

      {has("shop") && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Shop</legend>
          <Rows
            label="an item"
            rows={settings.shop}
            blank={{ name: "", price: 0, description: "" }}
            fields={[
              { key: "name", label: "Item" },
              { key: "price", label: "Price", type: "number" },
              { key: "description", label: "What it does", wide: true },
            ]}
            onChange={(shop, key) => set({ shop }, `shop.${key}`)}
          />
        </fieldset>
      )}

      {has("photos") && (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">Photos</legend>
          <Rows
            label="a photo"
            rows={settings.photos}
            blank={{ file: "", caption: "" }}
            fields={[
              { key: "file", label: "Card image file" },
              { key: "caption", label: "Caption", wide: true },
            ]}
            onChange={(photos, key) => set({ photos }, `photo.${key}`)}
          />
        </fieldset>
      )}

      {has("system") && (
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="mb-1 font-medium">The card's own app</legend>
          <Labelled label="Name">
            <TextInput value={settings.system.name} onChange={(e) => set({ system: { ...settings.system, name: e.target.value } }, "systemName")} />
          </Labelled>
          <Labelled label="What answers requests filed in it" className="sm:col-span-2">
            <AutoTextarea value={settings.system.description} onChange={(e) => set({ system: { ...settings.system, description: e.target.value } }, "systemText")} />
          </Labelled>
        </fieldset>
      )}
    </div>
  );
}
