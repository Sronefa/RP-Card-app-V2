import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { Button, EmptyState } from "../../components/ui";
import { useEditor, type SaveState } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { BasicsGroup } from "./BasicsGroup";
import { GROUPS, PERMANENT_FIELDS, TEXT_FIELDS, type GroupId } from "./fields";
import { GreetingsGroup } from "./GreetingsGroup";
import { HistoryDialog } from "./HistoryDialog";
import { TextField } from "./TextField";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
};

export function EditorView() {
  const record = useEditor((s) => s.record);
  const { saveState, past, future, undo, redo } = useEditor();
  const setSection = useUi((s) => s.setSection);
  const [group, setGroup] = useState<GroupId>("basics");
  const [history, setHistory] = useState(false);

  useKeyboardUndo(!!record);

  if (!record) {
    return (
      <EmptyState title="No card open">
        <p className="text-ink-muted">Open or create a card from a project in the Library.</p>
        <Button variant="primary" onClick={() => setSection("library")}>
          Go to Library
        </Button>
      </EmptyState>
    );
  }

  const d = record.card.data;
  const permanent = PERMANENT_FIELDS.reduce((n, f) => n + estimateTokens(d[f]), 0);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{d.name || "Unnamed"}</div>
            <div className="text-xs text-ink-muted">
              {record.kind === "world" ? "World" : "Character"} · ~{permanent} permanent tokens ·{" "}
              <span className={saveState === "error" ? "text-red-300" : undefined}>{SAVE_LABEL[saveState]}</span>
            </div>
          </div>
          <Button variant="ghost" aria-label="Undo" disabled={past.length === 0} onClick={undo}>
            ↶
          </Button>
          <Button variant="ghost" aria-label="Redo" disabled={future.length === 0} onClick={redo}>
            ↷
          </Button>
          <Button onClick={() => setHistory(true)}>History</Button>
        </div>
        <nav aria-label="Card sections" className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 py-2">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-current={group === g.id ? "true" : undefined}
              onClick={() => setGroup(g.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                group === g.id ? "bg-accent/15 text-accent" : "text-ink-muted hover:text-ink"
              }`}
            >
              {g.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4">
        {group === "basics" && <BasicsGroup key={record.id} />}
        {group === "greetings" && <GreetingsGroup />}
        {TEXT_FIELDS[group]?.map((info) => <TextField key={info.field} info={info} />)}
      </div>

      <HistoryDialog open={history} onClose={() => setHistory(false)} />
    </div>
  );
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y use the card's history instead of the text box's own. */
function useKeyboardUndo(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Inside dialogs (version name, persona form...) keep the text box's own undo.
      if (e.target instanceof Element && e.target.closest("[role=dialog]")) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        useEditor.getState().undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        useEditor.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
