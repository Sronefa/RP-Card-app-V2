/**
 * Character Card V3 types, following the spec at
 * https://github.com/kwaroran/character-card-spec-v3
 *
 * CardForge keeps every card as V3 internally and writes V2 alongside it on export.
 */

export type Extensions = Record<string, unknown>;

export interface LorebookEntry {
  keys: string[];
  content: string;
  extensions: Extensions;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  /** V3: treat keys as regular expressions (`/pattern/flags`). */
  use_regex: boolean;
  constant?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  position?: "before_char" | "after_char";
}

export interface Lorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Extensions;
  entries: LorebookEntry[];
}

export interface CardAsset {
  /** icon, background, user_icon, emotion, or a custom type (x_...). */
  type: string;
  /**
   * Where the asset lives:
   * - `embeded://path` file inside the package (CHARX path, CardForge's canonical form)
   * - `ccdefault:` the default (the PNG image itself, for icons)
   * - `http(s)://` or `data:` URL
   * - `__asset:N` only inside PNG files; rewritten to `embeded://` on import
   */
  uri: string;
  /** `main` marks the primary asset of its type. */
  name: string;
  ext: string;
}

export interface CardDataV3 {
  name: string;
  description: string;
  tags: string[];
  creator: string;
  character_version: string;
  mes_example: string;
  extensions: Extensions;
  system_prompt: string;
  post_history_instructions: string;
  first_mes: string;
  alternate_greetings: string[];
  personality: string;
  scenario: string;
  creator_notes: string;
  character_book?: Lorebook;
  assets?: CardAsset[];
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings: string[];
  /** Unix time in seconds. */
  creation_date?: number;
  /** Unix time in seconds. */
  modification_date?: number;
}

export interface CharacterCardV3 {
  spec: "chara_card_v3";
  spec_version: "3.0";
  data: CardDataV3;
}

export interface CardDataV2 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: Lorebook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Extensions;
}

export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: CardDataV2;
}

/** Standalone lorebook file (V3 spec). */
export interface LorebookV3File {
  spec: "lorebook_v3";
  data: Lorebook;
}

/**
 * A card plus the binary files its assets point to.
 * `files` is keyed by package path, matching `embeded://<path>` URIs in `card.data.assets`.
 * `image` is the card's default image (what `ccdefault:` points to), usually the PNG it came from.
 */
export interface CardPackage {
  card: CharacterCardV3;
  files: Record<string, Uint8Array>;
  image?: Uint8Array;
}

/** Result of an import: the package plus anything that was fixed up or ignored along the way. */
export interface ImportResult extends CardPackage {
  /** Format the file was read as. */
  format: "png" | "charx" | "json" | "jpeg-charx";
  /** Spec version found in the file before normalizing. */
  sourceSpec: "v1" | "v2" | "v3";
  warnings: string[];
}
