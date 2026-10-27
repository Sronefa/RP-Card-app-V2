/** Tags and a content warning that exports add from the project's content settings. */
import type { CardDataV3 } from "../card";
import type { CowriterSettings } from "../ai/records";

const WARNING = "Content warning: dead dove, do not eat. Disturbing and taboo themes are written straight, with no rescue or redemption.";

export function contentTags(s: Pick<CowriterSettings, "dark" | "unhinged">): string[] {
  return [
    s.unhinged !== "off" && "NSFW",
    s.dark !== "off" && "dark",
    s.dark === "horror" && "horror",
    s.dark === "deaddove" && "dead dove",
  ].filter((t): t is string => !!t);
}

/** The card as exported: content tags added once, and the dead dove warning at the top of the creator notes. */
export function withContentTags(data: CardDataV3, s: Pick<CowriterSettings, "dark" | "unhinged">): CardDataV3 {
  const have = new Set(data.tags.map((t) => t.toLowerCase()));
  const tags = [...data.tags, ...contentTags(s).filter((t) => !have.has(t.toLowerCase()))];
  const notes = s.dark === "deaddove" && !data.creator_notes.includes(WARNING) ? [WARNING, data.creator_notes].filter(Boolean).join("\n\n") : data.creator_notes;
  return { ...data, tags, creator_notes: notes };
}
