# Modules

A module is one package the engine merges into the card. It can have values, lorebook rules, regex and a screen. CardForge compiles every enabled module into the card's single Tavern Helper script and its regex list when the card is saved. Nothing is loaded at runtime.

## Parts of a module

- **manifest**: `id` (lowercase letters, digits and dashes; unique in the card), `name`, `slot`, `button` (for hub screens), `description`, `requires` (ids of modules it needs), `tags`, `enabled`, `settings` (options its code reads).
- **values**: the variables it adds to the game state, in the same format as the variable sheet (see "Values").
- **rules**: lorebook entries: update rules and behaviour the model reads.
- **regex**: SillyTavern regex scripts, written `/pattern/flags`.
- **html**: the screen's starting markup, put in `root` before the script runs.
- **css**: the screen's styles. They are added to the screen's document only.
- **js**: the screen's script. It runs as `function (CF, app, root, settings)`.
- **script**: the card-script part. It runs once per chat as `function (CF, settings, hooks)`.

Core modules (`time`, `settings`) are written by CardForge. You can read them as examples and change their options with `set_module_settings`, but not their files.

Built-in screens work the same way, but a card only has them once added (`add_built_in`, or the Modules tab):
- **creator**: the character creator, an inline block for the first message (`<cf-module id="creator"/>`). Its settings list the choices, stats and point budget, starting items and routes. Begin writes the character with `setMany` and sends the route's opening message.
- **phone**: a hub screen with a lock screen, home screen and apps (messages, contacts, social, news, wallet, map, calendar, shop, notes, photos, settings and a card-specific "system" app). The author picks and orders the apps. Its actions go through the input box as `<action app="phone">{"app":"messages",…}</action>`. With `inline` on, the model may also put `<cf-module id="phone"/>` in a message. A hub module of your own tagged `phone-app` shows on its home screen as an app.

Read them with read_example("creator") and read_example("phone"); the settings file shows every option.

## Slots: where a screen shows

- **panel**: a section at the top of the status panel under each reply. It gets the state of that reply, so old panels show old values. It is best for short live readouts: the clock, a relationship meter, a mood. Keep it to a few lines; it repeats under every reply.
- **overlay**: a hub screen. It opens over the chat from a button above the input box (the module's `button` label, emoji first: "📱 Phone"). It gets the latest state. This is the place for apps: phone, inventory, map, shop, character sheet.
- **message**: an inline block. It shows inside a message wherever the text holds `<cf-module id="your-id"/>`. The greeting can hold one (a title screen, a character creator), or a lorebook rule can tell the model when to write one (a letter, a newspaper). It gets that message's state.
- **script**: no screen. Only the `script` part runs: derived values, timers, side calls.

Several panel modules stack in the order they're installed, above the status values.

## Values

Each value has a `group` (like "Player"; empty for top level), a `name`, a `type`, a `start` and a `rule`. The type is one of:

- `number`, with an optional `min` and `max`. With both, the panel shows a bar, and the schema clamps the value.
- `text`: a few words.
- `toggle`: yes or no; `start` is "yes" or "no".
- `choice`: one of `options`.
- `list`: several short entries; `start` is "a, b, c".
- `counts`: names with amounts, like an inventory; `start` is "rope: 1, arrows: 20".

Set `hidden: true` for a value the model must not see (a `$` key: secrets, a hidden affection score). Set `readOnly: true` for a value the model sees but can't change (a `_` key: derived values a script keeps). `pinned: false` keeps a value out of the compact panel.

The `rule` says when and how the value changes. The model reads every rule before every reply, so make each one short and concrete (see the RP guide).

Two modules can't define the same value path, and a module can't redefine a value of the variable sheet. CardForge flags such clashes.

## Rules (lorebook entries)

`add_rule` adds an entry: `name`, `content`, `constant` (always sent) or `keys` (sent when a key appears in the chat), `depth` (in-chat depth, 1 or more; left out, it goes with the character description) and `order` (higher goes later, closer to the reply).

Write a rule for every action your screen sends, so the model knows what `<action app="shop">{"buy":"rope"}</action>` means and which values to update.

## Regex

`add_regex` adds a SillyTavern regex script: `find` as `/pattern/flags`, `replace`, which messages it runs on (`ai` replies and/or `user` messages), and `only`:

- `display`: changes only what the player sees.
- `prompt`: changes only what the model is sent.
- `both`: changes the message itself.

`minDepth` skips the latest messages (2 leaves the last two alone). In `replace`, `$1` is a capture group. Never write `{{` unless you mean a SillyTavern macro.

## Actions

Screens send structured actions through `app.send(app, payload, text)`: `<action app="shop">{"buy":"rope"}</action>`. The engine's own regex shows them as a short line and drops old ones from the prompt, so a module doesn't need regex for them. It does need a rule saying what each action means.

## Lifecycle

1. When a chat opens, the card's script starts: the updater, then the engine core, then each module's `script` part, then the hub buttons.
2. The greeting gets the starting values (from `[initvar]`, or the greeting's own `<initvar>` block), and the `afterUpdate` hooks run on them.
3. After every reply, the updater applies the model's `<UpdateVariable>` block, the hooks run, and the result is saved on that message (each swipe has its own).
4. Screens draw from the state and redraw on `app.onState`.

## Sizes

The whole engine script is shown on the Modules tab. Keep a module's code to a few kilobytes: a panel section is built again for every reply it shows under, and phones are slow.

## Parts and kits

Parts are finished modules you can install instead of building from scratch: `list_parts` finds them (by words or a tag), `read_part` shows one with its settings already filled from this card, and `install_part` adds it with the parts it needs. CardForge's own parts are built-in modules: change them only through `set_module_settings`. The user's saved modules are parts too; those you can patch like your own.

The shared parts every kit starts from:

- `time` (In-game time) and `settings` (the settings app): the core modules.
- `title` (Title screen): an inline block for the opening message, with New game, Continue and Settings. It keeps `Game.$Started`; the character creator waits for New game when both are in the card.
- `creator` (Character creator): the opening screen where the player makes their character.
- `menu` (Menu): one hub button with a tile for every other hub screen. With `only` on, the other hub buttons go away.
- `people` (People): a profile per person in the cast, with `<Name>.Affection` and `<Name>.Learned`. Values another module already keeps (the phone's affection) are shared, not added twice. Where someone is comes from `<Name>.Location`, else `Time._Whereabouts`.
- `events` (Events): scheduled and random events by day, time and place. After each update the engine puts what's happening now in `Events._Now` for the model. Random events roll the same way on every swipe.
- `journal` (Journal): the model adds the day's key events to `Journal.Today`; at the day's end they're filed in the hidden `Journal.$Past` and the last few days go back to the model as a short memory. A side call can write each day up.
- `notify` (Notifications): banners over the chat in the card's theme. A screen announces something with `CF.notify({ title, text, icon, open })` when the part is on, or with `app.emit("notify", { … })`, which works either way. It also watches lists in the state (`Phone.Texts`, `Phone.News`…) and announces new lines from the latest reply.

The phone is a part too, with the library parts that come in with the kits.

When you install a part, tailor it: fill in what the card's world pages didn't (likes, events, a tagline), and rename labels and stages to fit the setting. The user saves kits (a theme plus parts) from the Modules tab.
