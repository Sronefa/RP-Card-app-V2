# Debug a broken screen
When: a screen is blank, shows the wrong values, or render_preview reports errors.

1. Read the errors in the render result: the source (which frame), the message and the line. "CF is not defined" or "app is not defined" means code that runs outside the module script; module screens always get CF, app and root.
2. Blank screen: check that js sets `root.innerHTML` (or fills `root`) and that html isn't empty when js expects elements from it. A `querySelector` returning null usually means the markup isn't there yet.
3. Wrong values: compare the paths in the code with read_values. Paths are case-sensitive, and hidden or read-only values keep their `$` or `_` in the key (`Time._Weekday`).
4. Values don't update: the screen must redraw on `app.onState(draw)`. Run a scripted turn (run_turn) and look at the delta and the screenshot.
5. Buttons do nothing: use click on the button and read the result (actions sent, errors). Delegated listeners need `e.target.closest(...)`.
6. Styles missing: theme variables only exist inside engine screens; check the class names match the kit's (`cf-btn`, not `btn`).
7. Fix with patch_file, render again, repeat until clean.
