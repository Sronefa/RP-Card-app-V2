import { useUi } from "../../app/store";
import { Button, Dialog } from "../../components/ui";
import type { Issue, IssueLevel } from "../../editor/checker";

const LEVEL: Record<IssueLevel, { label: string; className: string }> = {
  error: { label: "Problem", className: "bg-red-500/15 text-red-300" },
  warning: { label: "Warning", className: "bg-amber-500/15 text-amber-300" },
  tip: { label: "Tip", className: "bg-accent/15 text-accent" },
};

export function CheckDialog({ open, issues, onClose }: { open: boolean; issues: Issue[]; onClose: () => void }) {
  const { setSection, setEditorGroup, setFocusEntry } = useUi();

  function go(issue: Issue) {
    const t = issue.target;
    if (t.section === "editor") setEditorGroup(t.group);
    if (t.section === "lorebook") setFocusEntry(t.entry);
    setSection(t.section);
    onClose();
  }

  return (
    <Dialog open={open} title="Card check" onClose={onClose}>
      {issues.length === 0 ? (
        <p className="text-ink-muted">No problems found. The card is ready to export.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => go(issue)}
                className="flex w-full flex-col gap-1 rounded-lg border border-border p-2 text-left text-sm hover:border-ink-muted"
              >
                <span className={`w-fit rounded-full px-2 text-xs ${LEVEL[issue.level].className}`}>
                  {LEVEL[issue.level].label}
                </span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
