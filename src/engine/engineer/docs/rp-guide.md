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

- Rules for values go with the update rules, which the engine places at depth 1.
- Behaviour rules for a module (how the phone's texts read, what the shop sells) work best at depth 2 to 4, or with the character description for always-true facts.
- Never use depth 0: it's for the player's own message.

## Don't fight the model

- If a value keeps going wrong, fix the rule's wording or make a script keep it (a `readOnly` value set in an `afterUpdate` hook), rather than adding warnings.
- A player's hand edit is logged in `_PlayerEdits`, which the model sees. Don't add rules telling it to undo them.
- Side calls (texts, feeds, shop stock written in the background) need their own short prompts. Keep them to one task each, and only run them when the player allows background generations.
