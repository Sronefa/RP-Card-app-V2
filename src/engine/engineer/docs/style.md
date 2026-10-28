# Style and motion guide

How to make engine screens beautiful, not just correct: design basics with before and after, the touches that make a screen feel premium, motion craft, images, the bundled fonts and textures, a recipe for each common genre, and the taste rules. The design guide (design) has the hard rules: phone width, touch, contrast, tokens. Load the style-and-motion skill for the method and its self-review checklist.

## Design basics

**One focal point.** Every screen has one thing the player should see first.
- Before: an inventory where the title, the gold, every item name and both buttons are the same size and weight.
- After: the gold is 1.6em in the accent colour at the top right, item names are 1em, counts are `--cf-muted`, and only "Use" is a primary button.

**Spacing rhythm.** Use the 4px scale (4, 8, 12, 16, 24) and the same gap for the same job: 8px inside a group, 16px between groups.
- Before: `margin: 7px`, `margin: 13px`, `padding: 5px 9px` scattered through the CSS.
- After: `.cf-stack` (8px gaps) inside a group, 16px between groups, everything aligned to one left edge.

**A small palette with one accent.** Background, surface, text, muted, and one accent for what matters. `--cf-accent2` is for a second kind of thing (a map pin, a rival), not decoration.
- Before: red titles, green buttons, a blue border and a purple badge.
- After: neutral surfaces, the accent only on the main button, the focal value and the active tab.

**Type scale and weight contrast.** Three sizes are enough: about 1.6em for the focal value or title, 1em for text, 0.8em for labels (`cf-label`). Bold only the focal value and headings.
- Before: everything `font-weight: 600`.
- After: the value bold, its label small, muted and in capitals, the rest regular.

**Grouping.** Things that belong together share a card or a row; things that don't get space between them, not a line.

**Empty and loading states still look designed.** An empty bag shows an icon, a short line in the card's voice ("Your bag is empty. The market opens at dawn.") and maybe an action, centred in the space it would fill. A missing portrait shows the avatar letter on a gradient in the theme's colours.

## Premium feel

- **Layered backgrounds:** image (or a gradient), then a scrim for readability, then a vignette or grain, then the content.
  `background: linear-gradient(180deg, transparent 30%, color-mix(in srgb, var(--cf-bg) 85%, transparent)), var(--hero) center / cover, var(--cf-bg);`
- **Soft depth:** `box-shadow: var(--cf-shadow)` on raised surfaces, a 1px border in `color-mix(in srgb, var(--cf-accent) 30%, var(--cf-border))`, a faint inner highlight (`inset 0 1px 0 rgba(255,255,255,.06)`) on dark themes. `backdrop-filter: blur(8px)` on a translucent panel over art.
- **Glow, used once:** `box-shadow: 0 0 18px color-mix(in srgb, var(--cf-accent) 45%, transparent)` on the focal element only, or `CF.fx.glow(el)` for a breathing one.
- **Genre frames and borders:** double borders for fantasy (`outline: 1px solid …; outline-offset: 3px`), clipped corners for sci-fi (`clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)`), torn or rough edges for horror (a texture plus an uneven border-radius like `3px 6px 2px 5px`).
- **Small ornaments:** a divider with a centred glyph (`✦`, `❖`, `◆`) in `--cf-muted`, corner brackets on a HUD panel, a wax seal on a letter. One kind per screen.
- **Tap feedback:** every button answers in 100 to 150ms: `transform: scale(.97)` on `:active`, a brief brightness change. The kit's buttons already do it.

## Motion craft

- **Durations:** taps 100 to 150ms, small changes 200 to 300ms, reveals and page transitions 250 to 400ms, a big moment 600 to 1200ms. Nothing over 1.5s unless the player can skip it.
- **Easing:** things arriving decelerate (`cubic-bezier(.2,.8,.2,1)` or `ease-out`); things leaving accelerate (`ease-in`). Linear only for loops like a spinner or rain.
- **Staggered entrances:** list items fade and rise 6 to 8px, each 40 to 60ms after the last, at most about 8 staggered items (the rest arrive together).
  `.row { animation: cf-rise .3s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * 50ms); } @keyframes cf-rise { from { opacity: 0; transform: translateY(8px); } }`
- **Count-ups and meter fills:** `CF.fx.countUp(el, to, { from })` for numbers that changed this reply (from `app.delta()`); kit meters slide their fill by themselves.
- **Transitions:** `CF.fx.transition(body, html, "left" | "right")` between pages or tabs, so the player feels where they went.
- **Ambient loops:** subtle and slow (6s or more), on opacity or transform only: drifting dust, a breathing glow, `CF.fx.weather(el, state.Weather)`. Never on a list of panels, never on layout.
- **One big moment per screen:** a level up, a new line of dialogue, a quest done, a critical hit. Use `CF.fx.flash`, `CF.fx.shake`, `CF.fx.typewriter`, a glow, a burst of particles; everything else on that screen stays calm.
- **CSS first:** keyframes and transitions for anything declarative; JS (`CF.fx`, the Web Animations API) for sequences, numbers and anything driven by state.
- **Less motion:** `CF.fx` handles it. In your own CSS, the kit's `.cf-reduce-motion` class on the body (or `@media (prefers-reduced-motion: reduce)`) must turn animations off; in your own JS, check `CF.fx.reduced()`.

## Images and backgrounds

- **Backgrounds:** `CF.assets.background(place, time)` gives the place's art at that time of day (then any time), or null. Put it under a scrim so text stays readable: a gradient from transparent to `--cf-bg` at the bottom where the text sits, or a 40 to 60% dark overlay for text over the whole picture.
- **Gradient fallback:** until the art exists, draw the same mood with gradients in the theme's colours (a dusk sky, a stone wall, a neon street) so the layout and the look are right without it. `CF.art.sky(time)` gives a sky for the time of day, and `CF.art` draws maps, crests, charts and textures with no image at all (the procedural-art skill).
- **Portraits and icons:** `CF.assets.portrait(name, { emotion })` and `CF.assets.icon(item)`, in a frame that fits the genre, with `object-fit: cover` and a fixed `aspect-ratio`. Fallback: the avatar letter, or a kit icon on a tinted circle.
- **Scene art:** `CF.assets.scene("title" | "map" | "wallpaper")` for title screens, maps and phone wallpapers.
- **Missing art:** request_asset with a one-sentence prompt that names the subject, the framing and the visual bible's palette ("The harbor at dusk, wide shot, teal and amber, fog over the water"). The screen must look finished before the art arrives.
- **Match the art:** read the visual bible (read_visual) and take the screen's accent from the art's palette, so screens and pictures look like one game.

## Fonts and textures

Cards can't load anything from the network, so CardForge bundles a few fonts and embeds a font in the card only when the theme or a screen's code uses it. Set one with set_theme (`heading` or `font`, the exact stack from the design guide), or name it in your CSS: `font-family: "Cinzel", Georgia, serif;`.

- **Cinzel:** carved Roman capitals, for dark fantasy, epic and ancient worlds.
- **Pirata One:** blackletter, for grimdark, gothic horror and pirates.
- **Orbitron:** wide geometric, for sci-fi, cyberpunk HUDs and mecha.
- **Share Tech Mono:** technical monospace, for consoles, terminals and readouts.
- **Playfair Display:** high-contrast serif, for romance, period drama and luxury.
- **Patrick Hand:** neat handwriting, for cozy slice of life, notes and diaries.

Use a bundled font for headings, titles and names; keep body text in the theme's text font. Each font has Latin letters only, so cards in other scripts should keep system fonts.

Textures (the theme's `texture` token, layered over surfaces): **Paper** (warm light and fibre), **Grain** (film grain), **Linen** (fine crosshatch), **Scanlines**, **Grid** (HUD lines), **Hex** (hexagon mesh), **Stars**, **Vignette** (darkened edges). set_theme takes the exact value from read_theme's list, or a gradient of your own.

## Recipe: dark fantasy

Presets: parchment (light) or grimdark (dark). Heading font Cinzel (or Pirata One for grimdark), body Serif. Palette: ink or iron surfaces, gold or old-blood accent, no neon. Frames: double borders, small square corners (2 to 4px), a `✦` divider. Texture: Paper on parchment, Grain on grimdark. Motion: slow and weighty: embers (`CF.fx.particles(el, "embers")`), a candle-like glow, a 300ms fade on pages; a shake on a hit.

## Recipe: cyberpunk HUD

Preset: cyberpunk. Heading Orbitron, data in Share Tech Mono. Palette: near-black, one neon accent (magenta or cyan) and the other as `--cf-accent2`, white text. Frames: thin 1px glowing borders, clipped corners, corner brackets, labels in small capitals with letter-spacing. Texture: Scanlines or Grid. Motion: fast and crisp: 120ms snaps, a flicker on reveal (opacity 0, 1, .4, 1 over 300ms), glitch only for the big moment, rain for the street.

## Recipe: cozy slice of life

Presets: dating or phone. Heading Patrick Hand or Rounded, body Rounded or System. Palette: warm cream or soft pastel surfaces, one friendly accent (peach, sage, sky). Frames: big round corners (14 to 20px), soft shadows, no hard borders, sticker-like chips. Texture: Linen or none. Motion: bouncy but gentle (`cubic-bezier(.34,1.56,.64,1)` at 300ms for pops), petals in spring, a pulse on a new message.

## Recipe: horror

Preset: dread. Heading Pirata One or Share Tech Mono (found-footage), body Serif. Palette: near-black and bone white, blood red as the only colour, used rarely. Frames: tiny corners, rough uneven edges, a heavy Vignette. Texture: Grain plus Vignette. Motion: mostly still, so the rare motion lands: a slow fade-in, a sudden flash or shake on a scare, a typewriter for notes. Dim the screen as sanity drops instead of adding effects.

## Recipe: sci-fi ship console

Preset: starship (or system for game-like status windows). Heading Orbitron, readouts Share Tech Mono. Palette: space black, amber readouts, cyan scans, red only for alerts. Frames: panels with clipped corners, thin rules, small caps labels, unit suffixes in `--cf-muted`. Texture: Grid or Hex. Motion: scan lines sweeping once, numbers counting up, a 2s pulse on an alert, transitions that slide like panels.

## Recipe: modern phone

Preset: phone. Fonts: System for everything (a phone looks like a phone). Palette: the system's light or dark with one app accent. Frames: an app bar, 12 to 16px corners, list rows with hairline separators, bubbles for chats. Texture: none. Motion: the platform's own: pages slide in 250ms, sheets rise from the bottom (`app.drawer`), toasts (`app.toast`), a badge pop on a new message.

## Recipe: visual novel

Preset: novel. Heading Playfair Display (or Cinzel for fantasy, Patrick Hand for cozy). Palette: soft, from the art. Frames: the kit's dialogue box (`CF.ui.dialogue`) over full-bleed scene art with a bottom scrim, the speaker's name on a tab in the accent. Texture: none over art. Motion: `CF.fx.typewriter` on the line with a tap to finish, a portrait fade on a mood change, weather from the state, a shake for an impact line.

## Taste rules

What makes a screen look cheap, and the fix:
- **Too many colours:** keep one accent; turn the rest into neutrals or tints of the accent.
- **Everything bold:** bold only the focal value and headings; labels small and muted.
- **Random spacing:** snap every gap to the 4px scale and use the same gap for the same job.
- **Walls of text:** cut to the line that matters; put the rest behind a tap (a drawer, a flip card, a details row).
- **Motion everywhere:** one big moment per screen; ambient loops slow and subtle; nothing that moves for no reason.
- **Borders around everything:** group with space and surfaces instead; keep borders for frames that mean something.
- **Default grey boxes:** give surfaces the theme's texture, a soft shadow and the genre's frame.
- **Emoji as decoration:** use the kit's icons or a genre glyph; emoji only where the card's voice is playful.
- **Centred everything:** left-align text and lists; centre only titles, empty states and big moments.
- **Tiny type to fit more:** show less instead; nothing under 12px.

## Seeing your work

- **render_preview** shows a picture and the layout outline of the screen as it is.
- **Frame strip:** render_preview with `frames: [0, 250, 900]` takes pictures before, during and after an animation, and lists what is moving at each moment (its animation, how far along, its opacity and transform). The trigger is opening `open`, tapping `click`, or setting `values`; with none, the newest message is drawn again so entrances play. Check that the first frame is the start state, the middle is smooth, and the last is exactly where it should rest.
- **preview_states** renders the same screen at several states at once (the card's start, low and empty, high and full, morning and night, or your own), at phone and desktop width, in light and dark, each with its layout problems.
- The user sees the same states on the Look tab's state preview.
