/**
 * The shot list: every image a card could use, proposed from the project, with the count before
 * anything is generated. Kept per card in the chats store under "studio:<cardId>".
 */
import type { CardDataV3 } from "../card";
import type { CardKind } from "../db/db";
import { getRecord, saveRecord } from "../db/db";
import { readArc } from "../editor/arc";
import { pageMeta } from "../editor/world";
import { readEngine } from "../engine/sheet";
import { newId } from "../lib/id";
import { sheetOf, subjectsOf, type Subject } from "./visual";

export type ShotKind =
  | "portrait"
  | "half"
  | "full"
  | "refsheet"
  | "pose"
  | "outfit"
  | "emotion"
  | "background"
  | "scene"
  | "cg"
  | "avatar"
  | "icon"
  | "engine"
  | "custom";

export type ShotGroup = "character" | "emotions" | "backgrounds" | "scenes" | "engine" | "avatars" | "custom";

export const SHOT_GROUPS: Record<ShotGroup, string> = {
  character: "Character art",
  emotions: "Emotion sets",
  backgrounds: "Backgrounds",
  scenes: "Scenes and CGs",
  engine: "Engine art",
  avatars: "NPC avatars",
  custom: "Custom shots",
};

export type Framing = "portrait" | "half" | "full" | "refsheet" | "landscape" | "scene" | "icon" | "square";

export interface Shot {
  id: string;
  group: ShotGroup;
  kind: ShotKind;
  label: string;
  /** The subject's key ("card" or "entry:<id>"), when it draws one. */
  subject?: string;
  /** The place's key, for a background or a scene. */
  place?: string;
  outfit?: string;
  emotion?: string;
  pose?: string;
  time?: string;
  weather?: string;
  framing: Framing;
  /** What happens in the picture, for scenes and custom shots. */
  action?: string;
  /** The user's own edit of the prompt; replaces the written one. */
  prompt?: { positive: string; negative: string };
  /** Skipped shots stay listed but aren't generated. */
  skip?: boolean;
}

/** SillyTavern's expression labels, so the sprites work as they are. */
export const ST_EXPRESSIONS = [
  "admiration",
  "amusement",
  "anger",
  "annoyance",
  "approval",
  "caring",
  "confusion",
  "curiosity",
  "desire",
  "disappointment",
  "disapproval",
  "disgust",
  "embarrassment",
  "excitement",
  "fear",
  "gratitude",
  "grief",
  "joy",
  "love",
  "nervousness",
  "neutral",
  "optimism",
  "pride",
  "realization",
  "relief",
  "remorse",
  "sadness",
  "surprise",
];
export const CORE_MOODS = ["neutral", "joy", "sadness", "anger", "fear", "surprise", "embarrassment", "love"];

export type EmotionSet = "full" | "core" | "custom";

/** A generated image waiting to be picked. */
export interface Candidate {
  id: string;
  bytes: Uint8Array;
  mime: string;
  seed?: number;
  /** "providerId/model". */
  model: string;
  cost?: number;
  at: number;
  /** The asset it became, once picked. */
  asset?: string;
}

export interface StudioRecord {
  cardId: string;
  shots: Shot[];
  /** Generated images by shot id. */
  candidates?: Record<string, Candidate[]>;
  emotionSet: EmotionSet;
  customEmotions: string[];
  updatedAt: number;
}

export const studioKey = (cardId: string) => `studio:${cardId}`;

export const newStudio = (cardId: string): StudioRecord => ({
  cardId: studioKey(cardId),
  shots: [],
  emotionSet: "full",
  customEmotions: [],
  updatedAt: Date.now(),
});

export async function loadStudio(cardId: string): Promise<StudioRecord> {
  return (await getRecord<StudioRecord>(studioKey(cardId))) ?? newStudio(cardId);
}

export async function saveStudio(studio: StudioRecord) {
  await saveRecord({ ...studio, updatedAt: Date.now() });
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Changes the studio record from its latest stored version. The queue and the page both write it,
 * so writes for a card run one after another and none works from a stale copy.
 */
/** The studio record once the writes already on their way are saved. */
export async function latestStudio(cardId: string): Promise<StudioRecord> {
  await chains.get(cardId)?.catch(() => undefined);
  return loadStudio(cardId);
}

export function updateStudio(cardId: string, change: (studio: StudioRecord) => StudioRecord): Promise<StudioRecord> {
  const run = (chains.get(cardId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const next = change(await loadStudio(cardId));
    await saveStudio(next);
    return next;
  });
  chains.set(cardId, run);
  return run;
}

export const emotionsOf = (studio: Pick<StudioRecord, "emotionSet" | "customEmotions">) =>
  studio.emotionSet === "core" ? CORE_MOODS : studio.emotionSet === "custom" ? studio.customEmotions : ST_EXPRESSIONS;

const shot = (fields: Omit<Shot, "id">): Shot => ({ id: newId(), ...fields });

/** What sets two shots apart; a shot with the same signature isn't proposed twice. */
export const shotSignature = (s: Shot) =>
  [s.kind, s.subject, s.place, s.outfit, s.emotion, s.pose, s.time, s.weather, s.action].map((x) => x ?? "").join("|");

export interface ProposeOptions {
  emotions: string[];
  /** Times of day and weather for backgrounds. */
  times?: string[];
  weathers?: string[];
}

/** Every shot the project suggests: character art, emotions, backgrounds, scenes, engine art and NPC avatars. */
export function proposeShots(data: CardDataV3, kind: CardKind, options: ProposeOptions): Shot[] {
  const subjects = subjectsOf(data, kind);
  const people = subjects.filter((s) => s.kind === "character");
  const places = subjects.filter((s) => s.kind === "place");
  const items = subjects.filter((s) => s.kind === "item");
  const main = people.find((s) => s.key === "card");
  const out: Shot[] = [];

  if (main) {
    const name = main.name;
    out.push(
      shot({
        group: "character",
        kind: "refsheet",
        label: `${name}: reference sheet (front, side, back)`,
        subject: main.key,
        outfit: "default",
        framing: "refsheet",
      }),
      shot({
        group: "character",
        kind: "portrait",
        label: `${name}: portrait`,
        subject: main.key,
        outfit: "default",
        emotion: "neutral",
        framing: "portrait",
      }),
      shot({
        group: "character",
        kind: "half",
        label: `${name}: half body`,
        subject: main.key,
        outfit: "default",
        framing: "half",
      }),
      shot({
        group: "character",
        kind: "full",
        label: `${name}: full body`,
        subject: main.key,
        outfit: "default",
        framing: "full",
      }),
    );
    for (const o of sheetOf(data, main).outfits.filter((o) => o.name !== "default"))
      out.push(
        shot({
          group: "character",
          kind: "outfit",
          label: `${name}: ${o.name} outfit`,
          subject: main.key,
          outfit: o.name,
          framing: "full",
        }),
      );
    for (const emotion of options.emotions)
      out.push(
        shot({
          group: "emotions",
          kind: "emotion",
          label: `${name}: ${emotion}`,
          subject: main.key,
          outfit: "default",
          emotion,
          framing: "half",
        }),
      );
  }

  const times = options.times ?? ["day", "night"];
  const weathers = options.weathers ?? ["clear"];
  for (const p of places)
    for (const time of times)
      for (const weather of weathers)
        out.push(
          shot({
            group: "backgrounds",
            kind: "background",
            label: `${p.name}, ${time}${weather === "clear" ? "" : `, ${weather}`}`,
            place: p.key,
            time,
            weather,
            framing: "landscape",
          }),
        );

  const firstPlace = places[0]?.key;
  [data.first_mes, ...data.alternate_greetings].forEach((g, i) => {
    if (!g.trim()) return;
    out.push(
      shot({
        group: "scenes",
        kind: "scene",
        label: i === 0 ? "Scene: the first message" : `Scene: greeting ${i}`,
        subject: main?.key,
        place: firstPlace,
        action: g
          .replace(/<initvar>[\s\S]*?<\/initvar>/gi, "")
          .trim()
          .slice(0, 400),
        framing: "scene",
      }),
    );
  });
  for (const [i, beat] of (readArc(data)?.beats ?? []).entries())
    if (beat.summary.trim())
      out.push(
        shot({
          group: "scenes",
          kind: "cg",
          label: `CG: beat ${i + 1}, ${beat.title}`,
          subject: main?.key,
          action: beat.summary,
          framing: "scene",
        }),
      );

  if (readEngine(data)) {
    out.push(
      shot({
        group: "engine",
        kind: "engine",
        label: "Title screen",
        subject: main?.key,
        place: firstPlace,
        action: "title screen key art",
        framing: "scene",
      }),
      shot({
        group: "engine",
        kind: "engine",
        label: "World map",
        action: "illustrated map of the setting",
        framing: "square",
      }),
      shot({
        group: "engine",
        kind: "engine",
        label: "Phone wallpaper",
        place: firstPlace,
        action: "phone wallpaper, vertical",
        framing: "portrait",
      }),
    );
    for (const it of items)
      out.push(
        shot({
          group: "engine",
          kind: "icon",
          label: `Icon: ${it.name}`,
          subject: it.key,
          framing: "icon",
        }),
      );
  }

  for (const p of people.filter((s) => s.key !== "card"))
    out.push(
      shot({
        group: "avatars",
        kind: "avatar",
        label: `${p.name}: avatar`,
        subject: p.key,
        outfit: "default",
        emotion: "neutral",
        framing: "portrait",
      }),
    );
  return out;
}

/** Adds proposed shots the list doesn't have yet; the user's own shots and edits stay. */
export function mergeShots(current: Shot[], proposed: Shot[]): Shot[] {
  const have = new Set(current.map(shotSignature));
  return [...current, ...proposed.filter((s) => !have.has(shotSignature(s)))];
}

/** "Same, at night": a copy with one change, as a custom shot. */
export function duplicateWith(s: Shot, change: string): Shot {
  const time = /\b(night|dawn|dusk|morning|evening|noon|day)\b/i.exec(change)?.[1]?.toLowerCase();
  return {
    ...s,
    id: newId(),
    group: s.group === "custom" ? "custom" : s.group,
    label: `${s.label} (${change.trim()})`,
    ...(time ? { time } : {}),
    action: [s.action, change.trim()].filter(Boolean).join("; "),
    prompt: undefined,
  };
}

/** A shot from the user's own words. */
export const customShot = (text: string, subject?: Subject): Shot =>
  shot({
    group: "custom",
    kind: "custom",
    label: text.trim().slice(0, 60),
    subject: subject?.key,
    action: text.trim(),
    framing: "scene",
  });

export const placeName = (data: CardDataV3, key?: string) => {
  if (!key) return undefined;
  const e = (data.character_book?.entries ?? []).find((x) => `entry:${String(x.id)}` === key);
  return e ? pageMeta(e)?.fields.name : undefined;
};
