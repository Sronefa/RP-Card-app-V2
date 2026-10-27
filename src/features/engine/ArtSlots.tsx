import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { Button } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { artSlots, type ArtSlot } from "../../images/engineArt";
import { mergeShots, updateStudio } from "../../images/shots";

/** The pictures the card's parts can show, with what's missing one tap from the shot list or the assets. */
export function ArtSlots() {
  const record = useEditor((s) => s.record);
  if (!record) return null;
  const slots = artSlots(record.card.data);
  if (!slots.length) return null;
  const empty = slots.filter((s) => !s.filled);

  const addShots = (list: ArtSlot[]) => {
    void updateStudio(record.id, (st) => ({ ...st, shots: mergeShots(st.shots, list.map((s) => s.shot())) }));
    toast(`${list.length === 1 ? "Added to" : `${list.length} shots added to`} the Image Studio's shot list`);
  };
  const pick = (slot: ArtSlot) => {
    useUi.getState().setAssetPick({ label: slot.label, tag: slot.tag });
    useUi.getState().setSection("assets");
  };

  return (
    <details className="rounded-xl border border-border p-2" open={empty.length > 0}>
      <summary className="cursor-pointer text-sm font-medium">
        Art for your parts{" "}
        <span className="text-ink-muted">
          ({slots.length - empty.length} of {slots.length} filled)
        </span>
      </summary>
      <p className="mt-1 text-xs text-ink-muted">
        Parts find pictures by what they show. Empty slots fall back to initials and the theme until an image is filed.
      </p>
      {empty.length > 1 && (
        <Button variant="ghost" className="mt-1" onClick={() => addShots(empty)}>
          Add all {empty.length} empty slots to the shot list
        </Button>
      )}
      <ul className="mt-2 flex flex-col gap-1" aria-label="Art slots">
        {slots.map((slot) => (
          <li key={slot.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={slot.filled ? "text-accent" : "text-ink-muted"} aria-hidden>
              {slot.filled ? "●" : "○"}
            </span>
            <span className="flex-1">
              {slot.label} <span className="text-xs text-ink-muted">· {slot.part}</span>
              <span className="sr-only">{slot.filled ? ", filled" : ", empty"}</span>
            </span>
            {!slot.filled && (
              <Button variant="ghost" aria-label={`Add a shot for ${slot.label}`} onClick={() => addShots([slot])}>
                + Shot
              </Button>
            )}
            <Button variant="ghost" aria-label={`Pick an image for ${slot.label}`} onClick={() => pick(slot)}>
              Pick
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
