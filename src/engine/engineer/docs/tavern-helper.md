# Tavern Helper and MVU

Engine cards run on the Tavern Helper extension (JS-Slash-Runner, version 4.11), in SillyTavern 1.16 or TauriTavern. Tavern Helper runs card scripts in hidden iframes, renders HTML code blocks in messages as iframes, and gives both a set of global functions. The engine core wraps the ones screens need. Prefer the core (`app.state`, `app.set`, `app.send`) over raw Tavern Helper calls. Use the functions below in a module's card-script part, or when the core has no wrapper.

## Variables

Tavern Helper keeps variables at several levels. The `type` option picks the level:

- `{ type: "message", message_id: 5 }`: variables of one message (its current swipe). The game state lives here.
- `{ type: "chat" }`: one chat. The engine keeps the player's settings here under `cardforge.settings`.
- `{ type: "character" }`, `{ type: "global" }` and `{ type: "script" }` are also available.

```js
getVariables({ type: "message", message_id: getLastMessageId() });           // → { stat_data, delta_data, … }
await updateVariablesWith(function (v) { v.flag = true; return v; }, { type: "chat" });
await insertOrAssignVariables({ seen_intro: true }, { type: "chat" });
replaceVariables(object, option);                                            // replaces all of that level
```

`message_id` takes negative numbers from the end (-1 is the last message) and `"latest"`.

## MVU format (the game state)

The engine stores the game state the way MagVarUpdate (MVU) does, so MVU tools and Tavern Helper's variable manager can read it:

- `stat_data`: the state itself, e.g. `{ Player: { Health: 80, Gold: 12 }, Time: { Day: 1, Clock: "08:00" } }`.
- `delta_data`: what the latest update changed, keyed by dotted path: `{ "Player.Gold": [12, 10] }`.
- Keys starting with `_` are read-only for the model; keys starting with `$` are hidden from it.

Each message has its own copy, and each swipe has its own too. A swipe or an edit starts from the previous message's state, so the state always matches the story on screen.

## The update block

The model ends each reply with:

```
<UpdateVariable>
<Analysis>Mina paid for the drinks: Gold −2.</Analysis>
<JSONPatch>
[
  { "op": "delta", "path": "/Player/Gold", "value": -2 },
  { "op": "replace", "path": "/Time/Clock", "value": "21:30" },
  { "op": "insert", "path": "/Player/Items/-", "value": "Map" },
  { "op": "remove", "path": "/Player/Items/0" },
  { "op": "move", "from": "/Quests/Active/0", "path": "/Quests/Done/-" }
]
</JSONPatch>
</UpdateVariable>
```

The ops are: `replace` (set a value), `delta` (add to a number), `insert` (also `add`; `/-` appends to a list, and a new key creates it), `remove` and `move`. The updater refuses writes to `_` values, checks every value against the schema (clamps numbers, repairs types), and skips what it can't apply. The CardForge sandbox shows skipped ops. Regex hides the block from the player and drops old blocks from the prompt.

## Events

```js
eventOn(tavern_events.MESSAGE_RECEIVED, function (id) { … });   // a reply arrived (also after a swipe)
eventOn(tavern_events.MESSAGE_SWIPED, function (id) { … });
eventOn(tavern_events.MESSAGE_EDITED, function (id) { … });
eventOn(tavern_events.MESSAGE_DELETED, function (count) { … });
eventOn(tavern_events.CHAT_CHANGED, function (name) { … });
eventOn("mag_variable_update_ended", function (data, before) { … }); // MVU: after each update; data.stat_data, before.stat_data
eventOnce(name, fn); eventEmit(name, …args); eventRemoveListener(name, fn);
```

Screens use `app.onState(fn)` instead. It covers updates, swipes, deletions and the player's edits, and its listeners go away with the screen.

## Prompts and lore

```js
injectPrompts([{ id: "my-module", position: "in_chat", depth: 1, role: "system", content: "…", should_scan: false }]);
uninjectPrompts(["my-module"]);
```

An injected prompt with the same id replaces the last one. `position: "none"` with `should_scan: true` adds words to the lorebook scan without sending them. The time module uses this, so entries keyed on "night" or "winter" turn on by themselves.

## Side calls (background generations)

```js
var text = await generate({ user_input: "Write Mina's next text message to {{user}}, one line.", should_silence: true });
var raw = await generateRaw({ ordered_prompts: [{ role: "system", content: "…" }, "chat_history"], should_silence: true });
```

These calls cost the player tokens. Only make them when `CF.settings().sideCalls` is true, and give the screen something sensible to show when they're off. In the CardForge sandbox, `generate` returns a placeholder line; Playtest runs it for real.

## Other functions

- `getChatMessages(range)`, `setChatMessages(changes)`, `getLastMessageId()` and `getCurrentMessageId()` (in a message iframe: the message it is in).
- `triggerSlash("/echo hi")` runs STscript.
- `toastr.success(text)`, `toastr.warning`, `toastr.error`.
- `replaceScriptButtons`, `eventOnButton`: the engine already uses these for the hub buttons, so don't call them from a module.
- `errorCatched(fn)` wraps a function so its errors show as toasts.

The engine core reaches SillyTavern's page as `window.parent` from the card script. A screen reaches the core as `window.CardForge || window.parent.CardForge`, but mounted modules get it as `CF` and never need to look.
