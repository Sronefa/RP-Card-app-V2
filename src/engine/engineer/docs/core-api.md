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
}

interface CardForge {
  version: string;
  ui: UiKit;
  /** Sets a screen up in a window: theme, kit, delegated controls, and an App bound to its message. */
  frame(win: Window, options?: { messageId?: number | "latest" }): App;
  /** Mounts a module's screen into an element (default: the page's #cf-root). */
  mount(win: Window, moduleId: string, root?: Element, options?: { app?: App }): App | null;
  /** Mounts every module of a slot under `el`, one <section class="cf-slot"> each. */
  mountSlot(win: Window, slot: "panel" | "overlay" | "message", el: Element, options?: { app?: App }): App;
  /** Opens a hub screen over the chat. "status" opens the status panel full size. */
  open(moduleId: string): HTMLIFrameElement;
  close(): void;
  /** A card image by file name: /user/images/<character>/<file>. */
  asset(file: string): string;
  settings(): Settings;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** The theme as a :root { --cf-… } rule, for the current settings. */
  themeCss(settings?: Settings): string;
  /** The card's enabled modules. */
  modules(): { id: string; name: string; slot: string; button: string }[];
  state: {
    /** The state at a message (default: the latest), or one value by path. */
    get(path?: string, messageId?: number | "latest"): any;
    /** The latest message id with a game state, or -1. */
    latestId(): number;
    /** The player changes a value on the latest state. Logged in _PlayerEdits so the AI keeps it. */
    set(path: string | string[], value: any, note?: string): Promise<any>;
    /** Every value back to the start, on the latest state. */
    reset(): Promise<void>;
  };
  act: {
    /** Writes `<action app="…">payload</action>` (+ text) into SillyTavern's input box; with now, sends it. */
    send(app: string, payload?: any, text?: string, options?: { now?: boolean }): Promise<string>;
    /** The same line, without writing it anywhere. */
    text(app: string, payload?: any, text?: string): string;
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
  /** The state at this screen's message (the latest for hub screens), or one value by path. */
  state(path?: string): any;
  /** What changed in this screen's message. */
  delta(): Delta;
  set(path: string | string[], value: any, note?: string): Promise<any>;
  send(app: string, payload?: any, text?: string, options?: { now?: boolean }): Promise<string>;
  open(moduleId: string): void;
  close(): void;
  /** Runs fn after updates, swipes, deletions and the player's edits. */
  onState(fn: () => void): void;
  on(name: string, fn: (detail: any) => void): void;
  emit(name: string, detail?: any): Promise<void>;
  toast(text: string): void;
  /** A modal over this screen; returns its backdrop element (remove() closes it). */
  modal(html: string): HTMLElement;
  /** A router for app-like screens. Routes are functions (params, app) => HTML string. */
  router(root: Element, routes: Record<string, (params: any, app: App) => string | void>, start: string, params?: any): { go(name: string, params?: any): void; back(): boolean };
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
}

type IconName = "heart" | "star" | "coin" | "clock" | "sun" | "moon" | "cloud" | "rain" | "snow" | "fog" | "storm" | "gear" | "back" | "close" | "phone" | "bag" | "map" | "chat" | "user" | "chart" | "calendar";
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

`CF.state.reset()` puts every value back to the start, as the settings app's "Back to the start" does.

## Sending actions

`app.send("shop", { buy: "rope", price: 5 }, "I buy the rope.")` writes this into the input box:

```
<action app="shop">{"buy":"rope","price":5}</action>
I buy the rope.
```

The player can add words and send it. With `{ now: true }` it is sent at once. The engine's regex shows the action as a short line (`⟶ shop`) and keeps old ones out of the prompt. Tell the model in a lorebook rule what each action means (see the RP guide).

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

`data-cf-back` buttons (the app bar's back arrow) go back one page, and close the screen on the first page.

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
- `CF.ui.icon("coin")`: an inline SVG icon from the set: heart, star, coin, clock, sun, moon, cloud, rain, snow, fog, storm, gear, back, close, phone, bag, map, chat, user, chart, calendar.
- `app.toast("Saved")`: a short message at the top.
- `app.modal('<h2>Sure?</h2><button class="cf-btn" data-cf-close>Close</button>')`: a dialog; `data-cf-close` inside it closes it.

Kit classes for your own markup: `cf-card`, `cf-stack` (vertical gap), `cf-row` (horizontal gap), `cf-spread` (space between), `cf-muted`, `cf-small`, `cf-label`, `cf-btn` (`primary`, `ghost`), `cf-input`, `cf-chip`, `cf-grid`/`cf-stat`, `cf-list`/`cf-item`, `cf-app`/`cf-appbar`/`cf-appbody` (app shell), `cf-bubbles`/`cf-bubble`.

## Theme variables

Use these in your CSS instead of fixed colours, so the screen follows the card theme, light or dark mode and the player's accent:

`--cf-bg`, `--cf-surface`, `--cf-surface2`, `--cf-text`, `--cf-muted`, `--cf-accent`, `--cf-accent2`, `--cf-border`, `--cf-good`, `--cf-bad`, `--cf-radius`, `--cf-font`, `--cf-heading`, `--cf-texture`, `--cf-shadow`, and `--cf-scale` (the player's text size; the kit's `.cf` font size already uses it).

```css
.shop-item { background: var(--cf-surface2); border: 1px solid var(--cf-border); border-radius: var(--cf-radius); }
.shop-price { color: var(--cf-accent); font-family: var(--cf-heading); }
```

## The card-script part

A module's `script` file runs once when the chat opens, inside the card's Tavern Helper script, as the body of `function (CF, settings, hooks) { … }`. Tavern Helper's functions are globals there (`getVariables`, `injectPrompts`, `eventOn`, `generate`…).

`hooks.afterUpdate(function (stat, before, info) { … return stat; })` runs after every update the model writes, and on the starting values (with `before` null). Change `stat` and return it to keep derived values consistent: roll a counter over, clamp a total, work out a label from a number. The in-game time module does its day roll, weekday and timers this way. Keep hooks quick and never throw: a failing hook is logged and skipped.

## Card images

`app.asset("mina_happy.png")` gives the address SillyTavern serves a card's CHARX image from. In the CardForge sandbox there are no images; draw a fallback (the avatar's letter, a gradient) when an image fails to load.
