# Port a panel from an existing Chinese 美化 card
When: the user pastes HTML/JS from another card (often with MVU, `getAllVariables`, `Mvu.getMvuData`, jQuery and CDN links) and wants it in this card.

1. Read the pasted code and list: the values it reads (paths under stat_data), the CDN libraries it loads, the events it listens to, and the actions or messages it sends.
2. Values: map each path to this card's schema. Add missing values with set_value; keep the original names when they fit.
3. Libraries: no CDN. jQuery, lodash (`_`), YAML, Zod and Vue are already there in Tavern Helper iframes. Replace others: icon fonts with CF.ui.icon or inline SVG, chart libraries with CSS bars, web fonts with the theme fonts, Tailwind classes with kit classes or small CSS.
4. State: replace `getAllVariables().stat_data.X`, `Mvu.getMvuData(...)` and `getVariables(...)` with `app.state("X")`. Replace `eventOn("mag_variable_update_ended", …)` with `app.onState`.
5. Actions: replace `triggerSlash("/send …")` or writes to `#send_textarea` with `app.send(app, payload, text)`.
6. Styling: map its colours to theme variables so it follows the card theme and dark mode.
7. Choose the slot: a panel if it was under each reply, an overlay if it was a full page, a message block if the model writes it.
8. Render, compare with the user's description, lint (network calls must be gone), fix.
