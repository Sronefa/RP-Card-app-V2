# Draw it in code
When: a screen needs a map, a chart, a gauge, a crest, a frame or a texture and there is no image for it, or until the art arrives.

1. **Prefer drawn to missing.** A procedural map or a sky beats an empty box. Read the core API's "Procedural art (CF.art)" section (read_doc core-api#procedural-art-cf-art) and use exactly what it lists.
2. **Seed with something stable.** Use the card's or a place's name as the seed, never `Math.random()`, so the picture is the same on every reply and every swipe.
3. **Maps:** `CF.art.mapImage({ kind, seed, places, palette })` as `CF.ui.map`'s image, with the same `{ x, y }` (in %) for the places and the pins. Pick the palette from the genre: parchment for fantasy, sea for sailing, night or neon for cyberpunk, stone for dungeons. Draw it once outside `draw()`; it only changes with the seed.
4. **Charts:** bars for comparing a few values (they fit a phone), a line or a spark for a value over time (keep its history in a list value with a rule that trims it), a radar for five to eight stats, a donut for shares of a whole. Give a `max` so the scale doesn't jump between replies, and a `title` for the screen reader.
5. **Gauges** for one value with a danger zone (fuel, stamina, sanity); `danger` turns it red when low.
6. **Frames, dividers and crests** add the genre's craft: one frame kind per card (ornate, tech or sketch), a divider between sections, `CF.art.sigil(name)` for factions or a missing portrait.
7. **Backgrounds:** `CF.art.sky(time)` under a header or as the fallback for `CF.assets.background`, `CF.art.pattern` or `CF.art.noiseTexture` for a subtle surface. Images can't read the theme: pass colours that match it (`CF.art.themeColor("accent", root)`).
8. **Look:** render_preview and preview_states (empty lists, many items, long labels) before you report.
