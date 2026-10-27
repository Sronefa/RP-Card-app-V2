import { useEffect, useState } from "react";
import {
  cardProgress,
  guideCard,
  markStep,
  readGuide,
  skipStep,
  STEPS,
  stepStatuses,
  updateGuide,
  type StepDef,
  type StepId,
  type StepStatus,
} from "../../app/guide";
import { useUi } from "../../app/store";
import { Button } from "../../components/ui";
import { getProject, type CardRecord, type ProjectRecord } from "../../db/db";
import { useEditor } from "../../editor/store";

const BADGE: Record<StepStatus, string> = { done: "✓ Done", skipped: "Skipped", suggested: "Next", todo: "" };

/** Opens the place where a step is done. */
export function goToStep(step: StepDef) {
  if (!step.go) return;
  const ui = useUi.getState();
  if (step.go.cowriterTab) ui.setCowriterTab(step.go.cowriterTab);
  ui.goTo(step.go.section, step.go.tab);
}

/** The guided path on the project page: each step done, skipped or suggested, with a way back in. */
export function GuidePanel({
  project,
  cards,
  onChange,
  onOpen,
  onNewCharacter,
  onSurprise,
  onExport,
}: {
  project: ProjectRecord;
  cards: CardRecord[];
  onChange: (p: ProjectRecord) => void;
  onOpen: (card: CardRecord) => Promise<void>;
  onNewCharacter: () => Promise<CardRecord>;
  onSurprise: () => void;
  onExport: (card: CardRecord) => void;
}) {
  const guide = readGuide(project);
  const openId = useEditor((s) => s.record?.id);
  const card = guideCard(cards, openId);
  const [progress, setProgress] = useState<Set<StepId>>(new Set());
  useEffect(() => {
    let live = true;
    void cardProgress(card).then((p) => live && setProgress(p));
    return () => {
      live = false;
    };
  }, [card]);

  const save = (p: Promise<ProjectRecord | undefined>) => void p.then((next) => next && onChange(next));
  if (!guide.on)
    return (
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Guided path</h2>
        <p className="text-sm text-ink-muted">A step list from the idea to the export, if you'd like one. Every step can be skipped.</p>
        <Button className="self-start" onClick={() => save(updateGuide(project.id, (g) => ({ ...g, on: true })))}>
          Show the guided path
        </Button>
      </section>
    );

  const statuses = stepStatuses(guide, progress);
  const go = async (step: StepDef) => {
    if (step.id === "export") return card && onExport(card);
    const target = card ?? (await onNewCharacter());
    await onOpen(target);
    goToStep(step);
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Guided path">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Guided path</h2>
        <Button variant="ghost" onClick={() => save(updateGuide(project.id, (g) => ({ ...g, on: false })))}>
          Hide
        </Button>
      </div>
      {card && <p className="text-xs text-ink-muted">Following {card.card.data.name || "the unnamed card"}.</p>}
      <ol className="flex flex-col gap-1">
        {STEPS.map((step, i) => {
          const status = statuses[step.id];
          const marked = guide.done.includes(step.id) && !progress.has(step.id);
          return (
            <li
              key={step.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg p-2 text-sm ${status === "suggested" ? "border border-accent/50 bg-accent/5" : "bg-surface-sunken"}`}
            >
              <span className="w-5 text-ink-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className={status === "skipped" ? "text-ink-muted line-through" : "font-medium"}>{step.label}</span>
                {BADGE[status] && <span className={`ml-2 text-xs ${status === "done" ? "text-accent" : "text-ink-muted"}`}>{BADGE[status]}</span>}
                <span className="block text-xs text-ink-muted">{step.hint}</span>
              </span>
              {step.id === "idea" && !card ? (
                <>
                  <Button variant="ghost" onClick={onSurprise}>
                    ✦ Surprise me
                  </Button>
                  <Button variant={status === "suggested" ? "primary" : "secondary"} onClick={() => void go(STEPS[1])}>
                    My own idea
                  </Button>
                </>
              ) : (
                status !== "skipped" &&
                (step.go || step.id === "export") && (
                  <Button variant={status === "suggested" ? "primary" : "ghost"} aria-label={`Go to ${step.label}`} onClick={() => void go(step)}>
                    {status === "done" ? "Open" : status === "suggested" ? "Continue" : "Go"}
                  </Button>
                )
              )}
              {status !== "done" && (
                <Button variant="ghost" aria-label={`${status === "skipped" ? "Unskip" : "Skip"} ${step.label}`} onClick={() => save(skipStep(project.id, step.id, status !== "skipped"))}>
                  {status === "skipped" ? "Unskip" : "Skip"}
                </Button>
              )}
              {(status === "suggested" || status === "todo" || marked) && (
                <Button variant="ghost" aria-label={`${marked ? "Unmark" : "Mark"} ${step.label} done`} onClick={() => save(markStep(project.id, step.id, !marked))}>
                  {marked ? "Not done" : "Done"}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "Next: …" on the card bar while the open card's project follows the guided path. */
export function GuideChip() {
  const record = useEditor((s) => s.record);
  const [next, setNext] = useState<StepDef>();
  useEffect(() => {
    if (!record) return setNext(undefined);
    let live = true;
    // Counted a moment after typing stops, not on every key.
    const timer = setTimeout(() => {
      void getProject(record.projectId).then(async (project) => {
        const guide = project && readGuide(project);
        if (!guide?.on) return live && setNext(undefined);
        const statuses = stepStatuses(guide, await cardProgress(record));
        if (live) setNext(STEPS.find((s) => statuses[s.id] === "suggested"));
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [record]);
  if (!next) return null;
  const open = () => {
    if (next.go) goToStep(next);
    else {
      useUi.getState().setProjectId(record!.projectId);
      useUi.getState().setSection("library");
    }
  };
  return (
    <Button variant="ghost" className="hidden sm:inline-flex" aria-label={`Next step: ${next.label}`} onClick={open}>
      Next: {next.label}
    </Button>
  );
}
