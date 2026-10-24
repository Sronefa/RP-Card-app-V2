import { useState } from "react";
import { REMIXES, type RemixKind } from "../../ai/prompts";
import { Button, Dialog, TextInput } from "../../components/ui";

/** Picks how to remix a card: the copy is made and the co-writer rewrites it. */
export function RemixDialog({
  name,
  onRemix,
  onClose,
}: {
  name: string;
  onRemix: (kind: RemixKind, details: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<RemixKind>("au");
  const [details, setDetails] = useState("");
  const remix = REMIXES[kind];
  return (
    <Dialog open title={`Remix ${name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Makes a copy of the card in this project, then the co-writer rewrites the copy with the same voice. The
          original stays as it is.
        </p>
        <fieldset className="flex flex-col gap-2" aria-label="Kind of remix">
          {(Object.keys(REMIXES) as RemixKind[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="radio" name="remix" className="size-4" checked={kind === k} onChange={() => setKind(k)} />
              {REMIXES[k].label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          {remix.ask}
          <TextInput value={details} placeholder={remix.placeholder} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={kind === "custom" && !details.trim()}
            onClick={() => onRemix(kind, details.trim())}
          >
            Make the remix
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
