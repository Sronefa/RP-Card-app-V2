/**
 * What the UI engineer can read of the story: the card's lorebook and the project world's, the world
 * pages' fields, the story arc and the visual bible. Entries are listed short and read on demand, so
 * no request carries the whole lorebook.
 */
import YAML from "yaml";
import type { CardDataV3, LorebookEntry } from "../../card";
import { arcSettingsText } from "../../ai/prompts";
import { ToolInputError } from "../../ai/tools";
import { antagonistText, arcHidden, beatText, isArcEntry, readArc } from "../../editor/arc";
import { entryTitle } from "../../editor/lorebook";
import { pageMeta, worldFieldsText, worldMeta } from "../../editor/world";
import { readSheets, type VisualSheet } from "../../images/visual";
import { estimateTokens } from "../../lib/tokens";

export interface LoreSource {
  /** "c" for the card's own lorebook, "w" for the project's world card. */
  prefix: "c" | "w";
  label: string;
  data: CardDataV3;
}

export interface LoreItem {
  /** "c3": the card's fourth entry; "w0": the world card's first. */
  id: string;
  source: LoreSource;
  entry: LorebookEntry;
  title: string;
  kind: string;
}

const KIND_LABELS: Record<string, string> = {
  npc: "NPC",
  location: "place",
  item: "item",
  shop: "shop",
  currency: "money",
  cast: "cast list",
};

function kindOf(entry: LorebookEntry): string {
  if (isArcEntry(entry)) return "story arc";
  const kind = worldMeta(entry)?.kind;
  return (kind && KIND_LABELS[kind]) ?? "other";
}

/** Every entry the engineer may read. A secret arc's entries are left out. */
export function loreItems(sources: LoreSource[]): LoreItem[] {
  return sources.flatMap((source) => {
    const hidden = arcHidden(source.data);
    return (source.data.character_book?.entries ?? []).flatMap((entry, i) =>
      hidden && isArcEntry(entry)
        ? []
        : [{ id: `${source.prefix}${i}`, source, entry, title: entryTitle(entry) || entry.keys[0] || "(untitled)", kind: kindOf(entry) }],
    );
  });
}

export function listLoreText(sources: LoreSource[]): string {
  const items = loreItems(sources);
  if (!items.length) return "The lorebook is empty.";
  return sources
    .map((source) => {
      const mine = items.filter((it) => it.source === source);
      if (!mine.length) return "";
      const lines = mine.map(({ id, entry, title, kind }) => {
        const bits = [kind, `${estimateTokens(entry.content)} tokens`];
        if (entry.constant) bits.push("constant");
        if (!entry.enabled) bits.push("off");
        const keys = entry.keys.filter((k) => k.trim()).slice(0, 8);
        return `- ${id} ${title} (${bits.join(", ")})${keys.length ? ` keys: ${keys.join(", ")}` : ""}`;
      });
      return `${source.label}:\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function entryText(item: LoreItem): string {
  const meta = pageMeta(item.entry);
  const body = meta ? worldFieldsText(meta) : item.entry.content.trim();
  return `<entry id="${item.id}" title="${item.title}" kind="${item.kind}">\n${body || "(empty)"}\n</entry>`;
}

/** At most this many entries come back from one search. */
const SEARCH_LIMIT = 8;

export function readLoreText(sources: LoreSource[], input: { ids?: unknown; query?: unknown }): string {
  const items = loreItems(sources);
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  if (!ids.length && !query) throw new ToolInputError("Give ids from list_lore, or a query to search every entry.");
  if (ids.length) {
    const unknown = ids.filter((id) => !items.some((it) => it.id === id));
    if (unknown.length === ids.length) throw new ToolInputError(`No entry has the id ${unknown.join(", ")}. Call list_lore for the ids.`);
    const found = ids.map((id) => items.find((it) => it.id === id)).filter((it): it is LoreItem => !!it);
    return [...found.map(entryText), ...(unknown.length ? [`No entry has the id ${unknown.join(", ")}.`] : [])].join("\n\n");
  }
  const words = query.split(/\s+/).filter(Boolean);
  const scored = items
    .map((it) => {
      const title = it.title.toLowerCase();
      const keys = it.entry.keys.join(" ").toLowerCase();
      const content = it.entry.content.toLowerCase();
      if (!words.every((w) => title.includes(w) || keys.includes(w) || content.includes(w))) return undefined;
      const score = words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (keys.includes(w) ? 2 : 0) + (content.includes(w) ? 1 : 0), 0);
      return { it, score };
    })
    .filter((x): x is { it: LoreItem; score: number } => !!x)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return `No entry mentions "${query}". Try fewer or other words, or list_lore.`;
  const shown = scored.slice(0, SEARCH_LIMIT).map((x) => entryText(x.it));
  const more = scored.slice(SEARCH_LIMIT).map((x) => x.it.id);
  return [...shown, ...(more.length ? [`${more.length} more match: ${more.join(", ")}. Read them by id.`] : [])].join("\n\n");
}

/** The arc, or only its settings when the user keeps it secret from themselves. */
export function arcText(data: CardDataV3): string {
  const arc = readArc(data);
  if (!arc) return "The card has no story arc.";
  if (arc.hidden)
    return [
      `The card has a secret story arc of ${arc.beats.length} ${arc.beats.length === 1 ? "beat" : "beats"}. The user keeps it hidden from themselves to avoid spoilers, so its beats, antagonist and ending aren't readable, and nothing you build or say may hint at them. Its settings, for difficulty and pacing:`,
      arcSettingsText(arc.settings),
    ].join("\n\n");
  return [
    `Story arc "${arc.title}"${arc.premise.trim() ? `: ${arc.premise.trim()}` : ""}`,
    arcSettingsText(arc.settings),
    ...arc.beats.map((_, i) => beatText(arc, i)),
    arc.antagonist ? antagonistText(arc.antagonist) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sheetName(sources: LoreSource[], key: string): string {
  const card = sources[0].data;
  if (key === "card") return card.name || "The character";
  const id = key.replace(/^entry:/, "");
  const entry = sources.flatMap((s) => s.data.character_book?.entries ?? []).find((e) => String(e.id) === id);
  return entry ? pageMeta(entry)?.fields.name?.trim() || entryTitle(entry) : key;
}

function sheetText(name: string, sheet: VisualSheet): Record<string, unknown> {
  const fields = Object.fromEntries(Object.entries(sheet.fields).filter(([, v]) => v?.trim()));
  const outfits = sheet.outfits
    .map((o) => {
      const { name: outfit, item: _item, ...parts } = o;
      const look = Object.values(parts)
        .map((v) => v.trim())
        .filter(Boolean)
        .join("; ");
      return look ? `${outfit}: ${look}` : "";
    })
    .filter(Boolean);
  return {
    name,
    kind: sheet.kind,
    ...(sheet.signature.length ? { signature: sheet.signature } : {}),
    ...(Object.keys(fields).length ? { look: fields } : {}),
    ...(outfits.length ? { outfits } : {}),
  };
}

/** The Image Studio's visual bible: how each character, place and item looks, so screens match the art. */
export function visualText(sources: LoreSource[], subject?: string): string {
  const sheets = sources.flatMap((s) => Object.entries(readSheets(s.data)).map(([key, sheet]) => ({ name: sheetName(sources, key), sheet })));
  if (!sheets.length) return "The visual bible is empty: the Image Studio has no look sheets for this card yet.";
  const want = subject?.trim().toLowerCase();
  const picked = want ? sheets.filter((s) => s.name.toLowerCase().includes(want)) : sheets;
  if (!picked.length) return `No look sheet for "${subject}". Sheets: ${sheets.map((s) => s.name).join(", ")}.`;
  return YAML.stringify(picked.map((s) => sheetText(s.name, s.sheet)));
}
