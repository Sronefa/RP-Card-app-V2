/**
 * Mechanics: game rules baked into the card as lorebook entries, no extension needed.
 *
 * Each module is one entry with one XML tag inside a `<mechanics>` wrapper, placed in-chat at a
 * depth (recent context gets the most attention), keyed and sticky when it's situational, and
 * grouped so only one mode is in the prompt at a time. Values a module tracks become fields of
 * the status tracker, so the rules and the status panel always match.
 */
import type { CardAsset, CardDataV3, Lorebook, LorebookEntry } from "../card";
import { embeddedPath } from "../card";
import { newId } from "../lib/id";
import { estimateTokens } from "../lib/tokens";
import { emptyBook, newEntry, withStPosition } from "./lorebook";
import { applyTracker, newTracker, readTracker, type FieldKind, type TrackerField } from "./trackers";

export interface TrackedValue {
  label: string;
  kind: FieldKind;
  start: string;
  max?: number;
  /** When and how the value changes. */
  rule: string;
}

export interface MechanicImage {
  /** The asset's uri in the card. */
  uri: string;
  /** When to show it. */
  when: string;
}

export interface MechanicModule {
  id: string;
  name: string;
  /** The XML tag, lower case with underscores. */
  tag: string;
  /** What the module does, in a line, for lists and the contradiction check. */
  summary: string;
  /** The rules, stated positively and concretely. */
  rules: string;
  /** A one-line example of correct output. */
  example: string;
  /** Always in the prompt, or only when its keys come up. */
  activation: "always" | "keyed";
  keys: string[];
  secondaryKeys: string[];
  /** SillyTavern's selectiveLogic: 0 and any, 1 not all, 2 none, 3 and all. */
  logic: number;
  depth: number;
  /** Messages the entry stays after it fires. 0 is off. */
  sticky: number;
  /** Messages the entry can't fire again after it ends. 0 is off. */
  cooldown: number;
  /** Inclusion group: only one entry of a group is in the prompt at a time. */
  group: string;
  /** Other entries can't trigger it. */
  excludeRecursion: boolean;
  /** Its text doesn't trigger other entries. */
  preventRecursion: boolean;
  /** 1 to 5. Higher sits later within its depth, where it gets the most attention. */
  priority: number;
  tracked: TrackedValue[];
  images: MechanicImage[];
}

export const newModule = (patch: Partial<MechanicModule> = {}): MechanicModule => ({
  id: newId(),
  name: "",
  tag: "",
  summary: "",
  rules: "",
  example: "",
  activation: "keyed",
  keys: [],
  secondaryKeys: [],
  logic: 0,
  depth: 4,
  sticky: 0,
  cooldown: 0,
  group: "",
  excludeRecursion: false,
  preventRecursion: false,
  priority: 3,
  tracked: [],
  images: [],
  ...patch,
});

/** A module with every field present and in range, from the co-writer or an old save. */
export function cleanModule(m: Partial<MechanicModule>): MechanicModule {
  const base = newModule();
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
  return {
    ...base,
    ...m,
    id: m.id || base.id,
    name: String(m.name ?? "").trim(),
    tag: toTag(m.tag || m.name || ""),
    activation: m.activation === "always" ? "always" : "keyed",
    keys: strings(m.keys),
    secondaryKeys: strings(m.secondaryKeys),
    logic: [0, 1, 2, 3].includes(Number(m.logic)) ? Number(m.logic) : 0,
    depth: int(m.depth, 0, 20, 4),
    sticky: int(m.sticky, 0, 50, 0),
    cooldown: int(m.cooldown, 0, 50, 0),
    group: String(m.group ?? "").trim(),
    priority: int(m.priority, 1, 5, 3),
    tracked: (Array.isArray(m.tracked) ? m.tracked : [])
      .filter((t) => t && String(t.label ?? "").trim())
      .map((t) => ({
        label: String(t.label).trim(),
        kind: (["bar", "number", "text", "list"] as const).includes(t.kind) ? t.kind : "text",
        start: String(t.start ?? ""),
        ...(t.kind === "bar" ? { max: int(t.max, 1, 100000, 100) } : {}),
        rule: String(t.rule ?? ""),
      })),
    images: Array.isArray(m.images) ? m.images.filter((i) => i?.uri) : [],
  };
}

export const toTag = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1") || "module";

export function readMechanics(data: CardDataV3): MechanicModule[] {
  const list = (data.extensions[EXT] as { mechanics?: MechanicModule[] } | undefined)?.mechanics;
  return Array.isArray(list) ? list : [];
}

const EXT = "cardforge";
const KIND = "mechanic";

export const isMechanicEntry = (e: LorebookEntry) =>
  (e.extensions[EXT] as { kind?: string } | undefined)?.kind === KIND;

// Images

/** SillyTavern's sanitize-filename on the character name: drops characters that can't be in a file name. */
function stFolder(name: string): string {
  return name
    .replace(/[/?<>\\:*|"]/g, "")
    .replace(/[\x00-\x1f\x80-\x9f]/g, "") // eslint-disable-line no-control-regex
    .replace(/^\.+$/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 255);
}

const ST_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg"]);

/**
 * Where SillyTavern serves an image from a CHARX card after import, or undefined when it doesn't
 * keep it in the image gallery (avatars, expressions and backgrounds go elsewhere).
 * Mirrors ST's charx.js: the file is lower-cased with non-alphanumeric runs turned into "_".
 */
export function stImagePath(
  cardName: string,
  asset: Pick<CardAsset, "type" | "name" | "ext" | "uri">,
): string | undefined {
  const ext = asset.ext.toLowerCase().replace(/^\./, "");
  if (!embeddedPath(asset.uri) || !ST_IMAGE_EXTS.has(ext)) return undefined;
  if (["icon", "user_icon", "emotion", "expression", "background"].includes(asset.type)) return undefined;
  const name = asset.name.replace(new RegExp(`\\.${ext}$`, "i"), "");
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!base) return undefined;
  return `/user/images/${encodeURIComponent(stFolder(cardName))}/${base}.${ext}`;
}

/** Images a module can show: the card's embedded images that land in SillyTavern's image gallery. */
export function galleryImages(data: CardDataV3): { asset: CardAsset; path: string }[] {
  return (data.assets ?? []).flatMap((asset) => {
    const path = stImagePath(data.name, asset);
    return path ? [{ asset, path }] : [];
  });
}

// Text

export function moduleText(m: MechanicModule, data: CardDataV3): string {
  const images = m.images.flatMap((img) => {
    const asset = data.assets?.find((a) => a.uri === img.uri);
    const path = asset && stImagePath(data.name, asset);
    return path ? [`- ${img.when || asset.name}: <img src="${path}" width="240">`] : [];
  });
  return [
    `<mechanics>`,
    `<${m.tag}>`,
    m.rules.trim(),
    m.example.trim() && `Example: ${m.example.trim()}`,
    images.length > 0 && `Show these images in your reply, as written, when they fit:\n${images.join("\n")}`,
    `</${m.tag}>`,
    `</mechanics>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** selectiveLogic values 0 to 3, as the co-writer names them. */
export const LOGIC_NAMES = ["and_any", "not_all", "not_any", "and_all"];

const LOGIC_WORDS = ["and any of", "but not all of", "but none of", "and all of"];

const messages = (n: number) => `${n} message${n === 1 ? "" : "s"}`;

/** When the module is in the prompt, in plain words. */
export function activeText(m: MechanicModule): string {
  const where = `at depth ${m.depth}${m.depth === 0 ? " (next to the last message)" : ""}`;
  if (m.activation === "always") return `Always in the prompt, ${where}.`;
  if (!m.keys.length) return "Never: it has no keys yet.";
  const parts = [
    `When the chat mentions ${m.keys.map((k) => `"${k}"`).join(" or ")}`,
    m.secondaryKeys.length > 0 &&
      ` ${LOGIC_WORDS[m.logic] ?? LOGIC_WORDS[0]} ${m.secondaryKeys.map((k) => `"${k}"`).join(", ")}`,
    `, ${where}.`,
    m.sticky > 0 && ` Stays for ${messages(m.sticky)} after that.`,
    m.cooldown > 0 && ` Then rests for ${messages(m.cooldown)}.`,
    m.group && ` Only one "${m.group}" module at a time.`,
  ];
  return parts.filter(Boolean).join("");
}

/** Attention best practices the module doesn't follow. */
export function moduleTips(m: MechanicModule, data: CardDataV3): string[] {
  const tips: string[] = [];
  const tokens = estimateTokens(moduleText(m, data));
  if (m.activation === "keyed" && !m.keys.length)
    tips.push("It has no keys, so it never comes up. Add keys or make it always on.");
  if (tokens > 200)
    tips.push(`About ${tokens} tokens. Rules of 50 to 200 tokens are followed more closely; split it or cut it down.`);
  if (m.depth === 0)
    tips.push("Depth 0 is for the user's message and post-history instructions. Use depth 1 or deeper.");
  if (m.activation === "always" && m.depth > 6)
    tips.push("Always-on rules deep in the prompt fade in long chats. Depth 3 or 4 works best.");
  if ((m.rules.match(/\b(never|don't|do not|must not|avoid)\b/gi) ?? []).length >= 3)
    tips.push('Mostly "don\'t" rules. Say what to do instead; models follow positive, concrete rules better.');
  if (!m.example.trim()) tips.push("Add a one-line example of correct output.");
  return tips;
}

/** Tips about the modules together. */
export function setTips(modules: MechanicModule[]): string[] {
  const always = modules.filter((m) => m.activation === "always").length;
  const tags = modules.map((m) => m.tag);
  const dupes = [...new Set(tags.filter((t, i) => tags.indexOf(t) !== i))];
  return [
    always > 3 &&
      `${always} modules are always on. Keep few rules constant and let situational ones come up with their keys.`,
    dupes.length > 0 && `More than one module uses the tag <${dupes[0]}>. Each module needs its own tag.`,
  ].filter((t): t is string => !!t);
}

// Writing to the card

function moduleEntry(book: Lorebook, m: MechanicModule, data: CardDataV3): LorebookEntry {
  const e = withStPosition(
    newEntry(book, {
      comment: `Mechanic: ${m.name || m.tag}`,
      keys: m.keys,
      secondary_keys: m.secondaryKeys,
      selective: m.secondaryKeys.length > 0,
      constant: m.activation === "always",
      // Within a depth, a higher order goes later, closer to the chat.
      insertion_order: 600 + m.priority * 10,
      content: moduleText(m, data),
    }),
    4,
  );
  const ext: Record<string, unknown> = {
    ...e.extensions,
    [EXT]: { kind: KIND, module: m.id },
    depth: m.depth,
    role: 0,
    selectiveLogic: m.logic,
    exclude_recursion: m.excludeRecursion,
    prevent_recursion: m.preventRecursion,
  };
  if (m.sticky > 0) ext.sticky = m.sticky;
  if (m.cooldown > 0) ext.cooldown = m.cooldown;
  if (m.group) Object.assign(ext, { group: m.group, group_weight: 100 });
  return { ...e, extensions: ext };
}

/** The tracker with each module's values as fields. The modules are the source of truth for those fields. */
function syncTracker(data: CardDataV3, modules: MechanicModule[]): CardDataV3 {
  const config = readTracker(data);
  const wanted = modules.flatMap((m) => m.tracked.map((t) => ({ m, t })));
  if (!config && !wanted.length) return data;
  const base = config ?? newTracker();
  const others = base.fields.filter((f) => f.addon !== "mechanic");
  const old = base.fields.filter((f) => f.addon === "mechanic");
  const fields: TrackerField[] = wanted.map(({ m, t }) => {
    const prev = old.find((f) => f.module === m.id && f.label === t.label);
    return { id: prev?.id ?? newId(), addon: "mechanic", module: m.id, ...t };
  });
  const next = { ...base, fields: [...others, ...fields] };
  const same = config && JSON.stringify(config.fields) === JSON.stringify(next.fields);
  return same ? data : applyTracker(data, next.fields.length ? next : undefined);
}

/** Writes the modules into the card: their entries, their tracker fields and the list. */
export function applyMechanics(data: CardDataV3, modules: MechanicModule[]): CardDataV3 {
  const book: Lorebook = data.character_book ?? emptyBook();
  const kept = book.entries.filter((e) => !isMechanicEntry(e));
  const draft: Lorebook = { ...book, entries: [...kept] };
  for (const m of modules) draft.entries.push(moduleEntry(draft, m, data));

  const extensions: Record<string, unknown> = { ...data.extensions };
  const cf = { ...(extensions[EXT] as Record<string, unknown> | undefined) };
  if (modules.length) cf.mechanics = modules;
  else delete cf.mechanics;
  if (Object.keys(cf).length) extensions[EXT] = cf;
  else delete extensions[EXT];

  const written = {
    ...data,
    extensions,
    character_book: draft.entries.length || data.character_book ? draft : undefined,
  };
  return syncTracker(written, modules);
}

/** The modules as the co-writer sees them, for writing new ones and checking contradictions. */
export function modulesContext(modules: MechanicModule[], tracker?: string): string {
  return [
    ...modules.map((m) => `<module name="${m.name}" tag="${m.tag}">\n${m.summary}\n${m.rules}\n</module>`),
    tracker && `<status_tracker>\n${tracker}\n</status_tracker>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
