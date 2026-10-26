# Animate changing values
When: values should visibly react when they change: a meter sliding, a number flashing, a toast.

- Kit meters animate their fill when redrawn with a new width, and flash when given a delta. Pass the delta from `app.delta()`.
- For your own elements: compare with `app.delta()` and add a class like `changed` for the reply where the value changed. Use a short CSS animation (300 to 600ms), not a loop.
- Count-up numbers: animate from the old to the new value in the delta with requestAnimationFrame over about 400ms; skip it when the player prefers reduced motion (`matchMedia("(prefers-reduced-motion: reduce)").matches`).
- Never animate on every redraw: only when this message's delta has the value.
- Wrap decorative motion in `@media (prefers-reduced-motion: no-preference)`.
