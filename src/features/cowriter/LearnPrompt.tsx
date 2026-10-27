import { useState } from "react";
import type { ChatRecord } from "../../ai/records";
import { useAiSettings } from "../../ai/settings";
import type { CardDataV3 } from "../../card";
import { AutoTextarea, Button } from "../../components/ui";
import { handEdits, noteFromEdit, noteSuggestion, saveNote } from "../../cowriter/learn";
import { useRun } from "./useRun";

/**
 * Offers to turn what the user keeps asking for, or how they changed an accepted edit by hand,
 * into a style note the co-writer reads from then on.
 */
export function LearnPrompt({ chat, data, onLearned }: { chat: ChatRecord; data: CardDataV3; onLearned: (proposalId: string) => void }) {
  const settings = useAiSettings((s) => s.settings);
  const { busy, run, status } = useRun();
  const [draft, setDraft] = useState<{ proposalId: string; note: string }>();
  const suggestion = noteSuggestion(settings);
  const edit = handEdits(chat, data)[0];

  if (draft)
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm">
        <p className="text-ink-muted">
          {draft.note ? "The co-writer will follow this note in everything it writes. Edit it if you like." : "Your change looks like a fact fix. Write a note anyway?"}
        </p>
        <AutoTextarea aria-label="Style note" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraft(undefined)}>
            Skip
          </Button>
          <Button
            variant="primary"
            disabled={!draft.note.trim()}
            onClick={() => {
              void saveNote(draft.note);
              setDraft(undefined);
            }}
          >
            Save note
          </Button>
        </div>
      </div>
    );

  if (suggestion)
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm">
        <p className="text-ink-muted">
          "{suggestion.label}" came up in your feedback {suggestion.count} times. Save it as a style note so
          drafts start that way: "{suggestion.note}"
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void saveNote("", suggestion.key)}>
            Not now
          </Button>
          <Button variant="primary" onClick={() => void saveNote(suggestion.note, suggestion.key)}>
            Save note
          </Button>
        </div>
      </div>
    );

  if (!edit) return status || null;
  const label = edit.field.replace(/_/g, " ");
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm">
      <p className="text-ink-muted">
        You changed the {label} from edit {edit.proposal.number} by hand. The co-writer can learn what you prefer from it.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!!busy} onClick={() => onLearned(edit.proposal.id)}>
          Not now
        </Button>
        <Button
          variant="primary"
          disabled={!!busy}
          onClick={() =>
            void run("Reading your changes…", async (signal) => {
              const note = await noteFromEdit(edit.field, edit.before, edit.after, signal);
              onLearned(edit.proposal.id);
              setDraft({ proposalId: edit.proposal.id, note });
            })
          }
        >
          ✦ Learn from my edit
        </Button>
      </div>
      {status}
    </div>
  );
}
