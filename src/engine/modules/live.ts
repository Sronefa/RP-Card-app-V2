/**
 * Living screens: content the model writes during play. After a reply, a silent background
 * generation (Tavern Helper's generateRaw) writes a few new items for a screen, in the voice of the
 * feed's content pack: an NPC texts {{user}}, the town's news reacts, a feed fills up. Feeds are off
 * by default, since each run costs tokens on the player's own API; the player can turn each one off
 * in the settings app. The runtime half is runtime/live.js (CF.live).
 */
import { estimateTokens } from "../../lib/tokens";
import type { EngineModule, LiveFeed, LivePack } from "./types";

export const LIVE_LIMITS = {
  count: [1, 5],
  every: [0, 20],
  history: [2, 30],
  keep: [1, 100],
} as const;

const PACK_KEYS = ["voice", "tone", "format", "length"] as const;

export const PACK_HELP: Record<keyof LivePack, { label: string; placeholder: string }> = {
  voice: { label: "Voice", placeholder: "Mina texting: lowercase, quick, teasing; emoji only when flustered" },
  tone: { label: "Tone", placeholder: "Warm, a little jealous of {{user}}'s friends" },
  format: { label: "Format", placeholder: "A text message to {{user}}" },
  length: { label: "Length", placeholder: "One or two short lines" },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const int = (v: unknown, fallback: number, [min, max]: readonly [number, number]) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;

const text = (v: unknown) => (typeof v === "string" ? v : "");
const lines = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean) : []);

export function newLiveFeed(name = "Texts", patch: Partial<LiveFeed> = {}): LiveFeed {
  return {
    id: slug(name) || "feed",
    name,
    enabled: false,
    pack: { voice: "", tone: "", format: "", length: "" },
    from: "",
    count: 1,
    every: 2,
    on: [],
    history: 6,
    keep: 30,
    into: "",
    fallback: [],
    ...patch,
  };
}

/** A feed from untrusted JSON (a pack file, the engineer's tool), or null when it isn't one. */
export function cleanLiveFeed(raw: unknown): LiveFeed | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name).trim();
  const id = slug(text(r.id)) || slug(name);
  if (!id) return null;
  const base = newLiveFeed(name || id);
  const pack = (r.pack && typeof r.pack === "object" ? r.pack : {}) as Record<string, unknown>;
  return {
    id,
    name: name || id,
    enabled: r.enabled === true,
    pack: Object.fromEntries(PACK_KEYS.map((k) => [k, text(pack[k])])) as unknown as LivePack,
    from: text(r.from).trim(),
    count: int(r.count, base.count, LIVE_LIMITS.count),
    every: int(r.every, base.every, LIVE_LIMITS.every),
    on: lines(r.on),
    history: int(r.history, base.history, LIVE_LIMITS.history),
    keep: int(r.keep, base.keep, LIVE_LIMITS.keep),
    into: text(r.into).trim(),
    fallback: lines(r.fallback),
  };
}

/** Feeds from untrusted JSON, with ids made unique within the list. */
export function cleanLiveFeeds(raw: unknown): LiveFeed[] {
  const out: LiveFeed[] = [];
  for (const feed of (Array.isArray(raw) ? raw : []).map(cleanLiveFeed)) {
    if (!feed) continue;
    let id = feed.id;
    for (let n = 2; out.some((f) => f.id === id); n++) id = `${feed.id}-${n}`;
    out.push({ ...feed, id });
  }
  return out;
}

/** Every feed on the card's modules, with the module it belongs to. */
export const liveFeedsOf = (modules: EngineModule[]) => modules.flatMap((m) => (m.live ?? []).map((feed) => ({ module: m, feed })));

/** About what a chat message costs the background call to read. */
const MESSAGE_TOKENS = 220;
/** The instructions around the pack, and the earlier items it's shown so it doesn't repeat them. */
const FRAME_TOKENS = 260;

/** About how many tokens one run of a feed costs: instructions, pack, chat read, and its answer. */
export function liveTokens(feed: LiveFeed): number {
  const pack = estimateTokens(PACK_KEYS.map((k) => feed.pack[k]).join("\n"));
  const answer = feed.count * 70;
  return Math.round((FRAME_TOKENS + pack + feed.history * MESSAGE_TOKENS + answer) / 10) * 10;
}

/** How often a feed runs, for the token note: "after every reply", "after every 3rd reply", "when Mina.Mood changes". */
export function liveCadence(feed: LiveFeed): string {
  const parts: string[] = [];
  if (feed.every === 1) parts.push("after every reply");
  else if (feed.every > 1) parts.push(`after every ${ordinal(feed.every)} reply`);
  if (feed.on.length) parts.push(`when ${feed.on.join(" or ")} changes`);
  return parts.join(", or ") || "never (give it a cadence or a value to follow)";
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** What the card script needs of a module's feeds: the ones that are on, with their cost. */
export function liveRuntime(m: EngineModule) {
  return (m.live ?? []).filter((f) => f.enabled).map((f) => ({ ...f, module: m.id, tokens: liveTokens(f) }));
}
