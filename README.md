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
  lorebook entries, `pitch`). Each call becomes a proposal shown as a diff; accepting it is one undo step.
  Models without tool calling write the same edits as a JSON block instead; this is detected automatically.
- The system prompt never changes during a chat. Project settings, the story bible, the card, the project's world and
  personas are sent in the user's message, only when they changed since the co-writer last saw them.
- Each task (chat, interview, answer brainstorm, gap analysis, drafting, lorebook brainstorm, critic, image prompts) has its own
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
- Each provider keeps a list of saved models; the co-writer's model picker switches between them without opening
  Settings. Each provider also has its own timeout (10 minutes by default).
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
10. Writing helpers: greeting planner, remix/fork, Surprise me
11. World pages: NPC roster, locations, economy
12. Status trackers and regex, relationship stages
13. Story arcs with the antagonist builder and secret mode
14. Mechanics tab and Game Wizard
