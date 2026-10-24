/**
 * The Surprise me trope deck: one card from each suit makes a premise to start an interview from.
 */
import type { CardKind } from "../db/db";

export interface Suit {
  name: string;
  cards: string[];
}

export const DECKS: Record<CardKind, Suit[]> = {
  character: [
    {
      name: "Who",
      cards: [
        "a retired assassin",
        "a disgraced knight",
        "a runaway heir",
        "a witch who hates magic",
        "a bounty hunter",
        "a con artist",
        "a war medic",
        "a cursed noble",
        "a fallen angel",
        "a demon on probation",
        "a bodyguard",
        "a smuggler captain",
        "a rival sorcerer",
        "a burned-out detective",
        "an android who wants to be human",
        "a vampire landlord",
        "a pirate queen",
        "a librarian who guards a forbidden book",
        "a monster hunter",
        "a fae noble bound by their word",
      ],
    },
    {
      name: "With you",
      cards: [
        "enemies forced to work together",
        "an arranged marriage",
        "childhood friends meeting again",
        "a bodyguard and their charge",
        "captor and captive",
        "master and apprentice",
        "fake dating",
        "rivals for the same prize",
        "a debt that must be repaid",
        "strangers stranded together",
        "a contract neither can break",
        "the one who got away",
        "a mentor who hides something",
        "roommates by accident",
        "you saved their life",
        "they're hunting you",
      ],
    },
    {
      name: "Trouble",
      cards: [
        "a curse that spreads by touch",
        "a war about to start",
        "someone is framing them",
        "a deal with something old",
        "a deadline at midnight",
        "a stolen relic everyone wants",
        "a plague in the city",
        "an heir that must be found",
        "a secret that would ruin them",
        "a storm that traps everyone",
        "a ghost that won't leave",
        "a crime they didn't commit",
        "a promise they can't keep",
        "a hunter on their trail",
      ],
    },
    {
      name: "Twist",
      cards: [
        "they already know who you are",
        "they're lying about their name",
        "they've died before",
        "they're working for the enemy",
        "they're far older than they look",
        "the real villain is their family",
        "they can't remember the last year",
        "they're the one who started it",
        "they're not human",
        "someone you trust sold you out",
        "it's a time loop",
        "they're royalty in hiding",
      ],
    },
  ],
  world: [
    {
      name: "Setting",
      cards: [
        "a drowned city",
        "a floating archipelago",
        "a walled city in endless winter",
        "a desert of glass",
        "a generation ship",
        "a dying empire's capital",
        "a frontier town on a haunted border",
        "a forest that moves at night",
        "a cyberpunk megacity",
        "a kingdom under a sunless sky",
        "a school for mages",
        "a port where every ship is a pirate",
        "a post-apocalyptic wasteland",
        "a city built on a sleeping god",
      ],
    },
    {
      name: "Power",
      cards: [
        "magic costs memories",
        "names have power",
        "the dead can be bargained with",
        "technology is outlawed",
        "gods walk the streets",
        "blood is currency",
        "dreams are shared",
        "everyone has a familiar",
        "the moon controls magic",
        "contracts are binding by law of nature",
        "monsters can be tamed",
        "music shapes reality",
      ],
    },
    {
      name: "Conflict",
      cards: [
        "a succession war",
        "an invasion from below",
        "a rebellion against the church",
        "two guilds at war",
        "a famine and a hoarding lord",
        "a plague of monsters",
        "a cold war between empires",
        "the barrier is failing",
        "an inquisition hunting mages",
        "a corporation owns everything",
      ],
    },
    {
      name: "Twist",
      cards: [
        "the heroes of legend were the villains",
        "the world is a prison",
        "the rulers are not human",
        "history was rewritten",
        "the end already happened once",
        "the gods are dead and someone is pretending",
        "the monsters were people",
        "the map is lying",
      ],
    },
  ],
};

const pick = (cards: string[], not?: string) => {
  const pool = cards.length > 1 && not ? cards.filter((c) => c !== not) : cards;
  return pool[Math.floor(Math.random() * pool.length)];
};

/** One card from each suit. */
export const draw = (kind: CardKind) => DECKS[kind].map((suit) => pick(suit.cards));

/** Redraws one suit's card, never the same card again. */
export const redraw = (kind: CardKind, hand: string[], suit: number) =>
  hand.map((card, i) => (i === suit ? pick(DECKS[kind][i].cards, card) : card));

/** The hand as an idea for the interview. */
export function premise(kind: CardKind, hand: string[]): string {
  if (kind === "character") {
    const [who, withYou, trouble, twist] = hand;
    return `${who[0].toUpperCase()}${who.slice(1)}. With {{user}}: ${withYou}. Trouble: ${trouble}. Twist: ${twist}.`;
  }
  const [setting, power, conflict, twist] = hand;
  return `${setting[0].toUpperCase()}${setting.slice(1)}, where ${power}. Conflict: ${conflict}. Twist: ${twist}.`;
}
