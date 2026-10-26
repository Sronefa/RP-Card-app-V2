# Build a hub app (phone, inventory, map, shop)
When: the user wants a screen that opens over the chat from a button: an app with pages, lists and actions.

0. A phone? Use the built-in one (add_built_in with screen "phone", then set_module_settings for its apps, contacts, places, shop and system app). For a phone app of your own (a dating app, a bank), make a hub module tagged "phone-app" (set_module tags): it shows on the phone's home screen and opens inside the phone.
1. Plan before code: the pages, what each shows, which values it reads, which actions it sends and what the model should do with each action. Write the plan in one short paragraph in your reply.
2. Add or check the values (read_values, set_value). Lists of things (contacts, items, quests) are `counts` or `list` values, or a group of values.
3. create_module with slot "overlay" and a button label that starts with an emoji ("📱 Phone").
4. js: build with the app shell. `CF.ui.appBar(title, { back: true })` + `<div class="cf-appbody">`. For several pages use `app.router(root, routes, "home")`. Redraw on app.onState.
5. Actions: buttons with `{ send: "app-id", payload: {...}, text: "what {{user}} does" }`. Add one keyed or constant rule per action (add_rule) saying what it means and which values to update.
6. Things only the player decides (equip, rename, favourites) use `app.set(path, value, note)`.
7. Render with open: your module id at phone width. Check: app bar clear of the close button on the right, tap targets at least 36px, one scrolling area, no overflow.
8. click a button or two and check the action text and errors.
9. Lint, fix, finish.

Checklist:
- [ ] Every page reachable and every back button works.
- [ ] Every action has a rule; every value read exists.
- [ ] Empty states: a short line when a list is empty.
- [ ] Looks right in light and dark (theme variables only).
- [ ] No network, no fonts or images by URL.

Example: read_example("inventory-app").
