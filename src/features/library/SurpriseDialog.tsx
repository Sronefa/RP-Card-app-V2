import { useState } from "react";
import { AutoTextarea, Button, Dialog } from "../../components/ui";
import { DECKS, draw, premise, redraw } from "../../cowriter/tropes";
import type { CardKind } from "../../db/db";

/** Draws a hand from the trope deck and starts an interview from it. */
export function SurpriseDialog({
  kind,
  onStart,
  onClose,
}: {
  kind: CardKind;
  onStart: (premise: string) => void;
  onClose: () => void;
}) {
  const [hand, setHand] = useState(() => draw(kind));
  const [idea, setIdea] = useState(() => premise(kind, hand));
  const deal = (next: string[]) => {
    setHand(next);
    setIdea(premise(kind, next));
  };
  return (
    <Dialog open title="Surprise me" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          One card from each pile. Draw again until something clicks, then start the interview with it.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DECKS[kind].map((suit, i) => (
            <li key={suit.name} className="flex items-start gap-2 rounded-xl border border-border bg-surface-raised p-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs text-ink-muted">{suit.name}</span>
                <span className="font-medium">{hand[i]}</span>
              </div>
              <button
                type="button"
                aria-label={`Draw another ${suit.name} card`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
                onClick={() => deal(redraw(kind, hand, i))}
              >
                ↻
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="self-start" onClick={() => deal(draw(kind))}>
          Draw a new hand
        </Button>
        <label className="flex flex-col gap-1 text-sm">
          The idea
          <AutoTextarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!idea.trim()} onClick={() => onStart(idea.trim())}>
            Start the interview
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
