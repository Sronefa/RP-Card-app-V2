# Make screens beautiful and alive
When: a screen should look premium, match a genre, or feel animated: a title screen, a hub app, a scene, a status panel the user wants to love.

1. **Pick the mood first.** Read the theme (read_theme) and the visual bible (read_visual). Find the genre's recipe in the style guide (search_docs "recipe" plus the genre, or read_doc style) and follow its palette, type, frame and motion. One genre per card; don't mix a HUD into parchment.
2. **One focal point.** Decide the single thing the player should see first (the HP, the speaker's line, the title). Make it the biggest, brightest or most animated; step everything else back with `--cf-muted`, smaller type and less weight.
3. **Layer the background.** Image, then a readability overlay, then the content: `CF.assets.background(place, time)` or `CF.assets.scene("title")` under a gradient scrim, with a gradient fallback until the art exists. Missing art: request_asset with a clear one-sentence prompt that names the visual bible's palette. Never leave a blank box.
4. **Give it depth and a frame.** Soft shadow (`var(--cf-shadow)`), a thin border in a tint of the accent, a small ornament or corner, a texture from the set (theme `texture`). Restraint: one or two of these per element, not all.
5. **Type with contrast.** Heading font from the theme (a bundled font like Cinzel or Orbitron when the genre wants it: set_theme `heading`), body in the text font. Big steps between sizes (1.6em title, 1em body, 0.8em labels), weight only on what matters, `tabular-nums` for numbers.
6. **Animate the moments.** Entrances staggered by 40 to 60ms, taps answered in 100 to 150ms, reveals in 250 to 400ms, eased (`cubic-bezier(.2,.8,.2,1)` in, `ease-in` out). One big moment per screen: `CF.fx` count-ups, glows, flashes, typewriter, weather. CSS first; JS only for what CSS can't do. Check `CF.fx.reduced()` or the kit's `.cf-reduce-motion` for anything you write yourself.
7. **See it.** preview_states at low, high, empty, night, desktop, light and dark. render_preview with `frames: [0, 200, 700]` for every animation: the first frame shows the start, the last the end; fix anything that jumps, flickers or ends in the wrong place.
8. **Cut.** Remove one colour, one effect and one line of text you don't need. Then run the self-review.

## Self-review
- **Focus:** one thing clearly matters most on each screen, and you can tell what it is in a second.
- **Spacing:** the 4px scale (4, 8, 12, 16, 24), edges lined up, related things grouped, the same gaps for the same jobs.
- **Colour:** one accent and theme variables only; gains in `--cf-good`, losses in `--cf-bad`; text readable on its background in light and dark (preview_states with both modes).
- **Type:** one heading font, two or three sizes, bold only on what matters, no line longer than about 60 characters, no wall of text.
- **States:** low, empty, full and long values still look designed; a missing image shows a designed fallback.
- **Depth:** background layered (image or gradient, overlay, content), surfaces lifted with a soft shadow or border, nothing flat and grey by accident.
- **Motion:** short and eased, one big moment at most, nothing looping without a reason, layout never animated in a loop, and everything stops or jumps to its end when the player wants less motion. Each animation checked with a frame strip.
- **Phone:** fits 360px with no sideways scrolling, tap targets 36px or more, works without hover.
- **Genre:** it looks like the recipe for the card's genre, not like a web form.
