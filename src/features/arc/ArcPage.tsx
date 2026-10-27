import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import {
  ASK_QUESTIONS,
  readAntagonist,
  readArcDraft,
  readQuestions,
  WRITE_ANTAGONIST,
  WRITE_ARC,
} from "../../ai/interviewTools";
import {
  answersText,
  antagonistKickoff,
  antagonistWriteRequest,
  arcWriteRequest,
  systemPrompt,
} from "../../ai/prompts";
import type { InterviewRound, Question } from "../../ai/records";
import { resolveModel, useAiSettings } from "../../ai/settings";
import type { CardRecord } from "../../db/db";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { toast } from "../../components/toast";
import { complete, gatherContext, partsText } from "../../cowriter/engine";
import {
  ANTAGONIST_FIELDS,
  antagonistText,
  applyArc,
  ARC_OPTIONS,
  beatText,
  newArc,
  readArc,
  rulesText,
  type Antagonist,
  type Arc,
  type ArcSettingKey,
  type ArcSettings,
  type Beat,
} from "../../editor/arc";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { BrainstormDialog } from "../cowriter/BrainstormDialog";
import { useRun } from "../cowriter/useRun";
import { QuestionCard } from "../cowriter/QuestionCard";
import { FromLibrary, SaveToLibrary } from "../library/LibraryButtons";
import { storyPayload, storyTemplateText, type Payloads } from "../../lib/libraries";

const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";


async function writeAntagonist(record: CardRecord, settings: ArcSettings, answers: string, signal: AbortSignal) {
  const parts = await gatherContext(record);
  const result = await complete("arc", {
    system: systemPrompt("arc"),
    messages: [{ role: "user", text: `${partsText(parts)}\n\n${antagonistWriteRequest(settings, answers)}` }],
    tools: [WRITE_ANTAGONIST],
    signal,
  });
  const call = result.toolCalls.find((c) => c.name === WRITE_ANTAGONIST.name);
  const antagonist = call && readAntagonist(call);
  if (!antagonist?.name) throw new Error("The co-writer didn't write an antagonist. Try again.");
  return antagonist;
}

/** The story arc: its settings, the antagonist, and the beats the narrator steers toward. */
export function ArcPage() {
  const record = useEditor((s) => s.record)!;
  const replaceData = useEditor((s) => s.replaceData);
  const { settings: ai, load } = useAiSettings();
  const setSection = useUi((s) => s.setSection);
  const stored = readArc(record.card.data);
  const [draft, setDraft] = useState<Arc>(newArc);
  const arc = stored ?? draft;
  const [ask, setAsk] = useState("");
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [interview, setInterview] = useState(false);
  const { busy, run, status } = useRun();

  useEffect(() => void load(), [load]);

  /** Keeps the arc in the card once there is something to keep; until then only on this page. */
  function save(next: Arc | undefined, coalesceKey?: string) {
    if (next && !stored && !next.beats.length && !next.antagonist) return setDraft(next);
    replaceData(applyArc(useEditor.getState().record!.card.data, next), coalesceKey);
    if (!next) setDraft(newArc());
  }
  const setSettings = (patch: Partial<ArcSettings>, key: string) =>
    save({ ...arc, settings: { ...arc.settings, ...patch } }, `arc.settings.${key}`);

  /** Plots the arc; a story template gives the settings and the shape of the beats to adapt. */
  const write = (template?: Payloads["story"]) =>
    run(arc.beats.length ? "Rewriting the arc…" : "Plotting the arc…", async (signal) => {
      const parts = await gatherContext(record);
      const settings = template ? { ...template.settings, beats: template.beats.length || template.settings.beats } : arc.settings;
      const antagonist = arc.settings.antagonist !== "none" && arc.antagonist ? antagonistText(arc.antagonist) : "";
      const result = await complete("arc", {
        system: systemPrompt("arc"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${arcWriteRequest(settings, antagonist, [ask, template && storyTemplateText(template)].filter(Boolean).join("\n\n"))}` }],
        tools: [WRITE_ARC],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === WRITE_ARC.name);
      const written = call && readArcDraft(call);
      if (!written?.beats.length)
        throw new Error("The co-writer didn't plot any beats. Try again, or pick another model.");
      save({ ...currentArc(arc), settings, ...written });
      toast(
        arc.hidden
          ? `Arc written: ${written.beats.length} beats, kept secret.`
          : `Arc written: ${written.beats.length} beats.`,
      );
    });

  const decideAntagonist = () =>
    run("Thinking up the antagonist…", async (signal) => {
      const antagonist = await writeAntagonist(record, arc.settings, "", signal);
      save({ ...currentArc(arc), antagonist });
      toast(arc.hidden ? "The antagonist is ready, and hidden." : `${antagonist.name} is ready.`);
    });

  if (!resolveModel(ai, "arc") && !stored)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">Connect a model in Settings to plot story arcs with the co-writer.</p>
        <Button variant="primary" className="self-start" onClick={() => setSection("settings")}>
          Set up a model
        </Button>
      </div>
    );

  const written = arc.beats.length > 0;
  const withAntagonist = arc.settings.antagonist !== "none";
  const alwaysOn =
    written &&
    estimateTokens(rulesText(arc)) +
      Math.max(...arc.beats.map((_, i) => estimateTokens(beatText(arc, i)))) +
      (withAntagonist && arc.antagonist && arc.settings.antagonist === "hidden"
        ? estimateTokens(antagonistText(arc.antagonist))
        : 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">
        A story arc is a run of beats the narrator steers toward, one after another, as the chat goes on. Each beat is a
        lorebook entry that SillyTavern brings in on its own after enough messages, so the story moves with no
        extension.
      </p>

      <SettingsForm settings={arc.settings} onChange={setSettings} />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={arc.hidden}
          onChange={(e) => (e.target.checked ? save({ ...arc, hidden: true }) : setConfirmReveal(true))}
        />
        <span>
          Keep the arc secret from me. CardForge hides the beats, the twists and the antagonist so the story can
          surprise you. The exported card still has them.
        </span>
      </label>

      {withAntagonist && (
        <section className="flex flex-col gap-2" aria-label="Antagonist">
          <h2 className="font-medium">Antagonist</h2>
          {!arc.antagonist ? (
            <>
              <p className="text-sm text-ink-muted">
                Build them with a few questions, or leave them to the co-writer so you meet them for the first time in
                the story.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!!busy} onClick={() => setInterview(true)}>
                  Build the antagonist
                </Button>
                <Button disabled={!!busy} onClick={() => void decideAntagonist()}>
                  ✦ Let the co-writer decide
                </Button>
              </div>
            </>
          ) : arc.hidden ? (
            <p className="rounded-xl border border-dashed border-border p-3 text-sm text-ink-muted">
              The antagonist is ready, and hidden.
            </p>
          ) : (
            <AntagonistFields
              antagonist={arc.antagonist}
              onChange={(a, key) => save({ ...arc, antagonist: a }, `arc.antagonist.${key}`)}
            />
          )}
          {arc.antagonist && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => setInterview(true)}>
                Build a new one
              </Button>
              <Button variant="ghost" onClick={() => save({ ...arc, antagonist: undefined })}>
                Remove the antagonist
              </Button>
            </div>
          )}
          {arc.antagonist && written && !arc.beats.some((b) => b.antagonist) && (
            <p className="text-xs text-ink-muted">Write the arc again so the beats bring the antagonist in.</p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="The arc">
        <h2 className="font-medium">The arc</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            What you want from it
            <TextInput
              value={ask}
              placeholder="Optional, e.g. a heist that goes wrong"
              onChange={(e) => setAsk(e.target.value)}
            />
          </label>
          <Button variant="primary" disabled={!!busy} onClick={() => void write()}>
            {written ? "✦ Write it again" : "✦ Write the arc"}
          </Button>
          <FromLibrary kind="story" label="✦ Write from a template" onUse={(item) => void write(item.payload)} />
          {written && !arc.hidden && <SaveToLibrary kind="story" name={arc.title || "Story template"} label="Save as a template" payload={() => storyPayload(currentArc(arc))} />}
        </div>
        {status}
        {!written ? (
          <p className="text-xs text-ink-muted">
            The arc is plotted from the card, the story bible, the lorebook and the settings above.
          </p>
        ) : arc.hidden ? (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm">
            <p>
              Arc written: {arc.beats.length} beats (hidden). About ~{alwaysOn} tokens are in the prompt at any time.
            </p>
            <Button className="self-start" onClick={() => setConfirmReveal(true)}>
              Reveal the arc…
            </Button>
          </div>
        ) : (
          <ArcEditor arc={arc} onChange={(next, key) => save(next, key)} />
        )}
        {written && !arc.hidden && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted">
              What the model is told (~{alwaysOn} tokens at a time)
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs whitespace-pre-wrap">
              {[rulesText(arc), ...arc.beats.map((_, i) => beatText(arc, i))].join("\n\n")}
            </pre>
          </details>
        )}
      </section>

      {stored && (
        <Button
          variant="danger"
          className="self-start"
          onClick={() => {
            save(undefined);
            toast("Story arc removed. Undo with ↶ if that was a mistake.");
          }}
        >
          Remove the arc
        </Button>
      )}

      <Dialog open={confirmReveal} title="Reveal the story arc?" onClose={() => setConfirmReveal(false)}>
        <p className="mb-4 text-sm text-ink-muted">
          You'll see every beat, the twists and the antagonist. You can hide it again, but you can't unsee it.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReveal(false)}>
            Keep it secret
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              save({ ...arc, hidden: false });
              setConfirmReveal(false);
            }}
          >
            Reveal
          </Button>
        </div>
      </Dialog>
      {interview && (
        <AntagonistInterview
          record={record}
          settings={arc.settings}
          onClose={() => setInterview(false)}
          onSave={(antagonist) => {
            save({ ...currentArc(arc), antagonist });
            setInterview(false);
          }}
        />
      )}
    </div>
  );
}

/** The arc as it is in the card now: a call may have finished after other edits. */
function currentArc(fallback: Arc): Arc {
  const record = useEditor.getState().record;
  return (record && readArc(record.card.data)) ?? fallback;
}

function SettingsForm({
  settings,
  onChange,
}: {
  settings: ArcSettings;
  onChange: (patch: Partial<ArcSettings>, key: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label="Arc settings">
      <h2 className="font-medium">Settings</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(Object.keys(ARC_OPTIONS) as ArcSettingKey[]).map((key) => {
          const opt = ARC_OPTIONS[key];
          const values = opt.values as Record<string, readonly [string, string]>;
          return (
            <label key={key} className="flex flex-col gap-1 text-sm" title={values[settings[key] as string]?.[1]}>
              {opt.label}
              <select
                className={selectClass}
                value={settings[key] as string}
                onChange={(e) => onChange({ [key]: e.target.value }, key)}
              >
                {Object.entries(values).map(([value, [label]]) => (
                  <option key={value} value={value}>
                    {label.replace("{{user}}", "You")}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label className="flex flex-col gap-1 text-sm">
          Beats
          <TextInput
            type="number"
            min={2}
            max={15}
            inputMode="numeric"
            value={settings.beats}
            onChange={(e) =>
              onChange({ beats: Math.min(15, Math.max(2, Math.round(Number(e.target.value)) || 2)) }, "beats")
            }
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Tone for this arc
        <TextInput
          value={settings.tone}
          placeholder="Empty follows the project's tone"
          onChange={(e) => onChange({ tone: e.target.value }, "tone")}
        />
      </label>
      <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
        {(["difficulty", "death", "failure"] as const).map((key) => (
          <li key={key}>
            {ARC_OPTIONS[key].label}:{" "}
            {(ARC_OPTIONS[key].values as Record<string, readonly [string, string]>)[settings[key]][1].replaceAll(
              "{{user}}",
              "you",
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AntagonistFields({
  antagonist,
  onChange,
}: {
  antagonist: Antagonist;
  onChange: (a: Antagonist, key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3">
      {ANTAGONIST_FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-sm">
          {f.label}
          {f.multiline ? (
            <AutoTextarea
              rows={2}
              value={antagonist[f.key]}
              onChange={(e) => onChange({ ...antagonist, [f.key]: e.target.value }, f.key)}
            />
          ) : (
            <TextInput
              value={antagonist[f.key]}
              onChange={(e) => onChange({ ...antagonist, [f.key]: e.target.value }, f.key)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

const BEAT_FIELDS: { key: keyof Beat; label: string }[] = [
  { key: "summary", label: "What happens" },
  { key: "direction", label: "How the narrator plays it" },
  { key: "antagonist", label: "What the antagonist does" },
];

function ArcEditor({ arc, onChange }: { arc: Arc; onChange: (arc: Arc, key: string) => void }) {
  const setBeat = (i: number, patch: Partial<Beat>, key: string) =>
    onChange({ ...arc, beats: arc.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) }, `arc.beat.${i}.${key}`);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Title
        <TextInput value={arc.title} onChange={(e) => onChange({ ...arc, title: e.target.value }, "arc.title")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Premise
        <AutoTextarea
          rows={2}
          value={arc.premise}
          onChange={(e) => onChange({ ...arc, premise: e.target.value }, "arc.premise")}
        />
      </label>
      <ol className="flex flex-col gap-2">
        {arc.beats.map((b, i) => (
          <li key={i}>
            <details className="rounded-xl border border-border bg-surface-raised" open={i === 0}>
              <summary className="cursor-pointer p-3 font-medium">
                Beat {i + 1}: {b.title || "Untitled"}
              </summary>
              <div className="flex flex-col gap-3 border-t border-border p-3">
                <label className="flex flex-col gap-1 text-sm">
                  Title
                  <TextInput value={b.title} onChange={(e) => setBeat(i, { title: e.target.value }, "title")} />
                </label>
                {BEAT_FIELDS.filter((f) => f.key !== "antagonist" || arc.antagonist).map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-sm">
                    {f.label}
                    <AutoTextarea
                      rows={2}
                      value={b[f.key]}
                      onChange={(e) => setBeat(i, { [f.key]: e.target.value }, f.key)}
                    />
                  </label>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ol>
      <label className="flex flex-col gap-1 text-sm">
        {arc.settings.endings === "branching" ? "Endings" : "Ending"}
        <AutoTextarea
          rows={2}
          value={arc.ending}
          onChange={(e) => onChange({ ...arc, ending: e.target.value }, "arc.ending")}
        />
      </label>
    </div>
  );
}

/** A short interview that builds the antagonist. */
function AntagonistInterview({
  record,
  settings,
  onClose,
  onSave,
}: {
  record: CardRecord;
  settings: ArcSettings;
  onClose: () => void;
  onSave: (a: Antagonist) => void;
}) {
  const [idea, setIdea] = useState("");
  const [round, setRound] = useState<InterviewRound>();
  const [antagonist, setAntagonist] = useState<Antagonist>();
  const [brainstorm, setBrainstorm] = useState<Question>();
  const { busy, run, status } = useRun();

  const start = () =>
    run("Preparing questions…", async (signal) => {
      const parts = await gatherContext(record);
      const result = await complete("arc", {
        system: systemPrompt("arc"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${antagonistKickoff(settings, idea)}` }],
        tools: [ASK_QUESTIONS],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === ASK_QUESTIONS.name);
      const questions = call ? readQuestions(call) : [];
      if (!questions.length)
        throw new Error("The co-writer didn't ask any questions. Try again, or pick another model.");
      setRound({ callId: call!.id, questions, answers: {}, submitted: false });
    });

  const write = () =>
    run("Writing the antagonist…", async (signal) =>
      setAntagonist(await writeAntagonist(record, settings, answersText(round!), signal)),
    );

  return (
    <Dialog open title="Build the antagonist" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {antagonist ? (
          <>
            <AntagonistFields antagonist={antagonist} onChange={(a) => setAntagonist(a)} />
            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => void write()}>
                Write it again
              </Button>
              <Button variant="primary" disabled={!antagonist.name.trim() || !!busy} onClick={() => onSave(antagonist)}>
                Use this antagonist
              </Button>
            </div>
          </>
        ) : round ? (
          <>
            {round.questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                answer={round.answers[q.id] ?? ""}
                onAnswer={(a) => setRound({ ...round, answers: { ...round.answers, [q.id]: a } })}
                onBrainstorm={() => setBrainstorm(q)}
              />
            ))}
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void write()}>
              Write the antagonist
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              A few questions with answers you can tap: what they want, how they work, how they move against you, and
              their weak spot.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Your idea, if you have one
              <AutoTextarea
                rows={2}
                value={idea}
                placeholder="e.g. the harbourmaster who sold the city to smugglers"
                onChange={(e) => setIdea(e.target.value)}
              />
            </label>
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void start()}>
              Start
            </Button>
          </>
        )}
        {status}
      </div>
      {brainstorm && round && (
        <BrainstormDialog
          key={brainstorm.id}
          question={brainstorm}
          known={answersText({ ...round, questions: round.questions.filter((q) => round.answers[q.id]?.trim()) })}
          onUse={(a) => setRound({ ...round, answers: { ...round.answers, [brainstorm.id]: a } })}
          onClose={() => setBrainstorm(undefined)}
        />
      )}
    </Dialog>
  );
}
