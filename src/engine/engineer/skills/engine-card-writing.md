# Write an engine card (MVU best practice)
When: the project is built for the Immersive Engine, or a card's text and its variables have to work together.

1. Plan the variables before the prose: at most about six core numbers. Each gets tiers (from-to ranges with a name and how characters behave in it) and threshold events.
2. Numbers live in variables, never in the prose: the description, personality and greetings don't state values. Tier behaviour goes in tier entries (write_tiers), not in the description.
3. Variable names are fixed words, like protagonist; never {{user}} in a name. Records keyed by name, not lists of objects. Lists one level deep, with a cap.
4. Read-only constants start with _ (no update rule). Hidden fields start with $, for secret progress.
5. Every update rule says: what triggers it, how much it changes ("+3 to +6"), when it doesn't change, when an entry is removed, and the cap on lists.
6. Every greeting carries its starting state: an <initvar> patch on the default values (set_greeting_state), the same way for all of them. With a character creator, greetings don't fix {{user}}'s looks or background.
7. Keep the world and rules always on and before the character; NPC entries keyed; one order number per entry.
8. Add output discipline: the update block goes at the end, no stats in the prose, the reply length. Add pacing: how fast a number may move.
9. Prose style stays out of the card except a short tone note.
