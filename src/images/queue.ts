/**
 * The image queue: runs shots one at a time in the background, with progress, the running cost, a
 * spending cap per batch, pause, cancel and retry. Results are saved as candidates on the studio record.
 */
import { create } from "zustand";
import { useAiSettings, type AiSettings } from "../ai/settings";
import { embeddedPath } from "../card";
import { getCard, getProject, type CardRecord } from "../db/db";
import { useEditor } from "../editor/store";
import { newId } from "../lib/id";
import { writePrompt } from "./prompt";
import { generateImages, sizeFor, type ImageModelInfo, type ImageProviderConfig, type ImageTask } from "./providers";
import { latestStudio, updateStudio, type Candidate, type Shot } from "./shots";
import { newStyleLock, readSheets } from "./visual";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  cardId: string;
  shotId: string;
  label: string;
  /** Candidates to make. */
  n: number;
  status: JobStatus;
  progress?: number;
  error?: string;
  cost?: number;
  /** How long it took, for providers that don't charge per image. */
  ms?: number;
  /** "providerId/model". */
  model?: string;
}

/** The kind of work a shot is, which picks its model. */
export function taskOf(shot: Pick<Shot, "kind">): ImageTask {
  switch (shot.kind) {
    case "emotion":
      return "emotion";
    case "background":
      return "background";
    case "icon":
      return "icon";
    case "scene":
    case "cg":
    case "engine":
    case "custom":
      return "scene";
    default:
      return "character";
  }
}

/** The provider and model for a task: its own choice, else character art's, else the first model listed. */
export function modelFor(settings: AiSettings, task: ImageTask): { provider: ImageProviderConfig; model: ImageModelInfo | { id: string; name: string } } | undefined {
  const providers = settings.imageProviders ?? [];
  const choice = settings.imageModels?.[task] ?? settings.imageModels?.character;
  const provider = providers.find((p) => p.id === choice?.providerId) ?? providers.find((p) => p.models?.length) ?? providers[0];
  if (!provider) return undefined;
  const id = choice?.providerId === provider.id ? choice.model : provider.models?.[0]?.id;
  if (!id) return undefined;
  return { provider, model: provider.models?.find((m) => m.id === id) ?? { id, name: id } };
}

/** Shots made from a character's reference keep their look with image-to-image. */
const FROM_REFERENCE = new Set<Shot["kind"]>(["portrait", "half", "full", "pose", "outfit", "emotion", "avatar"]);

/** Estimated cost of a list of shots, when the models have prices. */
export function estimateCost(settings: AiSettings, shots: Shot[], n: number): { cost: number; unpriced: number } {
  let cost = 0;
  let unpriced = 0;
  for (const s of shots) {
    const m = modelFor(settings, taskOf(s));
    const price = m && "price" in m.model ? m.model.price : undefined;
    if (m?.provider.kind === "comfyui") continue;
    if (price === undefined) unpriced++;
    else cost += price * n;
  }
  return { cost, unpriced };
}

interface QueueState {
  jobs: Job[];
  paused: boolean;
  /** Why the queue paused on its own. */
  pauseReason?: string;
  /** Spent in this batch, against the cap. */
  batchSpent: number;
  /** Most to spend in this batch, in USD; undefined for no cap. */
  cap?: number;
  /** Bumped whenever candidates are saved, so the studio reloads them. */
  version: number;
  enqueue: (cardId: string, shots: Shot[], options: { n: number; cap?: number }) => void;
  pause: () => void;
  resume: () => void;
  cancel: (jobId?: string) => void;
  retryFailed: () => void;
  clearFinished: () => void;
}

let controller: AbortController | undefined;
let running = false;

async function cardFor(cardId: string): Promise<CardRecord | undefined> {
  const open = useEditor.getState().record;
  return open?.id === cardId ? open : await getCard(cardId);
}

export const useImageQueue = create<QueueState>((set, get) => {
  const patch = (id: string, fields: Partial<Job>) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...fields } : j)) });

  async function runJob(job: Job) {
    await useAiSettings.getState().load();
    const settings = useAiSettings.getState().settings;
    const record = await cardFor(job.cardId);
    const studio = await latestStudio(job.cardId);
    const shot = studio.shots.find((s) => s.id === job.shotId);
    if (!record || !shot) throw new Error("The shot is gone.");
    const task = taskOf(shot);
    const chosen = modelFor(settings, task);
    if (!chosen) throw new Error("Add an image provider and pick a model in Settings first.");
    const { provider, model } = chosen;
    const price = "price" in model ? model.price : undefined;
    const estimate = price !== undefined ? price * job.n : 0;
    const { cap, batchSpent } = get();
    if (cap !== undefined && provider.kind !== "comfyui" && batchSpent + estimate > cap) {
      set({ paused: true, pauseReason: `The batch reached its spending cap of $${cap.toFixed(2)}. Raise it or resume to go on.` });
      return "paused" as const;
    }

    const lock = (await getProject(record.projectId))?.cowriter?.styleLock ?? newStyleLock();
    const prompt = writePrompt(record.card.data, record.kind, shot, lock);
    const sheet = shot.subject ? readSheets(record.card.data)[shot.subject] : undefined;
    const refPath = sheet?.reference && FROM_REFERENCE.has(shot.kind) ? embeddedPath(sheet.reference) : undefined;
    const reference = refPath && "imageToImage" in model && model.imageToImage === false ? undefined : refPath ? record.files[refPath] : undefined;
    const size = sizeFor(shot.framing);
    controller = new AbortController();
    const started = Date.now();
    const result = await generateImages(provider, {
      model: model.id,
      prompt: prompt.positive,
      negative: prompt.negative,
      ...size,
      n: job.n,
      ...(reference ? { reference, strength: 0.6, ...(sheet?.referenceSeed !== undefined ? { seed: sheet.referenceSeed } : {}) } : {}),
      ...(provider.kind === "comfyui" && sheet?.lora?.name ? { lora: { name: sheet.lora.name, weight: sheet.lora.weight ?? 0.8 } } : {}),
      task,
      signal: controller.signal,
      onProgress: (progress) => patch(job.id, { progress }),
    });
    const ms = Date.now() - started;
    const cost = result.cost ?? (price !== undefined ? price * result.images.length : undefined);
    const key = `${provider.id}/${model.id}`;
    const made: Candidate[] = result.images.map((img) => ({
      id: newId(),
      bytes: img.bytes,
      mime: img.mime,
      ...(img.seed !== undefined ? { seed: img.seed } : {}),
      model: key,
      ...(cost !== undefined ? { cost: cost / result.images.length } : {}),
      at: Date.now(),
    }));
    await updateStudio(job.cardId, (latest) => ({
      ...latest,
      candidates: { ...latest.candidates, [shot.id]: [...(latest.candidates?.[shot.id] ?? []), ...made] },
    }));
    set({ batchSpent: get().batchSpent + (cost ?? 0), version: get().version + 1 });
    patch(job.id, { status: "done", progress: 1, ms, model: key, ...(cost !== undefined ? { cost } : {}) });
    return "done" as const;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        if (get().paused) return;
        const job = get().jobs.find((j) => j.status === "queued");
        if (!job) return;
        patch(job.id, { status: "running", progress: 0, error: undefined });
        try {
          if ((await runJob(job)) === "paused") {
            patch(job.id, { status: "queued", progress: undefined });
            return;
          }
        } catch (e) {
          const aborted = (e as Error).name === "AbortError";
          patch(job.id, aborted ? { status: "cancelled" } : { status: "failed", error: (e as Error).message || "Something went wrong" });
        } finally {
          controller = undefined;
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    jobs: [],
    paused: false,
    batchSpent: 0,
    version: 0,
    enqueue(cardId, shots, { n, cap }) {
      const jobs: Job[] = shots.map((s) => ({ id: newId(), cardId, shotId: s.id, label: s.label, n, status: "queued" }));
      set({ jobs: [...get().jobs, ...jobs], cap, batchSpent: 0, paused: false, pauseReason: undefined });
      void pump();
    },
    pause: () => set({ paused: true, pauseReason: undefined }),
    resume() {
      // Resuming past the cap means the user accepts going over it for this batch.
      set({ paused: false, pauseReason: undefined, ...(get().pauseReason ? { cap: undefined } : {}) });
      void pump();
    },
    cancel(jobId) {
      const hit = (j: Job) => (jobId ? j.id === jobId : true) && (j.status === "queued" || j.status === "running");
      if (get().jobs.some((j) => hit(j) && j.status === "running")) controller?.abort();
      set({ jobs: get().jobs.map((j) => (hit(j) && j.status === "queued" ? { ...j, status: "cancelled" } : j)) });
    },
    retryFailed() {
      set({ jobs: get().jobs.map((j) => (j.status === "failed" ? { ...j, status: "queued", error: undefined } : j)) });
      void pump();
    },
    clearFinished: () => set({ jobs: get().jobs.filter((j) => j.status === "queued" || j.status === "running") }),
  };
});
