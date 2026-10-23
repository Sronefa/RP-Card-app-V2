/**
 * Converts any card JSON (V1, V2, V3, plus old TavernAI/Pygmalion field names) into a
 * clean V3 card, and V3 back into the V2 shape older frontends read.
 */
import type {
  CardAsset,
  CardDataV3,
  CharacterCardV2,
  CharacterCardV3,
  Extensions,
  Lorebook,
  LorebookEntry,
} from "./types";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" || typeof x === "number").map(String) : [];
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const ext = (v: unknown): Extensions => (isObject(v) ? { ...v } : {});

/** Drops keys whose value is undefined so exported JSON stays tidy. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function newCard(name = ""): CharacterCardV3 {
  const now = Math.floor(Date.now() / 1000);
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name,
      description: "",
      tags: [],
      creator: "",
      character_version: "",
      mes_example: "",
      extensions: {},
      system_prompt: "",
      post_history_instructions: "",
      first_mes: "",
      alternate_greetings: [],
      personality: "",
      scenario: "",
      creator_notes: "",
      group_only_greetings: [],
      creation_date: now,
      modification_date: now,
    },
  };
}

export function detectSpec(json: unknown): "v1" | "v2" | "v3" {
  if (!isObject(json)) throw new Error("Card data is not a JSON object");
  if (json.spec === "chara_card_v3") return "v3";
  if (json.spec === "chara_card_v2") return "v2";
  // Some tools write a V2/V3 `data` block without a spec field.
  if (isObject(json.data) && typeof json.data.name === "string") {
    return isObject(json.data) && ("group_only_greetings" in json.data || "assets" in json.data) ? "v3" : "v2";
  }
  return "v1";
}

export function normalizeLorebookEntry(raw: unknown, index: number): LorebookEntry {
  const e = isObject(raw) ? raw : {};
  const position = e.position === "before_char" || e.position === "after_char" ? e.position : undefined;
  return compact({
    keys: strArray(e.keys ?? e.key),
    content: str(e.content),
    extensions: ext(e.extensions),
    enabled: bool(e.enabled) ?? true,
    insertion_order: num(e.insertion_order) ?? 100,
    case_sensitive: bool(e.case_sensitive),
    use_regex: bool(e.use_regex) ?? false,
    constant: bool(e.constant),
    name: typeof e.name === "string" ? e.name : undefined,
    priority: num(e.priority),
    id: typeof e.id === "number" || typeof e.id === "string" ? e.id : index,
    comment: typeof e.comment === "string" ? e.comment : undefined,
    selective: bool(e.selective),
    secondary_keys: e.secondary_keys === undefined ? undefined : strArray(e.secondary_keys),
    position,
  });
}

export function normalizeLorebook(raw: unknown): Lorebook {
  const b = isObject(raw) ? raw : {};
  const entries = Array.isArray(b.entries)
    ? b.entries
    : isObject(b.entries)
      ? Object.values(b.entries) // some exporters key entries by id
      : [];
  return compact({
    name: typeof b.name === "string" ? b.name : undefined,
    description: typeof b.description === "string" ? b.description : undefined,
    scan_depth: num(b.scan_depth),
    token_budget: num(b.token_budget),
    recursive_scanning: bool(b.recursive_scanning),
    extensions: ext(b.extensions),
    entries: entries.map(normalizeLorebookEntry),
  });
}

function normalizeAssets(raw: unknown, warnings: string[]): CardAsset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const assets: CardAsset[] = [];
  for (const a of raw) {
    if (!isObject(a) || typeof a.uri !== "string") {
      warnings.push("Skipped an asset with no URI");
      continue;
    }
    assets.push({ type: str(a.type) || "icon", uri: a.uri, name: str(a.name), ext: str(a.ext).toLowerCase() });
  }
  return assets;
}

function seconds(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  // Some tools write milliseconds; the spec says seconds.
  return n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Normalizes any supported card JSON into a V3 card. */
export function toV3(json: unknown, warnings: string[] = []): CharacterCardV3 {
  const spec = detectSpec(json);
  const root = json as Json;
  const d: Json = spec === "v1" ? root : isObject(root.data) ? root.data : {};

  if (spec === "v1") {
    warnings.push("Converted from a V1 card");
  }

  const name = str(d.name ?? d.char_name);
  if (!name) warnings.push("Card has no name");

  const data: CardDataV3 = compact({
    name,
    description: str(d.description ?? d.char_persona),
    tags: strArray(d.tags),
    creator: str(d.creator),
    character_version: str(d.character_version),
    mes_example: str(d.mes_example ?? d.example_dialogue),
    extensions: ext(d.extensions),
    system_prompt: str(d.system_prompt),
    post_history_instructions: str(d.post_history_instructions),
    first_mes: str(d.first_mes ?? d.char_greeting),
    alternate_greetings: strArray(d.alternate_greetings),
    personality: str(d.personality),
    scenario: str(d.scenario ?? d.world_scenario),
    creator_notes: str(d.creator_notes ?? (spec === "v1" ? root.creatorcomment : undefined)),
    character_book: isObject(d.character_book) ? normalizeLorebook(d.character_book) : undefined,
    assets: normalizeAssets(d.assets, warnings),
    nickname: typeof d.nickname === "string" && d.nickname ? d.nickname : undefined,
    creator_notes_multilingual: isObject(d.creator_notes_multilingual)
      ? Object.fromEntries(Object.entries(d.creator_notes_multilingual).map(([k, v]) => [k, str(v)]))
      : undefined,
    source: d.source === undefined ? undefined : strArray(d.source),
    group_only_greetings: strArray(d.group_only_greetings),
    creation_date: seconds(d.creation_date),
    modification_date: seconds(d.modification_date),
  });

  return { spec: "chara_card_v3", spec_version: "3.0", data };
}

/**
 * V2 copy of a V3 card. V3-only fields (assets, nickname, group-only greetings...) are dropped.
 * Top-level V1 fields are included too, as SillyTavern does, for very old readers.
 */
export function toV2(card: CharacterCardV3): CharacterCardV2 & Record<string, unknown> {
  const d = card.data;
  const data = compact({
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creator_notes: d.creator_notes,
    system_prompt: d.system_prompt,
    post_history_instructions: d.post_history_instructions,
    alternate_greetings: d.alternate_greetings,
    // Regex keys are written as `/pattern/flags`, which SillyTavern also reads as regex.
    character_book: d.character_book,
    tags: d.tags,
    creator: d.creator,
    character_version: d.character_version,
    extensions: d.extensions,
  });
  return {
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creatorcomment: d.creator_notes,
    tags: d.tags,
    spec: "chara_card_v2",
    spec_version: "2.0",
    data,
  };
}

/** Parses card JSON text, with a friendly error. */
export function parseCardJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("Card data is not valid JSON");
  }
}
