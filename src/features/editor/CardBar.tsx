import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { checkCard } from "../../editor/checker";
import { useEditor, type SaveState } from "../../editor/store";
import { CheckDialog } from "./CheckDialog";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
};

/**
 * Top bar shared by the editor, lorebook and assets: the open card's name, save state,
 * undo/redo and the card checker. Also routes Ctrl+Z to the card's history.
 */
export function CardBar({ detail, children }: { detail?: React.ReactNode; children?: React.ReactNode }) {
  const record = useEditor((s) => s.record!);
  const { saveState, past, future, undo, redo } = useEditor();
  const [checking, setChecking] = useState(false);
  const issues = useMemo(() => checkCard(record), [record]);
  const problems = issues.filter((i) => i.level !== "tip").length;

  useKeyboardUndo();

  return (
    <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pt-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{record.card.data.name || "Unnamed"}</div>
        <div className="text-xs text-ink-muted">
          <span className={saveState === "error" ? "text-red-300" : undefined}>{SAVE_LABEL[saveState]}</span>
          {detail && <> · {detail}</>}
        </div>
      </div>
      <Button variant="ghost" aria-label="Undo" disabled={past.length === 0} onClick={undo}>
        ↶
      </Button>
      <Button variant="ghost" aria-label="Redo" disabled={future.length === 0} onClick={redo}>
        ↷
      </Button>
      <Button onClick={() => setChecking(true)} aria-label={`Check card, ${problems} problems`}>
        Check
        {problems > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300">{problems}</span>
        )}
      </Button>
      {children}
      <CheckDialog open={checking} issues={issues} onClose={() => setChecking(false)} />
    </div>
  );
}

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y use the card's history instead of the text box's own. */
function useKeyboardUndo() {
  useEffect(() => {
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
  }, []);
}
