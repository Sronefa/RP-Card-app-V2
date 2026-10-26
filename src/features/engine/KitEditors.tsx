/**
 * Settings of the kit parts on the Modules tab: daily life (Modern life sim), the school app (School
 * / academy), routes and the choice menu (Dating sim / VN). Routes fill themselves from the card's
 * world pages and images.
 */
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { useEditor } from "../../editor/store";
import type { ChoicesSettings } from "../../engine/modules/choices";
import type { LifeSettings } from "../../engine/modules/life";
import { ENDING_KINDS, routesSettings, type EndingKind, type RoutesSettings } from "../../engine/modules/routes";
import type { SchoolSettings } from "../../engine/modules/school";
import { fillRoutes, worldOf } from "../../engine/parts/catalog";
import { Check, Labelled, ListInput, Rows } from "./ScreenEditors";
import { selectClass } from "./VarEditor";

type Change<T> = (s: T, key?: string) => void;

export function LifeEditor({ settings, onChange }: { settings: LifeSettings; onChange: Change<LifeSettings> }) {
  const set = (patch: Partial<LifeSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  const job = (patch: Partial<LifeSettings["job"]>, key: string) => set({ job: { ...settings.job, ...patch } }, `job.${key}`);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Needs drain with the clock by themselves; the model changes them only for what happens in the scene. The next
        shift and the bills due are worked out after every reply. Money is the phone's when the card has one.
      </p>
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
        <Labelled label="Starting money">
          <TextInput inputMode="numeric" value={settings.startMoney} onChange={(e) => set({ startMoney: Number(e.target.value) || 0 }, "startMoney")} />
        </Labelled>
        <Labelled label="Money value" className="col-span-2">
          <TextInput value={settings.moneyPath} placeholder="The phone's, or its own" onChange={(e) => set({ moneyPath: e.target.value }, "moneyPath")} />
        </Labelled>
        <Labelled label="Wakes at">
          <TextInput type="time" value={settings.wakeAt} onChange={(e) => set({ wakeAt: e.target.value }, "wakeAt")} />
        </Labelled>
        <Labelled label="Skills group">
          <TextInput value={settings.skillsGroup} onChange={(e) => set({ skillsGroup: e.target.value }, "skillsGroup")} />
        </Labelled>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Needs</legend>
        <p className="text-xs text-ink-muted">Per hour: how much the clock moves it. Worse: "low" (energy) or "high" (hunger, stress). Warn: the line past which the player feels it.</p>
        <Rows
          label="a need"
          rows={settings.needs}
          blank={{ name: "", start: 50, perHour: 2, worse: "low", warn: 25, hint: "" }}
          fields={[
            { key: "name", label: "Need" },
            { key: "start", label: "Start", type: "number" },
            { key: "perHour", label: "Per hour", type: "number" },
            { key: "warn", label: "Warn at", type: "number" },
            { key: "worse", label: "Worse when (low/high)" },
            { key: "hint", label: "What changes it", wide: true },
          ]}
          onChange={(needs, key) => set({ needs: needs.map((n) => ({ ...n, worse: n.worse === "high" ? "high" : "low" })) }, `need.${key}`)}
        />
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <legend className="col-span-full font-medium">Job (empty title for none)</legend>
        <Labelled label="Title">
          <TextInput value={settings.job.title} onChange={(e) => job({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Employer">
          <TextInput value={settings.job.employer} onChange={(e) => job({ employer: e.target.value }, "employer")} />
        </Labelled>
        <Labelled label="Pay per shift">
          <TextInput inputMode="numeric" value={settings.job.salary} onChange={(e) => job({ salary: Number(e.target.value) || 0 }, "salary")} />
        </Labelled>
        <Labelled label="Days (Mon-Fri)">
          <TextInput value={settings.job.days} onChange={(e) => job({ days: e.target.value }, "days")} />
        </Labelled>
        <Labelled label="From">
          <TextInput type="time" value={settings.job.from} onChange={(e) => job({ from: e.target.value }, "from")} />
        </Labelled>
        <Labelled label="Until">
          <TextInput type="time" value={settings.job.to} onChange={(e) => job({ to: e.target.value }, "to")} />
        </Labelled>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Bills</legend>
        <Rows
          label="a bill"
          rows={settings.bills}
          blank={{ name: "", amount: 0, every: 30, first: 1 }}
          fields={[
            { key: "name", label: "Bill" },
            { key: "amount", label: "Amount", type: "number" },
            { key: "every", label: "Every (days)", type: "number" },
            { key: "first", label: "First due (day)", type: "number" },
          ]}
          onChange={(bills, key) => set({ bills }, `bill.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Skills (0 to 10)</legend>
        <Rows
          label="a skill"
          rows={settings.skills}
          blank={{ name: "", start: 0 }}
          fields={[
            { key: "name", label: "Skill", wide: true },
            { key: "start", label: "Start", type: "number" },
          ]}
          onChange={(skills, key) => set({ skills }, `skill.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Home</legend>
        <TextInput aria-label="Home" value={settings.home} onChange={(e) => set({ home: e.target.value }, "home")} />
        <p className="text-xs text-ink-muted">A room's action: sleep, cook, eat, wash, relax, or any short thing to do there.</p>
        <Rows
          label="a room"
          rows={settings.rooms}
          blank={{ name: "", action: "" }}
          fields={[
            { key: "name", label: "Room" },
            { key: "action", label: "Action", wide: true },
          ]}
          onChange={(rooms, key) => set({ rooms }, `room.${key}`)}
        />
      </fieldset>
    </div>
  );
}

export function SchoolEditor({ settings, onChange }: { settings: SchoolSettings; onChange: Change<SchoolSettings> }) {
  const set = (patch: Partial<SchoolSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The class on now and the next one come from the timetable and the clock. Violations carry their expiry day and
        drop off by themselves; coming exams count down.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labelled label="School name" className="col-span-2">
          <TextInput value={settings.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        </Labelled>
        <Labelled label="Title">
          <TextInput value={settings.title} onChange={(e) => set({ title: e.target.value }, "title")} />
        </Labelled>
        <Labelled label="Hub button">
          <TextInput value={settings.button} onChange={(e) => set({ button: e.target.value }, "button")} />
        </Labelled>
      </div>
      <Labelled label="Subjects">
        <ListInput value={settings.subjects} onChange={(subjects) => set({ subjects }, "subjects")} />
      </Labelled>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Periods</legend>
        <Rows
          label="a period"
          rows={settings.periods}
          blank={{ name: "", from: "", to: "" }}
          fields={[
            { key: "name", label: "Period", wide: true },
            { key: "from", label: "From" },
            { key: "to", label: "Until" },
          ]}
          onChange={(periods, key) => set({ periods }, `period.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Timetable</legend>
        <p className="text-xs text-ink-muted">One row per school day: the class in each period, in order, separated by commas.</p>
        <Rows
          label="a school day"
          rows={settings.timetable}
          blank={{ day: "", classes: "" }}
          fields={[
            { key: "day", label: "Day (Mon)" },
            { key: "classes", label: "Classes", wide: true },
          ]}
          onChange={(timetable, key) => set({ timetable }, `day.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Exams</legend>
        <Rows
          label="an exam"
          rows={settings.exams}
          blank={{ name: "", day: 1 }}
          fields={[
            { key: "name", label: "Exam", wide: true },
            { key: "day", label: "Day", type: "number" },
          ]}
          onChange={(exams, key) => set({ exams }, `exam.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Clubs</legend>
        <Rows
          label="a club"
          rows={settings.clubs}
          blank={{ name: "", description: "" }}
          fields={[
            { key: "name", label: "Club" },
            { key: "description", label: "What it's like", wide: true },
          ]}
          onChange={(clubs, key) => set({ clubs }, `club.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Handbook</legend>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Violations last (days)">
            <TextInput inputMode="numeric" value={settings.violationDays} onChange={(e) => set({ violationDays: Number(e.target.value) || 1 }, "violationDays")} />
          </Labelled>
        </div>
        <Rows
          label="a rule"
          rows={settings.rules}
          blank={{ rule: "", penalty: "" }}
          fields={[
            { key: "rule", label: "Rule", wide: true },
            { key: "penalty", label: "Penalty", wide: true },
          ]}
          onChange={(rules, key) => set({ rules }, `rule.${key}`)}
        />
      </fieldset>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Labelled label="Council">
          <TextInput value={settings.council.name} onChange={(e) => set({ council: { ...settings.council, name: e.target.value } }, "council.name")} />
        </Labelled>
        <Labelled label="What requests do" className="sm:col-span-2">
          <AutoTextarea rows={2} value={settings.council.description} onChange={(e) => set({ council: { ...settings.council, description: e.target.value } }, "council.description")} />
        </Labelled>
      </div>
    </div>
  );
}

export function RoutesEditor({ settings, onChange }: { settings: RoutesSettings; onChange: Change<RoutesSettings> }) {
  const data = useEditor((s) => s.record!.card.data);
  const set = (patch: Partial<RoutesSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        Hearts, stages and route status per love interest. Gallery pictures and endings unlock when the story reaches
        them and stay unlocked across chats. Tastes stay hidden from the player until a reaction shows them.
      </p>
      <Button
        className="self-start"
        onClick={() => {
          const filled = routesSettings(fillRoutes(settings as unknown as Record<string, unknown>, data));
          set({ interests: filled.interests, spots: filled.spots, gifts: filled.gifts, gallery: filled.gallery }, "world");
          toast(worldOf(data, "npc").length ? "Added the world's NPCs, places and items" : "The world has no NPCs yet");
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
        <Labelled label="Starting money">
          <TextInput inputMode="numeric" value={settings.startMoney} onChange={(e) => set({ startMoney: Number(e.target.value) || 0 }, "startMoney")} />
        </Labelled>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Love interests</legend>
        <p className="text-xs text-ink-muted">Loves, likes and dislikes are comma-separated.</p>
        <Rows
          label="a love interest"
          rows={settings.interests}
          blank={{ name: "", avatar: "", about: "", loved: "", liked: "", disliked: "" }}
          fields={[
            { key: "name", label: "Name" },
            { key: "avatar", label: "Picture file" },
            { key: "about", label: "About", wide: true },
            { key: "loved", label: "Loves", wide: true },
            { key: "liked", label: "Likes" },
            { key: "disliked", label: "Dislikes" },
          ]}
          onChange={(interests, key) => set({ interests }, `interest.${key}`)}
        />
      </fieldset>
      <Check checked={settings.trust} onChange={(trust) => set({ trust }, "trust")}>
        Trust, next to affection
      </Check>
      <Check checked={settings.jealousy} onChange={(jealousy) => set({ jealousy }, "jealousy")}>
        Love interests notice each other (jealousy)
      </Check>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Stages, from the affection each starts at</legend>
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
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Date spots</legend>
        <Rows
          label="a date spot"
          rows={settings.spots}
          blank={{ name: "", description: "" }}
          fields={[
            { key: "name", label: "Place" },
            { key: "description", label: "What it's like", wide: true },
          ]}
          onChange={(spots, key) => set({ spots }, `spot.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Gifts</legend>
        <Rows
          label="a gift"
          rows={settings.gifts}
          blank={{ name: "", price: 0 }}
          fields={[
            { key: "name", label: "Gift", wide: true },
            { key: "price", label: "Price", type: "number" },
          ]}
          onChange={(gifts, key) => set({ gifts }, `gift.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Gallery</legend>
        <p className="text-xs text-ink-muted">A picture unlocks when the model reports its scene by the exact caption.</p>
        <Rows
          label="a picture"
          rows={settings.gallery}
          blank={{ file: "", caption: "", route: "" }}
          fields={[
            { key: "file", label: "Picture file" },
            { key: "route", label: "Route" },
            { key: "caption", label: "Caption (the scene)", wide: true },
          ]}
          onChange={(gallery, key) => set({ gallery }, `cg.${key}`)}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Endings</legend>
        <p className="text-xs text-ink-muted">Kind: {ENDING_KINDS.join(", ")}. The hint shows while it's locked.</p>
        <Rows
          label="an ending"
          rows={settings.endings}
          blank={{ route: "", name: "", kind: "good" as EndingKind, hint: "" }}
          fields={[
            { key: "route", label: "Route" },
            { key: "kind", label: "Kind" },
            { key: "name", label: "Ending", wide: true },
            { key: "hint", label: "Hint", wide: true },
          ]}
          onChange={(endings, key) =>
            set({ endings: endings.map((e) => ({ ...e, kind: (ENDING_KINDS as readonly string[]).includes(e.kind) ? e.kind : "normal" })) }, `ending.${key}`)
          }
        />
      </fieldset>
    </div>
  );
}

export function ChoicesEditor({ settings, onChange }: { settings: ChoicesSettings; onChange: Change<ChoicesSettings> }) {
  const set = (patch: Partial<ChoicesSettings>, key: string) => onChange({ ...settings, ...patch }, key);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-muted">
        The model ends a reply with the menu and fills in the options; a tap sends the choice at once. Older menus stay as
        a record.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="How often">
          <select className={selectClass} value={settings.frequency} onChange={(e) => set({ frequency: e.target.value as ChoicesSettings["frequency"] }, "frequency")}>
            <option value="key">Key moments only</option>
            <option value="often">At most decisions</option>
          </select>
        </Labelled>
        <Labelled label="Seconds to choose (0 for no timer)">
          <TextInput inputMode="numeric" value={settings.timer} onChange={(e) => set({ timer: Number(e.target.value) || 0 }, "timer")} />
        </Labelled>
      </div>
      {settings.timer > 0 && (
        <Labelled label="Sent when time runs out">
          <TextInput value={settings.timeout} onChange={(e) => set({ timeout: e.target.value }, "timeout")} />
        </Labelled>
      )}
      <Check checked={settings.own} onChange={(own) => set({ own }, "own")}>
        Let the player type their own answer too
      </Check>
    </div>
  );
}
