# How SillyTavern shows engine screens

## Messages and the status panel

1. The model's reply is saved as text. The engine adds a `<StatusPlaceHolderImpl/>` tag at its end.
2. When SillyTavern displays a message, it runs the regex scripts marked for display. The engine's regex hides the `<UpdateVariable>` block and turns the placeholder into a fenced code block that holds the status panel's whole HTML document.
3. SillyTavern turns the message into HTML with its markdown renderer.
4. Tavern Helper finds code blocks that hold a full HTML document (`<html>` or `<!DOCTYPE html>`) and replaces each with an iframe (class `TH-render`) that runs it. The iframe grows to fit its content.

So a panel or inline block is always a full HTML document of its own, running in its own iframe on SillyTavern's origin. The engine core gives it the card theme and the kit.

## Rules for HTML that goes through regex

The status panel and inline blocks travel inside a regex replacement. SillyTavern reads some sequences there specially. CardForge writes these documents for you, but the same rules matter for any `replace` text you write yourself:

- `$1`, `$2`… and `$<name>` are capture groups. A literal dollar sign before a digit gets replaced. Write `$` in JavaScript strings instead.
- `{{` starts a SillyTavern macro (`{{char}}`, `{{user}}`). Avoid it in code.
- Tavern Helper reads a code block's text, which decodes HTML entities. `&lt;` becomes `<`. Don't rely on entities inside scripts.
- Markdown runs before Tavern Helper, but a fenced code block is left alone. HTML outside code blocks is cleaned by SillyTavern (scripts and many attributes removed). Always put interactive HTML in a full document inside a code block, the way the engine does.

Module screens (`html`, `css`, `js`) are mounted by the engine core, not pasted through regex, so they don't have these limits. Just never write a literal `</script` in them: the card script itself sits inside a script element.

## Where code runs

- **The card script** runs in a hidden iframe on SillyTavern's page when a chat with the card opens, and stops when the chat closes. This is where the updater, the engine core and each module's `script` part live.
- **Message iframes** (status panel, inline blocks) run per message. SillyTavern rebuilds them when the message is displayed again: after a swipe, an edit, or scrolling back into a long chat. Don't keep state in them; read it from the game state.
- **Hub screens** run in an overlay iframe that the core adds to SillyTavern's page. It goes away when closed.

All of them share SillyTavern's origin. A screen can reach `window.parent` (SillyTavern's window), but don't change SillyTavern's own page beyond what the core does.

## Swipes, edits and deletions

- A swipe asks for a new reply to the same message. The new swipe starts from the previous message's state, and its update block is applied to that.
- An edit re-runs the update for that message.
- Deleting messages leaves the earlier ones' states as they were.
- Each message keeps its own state, so a panel under an old message shows the values as they were then.

## The input box and buttons

- `#send_textarea` is SillyTavern's input box and `#send_but` its send button. `app.send` writes to them.
- Hub buttons are Tavern Helper script buttons. They show above the input box (in TauriTavern and SillyTavern 1.16).

## Card images (CHARX)

Images packed in a CHARX card are unpacked when the card is imported, to `/user/images/<character name>/<file>`. `app.asset("file.png")` builds that address. Images can't come from anywhere else; there's no internet in the sandbox and often none on the player's phone.

## Phones

Most players are on phones (TauriTavern on Android). Message iframes are as wide as the chat column, often about 340 to 390 CSS pixels. Hub screens fill the phone's screen minus a 12px margin, up to 460px wide and 780px tall. Test at phone width first.
