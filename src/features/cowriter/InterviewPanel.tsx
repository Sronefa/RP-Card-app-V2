import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { memoText } from "../../ai/interviewTools";
import { factsText, transcript } from "../../ai/prompts";
import {
  DEFAULT_COWRITER,
  type InterviewDepth,
  type InterviewRecord,
  type Question,
} from "../../ai/records";
import { AutoTextarea, Button, Dialog } from "../../components/ui";
import { useInterview } from "../../cowriter/interview";
import { useCowriter } from "../../cowriter/store";
import { getProject } from "../../db/db";
import { useEditor } from "../../editor/store";
import { BrainstormDialog } from "./BrainstormDialog";
import { QuestionCard } from "./QuestionCard";

const DEPTH: Record<InterviewDepth, string> = {
  quick: "Quick: one round of questions, then the draft.",
  standard: "Standard: a few rounds, one gap check, a story bible, then the draft.",
  deep: "Deep: rounds until every theme is settled, gap checks until nothing is open, a story bible, then the draft.",
};

/** The interview: question rounds, the gap memo, the story bible, then the draft. */
export function InterviewPanel() {
  const record = useEditor((s) => s.record)!;
  const { interview: iv, busy, status, streaming, error, load, run, stop, reset } = useInterview();
  const [restarting, setRestarting] = useState(false);

  useEffect(() => void load(record.id), [record.id, load]);

  if (!iv) return <StartForm projectId={record.projectId} kind={record.kind} />;

  const working = ["questions", "gap", "bible", "draft"].includes(iv.stage);
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Known iv={iv} />
      {iv.stage === "asking" && !busy && <Round iv={iv} projectId={record.projectId} />}
      {iv.stage === "memo" && <Memo iv={iv} />}
      {iv.stage === "review" && <Bible iv={iv} />}
      {iv.stage === "done" && <Done iv={iv} />}
      {busy && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3" aria-live="polite">
          <p className="text-sm">{status}</p>
          {streaming && <p className="text-sm whitespace-pre-wrap text-ink-muted">{streaming}</p>}
          <Button className="self-start" onClick={stop}>
            Stop
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {working && !busy && (
        <Button variant="primary" className="self-start" onClick={() => void run()}>
          {error ? "Try again" : "Continue"}
        </Button>
      )}
      {!busy && (
        <Button variant="ghost" className="self-start" onClick={() => setRestarting(true)}>
          Start the interview over
        </Button>
      )}
      <Dialog open={restarting} title="Start over?" onClose={() => setRestarting(false)}>
        <p className="mb-4 text-sm text-ink-muted">
          This clears the answers and the story bible. The card and the co-writer chat stay as they are.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRestarting(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setRestarting(false);
              void reset();
            }}
          >
            Start over
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function StartForm({ projectId, kind }: { projectId: string; kind: "character" | "world" }) {
  const start = useInterview((s) => s.start);
  const busy = useInterview((s) => s.busy);
  const [premise, setPremise] = useState("");
  const [depth, setDepth] = useState<InterviewDepth>();

  useEffect(() => {
    void getProject(projectId).then((p) => setDepth({ ...DEFAULT_COWRITER, ...p?.cowriter }.depth));
  }, [projectId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        I ask you questions about your {kind === "world" ? "world" : "character"}, each with ready-made answers you can
        tap, then write the whole card from your answers. You never have to write prose.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Your idea, if you have one
        <AutoTextarea
          rows={2}
          value={premise}
          placeholder={
            kind === "world"
              ? "e.g. a drowned city where memories are currency"
              : "e.g. a grumpy dragon who runs a library"
          }
          onChange={(e) => setPremise(e.target.value)}
        />
      </label>
      {depth && <p className="text-xs text-ink-muted">{DEPTH[depth]} Change the depth under Style.</p>}
      <Button variant="primary" className="self-start" disabled={busy} onClick={() => void start(premise)}>
        Start the interview
      </Button>
    </div>
  );
}

/** "What I know so far", and the answers given in earlier rounds. */
function Known({ iv }: { iv: InterviewRecord }) {
  const answered = iv.rounds.filter((r) => r.submitted);
  if (!iv.facts.length && !answered.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {iv.facts.length > 0 && (
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">What I know so far ({iv.facts.length})</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-muted">
            {iv.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}
      {answered.length > 0 && (
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Your answers ({answered.reduce((n, r) => n + r.questions.length, 0)})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {answered.flatMap((r) =>
              r.questions.map((q) => (
                <p key={q.id}>
                  <span className="text-ink-muted">{q.question}</span>
                  <br />
                  {r.answers[q.id]?.trim() || "You decide"}
                </p>
              )),
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Round({ iv, projectId }: { iv: InterviewRecord; projectId: string }) {
  const { setAnswer, submit } = useInterview();
  const [brainstorm, setBrainstorm] = useState<Question>();
  const round = iv.rounds.at(-1)!;
  const known = [iv.facts.length && `What we know:\n${factsText(iv.facts)}`, transcript(iv.rounds)]
    .filter(Boolean)
    .join("\n\n");
  const answered = round.questions.filter((q) => round.answers[q.id]?.trim()).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-muted">
        Round {iv.rounds.length}. Tap an answer, write your own, or leave it to me.
      </p>
      {round.questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          answer={round.answers[q.id] ?? ""}
          onAnswer={(a) => setAnswer(q.id, a)}
          onBrainstorm={() => setBrainstorm(q)}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void submit()}>
          Send answers
        </Button>
        <Button onClick={() => void submit(true)}>Enough questions</Button>
      </div>
      <p className="text-xs text-ink-muted">
        {answered} of {round.questions.length} answered. Unanswered questions are left to me.
      </p>
      {brainstorm && (
        <BrainstormDialog
          key={brainstorm.id}
          question={brainstorm}
          projectId={projectId}
          known={known}
          onUse={(a) => setAnswer(brainstorm.id, a)}
          onClose={() => setBrainstorm(undefined)}
        />
      )}
    </div>
  );
}

function Memo({ iv }: { iv: InterviewRecord }) {
  const { digDeeper, enough, busy } = useInterview();
  const memo = iv.memos.at(-1)!;
  const more = iv.depth === "deep" || iv.memos.length === 1;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3">
      <h3 className="font-medium">Gap check {iv.memos.length > 1 ? iv.memos.length : ""}</h3>
      {memo.clean ? (
        <p className="text-sm text-ink-muted">Nothing important is missing. Ready for the story bible.</p>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{memoText(memo)}</p>
      )}
      {memo.clean && memo.opportunities.length > 0 && (
        <p className="text-sm whitespace-pre-wrap text-ink-muted">
          {memoText({ ...memo, missing: [], vague: [], contradictions: [] })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!memo.clean && more && (
          <Button variant="primary" disabled={busy} onClick={() => void digDeeper()}>
            Dig deeper
          </Button>
        )}
        <Button variant={memo.clean || !more ? "primary" : "secondary"} disabled={busy} onClick={() => void enough()}>
          {memo.clean || !more ? "Write the story bible" : "That's enough"}
        </Button>
      </div>
    </div>
  );
}

function Bible({ iv, editOnly = false }: { iv: InterviewRecord; editOnly?: boolean }) {
  const { setBible, draft, busy } = useInterview();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">Story bible</h3>
      <p className="text-sm text-ink-muted">
        Every decided fact. The card is written from this, and the co-writer keeps to it afterwards. Edit anything
        that's wrong.
      </p>
      <AutoTextarea
        aria-label="Story bible"
        value={iv.bible ?? ""}
        className="min-h-48 text-sm"
        onChange={(e) => setBible(e.target.value)}
      />
      {!editOnly && (
        <Button
          variant="primary"
          className="self-start"
          disabled={busy || !iv.bible?.trim()}
          onClick={() => void draft()}
        >
          Draft the card
        </Button>
      )}
    </div>
  );
}

function Done({ iv }: { iv: InterviewRecord }) {
  const setTab = useUi((s) => s.setCowriterTab);
  const { critique, busy, chat } = useCowriter();
  const pending = chat?.proposals.some((p) => p.status === "pending" && p.call.name !== "pitch") ?? false;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3">
      <p className="text-sm">
        The draft is in the chat as edits to accept or reject.
        {iv.depth !== "quick" &&
          " Once you've accepted it, run the critic: it reads the card as the roleplay model would and proposes fixes."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setTab("chat")}>
          Review the draft
        </Button>
        {iv.depth !== "quick" && (
          <Button
            disabled={busy || pending}
            onClick={async () => {
              setTab("chat");
              await useCowriter.getState().load(iv.cardId);
              await critique();
            }}
          >
            Run the critic
          </Button>
        )}
      </div>
      {iv.bible && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">Story bible</summary>
          <Bible iv={iv} editOnly />
        </details>
      )}
    </div>
  );
}
