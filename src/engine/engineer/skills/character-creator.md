# Build a character creator
When: the player should set up {{user}} (name, background, stats, looks) before the story starts.

1. Values: a group like "Player" with the values to choose (name, origin, a few stats, appearance). Stats the player sets once and the model shouldn't change are readOnly.
2. Use an inline block in the greeting (slot "message", and tell the user to put `<cf-module id="creator"/>` in the greeting), or a hub screen if it should be reachable later.
3. Steps: 3 to 5 short pages with the router, or tabs. Pick from choices with buttons, not long forms. Show a summary page last.
4. On confirm, write every choice with `app.set` (one call per value, note "chosen in the character creator"), then send an action so the story begins: `app.send("creator", { done: true, name: … }, "I'm ready.", { now: false })`.
5. Point-buy stats: show the points left, disable "+" at the cap, and check the total before confirming.
6. Add a rule: what `<action app="creator">` means (the story starts with the chosen background) and that Player values were set by the player.
7. Render, click through every step (click), and check the state after confirming (the click result has it).

Checklist:
- [ ] Works on a 360px phone: one column, big tap targets.
- [ ] Can go back a step without losing choices.
- [ ] Confirm writes every value; the panel shows them after.
- [ ] Shows the choices again (read-only) once done, instead of the empty form.
