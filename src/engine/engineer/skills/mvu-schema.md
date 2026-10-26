# Design the game state (MVU schema)
When: starting an engine card, or adding values for a new system.

1. List what the story needs to remember that the model forgets: numbers that change (health, money, affection), states (location, mood, outfit), collections (items, contacts, quests), time.
2. Group values by who or what they belong to: Player, each main NPC, World, Time. Groups become objects in stat_data.
3. Choose the narrowest type: number with min and max for meters, choice for stages, counts for inventories, list for short tags.
4. Mark values: hidden ($) for secrets the model mustn't see; readOnly (_) for values only scripts or the player change.
5. Write each rule in one sentence with numbers (see the RP guide). Pin only the values the compact panel should show (3 to 6).
6. Prefer objects keyed by name over lists of objects: `Contacts: { Mina: 40 }` (counts) rather than `[{ name: "Mina", affection: 40 }]`. Paths stay stable and the model edits them reliably.
7. Read the token cost in lint; trim rules if the always-on cost passes about 800 tokens.
