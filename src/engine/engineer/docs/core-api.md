# Engine core API

The engine core is a small runtime CardForge puts in every engine card's Tavern Helper script. Every screen builds on it. It is shared as one object, `CardForge`, on SillyTavern's window. A module's screen script gets it as `CF`, together with `app` (its own screen) and `root` (its element), so you never look it up yourself.

Plain ES5-style JavaScript is safest (`var`, `function`), because players run cards in many WebViews. Arrow functions, `const` and `let`, template strings and `async` are fine too; avoid newer syntax such as optional chaining in card scripts. Never load anything from the web: no CDN, no fonts, no images by URL. The sandbox blocks the network, and so does a phone without signal.

## Types (.d.ts)

```ts
/** The game state: MVU stat_data. Keys starting with "_" are read-only for the AI; "$" keys are hidden from it. */
type State = Record<string, any>;
/** What changed in a message: { "Player.Health": [old, new] }. */
type Delta = Record<string, [any, any]>;

interface Settings {
  mode: "auto" | "light" | "dark";
  accent: string;        // "" = the card's own accent
  textScale: number;     // 0.85 to 1.3
  compact: boolean;      // compact status panels
  livePanels: number;    // how many panels stay live (0 = all)
  sideCalls: boolean;    // background generations allowed
  music: number;         // 0 to 100
  ambience: number;      // 0 to 100
  motion: "auto" | "full" | "reduce"; // "auto" follows the device's reduced-motion setting
}

interface CardForge {
  version: string;
  ui: UiKit;
  fx: Fx;
  art: Art;
  scene: Scene;
  /** Sets a screen up in a window: theme, kit, delegated controls, and an App bound to its message. */
  frame(win: Window, options?: { messageId?: number | "latest" }): App;
  /** Mounts a module's screen into an element (default: the page's #cf-root). */
  mount(win: Window, moduleId: string, root?: Element, options?: { app?: App }): App | null;
  /** Mounts every module of a slot under `el`, one <section class="cf-slot"> each. */
  mountSlot(win: Window, slot: "panel" | "overlay" | "message", el: Element, options?: { app?: App }): App;
  /** Opens a hub screen over the chat. "status" opens the status panel full size. `params` reach it through openParams(). */
  open(moduleId: string, params?: Record<string, any>): HTMLIFrameElement;
  /** What the latest open() passed, like { tab: "gallery" }; {} when nothing. */
  openParams(): Record<string, any>;
  close(): void;
  /** A card image by file name: /user/images/<character>/<file>. */
  asset(file: string): string;
  settings(): Settings;
  /** Set when the card keeps the state with a side call: about how many tokens a turn it costs. */
  sideCall(): { tokens: number } | null;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** The theme as a :root { --cf-… } rule, for the current settings. */
  themeCss(settings?: Settings): string;
  /** Whether the card has a status panel, which open("status") shows. */
  hasPanel(): boolean;
  /** The card's enabled modules. */
  modules(): { id: string; name: string; slot: string; button: string }[];
  /** Turns older status panels into still pictures (the player's "live panels" setting). Runs on its own after each message. */
  freezePanels(): void;
  state: {
    /** The state at a message (default: the latest), or one value by path. */
    get(path?: string, messageId?: number | "latest"): any;
    /** The latest message id with a game state, or -1. */
    latestId(): number;
    /** The player changes a value on the latest state. Logged in _PlayerEdits so the AI keeps it. */
    set(path: string | string[], value: any, note?: string): Promise<any>;
    /** Several player changes in one write and one log line: [[path, value], ...]. */
    setMany(changes: [string | string[], any][], note?: string): Promise<any>;
    /** Every value back to the start, on the latest state. */
    reset(): Promise<void>;
  };
  act: {
    /** Writes `<action app="…">payload</action>` (+ text) into SillyTavern's input box; with now, sends it. */
    send(app: string, payload?: any, text?: string, options?: { now?: boolean }): Promise<string>;
    /** The same line, without writing it anywhere. */
    text(app: string, payload?: any, text?: string): string;
    /** Writes plain text into the input box (no action tag); with now, sends it. */
    write(text: string, options?: { now?: boolean }): Promise<string>;
  };
  /** Values kept with the character across every chat: unlocked endings, gallery pictures, achievements. */
  keep: {
    get(key?: string): any;
    /** Emits "cf:keep" once saved. */
    set(key: string, value: any): Promise<any>;
    /** Adds lines to a kept list once each; resolves to the lines that were new. */
    add(key: string, lines: string | string[]): Promise<string[]>;
  };
  bus: {
    /** Listens for "cf:<name>" events between screens. Returns a function that stops listening. */
    on(name: string, fn: (detail: any) => void): () => void;
    emit(name: string, detail?: any): Promise<void>;
  };
}

/** One screen: the status panel, a hub screen or an inline block. Listeners end with the screen. */
interface App {
  window: Window;
  document: Document;
  messageId: number | "latest";
  ui: UiKit;
  fx: Fx;
  art: Art;
  scene: Scene;
  /** The state at this screen's message (the latest for hub screens), or one value by path. */
  state(path?: string): any;
  /** What changed in this screen's message. */
  delta(): Delta;
  set(path: string | string[], value: any, note?: string): Promise<any>;
  setMany(changes: [string | string[], any][], note?: string): Promise<any>;
  send(app: string, payload?: any, text?: string, options?: { now?: boolean }): Promise<string>;
  write(text: string, options?: { now?: boolean }): Promise<string>;
  open(moduleId: string, params?: Record<string, any>): void;
  close(): void;
  /** Runs fn after updates, swipes, deletions and the player's edits. */
  onState(fn: () => void): void;
  on(name: string, fn: (detail: any) => void): void;
  emit(name: string, detail?: any): Promise<void>;
  /** A short message at the top of this screen. */
  toast(text: string, o?: { kind?: "good" | "bad"; icon?: IconName; ms?: number }): HTMLElement;
  /** A dialog over this screen; returns its backdrop element (close() or remove() closes it). Escape, the backdrop and data-cf-close close it too. */
  modal(html: string, o?: { title?: string }): HTMLElement & { close(): void };
  /** A panel sliding in from the right (default), the left or the bottom; closes like a modal. */
  drawer(html: string, o?: { side?: "right" | "left" | "bottom"; title?: string }): HTMLElement & { close(): void };
  /** A router for app-like screens. Routes are functions (params, app) => HTML string. */
  router(root: Element, routes: Record<string, (params: any, app: App) => string | void>, start: string, params?: any): { go(name: string, params?: any): void; back(): boolean; refresh(): void };
  go(name: string, params?: any): void;
  back(): boolean;
  settings(): Settings;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  asset(file: string): string;
}

/** HTML-string builders. Every text argument is escaped for you. */
interface UiKit {
  esc(value: any): string;
  icon(name: IconName, label?: string): string;
  icons(): IconName[];
  delta(change: number): string;
  meter(o: { label: string; value: number; min?: number; max?: number; delta?: number; showMax?: boolean }): string;
  stat(label: string, value: any, delta?: number): string;
  grid(items: { label: string; value: any; delta?: number }[]): string;
  chip(text: string): string;
  avatar(src: string | null, name?: string): string;
  list(items: { title: string; sub?: string; right?: any; avatar?: string | null }[]): string;
  bubble(text: string, me?: boolean): string;
  button(label: string, o?: { primary?: boolean; ghost?: boolean; icon?: IconName; send?: string; payload?: any; text?: string; now?: boolean; open?: string; close?: boolean; back?: boolean }): string;
  tabs(tabs: { id: string; label: string; html: string }[], selected?: string): string;
  appBar(title: string, o?: { back?: boolean; close?: boolean }): string;
  /** A round progress ring with the value (or text) inside. */
  ring(o: { value: number; min?: number; max?: number; label?: string; text?: string; size?: number }): string;
  /** Slides that swipe sideways, with arrows and dots; works by itself. */
  carousel(slides: string[], o?: { label?: string }): string;
  /** A visual-novel dialogue box: name plate, portrait URL on the left or right, the line, and choices (button options each). */
  dialogue(o: { name?: string; text: string; portrait?: string | null; side?: "left" | "right"; more?: boolean; choices?: ({ label: string } & ButtonOptions)[] }): string;
  /** A map: an image (or a plain dotted ground) with pins at x/y percentages; a pin acts like a button. */
  map(o: { image?: string | null; label?: string; pins: ({ label: string; x: number; y: number; icon?: IconName; here?: boolean; locked?: boolean } & ButtonOptions)[] }): string;
  /** A timeline, top to bottom. */
  timeline(items: { title: string; sub?: string; time?: string; done?: boolean; current?: boolean }[]): string;
  /** A card that flips over when tapped; front and back are HTML. */
  flip(o: { front: string; back: string; label?: string; flipped?: boolean }): string;
}

type ButtonOptions = { send?: string; payload?: any; text?: string; now?: boolean; open?: string };

/** Effects. Each takes an element of your screen, animates only transform and opacity, and holds still when the player wants less motion. */
interface Fx {
  /** Whether to cut motion for this screen: the player's Motion setting, else the device's. */
  reduced(el?: Element): boolean;
  /** Particles over an element until stopped. */
  particles(el: Element, kind: "rain" | "snow" | "embers" | "petals" | "dust", o?: { count?: number; color?: string; speed?: number }): () => void;
  /** Particles for a weather word ("light rain", "Snow", "storm"); nothing for clear skies. */
  weather(el: Element, text: string, o?: { color?: string; speed?: number }): () => void;
  shake(el: Element, o?: { strength?: number; ms?: number }): Promise<void>;
  flash(el: Element, o?: { color?: string; strength?: number; ms?: number }): Promise<void>;
  /** A breathing glow until stopped. */
  glow(el: Element, o?: { color?: string }): () => void;
  /** A gentle repeating pulse until stopped. */
  pulse(el: Element): () => void;
  /** Types text in; a tap shows the rest. */
  typewriter(el: Element, text: string, o?: { speed?: number }): { done: Promise<void>; skip(): void };
  countUp(el: Element, to: number, o?: { from?: number; ms?: number; format?: (n: number) => string }): Promise<void>;
  /** Swaps the content with a transition. */
  transition(el: Element, html: string, o?: "fade" | "left" | "right" | "up" | { type?: "fade" | "left" | "right" | "up"; ms?: number }): Promise<void>;
  /** Layers with data-depth="0.2" to "1" drift with the pointer or the phone's tilt, until stopped. */
  parallax(el: Element, o?: { reach?: number }): () => void;
}

/** One step of a cutscene: plain data, so scenes can sit in a module's settings. */
type SceneStep =
  | { bg: string; time?: string; color?: string; fade?: number }   // a place name (its art), a picture URL, or "" for the theme's gradient; a sky for `time` when there's no art
  | { show: string; side?: "left" | "right" | "center"; emotion?: string; outfit?: string; from?: "left" | "right" | "bottom"; ms?: number }
  | { hide: string }
  | { say: string; who?: string; emotion?: string; auto?: number; speed?: number }  // types out, then waits for a tap (or `auto` ms)
  | { title: string; sub?: string; hold?: number; stay?: boolean }  // a chapter card
  | { fx: "shake" | "flash" | "weather" | "particles"; text?: string; kind?: string; color?: string; strength?: number }
  | { wait: number | "tap" }
  | { choice: (string | { label: string; value?: any; send?: string; payload?: any; text?: string })[]; prompt?: string }
  | { clear: true | "all" };

interface Scene {
  /** Plays a scene in el. Tap finishes a line, then moves on; Skip (or Escape) jumps to the end or the next choice. */
  play(el: Element, steps: SceneStep[], o?: { fill?: boolean; once?: string; skippable?: boolean; keep?: boolean; label?: string; speed?: number }): {
    done: Promise<{ skipped: boolean; stopped: boolean; seen: boolean; choice: { index: number; label: string; value: any } | null; choices: { index: number; label: string; value: any }[] }>;
    skip(): void;
    stop(): void;
  };
  /** Problems with a scene's steps, as sentences; [] when it can play. */
  check(steps: SceneStep[]): string[];
  /** Whether a scene played with { once: key } has played in this chat; with no key, the list of keys. */
  seen(key?: string): boolean | string[];
}

type ChartItem = number | { label?: string; value: number; color?: string };
type Palette = "parchment" | "sea" | "night" | "neon" | "stone";

/** Procedural art: inline pieces are HTML strings in the theme's colours; images are data URLs with their own. */
interface Art {
  chart(kind: "bar" | "line" | "spark" | "donut" | "radar", data: ChartItem[], o?: { max?: number; title?: string; center?: string; legend?: boolean; empty?: string }): string;
  gauge(o: { value: number; min?: number; max?: number; label?: string; unit?: string; text?: string; ticks?: number; danger?: number }): string;
  frame(html: string, o?: "ornate" | "tech" | "sketch" | { kind?: "ornate" | "tech" | "sketch"; title?: string }): string;
  divider(kind?: "flourish" | "diamond" | "circuit" | "line"): string;
  /** An emblem from a name: the same name, the same crest. */
  sigil(seed: string, o?: { size?: number; color?: string; label?: string }): string;
  /** A map picture (data URL) to give CF.ui.map as its image; places in % so pins line up. */
  mapImage(o?: { kind?: "island" | "dungeon" | "city"; seed?: string | number; places?: { x?: number; y?: number }[]; roads?: boolean; palette?: Palette; colors?: Partial<Record<"sea" | "land" | "high" | "line" | "mark" | "paper", string>> }): string;
  /** CSS backgrounds: a repeating pattern, SVG noise, a sky for a time of day. */
  pattern(kind: "dots" | "grid" | "stripes" | "checks" | "diamonds" | "waves" | "crosshatch" | "hex", o?: { color?: string; size?: number; opacity?: number }): string;
  noiseTexture(o?: { scale?: number; opacity?: number; color?: string; seed?: string | number }): string;
  sky(time: string): string;
  /** Coloured noise drawn on a canvas, as a PNG data URL ("" without a canvas). */
  noiseImage(o?: { seed?: string | number; size?: number; scale?: number; from?: string; to?: string }): string;
  /** A canvas filling el at the screen's pixel density; draw in CSS pixels. null without a canvas. */
  canvas(el: Element, o?: { height?: number }): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null;
  /** Seeded randomness and smooth noise (0 to 1) for your own drawing. */
  rng(seed: string | number): () => number;
  noise(seed: string | number): ((x: number, y?: number) => number) & { fbm(x: number, y?: number, octaves?: number): number };
  /** An SVG string as a data URL, or as a CSS url('…'). */
  dataUrl(svg: string): string;
  url(svg: string): string;
  /** A theme colour ("accent", "text"…) as el's screen sees it, for pictures that can't read the theme. */
  themeColor(name: string, el?: Element): string;
}

type IconName = "heart" | "star" | "coin" | "clock" | "sun" | "moon" | "cloud" | "rain" | "snow" | "fog" | "storm" | "gear" | "back" | "close" | "phone" | "bag" | "map" | "chat" | "user" | "chart" | "calendar" | "news" | "wallet" | "camera" | "note" | "spark" | "home" | "send" | "people" | "lock" | "check" | "plus" | "book" | "gift" | "sword" | "shield" | "flask" | "skull" | "fire" | "scroll" | "compass" | "bolt" | "rocket" | "eye" | "search" | "chip";
```

## A screen script

A module's `js` file runs once when its screen mounts, as the body of `function (CF, app, root, settings) { … }`. `root` already holds the module's `html` file, and the card theme and kit are in the document.

```js
function draw() {
  var p = app.state("Player") || {};
  var d = app.delta();
  root.innerHTML =
    '<div class="cf-card cf-stack">' +
    CF.ui.meter({ label: "Health", value: p.Health, max: 100, delta: (d["Player.Health"] || [])[1] - (d["Player.Health"] || [])[0] }) +
    CF.ui.grid([{ label: "Gold", value: p.Gold }]) +
    "</div>";
}
draw();
app.onState(draw);
```

Draw from the state every time, and redraw on `app.onState`. Don't keep your own copy of values: swipes and edits roll the state back.

## Reading state

- `app.state()` is the whole state at this screen's message. A status panel under reply 5 shows reply 5's values, not the latest.
- `app.state("Player.Health")` reads one value. A path can be dotted (`Player.Health`), bracketed (`Inventory["Old key"]`) or a JSON pointer (`/Player/Health`).
- `app.delta()` is what changed in this message: `{ "Player.Health": [80, 68] }`. Use it for +/- badges and flashes.
- Hidden values keep their `$`: `app.state("$Secret")`. Read-only values keep their `_`: `app.state("Time._Weekday")`.
- `CF.state.get(path, messageId)` does the same from anywhere.

## Changing state from a screen

`app.set("Player.Gold", 40, "spent at the shop")` changes the latest state at once. The change goes through the schema (clamps, repairs). It is logged in `_PlayerEdits`, so the model reads "Player.Gold: 52 → 40 (spent at the shop)" and builds on it instead of undoing it. Use it for things the player decides alone: equipping an item, renaming, choosing a setting. For anything the story should react to (buying, talking, travelling), send an action instead and let the model write the update.

`app.setMany([["Player.Name", "Ash"], ["Player.Class", "Mage"]], "made in the character creator")` writes several values in one go: one save, one schema check and one `_PlayerEdits` line. Hidden `$` values (like a read counter or the player's own notes) are saved but not logged, so the model isn't told about bookkeeping.

`CF.state.reset()` puts every value back to the start, as the settings app's "Back to the start" does.

## Sending actions

`app.send("shop", { buy: "rope", price: 5 }, "I buy the rope.")` writes this into the input box:

```
<action app="shop">{"buy":"rope","price":5}</action>
I buy the rope.
```

The player can add words and send it. With `{ now: true }` it is sent at once. The engine's regex shows the action as a short line (`⟶ shop`) and keeps old ones out of the prompt. Tell the model in a lorebook rule what each action means (see the RP guide).

`app.write("I rest until morning.", { now: true })` writes plain text, without an action tag: for a prewritten message, like the status panel's action buttons or the creator's opening line.

A button can send without any script: `CF.ui.button("Buy", { send: "shop", payload: { buy: "rope" }, text: "I buy the rope.", primary: true })`.

## Events between screens

`app.emit("bought", { item: "rope" })` and `app.on("bought", fn)` let screens talk: the bank app can hear a shop purchase. Event names get a `cf:` prefix. The engine itself emits `cf:state` (after a player edit), `cf:settings`, `cf:action`, `cf:opened` and `cf:closed`.

## Settings

`app.settings()` gives the player's choices for this chat (see the Settings type). Respect them: `compact` for panels, `sideCalls` before any background generation, `music` and `ambience` for sound. The theme already follows `mode`, `accent` and `textScale`.

## Hub screens and routing

An overlay module opens over the chat from its hub button, in a phone-sized frame with a close button (×) in the top-right corner. Leave about 44px free on the right of your app bar for it. `app.close()` closes it and `app.open("phone")` opens another.

For an app with several pages, use the router:

```js
var nav = app.router(root, {
  home: function () { return CF.ui.appBar("Phone") + '<div class="cf-appbody">' + CF.ui.button("Messages", { primary: true }) + "</div>"; },
  thread: function (p) { return CF.ui.appBar(p.name, { back: true }) + '<div class="cf-appbody">…</div>'; },
}, "home");
root.addEventListener("click", function (e) {
  if (e.target.closest(".cf-btn.primary")) nav.go("thread", { name: "Mina" });
});
```

`data-cf-back` buttons (the app bar's back arrow) go back one page, and close the screen on the first page. `nav.refresh()` draws the current page again, keeping the scroll: call it from `app.onState`.

`app.open("routes", { tab: "gallery" })` passes options to the screen it opens; that screen reads them with `CF.openParams()` when it starts.

## Kept across chats

`CF.keep` stores values with the character, not the chat, so they outlast a playthrough: endings reached, gallery pictures unlocked, achievements. `CF.keep.add("endings", "Mina: The café at dawn")` adds a line once; `CF.keep.get("endings")` reads the list. Screens hear `app.on("keep", …)` after a change. Keep it small: it is saved in the character card's variables.

## UI kit

Every builder returns an HTML string; put several together and set `root.innerHTML` once.

- `CF.ui.meter({ label: "Health", value: 68, max: 100, delta: -12 })`: a labelled bar with a +/- badge; it flashes when `delta` is set.
- `CF.ui.stat("Gold", 120, 5)` and `CF.ui.grid([{ label: "Gold", value: 120 }, { label: "Day", value: 3 }])`: small stat tiles.
- `CF.ui.chip("Rested")`: a pill.
- `CF.ui.delta(-12)`: a red or green badge.
- `CF.ui.avatar(app.asset("mina.png"), "Mina")`: a round portrait, or the first letter when `src` is null.
- `CF.ui.list([{ title: "Rope", sub: "15 m", right: "×1", avatar: null }])`: a list with optional avatars.
- `CF.ui.bubble("Hi!", false)` and `CF.ui.bubble("Hey", true)`: chat bubbles (wrap them in `<div class="cf-bubbles">`).
- `CF.ui.button("Use", { primary: true, icon: "bag" })`. It can also take `send`/`payload`/`text`/`now`, `open: "moduleId"`, `close: true` or `back: true`.
- `CF.ui.tabs([{ id: "bag", label: "Bag", html: "…" }, { id: "quests", label: "Quests", html: "…" }], "bag")`: tab switching works by itself.
- `CF.ui.appBar("Inventory", { back: true })`: the title bar of an app screen.
- `CF.ui.icon("coin")`: an inline SVG icon from the set: heart, star, coin, clock, sun, moon, cloud, rain, snow, fog, storm, gear, back, close, phone, bag, map, chat, user, chart, calendar, news, wallet, camera, note, spark, home, send, people, lock, check, plus, book, gift, sword, shield, flask, skull, fire, scroll, compass, bolt, rocket, eye, search, chip.
- `CF.ui.ring({ value: 7, max: 10, label: "Energy" })`: a round progress ring.
- `CF.ui.carousel(["<h3>Harbor</h3>…", "<h3>Market</h3>…"], { label: "Places" })`: swipeable slides with arrows and dots.
- `CF.ui.dialogue({ name: "Mina", text: "You came back.", portrait: CF.assets.portrait("Mina", { emotion: "happy" }), choices: [{ label: "Of course", send: "talk", payload: { say: "Of course" } }] })`: a visual-novel box; pair it with `CF.fx.typewriter` on its `.cf-vn-text`.
- `CF.ui.map({ image: CF.assets.scene("map"), pins: [{ label: "Harbor", x: 30, y: 60, here: true }, { label: "Tower", x: 70, y: 25, send: "travel", payload: { to: "Tower" } }] })`: a map with tappable pins; without an image it draws a plain dotted ground.
- `CF.ui.timeline([{ title: "Met Mina", time: "Day 1", done: true }, { title: "The festival", time: "Day 4", current: true }])`: events down a line.
- `CF.ui.flip({ front: "<b>?</b>", back: "<b>The Tower</b>", label: "Tarot card" })`: a card that flips when tapped.
- `app.toast("Saved", { kind: "good", icon: "check" })`: a short message at the top.
- `app.modal('<p>Sure?</p><button class="cf-btn" data-cf-close>Close</button>', { title: "Leave town" })`: a dialog; `data-cf-close` inside it, Escape and the backdrop close it.
- `app.drawer(CF.ui.list(items), { side: "right", title: "Bag" })`: a side panel (or `"bottom"` sheet) that closes the same way.

## Effects (CF.fx)

One call each, on an element of your screen. They animate only transform and opacity, so they stay smooth on phones, and they stop with the screen. When the player wants less motion (the settings app's Motion choice, else the device's setting) particles, shakes, flashes and parallax don't run, typed text and count-ups show their end at once, and transitions swap instantly; the kit's own CSS animations hold still too.

- `var stop = CF.fx.weather(root, app.state("Time.Weather"))`: rain, snow, embers, petals or dust that fit the weather word; nothing for clear skies. `CF.fx.particles(root, "embers", { count: 30 })` picks the kind yourself. Call `stop()` before drawing them again.
- `CF.fx.shake(card)` and `CF.fx.flash(root, { color: "#fff" })`: a hit, a jolt, lightning. Use them on a change (a delta), not on every render.
- `var off = CF.fx.glow(button)` and `CF.fx.pulse(badge)`: draw the eye until `off()`.
- `CF.fx.typewriter(root.querySelector(".cf-vn-text"), line).done.then(showChoices)`: types the line; a tap shows the rest.
- `CF.fx.countUp(goldEl, gold, { from: gold - change })`: money and scores rolling to their new value.
- `CF.fx.transition(body, html, "left")`: page and tab changes ("fade", "left", "right", "up"). Kit tabs fade between panels by themselves.
- `CF.fx.parallax(scene)`: children with `data-depth="0.2"` (far) to `"1"` (near) drift with the pointer or the phone's tilt.
- `CF.fx.reduced(root)`: true when motion should be cut; check it before animating anything yourself (`el.animate`, `requestAnimationFrame`).

Keep effects few and meaningful: one weather layer, a shake when something hits, a count-up when money changes. The lint warns when a module animates layout (width, height, top, left, margin) or animates from script without checking `CF.fx.reduced`.

Examples: `read_example("vn-scene")` (a dialogue box with a typed line, weather and a shake) and `read_example("journey-app")` (a map with pins, a carousel, flip cards, a timeline, a ring, a drawer, a toast, a count-up and page transitions).

Kit classes for your own markup: `cf-card`, `cf-stack` (vertical gap), `cf-row` (horizontal gap), `cf-spread` (space between), `cf-muted`, `cf-small`, `cf-label`, `cf-btn` (`primary`, `ghost`), `cf-input`, `cf-chip`, `cf-grid`/`cf-stat`, `cf-list`/`cf-item`, `cf-app`/`cf-appbar`/`cf-appbody` (app shell), `cf-bubbles`/`cf-bubble`.

## Cutscenes (CF.scene)

Small cutscenes for title screens, chapter cards, a boss entrance or a level up: `CF.scene.play(root, steps, options)` plays a list of steps in order and returns `{ done, skip, stop }`.

```js
var scene = CF.scene.play(root, [
  { bg: "Harbor", time: app.state("Time.PartOfDay") },
  { title: "Chapter II", sub: "The Drowned Crown" },
  { show: "Captain Varn", side: "right", emotion: "angry" },
  { fx: "shake" },
  { say: "You shouldn't have come back.", who: "Captain Varn" },
  { choice: [{ label: "Apologise", value: "sorry" }, { label: "Draw your sword", send: "duel", payload: {}, text: "I draw my sword." }] },
], { fill: true, once: "chapter-2" });
scene.done.then(function (r) { if (r.choice && r.choice.value === "sorry") app.write("I'm sorry.", { now: false }); });
```

- **Steps** are plain data (the SceneStep type): `bg` fades a background in (the card's art for that place and time from `CF.assets.background`, else a sky for `time`, else the theme's gradient), `show` and `hide` slide a character in and out (their portrait for the emotion, else their initial), `say` types a line in the dialogue box and waits for a tap (or `auto` ms), `title` is a chapter card, `fx` shakes, flashes or sets weather and particles, `wait` is a beat in ms or until a tap, `choice` shows buttons and waits, `clear` empties the dialogue (`"all"` also the stage).
- **The player stays in charge:** a tap finishes the line being typed, the next tap moves on, Skip (or Escape) jumps to the end, stopping only at a choice. With less motion everything appears without moving.
- **Options:** `fill` covers the screen (`root`) instead of making a block of its own (about 80% of the screen's height); `once: "key"` plays it only the first time in this chat (`done` resolves with `seen: true` after that); `keep` leaves the last frame on screen; `skippable: false` hides Skip (only for very short scenes).
- **Results:** `done` resolves with `{ skipped, stopped, seen, choice, choices }`. A choice with `send`, `payload` and `text` also writes its action in the input box, like any kit button; otherwise act on `choice.value` yourself.
- **Keep scenes as data** in the module's settings (`settings.scenes = { intro: [...] }`) and play `settings.scenes.intro`: the user can edit the words in the module's settings, and the lint checks every step (`CF.scene.check(steps)` does the same at run time).
- Play a scene on a change, not on every redraw: a chapter card when `app.delta()["Story.Chapter"]` is there, a level-up burst when the level rises, an intro with `once`.

Examples: `read_example("prologue")` (a hub screen whose intro plays once, with a choice) and `read_example("chapter-card")` (an inline block that plays a chapter card when the chapter changes).

## Procedural art (CF.art)

Pictures drawn in code, for screens that need no image or until the art exists. The same seed always draws the same picture, so a place's map or a house's crest stays the same every reply. Nothing moves, so there is nothing to cut for less motion.

Inline pieces are HTML strings, like `CF.ui`, drawn with the theme's colours and the kit's classes:
- `CF.art.chart("bar", [{ label: "Strength", value: 14 }, …], { max: 20 })`: one row per item, so long labels fit a phone. `"line"` for a value over time, `"spark"` for a tiny trend inside a line of text, `"donut"` with a legend and `{ center: "28" }`, `"radar"` for a character's stats (five to eight axes). Numbers work as data too. Each has an `aria-label` that reads the values.
- `CF.art.gauge({ value: 12, max: 100, label: "Fuel", unit: "%", danger: 0.25 })`: a dial with ticks and a needle; below the danger fraction it turns `--cf-bad`.
- `CF.art.frame(html, { kind: "ornate", title: "Chapter I" })`: a card with drawn corners: `"ornate"` (fantasy), `"tech"` (clipped corners, a HUD), `"sketch"` (hand-drawn).
- `CF.art.divider("flourish")`: an ornamental rule between sections (`"diamond"`, `"circuit"`, `"line"`).
- `CF.art.sigil("House Varn", { size: 48 })`: an emblem from a name, for factions, houses and guilds, or as a portrait's fallback.

Images are data URLs or CSS `url('…')` values with their own colours (a picture can't read the theme: pass `color` or a `palette`, or read one with `CF.art.themeColor("accent", root)`). They have no double quotes, so they fit in a `style="…"` attribute:
- `CF.ui.map({ image: CF.art.mapImage({ kind: "island", seed: "Saltreach", places: PLACES, palette: "parchment" }), pins: PLACES.map(…) })`: a whole map with coast, hills, trees, roads between the places and a compass. `"dungeon"` draws a room at each place joined by halls; `"city"` draws blocks, a river and a plaza at each place. Give the same `{ x, y }` in % to the map and the pins, so they line up. Palettes: parchment, sea, night, neon, stone.
- `background: CF.art.pattern("hex", { color: "rgba(46,242,255,.15)", size: 20 })`: dots, grid, stripes, checks, diamonds, waves, crosshatch or hex.
- `background: CF.art.noiseTexture({ scale: 0.8, opacity: 0.12 })`: film grain (high scale) to fog and clouds (scale 0.02).
- `background: CF.art.sky(app.state("Time.PartOfDay"))`: dawn, day, dusk or a starry night, from a word or a clock time: the fallback under `CF.assets.background`.
- `CF.art.noiseImage({ seed: "nebula", from: "#101828", to: "#8fa6d6" })`: coloured clouds drawn on a canvas, as a PNG.

For your own drawing: `CF.art.canvas(el, { height: 160 })` gives a canvas sized for the phone's pixel density, `CF.art.rng(seed)` seeded randomness, `CF.art.noise(seed)` smooth noise, and `CF.art.dataUrl(svg)` / `CF.art.url(svg)` turn your own SVG into an image or a background.

Examples: `read_example("world-map")` (a procedural island with pins, crests and a sky) and `read_example("stat-chart")` (a panel section with a radar of stats, a gauge and a trend line).

## Theme variables

Use these in your CSS instead of fixed colours, so the screen follows the card theme, light or dark mode and the player's accent:

`--cf-bg`, `--cf-surface`, `--cf-surface2`, `--cf-text`, `--cf-muted`, `--cf-accent`, `--cf-accent2`, `--cf-border`, `--cf-good`, `--cf-bad`, `--cf-radius`, `--cf-font`, `--cf-heading`, `--cf-texture`, `--cf-shadow`, and `--cf-scale` (the player's text size; the kit's `.cf` font size already uses it).

```css
.shop-item { background: var(--cf-surface2); border: 1px solid var(--cf-border); border-radius: var(--cf-radius); }
.shop-price { color: var(--cf-accent); font-family: var(--cf-heading); }
```

## The card-script part

A module's `script` file runs once when the chat opens, inside the card's Tavern Helper script, as the body of `function (CF, settings, hooks) { … }`. Tavern Helper's functions are globals there (`getVariables`, `injectPrompts`, `eventOn`, `generate`…).

`hooks.afterUpdate(function (stat, before, info) { … return stat; })` runs after every update the model writes, and on the starting values (with `before` null). `info.messageId` is the message being updated, `info.role` is "user" or "assistant" (the player's own messages get a state too, so count turns on the assistant's), and `info.latest` is true when it is the newest one: only then show banners or start side calls, since older messages are updated again on a swipe or an edit. Change `stat` and return it to keep derived values consistent: roll a counter over, clamp a total, work out a label from a number. The in-game time module does its day roll, weekday and timers this way. Keep hooks quick and never throw: a failing hook is logged and skipped.

## Card images

`app.asset("mina_happy.png")` gives the address SillyTavern serves a card's CHARX image from. In the CardForge sandbox there are no images; draw a fallback (the avatar's letter, a gradient) when an image fails to load.
