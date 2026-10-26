/**
 * Settings of the shared parts on the Modules tab: the title screen, menu, people, events, journal
 * and notifications. People and the title screen fill themselves from the card's world pages and
 * images.
 */
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import type { EventsSettings } from "../../engine/modules/events";
import { WRITE_UP_TOKENS, type JournalSettings } from "../../engine/modules/journal";
import type { MenuSettings } from "../../engine/modules/menu";
import type { NotifySettings } from "../../engine/modules/notify";
import { peopleSettings, type PeopleSettings } from "../../engine/modules/people";
import { TITLE_TAG, titleSettings, type TitleSettings } from "../../engine/modules/title";
import { fillPeople, fillTitle, worldOf } from "../../engine/parts/catalog";
import { Check, Labelled, Rows } from "./ScreenEditors";
import { selectClass } from "./VarEditor";

type Change<T> = (s: T, key?: string) => void;
const raw = <T,>(s: T) => s as unknown as Record<string, unknown>;

export function TitleEditor({ settings, onChange }: { settings: TitleSettings; onChange: Change<TitleSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const setField = useEditor((s) => s.setField);
  const set = (patch: Partial<TitleSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const shown = data.first_mes.includes(TITLE_TAG);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The opening message starts on a title screen. New game starts the story (the character creator shows up then, if
        the card has one); Continue jumps to where the chat is.
      </p>
      <div className="flex flex-wrap gap-2">
        {shown ? (
          <span className="self-center text-ink-muted">It's in the first message.</span>
        ) : (
          <Button
            onClick={() => {
              setField("first_mes", `${TITLE_TAG}\n\n${data.first_mes}`.trimEnd());
              toast("Added to the first message");
            }}
          >
            Put it in the first message
          </Button>
        )}
        <Button onClick={() => set(titleSettings(fillTitle({ ...raw(settings), title: "", premise: "" }, data)), "card")}>Fill from the card</Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="Title">
          <TextInput value={settings.title} placeholder={data.name} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Tagline">
          <TextInput value={settings.tagline} placeholder="e.g. A harbor town noir" onChange={(e) => set({ tagline: e.target.value }, "tagline")} />
        </Labelled>
        <Labelled label="Premise" className="sm:col-span-2">
          <AutoTextarea value={settings.premise} rows={2} onChange={(e) => set({ premise: e.target.value }, "premise")} />
        </Labelled>
        <Labelled label="Art (a card image's file name)">
          <TextInput value={settings.art} placeholder="The theme's colours" onChange={(e) => set({ art: e.target.value }, "art")} />
        </Labelled>
        <Labelled label="Music (a card audio file's name)">
          <TextInput value={settings.music} placeholder="None" onChange={(e) => set({ music: e.target.value }, "music")} />
        </Labelled>
        <Labelled label="New game button">
          <TextInput value={settings.newGame} onChange={(e) => set({ newGame: e.target.value }, "newGame")} />
        </Labelled>
        <Labelled label="Sent on New game when there's no creator">
          <TextInput value={settings.opening} placeholder="Nothing" onChange={(e) => set({ opening: e.target.value }, "opening")} />
        </Labelled>
      </div>
    </div>
  );
}

export function MenuEditor({ settings, onChange }: { settings: MenuSettings; onChange: Change<MenuSettings> }) {
  const set = (patch: Partial<MenuSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">One hub button opens a home screen with a tile for every other screen.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
      </div>
      <Check checked={settings.only} onChange={(only) => set({ only }, "only")}>
        Only the menu's button above the input box; everything else opens from it
      </Check>
      <Check checked={settings.status} onChange={(status) => set({ status }, "status")}>
        A tile for the status panel
      </Check>
    </div>
  );
}

export function PeopleEditor({ settings, onChange }: { settings: PeopleSettings; onChange: Change<PeopleSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<PeopleSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        A profile for everyone in the cast. Where they are comes from their own Location value or their routine in the
        clock; values the phone already keeps are shared.
      </p>
      <Button
        className="self-start"
        onClick={() => {
          set({ people: peopleSettings(fillPeople(raw(settings), data)).people }, "world");
          toast(worldOf(data, "npc").length ? "Added the world's NPCs" : "The world has no NPCs yet");
        }}
      >
        Fill from the world
      </Button>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
      </div>
      <Rows
        label="a person"
        rows={settings.people}
        blank={{ name: "", role: "", avatar: "", about: "", likes: "" }}
        fields={[
          { key: "name", label: "Name" },
          { key: "role", label: "Role" },
          { key: "avatar", label: "Picture file", wide: true },
          { key: "about", label: "About", wide: true },
          { key: "likes", label: "Likes", wide: true },
        ]}
        onChange={(people, key) => set({ people }, `person.${key}`)}
      />
      <Check checked={settings.affection} onChange={(affection) => set({ affection }, "affection")}>
        Affection, with relationship stages
      </Check>
      <Check checked={settings.learned} onChange={(learned) => set({ learned }, "learned")}>
        What the player has learned about each, written by the model
      </Check>
      {settings.affection && (
        <>
          <h3 className="text-xs font-medium text-ink-muted">Stages, from the affection each starts at</h3>
          <Rows
            label="a stage"
            rows={settings.stages}
            blank={{ name: "", from: 0 }}
            fields={[
              { key: "name", label: "Stage", wide: true },
              { key: "from", label: "From", type: "number" },
            ]}
            onChange={(stages, key) => set({ stages }, `stage.${key}`)}
          />
        </>
      )}
    </div>
  );
}

export function EventsEditor({ settings, onChange }: { settings: EventsSettings; onChange: Change<EventsSettings> }) {
  const set = (patch: Partial<EventsSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        After every reply the engine works out what's happening now from the clock and the player's place, and puts it in
        Events.Now for the model. Random events roll once per part of the day, the same on every swipe.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Scheduled</legend>
        <p className="text-xs text-ink-muted">When: "Day 5", "Mon-Fri", "Sat, Sun" or empty for every day. Times are HH:MM.</p>
        <Rows
          label="a scheduled event"
          rows={settings.scheduled}
          blank={{ name: "", when: "", from: "", to: "", where: "", text: "" }}
          fields={[
            { key: "name", label: "Event" },
            { key: "when", label: "When" },
            { key: "from", label: "From" },
            { key: "to", label: "Until" },
            { key: "where", label: "Where (empty for anywhere)", wide: true },
            { key: "text", label: "What happens", wide: true },
          ]}
          onChange={(scheduled, key) => set({ scheduled }, `scheduled.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Random</legend>
        <p className="text-xs text-ink-muted">Chance is per part of the day (Morning, Afternoon, Evening, Night; empty for any).</p>
        <Rows
          label="a random event"
          rows={settings.random}
          blank={{ name: "", chance: 10, where: "", part: "", text: "" }}
          fields={[
            { key: "name", label: "Event" },
            { key: "chance", label: "Chance %", type: "number" },
            { key: "part", label: "Part of day" },
            { key: "where", label: "Where" },
            { key: "text", label: "What happens", wide: true },
          ]}
          onChange={(random, key) => set({ random }, `random.${key}`)}
        />
      </fieldset>
      <Labelled label="Where the player is">
        <TextInput value={settings.locationPath} placeholder="Found by itself, e.g. Player.Location" onChange={(e) => set({ locationPath: e.target.value }, "locationPath")} />
      </Labelled>
      <Check checked={settings.notify} onChange={(notify) => set({ notify }, "notify")}>
        A banner when an event starts (with the notifications part)
      </Check>
    </div>
  );
}

export function JournalEditor({ settings, onChange }: { settings: JournalSettings; onChange: Change<JournalSettings> }) {
  const set = (patch: Partial<JournalSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model notes the day's key events as it plays. When the day ends they're filed under it, out of the state it
        reads every turn, and the last few days go back to it as a short memory.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
        <Labelled label="Days remembered">
          <TextInput inputMode="numeric" value={settings.remember} onChange={(e) => set({ remember: Number(e.target.value) || 0 }, "remember")} />
        </Labelled>
        <Labelled label="Memory depth">
          <TextInput inputMode="numeric" value={settings.depth} onChange={(e) => set({ depth: Number(e.target.value) || 1 }, "depth")} />
        </Labelled>
      </div>
      <Check checked={settings.writeUp} onChange={(writeUp) => set({ writeUp }, "writeUp")}>
        Write each finished day up with a side call (about {WRITE_UP_TOKENS} tokens a day; players can turn side calls off)
      </Check>
    </div>
  );
}

export function NotifyEditor({ settings, onChange }: { settings: NotifySettings; onChange: Change<NotifySettings> }) {
  const set = (patch: Partial<NotifySettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Banners over the chat in the card's theme. Screens announce with <code>CF.notify(…)</code>; the lists below are
        watched for new lines after each reply. Lists the card doesn't have are skipped.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Where">
          <select className={selectClass} value={settings.position} onChange={(e) => set({ position: e.target.value as NotifySettings["position"] }, "position")}>
            <option value="top">At the top</option>
            <option value="bottom">Above the input box</option>
          </select>
        </Labelled>
        <Labelled label="Seconds shown">
          <TextInput inputMode="numeric" value={settings.seconds} onChange={(e) => set({ seconds: Number(e.target.value) || 4 }, "seconds")} />
        </Labelled>
      </div>
      <Rows
        label="a list to watch"
        rows={settings.watch}
        blank={{ path: "", title: "", icon: "star" }}
        fields={[
          { key: "path", label: "List, e.g. Phone.Texts", wide: true },
          { key: "title", label: "Banner title" },
          { key: "icon", label: "Icon" },
        ]}
        onChange={(watch, key) => set({ watch }, `watch.${key}`)}
      />
    </div>
  );
}
