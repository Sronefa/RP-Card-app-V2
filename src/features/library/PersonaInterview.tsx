import { useEffect, useRef, useState } from "react";
import { useUi } from "../../app/store";
import { ASK_QUESTIONS, INTERVIEW_TOOLS, readPersona, readQuestions, WRITE_PERSONA } from "../../ai/interviewTools";
import { answersText, personaKickoff, personaSourceText, personaWriteRequest, systemPrompt } from "../../ai/prompts";
import type { InterviewRound, Question } from "../../ai/records";
import { resolveModel, useAiSettings } from "../../ai/settings";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { complete, isAbort } from "../../cowriter/engine";
import { createPersona, type CardRecord, type PersonaRecord } from "../../db/db";
import { estimateTokens } from "../../lib/tokens";
import { BrainstormDialog } from "../cowriter/BrainstormDialog";
import { QuestionCard } from "../cowriter/QuestionCard";

/** A short interview that writes a persona for the library. */
export function PersonaInterview({
  onClose,
  onCreated,
  sources,
}: {
  onClose: () => void;
  onCreated: (p: PersonaRecord) => void;
  /** Cards the persona can start from; the world card comes first. */
  sources?: CardRecord[];
}) {
  const { settings, load } = useAiSettings();
  const setSection = useUi((s) => s.setSection);
  const [premise, setPremise] = useState("");
  const [sourceId, setSourceId] = useState(sources?.[0]?.id ?? "");
  const sourceCard = sources?.find((c) => c.id === sourceId);
  const source = sourceCard && personaSourceText(sourceCard);
  const [round, setRound] = useState<InterviewRound>();
  const [persona, setPersona] = useState<{ name: string; description: string }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [brainstorm, setBrainstorm] = useState<Question>();
  const controller = useRef<AbortController>(undefined);

  useEffect(() => void load(), [load]);
  useEffect(() => () => controller.current?.abort(), []);

  async function run(status: string, fn: (signal: AbortSignal) => Promise<void>) {
    setBusy(status);
    setError(undefined);
    controller.current = new AbortController();
    try {
      await fn(controller.current.signal);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  const ask = () =>
    run("Preparing questions…", async (signal) => {
      const result = await complete("interview", {
        system: systemPrompt("interview"),
        messages: [{ role: "user", text: personaKickoff(premise, source) }],
        tools: INTERVIEW_TOOLS,
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === ASK_QUESTIONS.name);
      const questions = call ? readQuestions(call) : [];
      if (!questions.length) throw new Error("The co-writer didn't ask any questions. Try again, or pick another model.");
      setRound({ callId: call!.id, questions, answers: {}, submitted: false });
    });

  const write = () =>
    run("Writing the persona…", async (signal) => {
      const result = await complete("draft", {
        system: systemPrompt("draft"),
        messages: [{ role: "user", text: personaWriteRequest(answersText(round!), source) }],
        tools: [WRITE_PERSONA],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === WRITE_PERSONA.name);
      const written = call ? readPersona(call) : { name: "", description: result.text.trim() };
      if (!written.description) throw new Error("The co-writer didn't write a persona. Try again.");
      setPersona({ name: written.name || "New persona", description: written.description });
    });

  async function save() {
    if (!persona) return;
    onCreated(await createPersona(persona.name.trim(), persona.description.trim()));
  }

  const ready = !!resolveModel(settings, "interview");
  return (
    <Dialog open title="Build a persona" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!ready ? (
          <>
            <p className="text-sm text-ink-muted">Connect a model in Settings to build personas with the co-writer.</p>
            <Button
              variant="primary"
              className="self-start"
              onClick={() => {
                onClose();
                setSection("settings");
              }}
            >
              Set up a model
            </Button>
          </>
        ) : persona ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <TextInput value={persona.name} onChange={(e) => setPersona({ ...persona, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between">
                Description <span className="text-ink-muted">~{estimateTokens(persona.description)} tokens</span>
              </span>
              <AutoTextarea value={persona.description} onChange={(e) => setPersona({ ...persona, description: e.target.value })} />
            </label>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => void write()}>
                Write it again
              </Button>
              <Button variant="primary" disabled={!persona.name.trim() || !!busy} onClick={() => void save()}>
                Save to library
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
              Write the persona
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              A few questions with answers you can tap, then the co-writer writes a short persona you can edit. It
              focuses on how they look and what they can do; you bring the personality when you play.
            </p>
            {sources && sources.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                Start from
                <select
                  className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  {sources.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.card.data.name || "Untitled"} ({c.kind === "world" ? "world" : "character"})
                    </option>
                  ))}
                  <option value="">Nothing, start fresh</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Your idea, if you have one
              <AutoTextarea
                rows={2}
                value={premise}
                placeholder={source ? "Optional, e.g. a smuggler who knows the docks" : "e.g. a retired knight who became a baker"}
                onChange={(e) => setPremise(e.target.value)}
              />
            </label>
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void ask()}>
              Start
            </Button>
          </>
        )}
        {busy && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            {busy}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
            {error}
          </p>
        )}
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
