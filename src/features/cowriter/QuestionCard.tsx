import { YOU_DECIDE, type Question } from "../../ai/records";
import { AutoTextarea, Button } from "../../components/ui";

/** One interview question: suggested answers to tap, a box for your own, "You decide" and a brainstorm. */
export function QuestionCard({
  question,
  answer,
  onAnswer,
  onBrainstorm,
}: {
  question: Question;
  answer: string;
  onAnswer: (answer: string) => void;
  onBrainstorm: () => void;
}) {
  const chip = (selected: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-sm ${selected ? "border-accent bg-accent/15 text-ink" : "border-border text-ink-muted hover:text-ink"}`;
  return (
    <fieldset aria-label={question.question} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3">
      {question.theme && <span className="text-xs tracking-wide text-accent uppercase">{question.theme}</span>}
      <p className="font-medium">{question.question}</p>
      {question.suggestions.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={answer === s}
          className={chip(answer === s)}
          onClick={() => onAnswer(answer === s ? "" : s)}
        >
          {s}
        </button>
      ))}
      <AutoTextarea
        rows={1}
        aria-label={`Your answer: ${question.question}`}
        value={answer === YOU_DECIDE ? "" : answer}
        placeholder="Or write your own…"
        className="min-h-10"
        onChange={(e) => onAnswer(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={answer === YOU_DECIDE}
          className={chip(answer === YOU_DECIDE)}
          onClick={() => onAnswer(answer === YOU_DECIDE ? "" : YOU_DECIDE)}
        >
          You decide
        </button>
        <Button variant="ghost" className="text-accent" onClick={onBrainstorm}>
          ✦ Brainstorm
        </Button>
      </div>
    </fieldset>
  );
}

