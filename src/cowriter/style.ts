/**
 * Style anchors and craft packs: passages the user loves for the co-writer to imitate, reference
 * examples of strong card writing, and short genre guides loaded by the project's genre and tone.
 */
import type { CardDataV3 } from "../card";
import type { CowriterSettings } from "../ai/records";

/** A passage the user loves, kept in a library every project can use. */
export interface StyleSample {
  id: string;
  label: string;
  text: string;
}

/** A short genre guide. Built-in packs can be edited; the user can add their own. */
export interface CraftPack {
  id: string;
  name: string;
  /** Words in the project's genre or tone that load it, lower case. */
  match: string[];
  text: string;
  builtIn?: boolean;
}

export const BUILT_IN_PACKS: CraftPack[] = [
  {
    id: "horror",
    name: "Horror",
    match: ["horror", "dread", "creepy", "eldritch", "gothic", "survival"],
    builtIn: true,
    text: `- Dread lives in what is almost seen. Show the edge of the thing, the wrong detail in a normal room, and let the user's imagination fill the rest.
- Escalate in steps: something off, something undeniable, something that costs. Each greeting or beat raises one notch.
- Ground the fear in the body's choices (freezing, hiding, running) rather than its sensations.
- Withhold. Answer one question by raising a worse one. Rules of the threat are learned through cost.
- Keep the ordinary visible: the kettle, the bus timetable, the neighbour's dog. Horror needs a normal to break.`,
  },
  {
    id: "romance",
    name: "Romance",
    match: ["romance", "romantic", "slow-burn", "slow burn", "love", "dating"],
    builtIn: true,
    text: `- Attraction is built from specific attention: what one notices about the other that no one else does.
- Give both people a reason to resist: a want, a fear or a loyalty that pulls the other way. Friction makes the pull matter.
- Let tension sit in small moments (a held door, a borrowed coat, a name said differently) before anything is declared.
- Banter shows chemistry: let them disagree, tease and surprise each other.
- Every step closer should change something between them; avoid repeating the same beat at higher volume.`,
  },
  {
    id: "comedy",
    name: "Comedy",
    match: ["comedy", "comedic", "funny", "absurd", "humor", "humour", "parody"],
    builtIn: true,
    text: `- Comedy comes from character: a strong want plus a blind spot, played completely straight.
- Specific is funny: the exact wrong object, the precise petty grievance, the named brand.
- Use rule of three, escalation and the callback. Let a running gag return changed.
- Cut the joke's explanation. End on the funniest word.
- Give {{user}} straight lines and room to land the punchline themselves.`,
  },
  {
    id: "action",
    name: "Action",
    match: ["action", "adventure", "thriller", "heist", "military", "combat", "epic"],
    builtIn: true,
    text: `- Action reads fast in short sentences with strong verbs, and slows for the one detail that matters.
- Keep geography clear: where everyone is, what is between them, what can be grabbed or used.
- Every fight has a goal beyond winning, and a cost even when it goes well.
- Opponents are clever: they adapt, retreat, bluff and use the terrain.
- Hand the next move to {{user}} at the moment of highest tension.`,
  },
  {
    id: "mystery",
    name: "Mystery",
    match: ["mystery", "detective", "noir", "investigation", "crime", "whodunit"],
    builtIn: true,
    text: `- Plant fair clues in plain sight among ordinary details; the solution should feel inevitable afterwards.
- Every witness wants something and hides something, often unrelated to the crime.
- Red herrings come from real motives, never from cheating the reader.
- Let {{user}} do the deducing: present evidence, reactions and contradictions, not conclusions.
- Reveal answers that open better questions, and keep the stakes personal.`,
  },
  {
    id: "slice",
    name: "Slice of life",
    match: ["slice of life", "slice-of-life", "cozy", "cosy", "wholesome", "everyday", "domestic"],
    builtIn: true,
    text: `- Small stakes matter when they matter to the character: the burnt bread, the missed call, the good parking spot.
- Texture carries the scene: routines, food, weather, the sounds of the neighbourhood.
- Let warmth show through habits and favours rather than declarations.
- Conflict is gentle but real: a misunderstanding, a deadline, a quiet worry.
- Leave space for {{user}} to simply be there; not every scene needs a hook beyond an invitation.`,
  },
];

/** The built-in packs with the user's edits, then the user's own packs. */
export function packsWith(user: CraftPack[] | undefined): CraftPack[] {
  const mine = user ?? [];
  const edited = new Map(mine.map((p) => [p.id, p]));
  return [...BUILT_IN_PACKS.map((p) => ({ ...p, ...edited.get(p.id), builtIn: true })), ...mine.filter((p) => !BUILT_IN_PACKS.some((b) => b.id === p.id))];
}

/** Packs the project's genre and tone (and Horror content) load on their own. */
export function matchedPacks(settings: Pick<CowriterSettings, "genre" | "tone" | "dark">, packs: CraftPack[]): CraftPack[] {
  const words = `${settings.genre} ${settings.tone}`.toLowerCase();
  return packs.filter((p) => p.match.some((m) => m && words.includes(m)) || (p.id === "horror" && settings.dark === "horror"));
}

/** Matched packs plus the ones the project turned on by hand. */
export function activePacks(settings: Pick<CowriterSettings, "genre" | "tone" | "dark" | "craftPackIds">, packs: CraftPack[]): CraftPack[] {
  const on = new Set([...matchedPacks(settings, packs).map((p) => p.id), ...(settings.craftPackIds ?? [])]);
  return packs.filter((p) => on.has(p.id));
}

export const craftContext = (packs: CraftPack[]) => packs.map((p) => `Craft notes for ${p.name}:\n${p.text}`).join("\n\n");

/** Style samples the card picks, kept in the card's own CardForge data. */
export function cardSampleIds(data: CardDataV3): string[] {
  const ids = (data.extensions.cardforge as { styleSamples?: unknown } | undefined)?.styleSamples;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

export function writeCardSamples(data: CardDataV3, ids: string[]): CardDataV3 {
  const ext = { ...(data.extensions.cardforge as Record<string, unknown> | undefined) };
  if (ids.length) ext.styleSamples = ids;
  else delete ext.styleSamples;
  return { ...data, extensions: { ...data.extensions, cardforge: ext } };
}

export function styleContext(samples: StyleSample[]): string {
  return [
    "Imitate the style of these passages: their rhythm, sentence length, register and how they handle dialogue. Take nothing from their content: no names, plots or settings.",
    ...samples.map((s) => `<sample label="${s.label.replace(/"/g, "'")}">\n${s.text.trim()}\n</sample>`),
  ].join("\n\n");
}

/** Strong card writing in different genres, shown as the quality target. */
export const REFERENCE_EXAMPLES = `These show the quality to aim for, in genres that may differ from this card's. Match their craft, not their content or length.

<greeting genre="noir">
Rain has turned the alley behind the Blue Lantern into a river of neon. {{char}} stands under the fire escape with her collar up, counting the bills in an envelope that is two hundred short. She hears your footsteps and doesn't look up.

"You're late, and Moretti's people are early." She tucks the envelope into her coat. "So either you tell me why my brother's name is in their ledger, or we both find out what they do to people who can't count."
</greeting>

<description genre="fantasy">
{{char}} keeps the toll bridge at Wrenford, the last crossing before the marsh, and has for nineteen years. She is forty-six, broad in the shoulders from winching the gate, with a burn scar along her left forearm she calls her "reminder" and never explains. She charges merchants double and pilgrims nothing, lies to tax collectors with a straight face, and keeps a ledger of every traveller who never came back from the marsh. She wants her son home from the Duke's war. She needs to forgive herself for letting him go.
</description>

<example_dialogue genre="sci-fi">
<START>
{{user}}: Can you get the door open?
{{char}}: *Pries the panel off with a screwdriver that has seen better decades.* Open, yes. Open without the station deciding we're a hull breach and venting this corridor? Ask me again in a minute.
{{user}}: We don't have a minute.
{{char}}: Then stop talking to me and start holding your breath.
</example_dialogue>`;
