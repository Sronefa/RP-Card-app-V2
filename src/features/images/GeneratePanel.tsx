import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { useAiSettings } from "../../ai/settings";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, TextInput } from "../../components/ui";
import { getProject, type CardRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { useObjectUrl } from "../../lib/useObjectUrl";
import { withFreshArt } from "../../images/engineArt";
import { fileCandidate } from "../../images/filing";
import { writePrompt } from "../../images/prompt";
import { estimateCost, modelFor, taskOf, useImageQueue, type Job } from "../../images/queue";
import type { Candidate, Shot, StudioRecord } from "../../images/shots";
import { newStyleLock, readSheets, writeSheet, type StyleLock } from "../../images/visual";

const STATUS: Record<Job["status"], string> = {
  queued: "Waiting",
  running: "Making",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const money = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/** Shots whose picked image can be a character's reference. */
const REFERENCE_KINDS = new Set<Shot["kind"]>(["refsheet", "portrait", "half", "full"]);

/** Makes the planned shots: the queue, and a gallery of candidates to pick from. */
export function GeneratePanel({
  record,
  studio,
  change,
}: {
  record: CardRecord;
  studio: StudioRecord;
  change: (fn: (s: StudioRecord) => StudioRecord) => void;
}) {
  const { settings, load } = useAiSettings();
  const queue = useImageQueue();
  const [n, setN] = useState(2);
  const [cap, setCap] = useState("");
  const [lock, setLock] = useState<StyleLock>(newStyleLock());
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void getProject(record.projectId).then((p) => p?.cowriter?.styleLock && setLock(p.cowriter.styleLock));
  }, [record.projectId]);

  const providers = settings.imageProviders ?? [];
  const candidates = studio.candidates ?? {};
  const picked = (s: Shot) => (candidates[s.id] ?? []).some((c) => c.asset);
  const todo = studio.shots.filter((s) => !s.skip && !picked(s) && !(candidates[s.id] ?? []).length);
  const estimate = estimateCost(settings, todo, n);
  const jobs = queue.jobs.filter((j) => j.cardId === record.id);
  const spent = jobs.reduce((t, j) => t + (j.cost ?? 0), 0);
  const local = jobs.filter((j) => j.status === "done" && j.ms && !j.cost);
  const perImage = local.length ? local.reduce((t, j) => t + j.ms! / j.n, 0) / local.length / 1000 : undefined;
  const usesComfy = todo.some((s) => modelFor(settings, taskOf(s))?.provider.kind === "comfyui");
  const size = Object.values(record.files).reduce((t, b) => t + b.length, 0) + (record.image?.length ?? 0);
  const budget = (settings.cardBudgetMb ?? 30) * 1024 * 1024;
  const capValue = cap.trim() ? Number(cap) : undefined;

  const start = (shots: Shot[]) =>
    queue.enqueue(record.id, shots, { n, ...(capValue !== undefined && Number.isFinite(capValue) ? { cap: capValue } : {}) });

  async function pick(shot: Shot, candidate: Candidate) {
    const editor = useEditor.getState();
    const current = editor.record;
    if (!current || current.id !== record.id) return;
    const filed = await fileCandidate(current.card.data, current.files, shot, candidate);
    editor.addFiles(filed.files);
    editor.replaceData(withFreshArt(filed.data));
    change((s) => ({
      ...s,
      candidates: {
        ...s.candidates,
        [shot.id]: (s.candidates?.[shot.id] ?? []).map((c) => (c.id === candidate.id ? { ...c, asset: filed.asset.uri } : { ...c, asset: undefined })),
      },
    }));
    toast(`Filed as ${filed.asset.type === "emotion" ? `the ${filed.asset.name} sprite` : filed.asset.type === "background" ? "a background" : "an image"}`);
  }

  function useAsReference(shot: Shot, candidate: Candidate) {
    const editor = useEditor.getState();
    const data = editor.record!.card.data;
    const sheet = readSheets(data)[shot.subject!];
    if (!sheet || !candidate.asset) return;
    editor.replaceData(writeSheet(data, shot.subject!, { ...sheet, reference: candidate.asset, referenceSeed: candidate.seed }));
    toast("Emotions, outfits and poses start from this image now");
  }

  if (!providers.length)
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-sm">
        <p>Add an image provider first: NanoGPT, any OpenAI-compatible images endpoint, or ComfyUI on your computer.</p>
        <Button className="self-start" onClick={() => useUi.getState().setSection("settings")}>
          Open Settings
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Candidates per shot
          <select className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[1, 2, 3, 4].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Spending cap for this batch ($)
          <TextInput type="number" min={0} step="0.1" inputMode="decimal" placeholder="No cap" value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
      </div>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {todo.length} shots still need images
        {todo.length > 0 &&
          (estimate.cost > 0 || !usesComfy
            ? ` · about ${money(estimate.cost)} for ${todo.length * n} images${estimate.unpriced ? ` (${estimate.unpriced} shots have no listed price)` : ""}`
            : "")}
        {usesComfy && ` · ComfyUI is free${perImage ? `, about ${Math.round(perImage)} s per image` : ""}`}
      </p>
      <Button variant="primary" className="self-start" disabled={!todo.length} onClick={() => start(todo)}>
        Generate {todo.length} {todo.length === 1 ? "shot" : "shots"}
      </Button>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-ink-muted">
          <span>Card size</span>
          <span>
            {mb(size)} of {mb(budget)}
          </span>
        </div>
        <div role="meter" aria-label="Card size" aria-valuenow={size} aria-valuemin={0} aria-valuemax={budget} className="h-1.5 rounded-full bg-surface-sunken">
          <div className={`h-full rounded-full ${size > budget ? "bg-red-400" : "bg-accent"}`} style={{ width: `${Math.min(100, (size / budget) * 100)}%` }} />
        </div>
      </div>

      {jobs.length > 0 && (
        <section aria-label="Queue" className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Queue · spent {money(spent)}</h3>
            <div className="flex flex-wrap gap-1">
              {queue.paused ? (
                <Button variant="ghost" onClick={queue.resume}>
                  Resume
                </Button>
              ) : (
                <Button variant="ghost" onClick={queue.pause}>
                  Pause
                </Button>
              )}
              <Button variant="ghost" onClick={() => queue.cancel()}>
                Cancel all
              </Button>
              {jobs.some((j) => j.status === "failed") && (
                <Button variant="ghost" onClick={queue.retryFailed}>
                  Retry failed
                </Button>
              )}
              <Button variant="ghost" onClick={queue.clearFinished}>
                Clear finished
              </Button>
            </div>
          </div>
          {queue.pauseReason && <p className="text-sm text-amber-300">{queue.pauseReason}</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{j.label}</span>
                  <span className={`shrink-0 text-xs ${j.status === "failed" ? "text-red-300" : "text-ink-muted"}`}>
                    {STATUS[j.status]}
                    {j.cost !== undefined && ` · ${money(j.cost)}`}
                    {j.ms && !j.cost ? ` · ${Math.round(j.ms / 1000)} s` : ""}
                  </span>
                  {(j.status === "queued" || j.status === "running") && (
                    <button type="button" aria-label={`Cancel ${j.label}`} className="px-1 text-ink-muted" onClick={() => queue.cancel(j.id)}>
                      ✕
                    </button>
                  )}
                </div>
                {j.status === "running" && (
                  <div className="h-1 rounded-full bg-surface-sunken">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((j.progress ?? 0) * 100)}%` }} />
                  </div>
                )}
                {j.error && <span className="text-xs text-red-300">{j.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {studio.shots
        .filter((s) => (candidates[s.id] ?? []).length)
        .map((s) => (
          <ShotGallery
            key={s.id}
            shot={s}
            record={record}
            lock={lock}
            candidates={candidates[s.id]}
            onPick={(c) => void pick(s, c)}
            onReference={REFERENCE_KINDS.has(s.kind) && s.subject && readSheets(record.card.data)[s.subject] ? (c) => useAsReference(s, c) : undefined}
            isReference={(c) => !!c.asset && !!s.subject && readSheets(record.card.data)[s.subject]?.reference === c.asset}
            onDiscard={(c) =>
              change((st) => ({ ...st, candidates: { ...st.candidates, [s.id]: (st.candidates?.[s.id] ?? []).filter((x) => x.id !== c.id) } }))
            }
            onRetry={(prompt) => {
              if (prompt) change((st) => ({ ...st, shots: st.shots.map((x) => (x.id === s.id ? { ...x, prompt } : x)) }));
              // The queue reads the shot once this edit is saved.
              start([s]);
            }}
          />
        ))}
    </div>
  );
}

function ShotGallery({
  shot,
  record,
  lock,
  candidates,
  onPick,
  onReference,
  isReference,
  onDiscard,
  onRetry,
}: {
  shot: Shot;
  record: CardRecord;
  lock: StyleLock;
  candidates: Candidate[];
  onPick: (c: Candidate) => void;
  onReference?: (c: Candidate) => void;
  isReference: (c: Candidate) => boolean;
  onDiscard: (c: Candidate) => void;
  onRetry: (prompt?: Shot["prompt"]) => void;
}) {
  const [editing, setEditing] = useState<string>();
  return (
    <section aria-label={`Images for ${shot.label}`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{shot.label}</h3>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => onRetry()}>
            Regenerate
          </Button>
          <Button variant="ghost" onClick={() => setEditing(editing === undefined ? writePrompt(record.card.data, record.kind, shot, lock).positive : undefined)}>
            Edit prompt
          </Button>
        </div>
      </div>
      {editing !== undefined && (
        <div className="flex flex-col gap-2">
          <AutoTextarea aria-label={`New prompt for ${shot.label}`} value={editing} onChange={(e) => setEditing(e.target.value)} />
          <Button
            className="self-start"
            onClick={() => {
              onRetry({ positive: editing, negative: writePrompt(record.card.data, record.kind, shot, lock).negative });
              setEditing(undefined);
            }}
          >
            Retry with this prompt
          </Button>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {candidates.map((c, i) => (
          <li key={c.id} className={`flex flex-col overflow-hidden rounded-xl border ${c.asset ? "border-accent" : "border-border"}`}>
            <Thumb candidate={c} label={`${shot.label}, image ${i + 1}`} />
            <div className="flex flex-wrap gap-1 p-1">
              {c.asset ? (
                <span className="px-1 text-xs text-accent">Picked</span>
              ) : (
                <Button variant="ghost" aria-label={`Pick image ${i + 1} for ${shot.label}`} onClick={() => onPick(c)}>
                  Pick
                </Button>
              )}
              {c.asset && onReference && !isReference(c) && (
                <Button variant="ghost" onClick={() => onReference(c)}>
                  Use as reference
                </Button>
              )}
              {isReference(c) && <span className="px-1 text-xs text-ink-muted">Reference</span>}
              {!c.asset && (
                <Button variant="ghost" aria-label={`Discard image ${i + 1} for ${shot.label}`} onClick={() => onDiscard(c)}>
                  ✕
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thumb({ candidate, label }: { candidate: Candidate; label: string }) {
  const url = useObjectUrl(candidate.bytes, candidate.mime);
  return url ? <img src={url} alt={label} className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full bg-surface-sunken" />;
}
