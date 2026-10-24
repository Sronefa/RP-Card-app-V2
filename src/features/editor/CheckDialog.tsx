import { useUi } from "../../app/store";
import { Button, Dialog } from "../../components/ui";
import { askCowriter } from "../../cowriter/ask";
import type { Health, Issue, IssueLevel } from "../../editor/checker";
import { coverageRequest } from "../../editor/coverage";
import { emptyBook, newEntry } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";

const LEVEL: Record<IssueLevel, { label: string; className: string }> = {
  error: { label: "Problem", className: "bg-red-500/15 text-red-300" },
  warning: { label: "Warning", className: "bg-amber-500/15 text-amber-300" },
  tip: { label: "Tip", className: "bg-accent/15 text-accent" },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CheckDialog({
  open,
  issues,
  health,
  onClose,
}: {
  open: boolean;
  issues: Issue[];
  health?: Health;
  onClose: () => void;
}) {
  const { setSection, setEditorGroup, setFocusEntry } = useUi();

  function go(issue: Issue) {
    const t = issue.target;
    if (t.section === "editor") setEditorGroup(t.group);
    if (t.section === "lorebook") setFocusEntry(t.entry);
    setSection(t.section);
    onClose();
  }

  function fix(request: string) {
    onClose();
    void askCowriter({ send: request });
  }

  /** Adds an empty entry keyed on the name and opens it. */
  function addStub(name: string) {
    const { record, setField } = useEditor.getState();
    const book = record!.card.data.character_book ?? emptyBook();
    setField("character_book", { ...book, entries: [...book.entries, newEntry(book, { comment: name, keys: [name] })] });
    setFocusEntry(book.entries.length);
    setSection("lorebook");
    onClose();
  }

  const problems = issues.filter((i) => i.level !== "tip");
  const slop = issues.filter((i) => i.kind === "slop");
  const uncovered = issues.filter((i) => i.kind === "coverage");
  const tips = issues.filter((i) => i.level === "tip" && !i.kind);

  const row = (issue: Issue, i: number) => (
    <li key={i} className="flex items-stretch gap-1 rounded-lg border border-border hover:border-ink-muted">
      <button type="button" onClick={() => go(issue)} className="flex flex-1 flex-col gap-1 p-2 text-left text-sm">
        {!issue.kind && (
          <span className={`w-fit rounded-full px-2 text-xs ${LEVEL[issue.level].className}`}>
            {LEVEL[issue.level].label}
          </span>
        )}
        {issue.message}
      </button>
      {issue.stub && (
        <button
          type="button"
          aria-label={`Add an empty entry for ${issue.stub}`}
          className="shrink-0 px-3 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink"
          onClick={() => addStub(issue.stub!)}
        >
          + Entry
        </button>
      )}
      {!issue.manual && (
        <button
          type="button"
          aria-label={`Fix with the co-writer: ${issue.message}`}
          className="shrink-0 rounded-r-lg px-3 text-sm text-accent hover:bg-accent/10"
          onClick={() => fix(issue.request ?? `The card checker found this: "${issue.message}" Fix it.`)}
        >
          {issue.kind === "slop" ? "✦ Rewrite" : issue.kind === "coverage" ? "✦ Write" : "✦ Fix"}
        </button>
      )}
    </li>
  );

  const group = (title: string, list: Issue[], action?: React.ReactNode) =>
    list.length > 0 && (
      <section className="flex flex-col gap-2" aria-label={title}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-ink-muted">{title}</h3>
          {action}
        </div>
        <ul className="flex flex-col gap-2">{list.map(row)}</ul>
      </section>
    );

  return (
    <Dialog open={open} title="Card check" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {health && <HealthSummary health={health} />}
        {issues.length === 0 ? (
          <p className="text-ink-muted">No problems found. The card is ready to export.</p>
        ) : (
          <>
            {group("Problems", problems)}
            {group("Overused phrasing", slop)}
            {group(
              "Names without lorebook entries",
              uncovered,
              uncovered.length > 1 && (
                <Button variant="ghost" onClick={() => fix(coverageRequest(uncovered.map((i) => i.stub!)))}>
                  ✦ Write all
                </Button>
              ),
            )}
            {group("Tips", tips)}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function HealthSummary({ health }: { health: Health }) {
  const color = health.score >= 80 ? "text-emerald-300" : health.score >= 50 ? "text-amber-300" : "text-red-300";
  const parts = [
    health.problems && plural(health.problems, "problem", "problems"),
    health.slop && plural(health.slop, "overused phrase", "overused phrases"),
    health.uncovered && plural(health.uncovered, "name without an entry", "names without entries"),
    health.tips && plural(health.tips, "tip", "tips"),
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-sunken p-3">
      <div className={`text-3xl font-semibold tabular-nums ${color}`} aria-label={`Card health ${health.score} out of 100`}>
        {health.score}
      </div>
      <div className="flex flex-col text-sm">
        <span className="font-medium">Card health</span>
        <span className="text-ink-muted">{parts.length ? parts.join(" · ") : "Nothing to fix"}</span>
      </div>
    </div>
  );
}
