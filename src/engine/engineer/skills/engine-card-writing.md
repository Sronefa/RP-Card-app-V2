# Write an engine card (MVU best practice)
When: the project is built for the Immersive Engine, or a card's text and its variables have to work together.

1. Plan the variables before the prose: at most about six core numbers. Each gets tiers (from-to ranges with a name and how characters behave in it) and threshold events.
2. Numbers live in variables, never in the prose: the description, personality and greetings don't state values. Tier behaviour goes in tier entries (write_tiers), not in the description.
3. Variable names are fixed words, like protagonist; never {{user}} in a name. Records keyed by name, not lists of objects. Lists one level deep, with a cap.
4. Read-only constants start with _ (no update rule). Hidden fields start with $, for secret progress.
5. Every update rule is a check list: what triggers it, how much it changes ("+3 to +6"), when it doesn't change, when an entry is removed, and the cap on lists. The analysis before the patch is capped at 80 words and checks each value against its rule using only the latest reply. The format says old update blocks are hidden on purpose, so the model keeps writing new ones.
5b. Thresholds are code, not judgment: tiers follow the numbers, threshold events and caps run in an afterUpdate hook, and any roll there uses info.random() (seeded from the message), never Math.random().
6. Every greeting carries its starting state: an <initvar> patch on the default values (set_greeting_state), the same way for all of them. With a character creator, greetings don't fix {{user}}'s looks or background.
7. Keep the world and rules always on and before the character; NPC entries keyed; one order number per entry. The game state and the format reminder are at depth 0, which the engine sets up; keep the card's own entries off depth 0.
8. Add output discipline: the update block goes at the end, no stats in the prose, the reply length. Add pacing: how fast a number may move.
9. Prose style stays out of the card except a short tone note.
10. When values drift, walk the troubleshooting list in rp-guide ("When the update goes wrong") before adding more rules.
