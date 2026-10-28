# Writing for the roleplay model

Screens are only half of an engine card. The other half is what the model reads, so it writes the update block right and reacts to the player's actions. Every word of rules is sent on every turn, so it costs the player tokens and attention.

## Token cost

- Each value's rule is sent before every reply, with the current values. 30 values at 25 tokens of rules is about 750 tokens a turn, plus the state itself.
- Keep a rule to one sentence: when the value changes, by how much, and its range. Leave out what the model would do anyway.
- Only make a value something the model updates if the story should change it. Values only the player or a script changes are `readOnly`, and their rule can be a few words.
- Use keyed rules (`constant: false` with `keys`) for situational behaviour (the shop, a fight), so they're sent only when the scene needs them.
- The lint tool reports the token cost of the card's always-on rules.

## Wording update rules

Good rules are concrete and positive, with numbers:

- Good: "Affection: +1 to +3 when {{user}} is kind or remembers something about her; −3 to −5 when {{user}} mocks her. 0 to 100."
- Weak: "Affection should reflect how she feels about {{user}}."
- Good: "Clock: move it forward as time passes in the scene: a talk 10 to 30 min, a meal 1 h, sleep to 07:00."
- Weak: "Keep track of the time."

Name values the same everywhere: in rules, in screens and in actions. Prefer `delta` for numbers that go up and down, `insert`/`remove` for lists, and `replace` for text.

## Actions from screens

For every action a screen sends, add a rule that says what it means and what to update:

> `<action app="shop">{"buy":"<item>","price":<n>}</action>` means {{user}} buys the item at the counter. Narrate the purchase, then in the update block: delta /Player/Gold by −price, and insert the item into /Player/Items. If Gold is too low, the shopkeeper refuses and nothing changes.

Keep the rule keyed on the action's app name (`keys: ["app=\"shop\""]`) or constant if it's short. The engine already hides old actions from the prompt.

## Depth

- The engine puts the game state and the format reminder at depth 0, as system messages: the last thing the model reads, so they don't drift out of its attention in a long chat. The update rules sit after the character.
- Behaviour rules for a module (how the phone's texts read, what the shop sells) work best at depth 2 to 4, or with the character description for always-true facts.
- Don't put a module's own entries at depth 0: it's kept for the state and the reminder.

## Getting the update written every time

- The update block from earlier replies is hidden from the model on purpose (it saves tokens and keeps the prose clean). The format text says so, because a model that never sees its own blocks otherwise stops writing them. Keep that sentence if you rewrite the rules.
- The analysis step is capped at 80 words: time passed, then each value checked against its rule, using only the latest reply. A longer analysis eats the reply's length and gets cut off.
- Give each value a check list in its rule: the trigger, the size of the change, when not to change it, and caps. "Check each variable" only works when each has something to check.
- Thresholds belong in code, not in the model's judgment: a tier that follows a number, an event that fires at 0 trust, a counter that rolls over. Do these in an `afterUpdate` hook or with tiers; the model only reports what happened.
- Randomness in hooks uses `info.random()`, which is seeded from the message: re-reading a message (a swipe back, an edit, a replay after a delete) gives the same roll. `Math.random()` and the clock don't.

## When the update goes wrong

The engine already catches the common failures: a reply with no update block, or one cut off at the length limit, gets a side call for its update instead; an update the schema turns away is skipped and the player sees a notice; edits, deletes and deleted swipes rebuild the state from the chat; the player's own edits are kept on the message and survive a re-read. If values still go wrong, check in this order:

1. Is the value in `<game_state>` at all? A hidden (`$`) value is never shown to the model, so it can't update it.
2. Does its rule say when it changes and by how much? Vague rules give no updates or wild ones.
3. Does the model write the block? Read a raw reply. If it stops after a few turns, check the reminder is on and the "hidden on purpose" line is in the format.
4. Does the schema reject the change? The notice names the change. Widen the range, coerce the type, or fix the path the rule names.
5. Is a hook overwriting it? A hook runs after every update and wins.
6. Does the model struggle with the format at all? Switch the card to the side call, or let players switch (leave the update mode unlocked).

Players have two repair buttons in the settings app's Game state tab: "Rebuild from the chat" reads every message again (`CF.state.rebuild()`), and "Redo the last update" asks a second call to write the newest reply's update again (`CF.state.redo()`). Point players to them in the creator notes if your card's values are delicate.

## Don't fight the model

- If a value keeps going wrong, fix the rule's wording or make a script keep it (a `readOnly` value set in an `afterUpdate` hook), rather than adding warnings.
- A player's hand edit is logged in `_PlayerEdits`, which the model sees. Don't add rules telling it to undo them.
- Side calls (texts, feeds, shop stock written in the background) need their own short prompts. Keep them to one task each, and only run them when the player allows background generations.
