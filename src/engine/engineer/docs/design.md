# Design guide

Engine screens should feel like a polished mobile game, not a web form. Aim for one clear purpose per screen, the important value biggest, and nothing that makes the player squint or scroll sideways.

## Layout

- **Phone first.** Design for 360px wide, then check 390px and desktop. Never use fixed widths over 320px. Use `max-width: 100%`, flex and grid with `minmax(0, 1fr)`, and let long words wrap (`overflow-wrap: anywhere`).
- **Spacing.** Use a 4px scale: 4, 8, 12, 16, 24. A card has 10 to 12px padding, sections are 8 to 12px apart, and an app body has 10px padding.
- **Hierarchy.** One heading per screen (`--cf-heading` font), labels in `cf-label` (small capitals), values large and tabular (`font-variant-numeric: tabular-nums`).
- **Status panel sections** are compact: one or two lines each. Put details in a hub screen.
- **Hub screens** use the app shell: `<div class="cf-app">`, then `CF.ui.appBar(title)`, then `<div class="cf-appbody">…</div>`. Leave 44px on the right of the app bar for the overlay's close button.

## Touch

- Tap targets are at least 36×36px (kit buttons are), with 6px or more between them.
- Never rely on hover. Every control works with a tap and has a visible focus style (the kit has one).
- Avoid scrolling inside scrolling. One scrolling area per screen; tabs instead of long pages.

## Colour and theme

- Use the theme variables, never fixed colours: `var(--cf-text)` on `var(--cf-bg)` or `var(--cf-surface)`, `var(--cf-accent)` for the main action and highlights, `var(--cf-good)`/`var(--cf-bad)` for gains and losses, `var(--cf-muted)` for secondary text.
- Text needs a contrast of at least 4.5:1 with its background (3:1 for large or bold text over 18px). White text on `--cf-accent` is only safe when the accent is dark enough; the lint checks it.
- Mix colours with `color-mix(in srgb, var(--cf-accent) 20%, transparent)` for tints that work in light and dark mode.
- The presets are:
  - **Fantasy parchment**: aged paper, ink, gold, serif type, square corners.
  - **Cyberpunk HUD**: neon magenta and cyan on black, monospace data, scanlines, thin glowing borders.
  - **Visual novel**: a translucent dialogue frame, soft gradients, rounded type.
  - **Dating sim**: pinks and peach, round corners, playful.
  - **Modern phone OS**: clean system UI, like a phone's own apps.
  - **Academy**: navy and crest gold on crisp paper, serif headings.
  - **Grimdark**: ash, iron and old blood; dark, worn, small corners.
  - **System window**: glowing blue status windows over deep navy, thin bright borders.
  - **Starship console**: amber readouts and cyan scans on space black, monospace headings, clean panels.
  - **Dread**: near-black and bone white, typewriter headings, blood red as the only colour; tiny corners.
  Match the preset's character in your own CSS: no glows on parchment, no serif on the HUD.

## Theme tokens (set_theme)

`bg`, `surface`, `surface2`, `text`, `muted`, `accent`, `accent2`, `border`, `good`, `bad` are colours (#hex, rgb(), hsl()). `radius` is a number of pixels (0 to 40). `font` and `heading` must be one of these stacks, exactly:

- System: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`
- Serif: `Georgia, "Palatino Linotype", "Book Antiqua", Palatino, "Noto Serif", serif`
- Rounded: `"Segoe UI Variable Display", "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif`
- Mono: `ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "Roboto Mono", monospace`
- Elegant: `"Didot", "Bodoni MT", "Noto Serif Display", Georgia, serif`

`texture` is a CSS background image made of gradients (or "none"), and `shadow` is a box-shadow. Neither may use `url()`.

## Type

- The base size is 14px times the player's text size (`--cf-scale`). Use `em` for sizes so they follow it.
- Two families at most: `--cf-font` for text and `--cf-heading` for titles.
- Line height is 1.4 to 1.5 for text and 1.2 for headings.

## Motion

- Animate changes, not idle screens: a meter fill sliding to its new width (the kit does this), a short flash on a changed value, a toast sliding in.
- Keep motion between 150 and 500ms, eased.
- Wrap anything bigger in `@media (prefers-reduced-motion: no-preference)`.
- Never animate layout in a loop: phones heat up, and long chats hold many panels.

## Images

- Card images come from `app.asset(file)`. Always show a fallback: the avatar letter, a gradient, an icon.
- Use `object-fit: cover` and a fixed aspect ratio (`aspect-ratio: 3 / 4` for portraits), so missing or odd-sized images don't break the layout.

## Icons

Use `CF.ui.icon(name)` from the kit's set, or inline SVG of your own. No icon fonts and no emoji as the only label of a control: give buttons text or an `aria-label`.

## Accessibility

- Use real buttons (`<button type="button">`), not clickable divs.
- Give meters and icons labels (the kit does).
- Don't use colour alone for meaning: add a sign or word (+5, "low").
