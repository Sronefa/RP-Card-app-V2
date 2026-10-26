# Build an inline message block
When: something should appear inside a message: a letter, a newspaper, a title screen, a quest card, a choice menu.

1. create_module with slot "message". The block shows wherever a message holds `<cf-module id="<id>"/>`.
2. Decide who writes the tag: the greeting (tell the user to add it, or ask), or the model (add a keyed rule saying when to write the tag, e.g. "When {{char}} hands {{user}} a letter, put <cf-module id="letter"/> on its own line").
3. The block gets the state at its message, so it shows what was true then. If it shows content the model wrote (the letter's text), have the model store it in a value (a `text` value like `Letter.Body`) in the same reply's update block.
4. Keep it self-contained and short: blocks in old messages are rebuilt when the player scrolls back.
5. Render with a scripted turn whose reply holds the tag (run_turn), and check the screenshot.
