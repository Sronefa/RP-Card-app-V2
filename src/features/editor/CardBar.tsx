import { useEffect, useMemo, useState } from "react";
import { useAiSettings } from "../../ai/settings";
import type { LorebookEntry } from "../../card";
import { Button } from "../../components/ui";
import { listCards } from "../../db/db";
import { cardHealth, checkCard } from "../../editor/checker";
import { DEFAULT_SLOP_PHRASES } from "../../editor/slop";
import { useEditor, type SaveState } from "../../editor/store";
import { CheckDialog } from "./CheckDialog";
import { InboxDialog, useInbox } from "../inbox/InboxDialog";
import { GuideChip } from "../library/GuidePanel";

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
  const issues = useCardIssues();
  const problems = issues.filter((i) => i.level !== "tip").length;
  const inbox = useInbox();
  const [inboxOpen, setInboxOpen] = useState(false);

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
      <GuideChip />
      {inbox.length > 0 && (
        <Button variant="ghost" onClick={() => setInboxOpen(true)} aria-label={`Inbox, ${inbox.length} waiting`}>
          Inbox
          <span className="rounded-full bg-accent/20 px-1.5 text-xs text-accent">{inbox.length}</span>
        </Button>
      )}
      {children}
      <InboxDialog items={inbox} open={inboxOpen} onClose={() => setInboxOpen(false)} />
      <CheckDialog open={checking} issues={issues} health={cardHealth(issues)} onClose={() => setChecking(false)} />
    </div>
  );
}

/** Checker results for the open card, with overused phrasing and names the lorebooks don't cover. */
function useCardIssues() {
  const record = useEditor((s) => s.record!);
  const { settings, load } = useAiSettings();
  const [worldEntries, setWorldEntries] = useState<LorebookEntry[]>([]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    let live = true;
    setWorldEntries([]);
    if (record.kind === "character")
      void listCards(record.projectId).then((cards) => {
        const world = cards.find((c) => c.kind === "world");
        if (live) setWorldEntries(world?.card.data.character_book?.entries ?? []);
      });
    return () => {
      live = false;
    };
    // The world's lorebook is read when a card opens.
  }, [record.id]);
  const phrases = settings.slopPhrases ?? DEFAULT_SLOP_PHRASES;
  return useMemo(
    () => checkCard(record, { slopPhrases: phrases, coverage: { otherEntries: worldEntries } }),
    [record, phrases, worldEntries],
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
