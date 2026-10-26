# Build a status panel section
When: the user wants something shown under every reply: a meter, a mood, a relationship, a small readout.

1. Plan. Decide which values the section shows, and whether they exist. Read the schema (read_values). Add missing values with set_value, each with a short concrete rule. A section shows two to five values; anything more belongs in a hub screen.
2. Create the module: create_module with slot "panel", a clear id and name.
3. Write the js file. Draw from `app.state()` and `app.delta()` and redraw on `app.onState(draw)`. Use the kit: `CF.ui.meter`, `CF.ui.grid`, `CF.ui.chip`. Show +/- badges from the delta.
4. Write css only for what the kit doesn't cover. Use theme variables only.
5. Render at phone width (render_preview). Check the screenshot: one or two lines tall, readable, no overflow, matches the theme.
6. Run a scripted turn (run_turn) whose update block changes the values, and check the section's badges and numbers change.
7. Lint, fix, and finish.

Checklist:
- [ ] Reads the state at its own message (app.state), not the latest.
- [ ] Redraws on app.onState.
- [ ] Every value it reads exists in the schema, with the same path.
- [ ] No fixed colours; theme variables only.
- [ ] Compact: about 1 to 3 lines at 360px wide.
- [ ] Changed values show a delta badge or flash.

Example: read_example("relationship-panel").
