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
- **live**: its living screens, if any: feeds the model writes in the background after replies, each with a content pack (voice, tone, format, length), a cadence and fallback lines. Off by default; set them with `set_live_feed` and read them in the screen with `app.live(id)` (see the core API's "Living screens"). Any module can have them, built-ins too.

Core modules (`time`, `settings`) are written by CardForge. You can read them as examples and change their options with `set_module_settings`, but not their files, unless you fork them (see "Forking a built-in").

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

## Forking a built-in

When settings can't do what the card needs, `fork_module` copies a built-in module (the phone, the creator, the title screen, any installed part) into the card as its own module: its files, values, rules and regex. It keeps the same id, slot and hub button, so `CF.open`, `<cf-module id="…"/>` tags and the other parts' links keep working, and the original stops running. Then `read_module` and `patch_file` it like your own. Load the `fork-and-tailor` skill first.

- **One phone app**: `fork_module` with `module: "phone"` and `app` ("messages", "shop", "map"…) forks only that app. It becomes the module `phone-<app>`, tagged `phone-app` and opening inside the phone, with the app's values and its lines of the phone's action rule; the rest of the phone stays CardForge's and keeps getting its fixes. Its code is the phone's script with `settings.piece` set to the app, which shows only that app; patch the parts for that app's screens (`screens.<app>`).
- **Settings**: a built-in's code reads `settings.live || settings`. A fork keeps them as one flat object, so `set_module_settings` on the fork still changes what its code reads (contacts, places, labels).
- **What it remembers**: the fork records the built-in it came from (`fork.core`), when, and a fingerprint of CardForge's code then. The Modules tab and the lint say when CardForge has updated the original since; the fork keeps its own code. The user can go back to CardForge's version from the Modules tab (a forked phone app goes back into the phone).
- **Lint**: the files you haven't changed are CardForge's, so the lint checks only the files you changed, and leaves out what the original already did.
- A fork can be saved to the module library like any module of the user's own.

## Parts and kits

Parts are finished modules you can install instead of building from scratch: `list_parts` finds them (by words or a tag), `read_part` shows one with its settings already filled from this card, and `install_part` adds it with the parts it needs. CardForge's own parts are built-in modules: change them through `set_module_settings`, or fork them to change their code. The user's saved modules are parts too; those you can patch like your own.

The shared parts every kit starts from:

- `time` (In-game time) and `settings` (the settings app): the core modules.
- `title` (Title screen): an inline block for the opening message, with New game, Continue and Settings. It keeps `Game.$Started`; the character creator waits for New game when both are in the card.
- `creator` (Character creator): the opening screen where the player makes their character.
- `menu` (Menu): one hub button with a tile for every other hub screen. With `only` on, the other hub buttons go away.
- `people` (People): a profile per person in the cast, with `<Name>.Affection` and `<Name>.Learned`. Values another module already keeps (the phone's affection) are shared, not added twice. Where someone is comes from `<Name>.Location`, else `Time._Whereabouts`.
- `events` (Events): scheduled and random events by day, time and place. After each update the engine puts what's happening now in `Events._Now` for the model. Random events roll the same way on every swipe.
- `journal` (Journal): the model adds the day's key events to `Journal.Today`; at the day's end they're filed in the hidden `Journal.$Past` and the last few days go back to the model as a short memory. A side call can write each day up.
- `notify` (Notifications): banners over the chat in the card's theme. A screen announces something with `CF.notify({ title, text, icon, open })` when the part is on, or with `app.emit("notify", { … })`, which works either way. It also watches lists in the state (`Phone.Texts`, `Phone.News`…) and announces new lines from the latest reply.

Parts the kits bring, which any card can use:

- `phone` (Phone): the modern phone hub. Other parts pay from its money (`Phone.Money`) when the card has one.
- `life` (Daily life): needs in `Needs.<Name>` (0 to 100) that the engine drains by the time that passed, unless the story changed that need in the same update; a job with `Job.Performance` and the next shift in `Job._Shift`; bills due in `Life._Bills` (paid ones in `Life.$Paid`); skills (in `Skills`, or the creator's group when `skillsGroup` names it, so they share the creator's stats); a home with rooms. Actions: `<action app="life">` with `{"do":"sleep"|"cook"|"eat"|"wash"|"relax"|"work"|"skip"|"practice"|"room"}`.
- `school` (School app): `School._Now` and `School._Next` from the timetable and the clock, `School.Grades` and `School.Study` per subject, `School._Exams` counting down, `School.Attendance`, `School.Violations` as "What — expires Day N" (removed when they expire), the club, announcements, and council requests. Actions: `<action app="school">` with `{"do":"attend"|"skip"|"study"|"join"|"visit"|"request"}`.
- `routes` (Routes): per love interest `<Name>.Affection` (shared with the phone or people when they keep it), `<Name>.Trust`, `<Name>.Route` (Open, Locked in, Lost) and `<Name>.Discovered` tastes; `Routes.Focus`, `Routes.Dates`, `Routes.Gifts`. When the model inserts a caption into `Routes.Unlocked` or sets `Routes.Ending`, the picture or ending is kept with the character (`CF.keep`) across chats. A stage-up plays a short banner. Actions: `<action app="routes">` with `{"date":{…}}` or `{"give":G,"to":N}`. `CF.open("routes", { tab: "gallery" })` opens on a tab.
- `choices` (Choice menu): the model ends a reply with `<cf-module id="choices"/>` and fills `Choices.Options`; a tap sends `<action app="choices">{"pick":…}</action>` at once. It has an optional timer.
- `hero` (Hero sheet): in the creator's group (`Player` by default, sharing its stats): `_Level` and `_NextXP` from `XP` (the model only hands out XP), `_Points` to spend on stats in the screen, resources like `Health` with `_MaxHealth` that grow with the level, refill on a level-up and come back with the clock, `Abilities` (the engine adds each level's skills), `Conditions` like "Poisoned until Day 4" (removed when the day comes) and, when on, `Titles` and the worn `Title`. The `system` style draws an isekai status window and has the model speak as the System in [brackets]. Actions: `<action app="hero">` with `{"use":A}` or `{"rest":H}`.
- `inventory` (Inventory): the bag in `Inventory.Items` (counts; the creator's item list when it hands items out), gold in `Inventory.Gold` (the phone's money when it has a wallet), gear in `Equipped.<Slot>`, an item catalog (kind, slot, effect, price), a slot limit and merchants (a merchant with a map place trades only there). Equipping, dropping, buying and selling are the player's own edits; `<action app="inventory">` with `{"use":I}` or `{"give":I,"to":P}` goes to the story. Other parts (daily life, routes) pay from its gold when there's no phone.
- `quests` (Quest log): `Quests.Active` as "Name — objective", `Quests.Board` offers with their reward, `Quests.Done`, `Quests.Failed`, the `Quests.Tracked` one (pinned) and, with ranks, `Quests.Renown` and `Quests._Rank`. Finished quests give XP when the card has a hero sheet. Actions: `<action app="quests">` with `{"accept":Q}`, `{"abandon":Q}` or `{"ask":Q}`.
- `map` (World map): places with roads, regions, danger (0 to 3) and a spot each; `Map.Location`, `Map.Discovered` (the engine adds where you go and the roads from there; the rest stays in the fog) and `Map._Nearby`. Travel follows the shortest known road: `<action app="map">` with `{"travel":P,"via":[…],"hours":H}`. The travel button's word (`verb`: Travel, Jump, Go) and the message sent (`go`, with `{place}`) are settings, so it serves as a star chart or a town map too.
- `combat` (Combat HUD): during a fight the model ends each reply with `<cf-module id="combat"/>`; `Combat.Active`, `Combat.Enemies` (counts of health), `Combat.Log`, `Combat._Round` (one per reply) and the hidden `Combat.$Max` for the bars. The fight ends by itself when the last foe is removed. Skills and items come from the hero sheet and the inventory. A tap sends `<action app="combat">` with `{"do":"attack"|"skill"|"item"|"defend"|"flee",…}` at once.
- `ship` (Ship): `Ship.Hull`, `Ship.Shields` and `Ship.Fuel` with their `_Max` values (the engine caps them), `Ship._Power` (counts: the reactor's power the player routes between systems in the screen, never more than the reactor gives), `Ship.Damaged` (systems knocked offline), `Ship.Alert` (Green, Yellow, Red), `Ship.Crew` as "Name — role" and `Ship.Cargo` (counts, with a hold limit). Shields recharge with the clock by the power they get, and each jump on the map burns fuel unless the story already changed it that turn. Banners for a critical hull, low fuel, damage and repairs. Actions: `<action app="ship">` with `{"repair":S}`, `{"talk":N}`, `{"jettison":C}` or `{"alert":L}`.
- `case` (Case file): `Case.Clues` as "Clue — where found", `Case.Suspects` as "Name — what's known", the player's board in `Case._Links` ("Clue → Suspect") and notes in `Case._Theory`, `Case.Solved`, and a fear meter (`Case.Dread` by default, 0 to 100) that makes the screen flicker and drift as it climbs. The author's truth goes to the model in an always-on rule and never shows on screen. Actions: `<action app="case">` with `{"question":N}`, `{"examine":C}` or `{"accuse":N,"evidence":[…]}`.

The title screen has styles for the kits: `classic`, `lock` (a phone lock screen), `gate` (petals, leaves or snow by the in-game season) `cast` (portraits of the cast, plus Gallery and Endings when the card has routes), `embers` (sparks rising, for dark fantasy), `system` (a status window that boots up, for isekai), `glitch` (a neon title that tears, for cyberpunk), `stars` (stars streaking past at warp, for space) and `static` (a VHS tape with noise and the in-game time, for horror).

Built-in kits: "Starter game" (the shared parts), "Modern life sim" (phone theme, lock-screen title, phone with a Jobs app, daily life, people, diary), "School / academy" (Academy theme, school-gate title, school app, phone with a Forum app, people with school stages, festivals on the calendar) "Dating sim / VN" (dating theme, cast title, routes, choice menu, a light phone, festival and confession-day events), "Fantasy RPG" (parchment theme, a race and class creator, hero sheet, inventory with merchants, guild quests with ranks, a world map, combat), "Dark fantasy / survival" (Grimdark theme, embers title, hunger, thirst, warmth, rest and sanity from the daily-life part at a camp, a scarce pack, contracts, deadly roads, brutal fights) and "Isekai / system" (System theme and title, a reincarnation creator, the System status window with titles, an unlimited item box, guild quests and ranks, a starter-town map), "Cyberpunk" (Cyberpunk HUD theme, glitch title, a lifepath and role creator, a neural HUD with RAM-powered quickhacks, gear with cyberware slots and a ripperdoc, gigs with street cred, a sprawl map, a phone with a Darknet app, fights), "Sci-fi / space" (Starship theme, warp title, a crew-file creator, an officer's sheet, the ship, a locker, contracts with reputation, a star chart where jumps burn fuel, fights) and "Horror / mystery" (Dread theme, VHS title, an occupation and burden creator, the case file with a dread meter, pockets, a small town at night, a phone, no fights). Installing a kit adds what the card doesn't have, filled from the card.

When you install a part, tailor it: fill in what the card's world pages didn't (likes, events, a tagline), and rename labels and stages to fit the setting. The user saves kits (a theme plus parts) from the Modules tab.
