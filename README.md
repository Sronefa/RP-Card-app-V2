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
  `<jailbreak>` tags, for every writing task while they're on. The UI engineer goes without, unless "Send the jailbreak
  to the UI engineer too" is turned on, so its chat history stays cached.
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
33. Image Studio, part 1 (Assets → Image Studio, `src/images/`): a visual sheet for the character and every NPC, place and item (face, hair, body, wardrobe with named outfits, three or four signature details, place variants, a LoRA and trigger word), filled by the co-writer from the card with questions only about the gaps and locks per field; a project style lock started from the saved image styles; a shot list suggested from the project (character art and a reference sheet, the SillyTavern emotion set or 8 core moods or custom labels, backgrounds by place and time, scenes per greeting and arc beat, engine art and item icons on engine cards, NPC avatars, custom shots and "same, but…" copies) with the image count; and a prompt writer that builds each prompt from the sheets as tags or sentences, trims the least important parts to fit the image model and never the signature details, and keeps the user's edits (done)
34. Image Studio, part 2 (`src/images/providers.ts`, `comfy.ts`, `queue.ts`, `filing.ts`): image providers in Settings apart from the text ones (NanoGPT, any OpenAI-compatible images endpoint, local ComfyUI), with the model list, prices and capabilities read from the provider and a model per kind of image; a background queue with progress, running cost, a spending cap per batch, pause, cancel and retry; several candidates per shot to pick, regenerate, or retry with an edited prompt; a reference image per character so emotions, outfits and poses keep the look with image-to-image and the same seed; picked images resized to WebP and filed as typed, tagged assets (emotions as SillyTavern sprites, backgrounds as the card's backgrounds) with the card size against a budget; tags on imported images too; and ComfyUI by address with a connect test, API-format workflow import with automatic and manual node mapping, three starter workflows (text to image, image to image, face reference with IP-Adapter), a workflow per kind of shot, a LoRA and trigger word per character wired in automatically, missing-node warnings, and time per image instead of cost (done)
35. Image Studio, part 3 (`src/images/manifest.ts`, `engineArt.ts`, `src/engine/modules/stage.ts`): engine screens find art by meaning through `CF.assets` (a portrait by name with an emotion or outfit, a background by place and time, an icon, a scene) from a manifest of the card's tagged images, falling back to a close emotion, then the portrait, then initials; People, phone contacts, routes, case file, title cast, title art, map and phone wallpaper use tagged art when no picture is set; a Stage part shows the place's background with the cast's sprites by mood; "Art for your parts" on the engine page lists the slots the installed parts can fill, adds the missing ones to the shot list or picks an image from the assets; and the UI engineer lists the card's art and asks for new images onto the shot list (done)
36. Proposal inbox and guided path (`src/app/inbox.ts`, `src/app/guide.ts`): an Inbox on the card bar with everything waiting on the card (co-writer and lorebook brainstorm edits, UI engineer changes, Game Wizard modules and bulk items kept with "Decide later", and Image Studio shots with images nobody picked), with accept all, reject all, and a link that opens where each lands on the right tab; and an optional guided path per project (idea or Surprise me, interview, draft, world pages, story arc, engine kit, images, playtest, export) on the project page, where each step shows done, skipped or next from the card itself, can be skipped or marked done, and opens where it is done, with the next step on the card bar (done)
37. Project bundle and libraries (`src/lib/bundle.ts`, `src/lib/libraries.ts`): Export project on the project page writes one `.cardforge` file with every card, its images and assets, lorebooks and world pages, engine, versions, co-writer, engineer and lorebook chats, the Image Studio, the story bible, per-card settings and linked personas; Import project on the project list brings it in, replacing the same project or keeping both. Libraries for NPCs (world pages), visual sheets and outfits (Image Studio), image setups (a shot list, emotion set and ComfyUI workflows), story templates the co-writer adapts (story arc), lore packs (chosen lorebook entries) and greeting sets (planner grids), each with Save to library and From library where it is made, and a Libraries tab that exports any of them, or mechanics, engine parts and kits, as a `.cfpack` file and imports packs (done)
38. Content levels, prose settings and prompt fixes: Dark (Dark, Horror, Dead dove) and Unhinged (Unhinged, Absolutely unhinged) are two levels that combine, each with its own prompt line and interview theme (Absolutely unhinged asks for the kink list and hard limits first), with old projects migrated; exports add NSFW, dark, horror and dead dove tags and a dead dove content warning. Prose settings per project (point of view, tense, reply length, dialogue, register, rhythm, explicitness for NSFW projects, formatting) join tone and genre in every co-writer request. The base prompt states its rules positively, asks for a one-line plan before longer prose, and steers away from the habits that mark AI fiction (stated morals, feelings as body sensations, characters introduced by description, settings mirroring moods, tidy endings) (done)
39. Style anchors and craft packs (`src/cowriter/style.ts`, Settings → Style samples and Craft packs): a library of passages the user loves, picked per project and per card, that the co-writer imitates for rhythm, sentence length, register and dialogue but not content; reference examples of a strong greeting, description and example dialogue in other genres as the quality target (on by default, off per project); and editable genre guides for horror, romance, comedy, action, mystery and slice of life, loaded by the project's genre, tone or Horror content, turned on by hand, or written by the user (done)
40. Prose editor pass and slop while writing (`src/cowriter/polish.ts`, `src/editor/patterns.ts`, `src/editor/phraseStats.ts`): a line-editor mode that polishes a field (the Polish chip), a pending proposal (✦ Polish) or every draft when the project asks for it, and refuses a result that drops most of the text; proposals with overused phrases or AI patterns ("not X, but Y", em-dash overuse, adjective triplets, repeated openings) are rewritten before the user sees them, with a note of what changed; the checker flags greetings that open the same way and names models overuse, with a name helper; phrases the models repeat across projects are counted and offered for the slop list; and a local backend can ban the slop list while writing (done)
41. Learn from the user and variants (`src/cowriter/learn.ts`, `src/cowriter/variants.ts`): feedback chips on every pending proposal (shorter, longer, darker, warmer, more dialogue, less purple, more grounded, more in voice) that revise it in one tap; an optional reason on a rejection; feedback that keeps coming up, and hand edits to accepted text, offered as personal style notes the co-writer reads in everything it writes (Settings → Style notes); and other versions of a greeting, description or example dialogue (quiet, mid-action, dialogue-led) side by side, to use one, merge paragraphs from several, or have a judge model rank them (done)
42. Sampling and model settings per task (`src/ai/sampling.ts`, Settings → Sampling and thinking): writing tasks run warmer (temperature 1, min-p 0.05) and checks cooler (temperature 0.3), editable per task or turned off, with a retry on the provider's defaults when an endpoint refuses a setting (Claude gets temperature only without thinking, and no min-p); writing tasks think first at medium effort where the model can; a link to the EQ-Bench creative writing leaderboard; and a short StoryScope tip about the model family's fiction habits (Claude, GPT, Gemini, DeepSeek) added to writing prompts (done)
43. No jailbreak for the engineers, lore read tools and connection test (`src/engine/engineer/lore.ts`, `src/ai/connection.ts`): the UI engineer gets no jailbreak unless the user opts in (Settings → Jailbreaks), so its history can cache; it reads the whole story on demand with `list_lore` (every entry of the card's and the project world's lorebook with kind, tokens, constant and keys), `read_lore` (entries by id, or a search), `read_arc` (only the settings of a secret arc) and `read_visual` (the Image Studio's look sheets), instead of 40 titles in `read_card`; and every text and image provider has a Test button that sends one tiny request (no picture) and explains a failure in plain words: wrong address, bad key, model unavailable, no balance (done)
44. Engineer lead and worker (`src/engine/engineer/worker.ts`): the UI engineer works as two. The lead talks with the user, reads the engine and the lore, plans, and hands one task at a time to a worker with `run_worker`: a brief with the task, the modules it may change, and the skills, docs, examples and lore entries it needs attached up front. The worker builds and tests in its own fresh context, writes to the same draft, and is refused writes outside its brief; its history is dropped and the lead keeps only its report, the files it changed and the lint. The lead lints before moving on and hands the user one proposal. Worker steps show live in the engineer panel and stay in the chat as a collapsible list. A "UI engineer worker" task model (the engineer's model unless set) lets a cheaper model do the building (done)
45. Background work (`src/app/activity.ts`, `src/features/activity/`): one queue for long jobs from any card, run one at a time. The UI engineer's turns go through it, so a turn keeps running when the user opens another card or page, and a message sent while one runs waits in line (shown under the chat, with Cancel). An activity chip in the header on every page says what's running ("Engineer: step 3, building the shop app"); tapping it opens the live view with the worker's steps, the queue and finished jobs, each with Open to jump to its card. A notice says when a job is done, needs the user or failed, and the proposal lands in that card's engineer chat and inbox. Co-writer edits the engineer proposes for a card in the background are planned against that card, not the open one (done)
46. Background work on Android (`src-tauri/plugins/keepalive`, `src/app/keepAlive.ts`): while a job runs or waits, a foreground service with a quiet notification ("Engineer working on Mina: step 3, building the shop app · 1 more waiting") keeps the app's process, its web view and network calls alive when the user switches apps or turns the screen off, with a partial wake lock. It starts when a job starts, while the user is in the app (Android 12+ won't start one from the background), lasts for the whole queue, and stops when the queue is empty, leaving a done, needs-you or failed notice if the user is away. It asks for notification permission the first time. Desktop needs nothing: the app keeps running when minimized (done)
47. Fork prebuilt modules (`src/engine/modules/fork.ts`): the UI engineer's `fork_module` tool and a Fork button on the Modules tab copy a built-in screen or part (files, values, rules, regex) into the card as its own module, in place, with the same id, slot and hub button, so the code can change; the other parts' links (the phone's money, the creator's bag) keep working. One phone app can be forked on its own: it becomes a `phone-<app>` module opening inside the phone, with that app's values and rule lines, and the rest of the phone keeps CardForge's fixes. A fork records where it came from and a fingerprint of CardForge's code; the Modules tab and the lint say when the original has been updated, and "Use CardForge's version again" (or "Put it back in the phone") undoes it. The lint checks only the files a fork changed. Forks save to the module library and pack files. A new engineer skill, "fork and tailor", says to try settings first, fork the smallest piece, keep value names and actions, patch instead of rewriting, and playtest against the part's starting states (done)
48. Effects kit and more UI pieces (`src/engine/runtime/fx.js`, `core.js`, `kit.css`): `CF.fx` gives engine screens weather and particles (rain, snow, embers, petals, dust, or from a weather word), shake, flash, glow, pulse, typed text, count-ups, page transitions and parallax, one call each, animating only transform and opacity. New `CF.ui` pieces: progress ring, swipeable carousel, visual-novel dialogue box with portrait and choices, map with pins, timeline and flip card, plus `app.toast` kinds, `app.modal` with a title and Escape, and `app.drawer`. The settings app has a Motion choice (as the device is set, full, less); with less motion the effects hold still or jump to their end and the kit's CSS animations stop. The lint warns about animating layout properties and script animation that ignores less motion. Docs in the core API ("Effects (CF.fx)", "UI kit") and two example modules, `vn-scene` and `journey-app` (done)
49. Style and motion, and the engineer seeing its own work (`src/engine/engineer/skills/style-and-motion.md`, `docs/style.md`, `src/engine/scrubber.ts`, `src/engine/fonts/`): a skill and a searchable style guide teach design basics with before and after, the premium touches, motion craft, images with scrims and fallbacks, taste rules and a recipe for seven genres (dark fantasy, cyberpunk HUD, cozy slice of life, horror, sci-fi console, modern phone, visual novel). Six open-licence fonts (Cinzel, Pirata One, Orbitron, Share Tech Mono, Playfair Display, Patrick Hand) and eight textures are bundled; a card embeds a font only when its theme or screens use it. `render_preview` takes `frames` for a frame strip after a click, a screen opening or a change of values, with pictures and a list of what is moving at each moment (animations are held still while each picture is drawn). `preview_states` shows screens at the card's start, low and empty, high and full, and morning and night, at phone and desktop width, in light and dark; the Look tab shows the status panel the same way. A worker that built or changed a screen reviews it against the skill's checklist before it reports. Example module `hero-sheet` (done)
50. Procedural art (`src/engine/runtime/art.js`, `kit.css`): `CF.art` draws what needs no image, the same picture for the same seed. Inline pieces in the theme's colours: charts (bars, line, spark, donut, radar), a dial gauge with a danger zone, frames with drawn corners (ornate, tech, sketch), ornamental dividers and emblems from a name. Pictures as data URLs and CSS backgrounds: whole maps (island, dungeon, city, in five palettes) to put `CF.ui.map` pins on, eight repeating patterns, SVG noise textures, skies for the time of day and canvas noise, plus a pixel-density canvas, seeded randomness and smooth noise for the author's own drawing. Docs in the core API ("Procedural art (CF.art)"), a `procedural-art` skill, and example modules `world-map` and `stat-chart` (done)
51. Scene director (`src/engine/runtime/scene.js`, `kit.css`): `CF.scene.play` runs a short cutscene written as a list of steps: a background (art, a sky for the time of day or a gradient), characters shown left, right or center (a letter when there is no portrait), typed lines that wait for a tap, a chapter title, effects (shake, flash, weather, particles), waits, and a choice whose answer it returns. Skip is always there, Escape skips, a scene can play once per chat, and less motion drops the movement. The lint checks every scene in a module's `settings.scenes`. Docs in the core API ("Cutscenes (CF.scene)"), a `cutscenes` skill, and example modules `prologue` and `chapter-card` (done)
52. Mood-reactive theme and expressive portraits (`src/engine/runtime/mood.js`, `theme.ts`, Look tab): moods follow a value of the state (a text value from a list, a number range, or any true value) and, while on, change the theme's colours and texture, lay a tint over the screens and drift weather over the newest screen, fading between moods (less motion holds still). A portrait binding makes `app.portrait(name)` / `CF.ui.portrait` show the emotion and outfit the values name, a hurt look under a health line and the closest picture when one is missing, with a crossfade when it changes. Missing emotions and outfits show as art slots and go on the shot list in one tap. Set up in the Look tab or by the engineer (`set_mood`, `set_portrait`, read in `read_theme`); the lint checks the values they follow. Docs in the core API ("Moods and portraits"), a `moods-and-portraits` skill, and example modules `companion-card` and `danger-meter` (done)
53. Minigame toolkit (`src/engine/runtime/game.js`, `engineer/minigames.ts`): `CF.game` / `app.game(root, options)` gives a game a frame (title, score, timer, Skip), a clock and loop that stop while paused or hidden, game-time timers, input for taps, holds, swipes, keys and drag and drop (with a tap fallback), boards of buttons, sprites with collision, countdowns, combos and meters, seeded randomness for layouts, a difficulty read from a value (`g.tune(easy, hard)`), and an end that writes values with the result and sends a `<action app="minigame">` line to the model. Players can skip any game, or all of them in the settings app. Six templates to adapt (lockpicking, hacking, card game, matching puzzle, timed choice, quick-time event), a `build-a-minigame` skill, the core API's "Minigames (CF.game)" section, and lint checks (a game starts and ends, and uses the game's loop, timers and seed) (done)
54. Living screens (`src/engine/runtime/live.js`, `modules/live.ts`, Modules tab): a module can have feeds the model writes during play. After a reply, a silent background call (`generateRaw`) reads the last few messages and writes new items in the voice of the feed's content pack (voice, tone, format, length): an NPC's texts, a news feed, posts. Feeds run every N replies or when a value changes, only for the latest reply, keep their items on that reply per swipe (rerolls get their own, an edit elsewhere doesn't pay twice), fall back to their own lines when the call fails, and can also add the items to a list value so the story and the built-in phone see them. Off by default with the cost per run shown; players can turn each one off in the settings app. Screens read them with `app.live(id)` and show `CF.ui.typing()` while one writes. Set up in the Modules tab or by the engineer (`set_live_feed`); the lint checks packs, cadence, values and that a screen reads them. Docs in the core API ("Living screens (CF.live)"), a `living-screens` skill, and example modules `npc-texts` and `town-news` (done)
55. Co-writer and engineer hand tasks to each other (`app/handoff.ts`, `editor/gaps.ts`, inbox): for cards on the engine, an accepted co-writer edit that the engine should show files a task for the UI engineer (a new NPC becomes "add a phone contact", a shop "add its goods", a place "put it on the map", a stat "show it as a meter"), and an accepted engineer proposal that needs words files one for the co-writer (rules and tiers for a new value, a lorebook page for a new place, a content pack, outcome lines, mood names, expressions). Each side can also ask the other in its chat (`ask_engineer`, `ask_cowriter`). Every task waits in the inbox to approve, edit or dismiss; an approved engineer task runs in the background with the linked lore in its brief, and an approved co-writer task becomes a message in the co-writer chat. The inbox's catch-up scan lists every gap between card and engine as tasks. The co-writer now writes for the engine's screens too: living-screen content packs, minigame outcome lines, cutscenes, mood names and descriptions, and portrait expression lists (`write_live_pack`, `write_minigame_lines`, `write_scene`, `name_mood`, `list_expressions`) (done)
