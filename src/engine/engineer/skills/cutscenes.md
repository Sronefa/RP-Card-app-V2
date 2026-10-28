# Direct a cutscene
When: a moment deserves a little scene: a title screen intro, a chapter card, a boss entrance, a level up, a reveal.

1. **Pick the moment and keep it short.** Three to ten steps, under about 20 seconds when nobody taps. One big moment (a shake, a flash, a title), not one per step. Read the core API's "Cutscenes (CF.scene)" section (read_doc core-api#cutscenes-cf-scene).
2. **Write it as data.** Put the steps in the module's settings (`settings.scenes.intro = [...]`) and play `settings.scenes.intro`, so the user can change the words and the lint checks every step. Use the card's own names for `show` and `who`, and places from the card for `bg`, so the art the Image Studio files appears by itself.
3. **Stage it:** `bg` first (with `time` for a sky until the art exists), then `title` for a chapter card, then `show` the characters (left and right for a conversation, center for one), then `say` lines with `who` (the others dim). Add `fx` only where the story hits: a shake on an impact, a flash for lightning or magic, weather for the mood.
4. **Respect the player.** Lines wait for a tap; Skip is always there; never put a long `wait` in front of the first line. Use `auto` only for short beats the player shouldn't have to tap. Less motion is handled for you.
5. **Play it on a change, once.** `once: "key"` for intros and chapter cards; a delta (`app.delta()["Story.Chapter"]`) for a moment in a reply; never on every redraw. When a scene was already seen, draw a still version instead (see the chapter-card example).
6. **Use the result.** A `choice` with `send`, `payload` and `text` writes the player's answer as an action (add the rule for it); otherwise act on `done`'s `choice.value`. After the scene, draw the screen's normal content.
7. **Look.** render_preview with `frames: [0, 800, 2500]` and `open` for a hub screen's intro, then `click` to step through lines and the choice. Check it at phone width, where the dialogue box covers the bottom third.
