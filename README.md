# CardForge

Co-write [SillyTavern](https://github.com/SillyTavern/SillyTavern) character cards with AI.
CardForge reads and writes Character Card V3 (PNG, CHARX, JSON) and runs on Windows and Android.

> Working name, may change.

## Stack

- [Tauri 2](https://tauri.app) shell for the Windows app and the Android APK
- React 19 + TypeScript + Vite
- Tailwind CSS 4, Zustand
- IndexedDB (via `idb`) for projects, cards, version history and the persona library
- Vitest + Testing Library

## Development

Prerequisites: Node 22, Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS (plus Android Studio, the SDK and NDK for Android work).

```sh
npm install
npm run tauri dev        # desktop app with hot reload
npm run dev              # web UI only, in the browser at http://localhost:1420
npm test                 # unit tests
npm run typecheck
```

### Android

The Android project is generated, not committed:

```sh
npx tauri android init
npx tauri icon public/icon.svg   # copy the app icon into the Android project
npx tauri android dev            # run on a device or emulator
```

## Card engine

`src/card/` reads and writes cards without any UI or native code:

- Import: PNG (`ccv3` and `chara` chunks, embedded `chara-ext-asset_` assets), CHARX, CHARX appended to a JPEG,
  and JSON in V1, V2 or V3 (old TavernAI/Pygmalion field names included). Everything becomes a V3 card.
- Export: PNG with the V3 card plus a V2 copy for older frontends, CHARX, and JSON.
- Lorebooks: V3 `lorebook_v3` files and SillyTavern World Info, keeping ST-only settings in entry extensions.
- Personas: a small CardForge JSON file, since SillyTavern has no persona file format.

Test fixtures in `src/card/__tests__/fixtures` are made by `make_fixtures.py` with Pillow, independently of
CardForge's own PNG code.

## Co-writer

`src/ai/` talks to the models, `src/cowriter/` runs the conversation:

- Providers: Claude through the Anthropic SDK, and any OpenAI-compatible endpoint (NanoGPT, OpenRouter, DeepSeek,
  local servers). In the app, requests go through Tauri's HTTP plugin, so endpoints don't need CORS.
  API keys are stored on the device only.
- The co-writer edits the card only through tool calls (`set_field`, `patch_field`, greetings, example dialogues,
  lorebook entries, typed `add_npc`, `add_place`, `add_item`, `add_shop` and `update_world_entry`, `pitch`). Each call becomes a proposal shown as a diff; accepting it is one undo step.
  Models without tool calling write the same edits as a JSON block instead; this is detected automatically.
- The system prompt never changes during a chat. Project settings, the story bible, the card, the project's world and
  personas are sent in the user's message, only when they changed since the co-writer last saw them.
- Each task (chat, interview, answer brainstorm, gap analysis, drafting, lorebook brainstorm, critic, image prompts, greeting planner, world pages, story arcs, Game Wizard) has its own
  system prompt and can run on its own model; tasks without one use the default model.
- The interview (`src/cowriter/interview.ts`) asks rounds of questions with suggested answers, then, depending on the
  project's depth, runs gap analysis and follow-up rounds, writes a story bible, and drafts the card in four calls
  (core fields, greetings, example dialogues, lorebook). The draft lands in the chat as proposals. The critic reads
  the finished card and the chat proposes fixes.
- Personas can be built with a short interview from the persona library. Card checker findings and each text field
  have one-tap requests to the co-writer.
- The card checker (`src/editor/checker.ts`) also flags overused AI phrasing (`slop.ts`, phrase list editable in
  Settings) and names, places and factions without a lorebook entry (`coverage.ts`), and combines everything into one
  card health score. Flagged lines can be rewritten, and missing entries stubbed or written, in one tap. Any text field
  can be squeezed to a target token count by the co-writer.
- Writing helpers: the greeting planner (`src/cowriter/greetingPlan.ts`) sorts greetings onto a mood × relationship
  stage × place grid and asks the co-writer for the missing openings; Remix copies a card and has the co-writer rewrite
  the copy (alternate universe, darker, older, genderswap or your own change) in the same voice; Surprise me draws a
  premise from a trope deck (`src/cowriter/tropes.ts`) and starts an interview with it.
- World pages (`src/editor/world.ts`, Lorebook → NPCs, Places, Economy): NPCs with voice notes, places with mood and
  senses, the currency, items with prices, and shops. Each one is an ordinary lorebook entry whose text and keys are
  written from its fields (kept in the entry's `extensions.cardforge`). An optional always-on cast list keeps NPC voices
  apart. The co-writer pitches entries for each page; on the NPC page it can also find the NPCs the card already
  mentions and add them all at once. The currency can be built with a short interview on the coin and the economy,
  and items or services can be made in bulk with settings for count, price, quality, rarity and where they're sold.
  Currency, item and shop entries are XML-tagged (`<item name="…" price="…" quality="…">`), like the arc and mechanics
  entries. Wherever the co-writer writes (chat, interview draft, lorebook brainstorm, Remix, the UI engineer), people,
  places, items and shops go through the typed tools, so they land on these pages and are changed by their fields. A
  plain entry that reads like one can be saved as an NPC (or place, item) from its proposal card; "Sort my lorebook"
  files existing plain entries with the co-writer or a quick offline guess (`src/cowriter/worldScan.ts`); and after a
  turn, names it mentioned without an entry can be added in one tap. The story arc's antagonist shows on the NPC page,
  masked while the arc is secret.
- Trackers & regex (`src/editor/trackers.ts`): optional add-ons (stats, inventory and money, relationship stages,
  custom fields). The model ends each reply with a status block; CardForge writes a display regex script that turns it
  into an HTML panel, a prompt-only script that drops old blocks, an always-on reminder of the format at depth 1, and for
  relationship stages one lorebook entry per stage keyed on the block's stage line. Scripts go in
  `data.extensions.regex_scripts`; the user's own scripts are kept and can be edited and tried on a sample reply.
  A sandboxed preview shows the reply as SillyTavern renders it.
- Story arcs (`src/editor/arc.ts`, Lorebook → Story arc): settings for difficulty, death (including permadeath),
  failure, pacing, endings, twists, the antagonist, secrecy and tone, then the co-writer plots the beats. Each beat is a
  constant lorebook entry at depth 4 in one inclusion group with prioritize on, and each later beat has a longer delay
  and a higher order, so SillyTavern swaps in the next beat after enough messages with no extension. A rules entry
  carries the settings. The antagonist is built with a short interview or left to the co-writer, and becomes its own
  entry. Secret mode hides the arc everywhere in CardForge (the entry list, the slop check, the co-writer is told not to
  hint at it) until you reveal it behind a confirm; the exported card always has it.
- Mechanics (`src/editor/mechanics.ts`, Trackers → Mechanics): game rules baked into the card with no extension and no
  dice. The Game Wizard turns a plain-words description into a module after a few questions: one lorebook entry with
  its own XML tag inside a `<mechanics>` wrapper, with the trigger setup chosen for it (keys, secondary keys and logic,
  depth, always on or keyed, sticky, cooldown, inclusion group, recursion, priority). It follows attention best
  practices by default (rules in-chat at depth 1 to 4 with depth 0 left free, 50 to 200 tokens, positive rules with an
  example, few always-on modules) and flags modules that don't. Each new module is checked against the others for
  contradictions, and can be rewritten to fit. Values a module tracks become status tracker fields. Modules can be
  saved to a library shared by all projects. A module can show the card's images using the path SillyTavern gives
  CHARX assets (`/user/images/<card name>/<file>`); cards with images export as CHARX by default, with a warning on PNG.
- Personas focus on what other characters see and what the player can do (look, capabilities, gear, role), not
  personality, since the player brings that. From a project, "Build from a card" starts the persona interview from the
  world card or a character card and links the new persona to the project.
- Models are chosen in one place: each provider keeps a list of saved models, one of them marked as the default (the
  first one saved, until you pick another). A task's own model is picked from the same lists, and the co-writer's
  model picker switches between them without opening Settings. Each provider also has its own timeout (10 minutes by
  default).
- Jailbreaks in the prompt library are sent at the very end of every request, after the last message, wrapped in
  `<jailbreak>` tags, for every task while they're on.
- The image prompt writer (`src/features/images/`) turns the card, other cards in the project, or a lorebook entry
  into a prompt and negative prompt for an image generator, in a style saved in Settings (tags or sentences, art
  style, fixed opening tags, negative prompt, extra rules).
- On a world card, the lorebook brainstorm can bring in a character card from the project or a file. The co-writer
  says how the character fits the world and what clashes, then pitches lorebook entries for them; the character card
  itself is not changed.

## Builds

GitHub Actions builds every push and pull request:

- `cardforge-windows`: NSIS `.exe` and `.msi` installers
- `cardforge-android`: `cardforge.apk` (arm64 + armv7)

Download them from the run's **Artifacts** section.

The APK is signed with a temporary key until a release key is added as repository secrets
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`). With a temporary key,
uninstall the previous build before installing a new one.

Publishing a GitHub Release attaches the installers and the APK to it. See [RELEASING.md](RELEASING.md).

## Roadmap

1. Foundation: app shell and CI builds (done)
2. Card engine: V3 model, PNG/CHARX/JSON import and export, V2 fallback (done)
3. Projects, persona library and card editor with autosave, undo and version history (done)
4. Lorebook, assets and card checker (done)
5. Co-writer core: Claude and OpenAI-compatible endpoints (NanoGPT, OpenRouter, local), tool-call edits (done)
6. Interview, Deep pipeline and lorebook brainstorm (done)
7. Polish and release (done)
8. Saved models, timeouts, image prompts, bringing characters into a world (done)
9. Card quality: slop detector, token squeeze, lore coverage, card health score (done)
10. Writing helpers: greeting planner, remix/fork, Surprise me (done)
11. World pages: NPC roster, locations, economy (done)
12. Status trackers and regex, relationship stages (done)
13. Story arcs with the antagonist builder and secret mode (done)
14. Mechanics tab and Game Wizard (done)
15. Quality of life: one model picker, per-task models from the provider lists, jailbreaks (done)
16. Quality of life: NPC scan, currency interview, bulk items (done)
17. Quality of life: personas built from a card (done)
18. Immersive Engine foundation: variable sheet, MVU-compatible updater, status panel (Tavern Helper) (done)
19. Engine sandbox: offline fake SillyTavern with a mock Tavern Helper, state inspector, scenario runner (done)
20. Engine modules: module format, library and pack files, card theme with 5 presets, hub buttons, core modules for in-game time and the player settings app (done)
21. UI engineer: a co-writer task that builds engine screens with docs, editable skills and examples, tests them on a hidden sandbox page (screenshots, console, clicks, scripted turns, lint) and hands over one proposal with a diff (done)
22. The first three screens: a status panel with tabs, sliding meters and action buttons (older panels turn into still pictures), the character creator, and the phone with its lock screen, home screen and 12 apps (done)
23. Playtest and side calls: a mini chat with your real roleplay model and the full engine (swipe, edit, rewind), saved game states to restart from, flagging a reply to the engineer, auto-play with a second model as {{user}}, and a side-call mode that keeps the state with a cheap silent call, with its cost a turn (done)
24. Parts browser and shared parts: a library of finished parts (search by tag, live preview, filled from the card when added) and the engineer's list_parts, read_part and install_part; the shared parts (title screen, menu, people, events, journal, notifications); and your own kits, a theme plus parts (done)
25. Kits, batch 1: Modern life sim (phone hub, daily life with needs, a job, bills and skills, a lock-screen title), School / academy (school app with timetable, grades, exams, record, clubs and council requests, a seasonal school-gate title, an Academy theme) and Dating sim / VN (routes with hearts, dates, gifts, a gallery and endings kept across playthroughs, a choice menu, a title with the cast) (done)
26. Kits, batch 2: Fantasy RPG (hero sheet with levels, stat points and skills; inventory with gear and merchants; quest board and guild ranks; a world map with fog and travel; a combat HUD under the reply), Dark fantasy / survival (needs at a camp, a scarce pack, contracts, deadly roads, an embers title, a Grimdark theme) and Isekai / system (a System status window with titles, an item box, a booting System title and theme) (done)
27. Kits, batch 3: Cyberpunk (a neural HUD with RAM quickhacks, cyberware slots and a ripperdoc, gigs and street cred, a sprawl map, a phone with a Darknet app, a glitch title), Sci-fi / space (a ship with hull, shields, fuel, routed reactor power, crew and cargo; a star chart where jumps burn fuel; contracts; a warp title and a Starship theme) and Horror / mystery (a case file with clues, suspects, a red-string evidence board, accusations and a dread meter; a town at night; a VHS title and a Dread theme) (done)
28. NPCs, places and items always land in the lorebook: typed co-writer tools, "Save as NPC" on plain entries, "Sort my lorebook", one-tap entries for names a turn mentioned, the engineer's world additions, the antagonist on the NPC page (done)
29. Engineer screenshots made optional (a "can see images" setting per model and a per-run toggle; without them render_preview sends a text layout report with overlap, text size, empty image and hidden button checks) and token counters: usage read from every reply, meters in the co-writer, the engineer (context fill, breakdown by source, a per-message limit) and the playtest, model context and prices from the provider's list, and per-project totals in Settings (done)
30. App themes (`src/app/theme.ts`, Settings → Look): OLED Black and nine presets (Midnight Library, Neon Noir, Bloodmoon, Forest Shrine, Frostbite, Sakura Night, Phosphor, Ember, Parchment), any accent, RGB Drift (speed, saturation, accent / borders / aurora, still on reduced motion, paused on low battery), custom themes from a tint and an accent with a readability check and theme files, and toggles for the open card's colours, a project colour line, following the clock, textures, a hue per section, text size, density, serif writing fields and a monospace font (done)
31. Engine-aware co-writer: a "Built for the Immersive Engine" project switch, co-writer tools for values, update rules, tiers with threshold events and each greeting's starting state, MVU best practice as a doc and an editable skill (`engine-card-writing`) both sides read, an engine-ready check in the card checker (numbers in prose, greetings without starting state, numbers without tiers, missing or vague rules, macros in value names, values nested too deep), and a change log the co-writer and the UI engineer share, with the engineer proposing card text through the co-writer chat (done)
32. Light card to engine card (`src/engine/convert.ts`): "Convert with the UI engineer" on the engine page; the engineer reads the light card, tells the user the plan and asks before converting. Tracker fields and mechanics values become values, relationship stages become tiers of one affection value, NPCs and places can become People and World values, the tracker is kept so turning the engine off brings it back, and once accepted the co-writer offers each greeting its starting state (done)
