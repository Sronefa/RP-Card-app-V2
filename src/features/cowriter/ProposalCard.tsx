import type { Proposal } from "../../ai/records";
import { describeEdit, planEdit, ToolInputError, type Edit } from "../../ai/tools";
import { Button } from "../../components/ui";
import type { CardDataV3 } from "../../card";
import { diffWords } from "../../lib/diff";

const STATUS: Record<Proposal["status"], string> = {
  pending: "",
  accepted: "Accepted",
  rejected: "Rejected",
  failed: "Couldn't apply",
};

/**
 * One edit the co-writer proposed. Pending edits are shown against the card as it is now;
 * decided ones show just their outcome.
 */
export function ProposalCard({
  proposal,
  data,
  onDecide,
  onMore,
}: {
  proposal: Proposal;
  data: CardDataV3 | undefined;
  onDecide: (accept: boolean) => void;
  /** Asks for more pitches like this one. */
  onMore?: () => void;
}) {
  let edit: Edit | undefined;
  let problem: string | undefined;
  const pending = proposal.status === "pending";
  // Decided edits keep the description they had; re-planning them against the changed card would mislead.
  if (data && pending) {
    try {
      edit = planEdit(data, proposal.call);
    } catch (e) {
      if (!(e instanceof ToolInputError)) throw e;
      problem = e.message;
    }
  }
  const isPitch = proposal.call.name === "pitch";
  const title = isPitch
    ? String(proposal.call.input.title ?? "")
    : edit
      ? describeEdit(edit)
      : (proposal.summary ?? proposal.call.name.replace(/_/g, " "));
  const why = typeof proposal.call.input.why === "string" ? proposal.call.input.why : "";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {isPitch ? "Idea" : "Edit"} {proposal.number}: {title}
        </span>
        {!pending && (
          <span className={`shrink-0 text-xs ${proposal.status === "accepted" ? "text-accent" : "text-ink-muted"}`}>
            {STATUS[proposal.status]}
          </span>
        )}
      </div>
      {why && pending && <p className="text-xs text-ink-muted italic">{why}</p>}
      {proposal.error && <p className="text-xs text-red-300">{proposal.error}</p>}
      {pending && problem && <p className="text-xs text-amber-300">This edit no longer fits the card: {problem}</p>}
      {pending && edit && <EditPreview edit={edit} />}
      {!pending && onMore && (
        <Button variant="ghost" className="self-end" onClick={onMore}>
          More like this
        </Button>
      )}
      {pending && (
        <div className="flex justify-end gap-2">
          {onMore && (
            <Button variant="ghost" className="mr-auto" onClick={onMore}>
              More like this
            </Button>
          )}
          <Button variant="ghost" onClick={() => onDecide(false)}>
            {isPitch || problem ? "Dismiss" : "Reject"}
          </Button>
          {!problem && (
            <Button variant="primary" onClick={() => onDecide(true)}>
              {isPitch ? "Use it" : "Accept"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EditPreview({ edit }: { edit: Edit }) {
  if (edit.kind === "pitch") return <p className="text-ink">{edit.idea}</p>;
  if (edit.kind === "lore") {
    const e = edit.after ?? edit.before!;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink-muted">
          Keys: {e.keys.join(", ") || "none"}
          {e.constant ? " · always on" : ""}
        </span>
        {edit.action === "delete" ? (
          <Diff before={e.content} after="" />
        ) : (
          <Diff before={edit.before?.content ?? ""} after={edit.after!.content} />
        )}
      </div>
    );
  }
  return <Diff before={edit.before} after={edit.after} />;
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg bg-surface-sunken p-2 leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.type === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.type === "add" ? (
          <ins key={i} className="bg-emerald-500/20 text-emerald-200 no-underline">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="bg-red-500/15 text-red-300/80">
            {p.text}
          </del>
        ),
      )}
    </div>
  );
}
