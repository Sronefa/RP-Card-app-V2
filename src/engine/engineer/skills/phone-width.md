# Make a layout work at phone width
When: render_preview or lint reports overflow, or a screen looks cramped at 360 to 390px.

1. Find the culprit in the lint report (it names the widest elements) or the DOM summary.
2. Usual causes and fixes:
   - Fixed widths: replace `width: 400px` with `max-width: 100%` or `width: 100%`.
   - Grids: `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` instead of fixed column counts; `minmax(0, 1fr)` for flexible columns.
   - Flex rows: add `flex-wrap: wrap` and `min-width: 0` on children; let text truncate with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` where it's a label.
   - Long words and numbers: `overflow-wrap: anywhere`.
   - Tables: turn into stacked cards below 420px with a media query.
   - Images: `max-width: 100%; height: auto`.
3. Render again at phone width and at desktop width.
