import type { Proposal } from "../../ai/records";
import { describeEdit, planEdit, ToolInputError, type Edit } from "../../ai/tools";
import { Button } from "../../components/ui";
import type { CardDataV3 } from "../../card";
import { diffWords } from "../../lib/diff";
import { estimateTokens } from "../../lib/tokens";
import { guessWorldKind, KINDS, type TypedKind } from "../../editor/world";
import { varLabel, type EngineConfig } from "../../engine/sheet";
import { FEEDBACK, feedbackLabel, REASONS, reasonLabel } from "../../cowriter/learn";
import { textOf } from "../../cowriter/polish";
import { Variants } from "./Variants";

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
  onRetype,
  onPolish,
  onRevise,
  onReason,
  onVariants,
  onRank,
  onUseVariant,
  busy = false,
}: {
  proposal: Proposal;
  data: CardDataV3 | undefined;
  onDecide: (accept: boolean) => void;
  /** Asks for more pitches like this one. */
  onMore?: () => void;
  /** Files a plain lore entry under a world page instead. */
  onRetype?: (kind: TypedKind) => void;
  /** Runs the prose editor over the proposed text. */
  onPolish?: () => void;
  /** Rewrites the proposed text with a feedback chip. */
  onRevise?: (feedback: string) => void;
  /** Records why it was rejected. */
  onReason?: (reason: string) => void;
  /** Writes other versions of the proposed text. */
  onVariants?: () => void;
  onRank?: () => void;
  onUseVariant?: (text: string, label: string) => void;
  /** A model call is running, so the buttons that start one are off. */
  busy?: boolean;
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
  // The safety net: a plain entry that reads like a person, place or item can land on its page.
  const guess =
    pending && onRetype && edit?.kind === "lore" && edit.action === "add" && !edit.world
      ? guessWorldKind(edit.title, edit.after!.content)
      : undefined;

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
      {pending && proposal.fixed && (
        <p className="text-xs text-ink-muted">Rewrote overused phrasing: {proposal.fixed.map((f) => `"${f}"`).join(", ")}</p>
      )}
      {pending && proposal.polished && <p className="text-xs text-ink-muted">Polished: {proposal.polished.join("; ") || "line edits"}</p>}
      {pending && proposal.revised && <p className="text-xs text-ink-muted">Revised: {proposal.revised.map(feedbackLabel).join(", ")}</p>}
      {pending && proposal.variants && onUseVariant && onRank && (
        <Variants variants={proposal.variants} current={textOf(proposal.call) ?? ""} busy={busy} onUse={onUseVariant} onRank={onRank} />
      )}
      {pending && onRevise && !problem && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Revise edit ${proposal.number}`}>
          {FEEDBACK.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={busy}
              onClick={() => onRevise(f.id)}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink disabled:opacity-40"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {proposal.status === "rejected" && onReason && !isPitch && (
        proposal.reason ? (
          <p className="text-xs text-ink-muted">Why: {reasonLabel(proposal.reason)}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Why was edit ${proposal.number} rejected?`}>
            <span className="text-xs text-ink-muted">Why? (optional)</span>
            {REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onReason(r.id)}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-ink"
              >
                {r.label}
              </button>
            ))}
          </div>
        )
      )}
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
          {guess && (
            <Button variant="ghost" className={onMore ? "" : "mr-auto"} onClick={() => onRetype!(guess)}>
              Save as {guess === "npc" ? "NPC" : KINDS[guess].label}
            </Button>
          )}
          {onVariants && !problem && !proposal.variants && (
            <Button variant="ghost" aria-label={`Variants of edit ${proposal.number}`} disabled={busy} onClick={onVariants}>
              ✦ Variants
            </Button>
          )}
          {onPolish && !problem && (
            <Button variant="ghost" aria-label={`Polish edit ${proposal.number}`} onClick={onPolish}>
              ✦ Polish
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
          {edit.world && `On the ${KINDS[edit.world].plural} page · `}
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
  if (edit.kind === "engine") return <Diff before={sheetText(edit.before)} after={sheetText(edit.after)} />;
  if (edit.kind === "tiers") return <Diff before={edit.before?.content ?? ""} after={edit.after.content} />;
  const before = estimateTokens(edit.before);
  const after = estimateTokens(edit.after);
  return (
    <div className="flex flex-col gap-1">
      {edit.before && before !== after && (
        <span className="text-xs text-ink-muted">
          ~{before} → ~{after} tokens
        </span>
      )}
      <Diff before={edit.before} after={edit.after} />
    </div>
  );
}

/** The sheet's values as lines, so a change to them shows as a diff. */
function sheetText(config: EngineConfig | undefined): string {
  return (config?.vars ?? [])
    .map((v) => {
      const range = v.min !== undefined || v.max !== undefined ? `, ${v.min ?? "…"} to ${v.max ?? "…"}` : "";
      return `${varLabel(v)} (${v.type}, starts at ${v.start || "nothing"}${range}${v.hidden ? ", hidden" : v.readOnly ? ", read-only" : ""})${v.rule.trim() ? `: ${v.rule.trim()}` : ""}`;
    })
    .join("\n");
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
