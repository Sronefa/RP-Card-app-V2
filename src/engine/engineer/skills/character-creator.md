# Build a character creator
When: the player should set up {{user}} (name, background, stats, looks) before the story starts.

1. Start from the built-in creator unless the user wants something it can't do: add_built_in with screen "creator". read_example("creator") shows its settings.
2. Fill its settings from the card (read_card, and the lorebook's NPCs, places and items): `choices` (origin, class, role… each with options and a one-line description), `stats` with `base` and `max`, the `points` budget, starting `items` and `pickItems`, and `routes` (each a button and the opening message the player sends, "{name}" becoming their name). Use set_module_settings.
3. Tell the user to put `<cf-module id="creator"/>` in the greeting (the Modules tab has a button for it).
4. The values go in the `group` (default "Player"), and `$Created` marks it done. Add a rule if the story should treat a choice specially (a class's powers, an origin's enemies).
5. Render with the greeting, click through every step, press Begin, and check the state and the sent message.

Building your own instead:
- Use an inline block (slot "message") with 3 to 5 short pages. Pick with buttons, not long forms. Show a summary last.
- On confirm, write every choice with one `app.setMany([[path, value], …], "made in the character creator")`, then `app.write(openingText, { now: true })`.
- Point-buy: show the points left, disable "+" at the cap, check the total before confirming.

Checklist:
- [ ] Works on a 360px phone: one column, big tap targets.
- [ ] Can go back a step without losing choices.
- [ ] Begin writes every value; the panel shows them after.
- [ ] Shows a done card once made, instead of the empty form.
