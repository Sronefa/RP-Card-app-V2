# Fork and tailor a built-in
When: a built-in screen or part (phone, creator, title, people, inventory…) is close to what the user wants, but its settings can't do it: a different layout, a new page, a behaviour the part doesn't have.

1. Settings first. read_module the built-in (its settings show every option) and read_part it. Most asks (labels, apps, contacts, stages, colours through the theme, which pages show) are set_module_settings. Fork only when no setting does it, and say why in your reply.
2. Fork the smallest piece. For one phone app, fork_module with module "phone" and app: the rest of the phone keeps CardForge's fixes. Fork the whole module only when the change touches the frame (lock screen, home screen) or several apps.
3. Read the fork with read_module before changing it. Find the function for the screen you need (`screens.<name>` in the phone, the render functions elsewhere) and change only that.
4. Small patches, not rewrites. patch_file the few lines that change; write_file only for a new file. A rewrite throws away fixes and the cases the original already handles (empty lists, phone width, light and dark).
5. Keep the contract the rest of the card relies on:
   - value paths and names (`Phone.Texts`, `<Name>.Affection`): other parts, the rules and the model's update block use them;
   - action names and payloads (`<action app="phone">{"app":"shop",…}`): the rules explain them to the model;
   - the module id, slot and hub button;
   - the core API: app.state, app.send, app.set, CF.ui, CF.open. No new globals.
   If a change needs a new value or action, add it (set_value on the fork, add_rule) instead of renaming an old one.
6. Settings on a fork are one flat object its code reads: change contacts, places or labels with set_module_settings, not by hard-coding them in the js.
7. Playtest against the original's starting states: set_sample_state with the part's sample values (read_part shows them), then an empty state and a full one. render_preview at phone width, click through each changed screen, run_turn once if you changed an action.
8. Lint. It checks only the files you changed; fix every error and warning in them.

Checklist:
- [ ] A setting couldn't do it (said why).
- [ ] The smallest piece was forked.
- [ ] Value paths, action names, id and button unchanged.
- [ ] Rendered and clicked at phone width, empty and full.
- [ ] Lint clean on the changed files.

Docs: read_doc("modules#forking-a-built-in").
