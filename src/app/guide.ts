/**
 * The guided path: an optional list of steps for a project, from the idea to the export. Most steps
 * know from the card when they are done; any step can be skipped or marked done by hand.
 */
import { getInterview, getProject, getRecord, playtestKey, saveProject, type CardRecord, type ProjectRecord } from "../db/db";
import { readArc } from "../editor/arc";
import { worldMeta } from "../editor/world";
import { readEngine } from "../engine/sheet";
import { readAssetTags } from "../images/filing";
import type { SectionId } from "./sections";

export type StepId = "idea" | "interview" | "draft" | "world" | "arc" | "engine" | "images" | "playtest" | "export";

export interface StepDef {
  id: StepId;
  label: string;
  hint: string;
  /** Where the step is done; the idea and export steps are on the project page. */
  go?: { section: SectionId; tab?: string; cowriterTab?: "chat" | "interview" };
}

export const STEPS: StepDef[] = [
  { id: "idea", label: "Idea", hint: "Start from your own idea, or let Surprise me draw one." },
  { id: "interview", label: "Interview", hint: "The co-writer asks about the character and keeps a story bible.", go: { section: "cowriter", cowriterTab: "interview" } },
  { id: "draft", label: "Draft", hint: "Description, personality, scenario and the first message.", go: { section: "editor" } },
  { id: "world", label: "World pages", hint: "NPCs, places and items in the lorebook.", go: { section: "lorebook", tab: "npcs" } },
  { id: "arc", label: "Story arc", hint: "Beats, an ending and a secret antagonist, if the story wants one.", go: { section: "lorebook", tab: "arc" } },
  { id: "engine", label: "Engine kit", hint: "Values, screens and a theme with the Immersive Engine.", go: { section: "engine", tab: "modules" } },
  { id: "images", label: "Images", hint: "The visual bible, a shot list and the pictures.", go: { section: "assets", tab: "studio" } },
  { id: "playtest", label: "Playtest", hint: "Play a few turns against the engine and watch the values.", go: { section: "engine", tab: "playtest" } },
  { id: "export", label: "Export", hint: "Save the card as PNG, CHARX or JSON for SillyTavern." },
];

export type StepStatus = "done" | "skipped" | "suggested" | "todo";

export interface GuideState {
  on: boolean;
  skipped: StepId[];
  /** Steps the user marked done, and the export once it happened. */
  done: StepId[];
}

export const readGuide = (project: ProjectRecord): GuideState => project.guide ?? { on: false, skipped: [], done: [] };

/** Changes the project's guide, re-reading the project first so other settings aren't lost. */
export async function updateGuide(projectId: string, fn: (g: GuideState) => GuideState): Promise<ProjectRecord | undefined> {
  const project = await getProject(projectId);
  if (!project) return undefined;
  return saveProject({ ...project, guide: fn(readGuide(project)) });
}

const toggle = (list: StepId[], id: StepId, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
export const skipStep = (projectId: string, id: StepId, skip: boolean) =>
  updateGuide(projectId, (g) => ({ ...g, skipped: toggle(g.skipped, id, skip) }));
export const markStep = (projectId: string, id: StepId, done: boolean) => updateGuide(projectId, (g) => ({ ...g, done: toggle(g.done, id, done) }));

/** Steps the card shows are done, without the user's marks. */
export async function cardProgress(record: CardRecord | undefined): Promise<Set<StepId>> {
  const done = new Set<StepId>();
  if (!record) return done;
  const d = record.card.data;
  const interview = await getInterview(record.id);
  if (interview || d.description.trim() || d.personality.trim()) done.add("idea");
  if (interview && ["review", "draft", "done"].includes(interview.stage)) done.add("interview");
  if (d.description.trim() && d.first_mes.trim()) done.add("draft");
  if ((d.character_book?.entries ?? []).some((e) => worldMeta(e))) done.add("world");
  if (readArc(d)?.beats.length) done.add("arc");
  if (readEngine(d)?.modules?.length) done.add("engine");
  if (Object.keys(readAssetTags(d)).length) done.add("images");
  if (await getRecord(playtestKey(record.id))) done.add("playtest");
  return done;
}

/** Each step's status: the first step neither done nor skipped is the suggested one. */
export function stepStatuses(guide: GuideState, progress: Set<StepId>): Record<StepId, StepStatus> {
  const out = {} as Record<StepId, StepStatus>;
  let suggested = false;
  for (const step of STEPS) {
    const skipped = guide.skipped.includes(step.id) || (step.id === "playtest" && guide.skipped.includes("engine") && !progress.has("playtest"));
    if (progress.has(step.id) || guide.done.includes(step.id)) out[step.id] = "done";
    else if (skipped) out[step.id] = "skipped";
    else if (!suggested) {
      out[step.id] = "suggested";
      suggested = true;
    } else out[step.id] = "todo";
  }
  return out;
}

/** The card the guide follows: the open card when it is in the project, else the first character. */
export const guideCard = (cards: CardRecord[], openId?: string) =>
  cards.find((c) => c.id === openId) ?? cards.find((c) => c.kind === "character") ?? cards[0];
