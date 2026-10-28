// CardForge sandbox: a small stand-in for SillyTavern with Tavern Helper, run inside a sandboxed
// iframe that can't reach the network.
//
// It keeps a chat the way SillyTavern does (messages with swipes, variables per swipe), renders it
// with the card's regex and Tavern Helper's rule for frontends (a code block holding an HTML
// document becomes an iframe), and runs the card's Tavern Helper scripts in hidden iframes. Every
// iframe gets the Tavern Helper functions, bound to that iframe, under the same names and with the
// same behaviour as the real ones, so code that runs here runs in SillyTavern.
//
// It reports to CardForge (the parent window) by postMessage: the chat and its variables, the
// action log, and errors. CardForge drives it with commands: send, reply, swipe, edit, rewind,
// set variables, run a scenario.
//
// Reads `CF_SANDBOX` (the card, written by CardForge) and `CF_LIBS` (jQuery and Vue sources).
// Never write the closing script tag literally in this file: it is inlined in a script element.
(function () {
  "use strict";
  var config = window.CF_SANDBOX;
  var card = config.card;
  var USER = config.user || "You";
  var CHAR = card.name || "Character";
  var ST_VERSION = "1.16.0";

  // ---------------------------------------------------------------- reporting to CardForge

  function post(message) {
    try {
      window.parent.postMessage({ cfSandbox: JSON.parse(JSON.stringify(message)) }, "*");
    } catch (e) {
      window.parent.postMessage({ cfSandbox: { kind: "log", source: "sandbox", action: "unreportable", detail: String(e) } }, "*");
    }
  }

  function short(value) {
    var text;
    try {
      text = typeof value === "string" ? value : JSON.stringify(value);
    } catch (e) {
      text = String(value);
    }
    return text && text.length > 400 ? text.slice(0, 400) + "…" : text;
  }

  function log(source, action, detail) {
    post({ kind: "log", source: source, action: action, detail: detail === undefined ? "" : short(detail) });
  }

  /** Frames by window, with their name and source, for error reports and cleanup. */
  var frames = [];
  function frameOf(win) {
    for (var i = 0; i < frames.length; i++) if (frames[i].win === win) return frames[i];
    return null;
  }
  function sourceName(win) {
    if (!win || win === window) return "sandbox";
    var frame = frameOf(win);
    return frame ? frame.name : "iframe";
  }

  function reportError(win, message, line, column, stack) {
    var frame = frameOf(win);
    var code = "";
    if (frame && line) code = (frame.source.split("\n")[line - 1] || "").trim().slice(0, 300);
    post({
      kind: "error",
      source: sourceName(win),
      message: String(message),
      line: line || 0,
      column: column || 0,
      code: code,
      stack: stack ? String(stack).split("\n").slice(0, 6).join("\n") : "",
    });
  }

  /** The chat as CardForge sees it: each message with its current swipe's variables. */
  function chatSnapshot() {
    return {
      chat: chat.map(function (m, i) {
        return {
          id: i,
          role: roleOf(m),
          name: m.name,
          message: m.mes,
          swipe_id: m.swipe_id || 0,
          swipes: (m.swipes || [m.mes]).length,
          variables: (m.variables || [])[m.swipe_id || 0] || {},
        };
      }),
      injected: Object.keys(injected).map(function (id) { return injected[id]; }),
    };
  }

  var stateQueued = false;
  function postState() {
    if (stateQueued) return;
    stateQueued = true;
    setTimeout(function () {
      stateQueued = false;
      var now = chatSnapshot();
      post({ kind: "state", chat: now.chat, injected: now.injected, chatVariables: chatVariables, schema: Object.keys(schemas) });
    }, 0);
  }

  // ---------------------------------------------------------------- chat model (SillyTavern's shape)

  var chat = [];
  /** Prompts the card's scripts injected, by id (Tavern Helper's injectPrompts). */
  var injected = {};

  // ---------------------------------------------------------------- playtest: generations by CardForge

  // In a playtest, CardForge answers with a real model: replies to the player's messages, and the
  // card's own generate and generateRaw calls (side calls).
  var PLAYTEST = !!config.playtest;
  var asked = {};
  var askedCount = 0;
  function askCardForge(purpose, options) {
    return new Promise(function (resolve, reject) {
      var id = ++askedCount;
      asked[id] = { resolve: resolve, reject: reject };
      var now = chatSnapshot();
      post({ kind: "generate", requestId: id, purpose: purpose, options: options || {}, chat: now.chat, injected: now.injected });
    });
  }
  function answered(command) {
    var waiting = asked[command.requestId];
    if (!waiting) return;
    delete asked[command.requestId];
    if (command.error) waiting.reject(new Error(command.error));
    else waiting.resolve(command.text || "");
  }

  /** The reply being written, shown as it streams in. */
  function typing(text) {
    var bubble = document.getElementById("cf-typing");
    if (text === null || text === undefined) {
      if (bubble) bubble.remove();
      return;
    }
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.id = "cf-typing";
      bubble.className = "mes";
      bubble.innerHTML = '<div class="mes_avatar"></div><div class="mes_block"><div class="ch_name"></div><div class="mes_text"></div></div>';
      bubble.querySelector(".mes_avatar").textContent = CHAR.charAt(0).toUpperCase();
      bubble.querySelector(".ch_name").textContent = CHAR;
      chatElement.appendChild(bubble);
    }
    bubble.querySelector(".mes_text").textContent = text || "…";
    chatElement.scrollTop = chatElement.scrollHeight;
  }

  var chatVariables = {};
  var characterVariables = {};
  var globalVariables = {};
  var scriptVariables = {};
  var schemas = {};
  var globals = {};

  function roleOf(m) {
    return m.is_user ? "user" : m.is_system ? "system" : "assistant";
  }

  function newMessage(role, text, name) {
    return {
      name: name || (role === "user" ? USER : role === "system" ? "System" : CHAR),
      is_user: role === "user",
      is_system: role === "system",
      mes: text,
      swipes: [text],
      swipe_id: 0,
      variables: [{}],
      extra: {},
      data: {},
    };
  }

  function setText(m, text) {
    m.mes = text;
    if (!m.swipes) m.swipes = [text];
    m.swipes[m.swipe_id || 0] = text;
  }

  function messageIndex(id) {
    var n = Number(id);
    if (!Number.isInteger(n)) throw new Error("Message id must be a whole number, got '" + id + "'.");
    if (n < 0) n += chat.length;
    if (n < 0 || n >= chat.length) throw new Error("Message " + id + " is outside [" + -chat.length + ", " + chat.length + ").");
    return n;
  }

  function varsOf(m) {
    if (!m.variables) m.variables = [];
    var swipe = m.swipe_id || 0;
    if (!m.variables[swipe]) m.variables[swipe] = {};
    return m.variables[swipe];
  }

  function clone(value) {
    return value === undefined ? undefined : _.cloneDeep(value);
  }

  // ---------------------------------------------------------------- events (SillyTavern's eventSource)

  var tavern_events = {
    APP_READY: "app_ready",
    MESSAGE_SWIPED: "message_swiped",
    MESSAGE_SENT: "message_sent",
    MESSAGE_RECEIVED: "message_received",
    MESSAGE_EDITED: "message_edited",
    MESSAGE_DELETED: "message_deleted",
    MESSAGE_UPDATED: "message_updated",
    CHAT_CHANGED: "chat_id_changed",
    GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
    GENERATION_STARTED: "generation_started",
    GENERATION_STOPPED: "generation_stopped",
    GENERATION_ENDED: "generation_ended",
    USER_MESSAGE_RENDERED: "user_message_rendered",
    CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
    CHARACTER_FIRST_MESSAGE_SELECTED: "character_first_message_selected",
    WORLD_INFO_ACTIVATED: "world_info_activated",
    STREAM_TOKEN_RECEIVED: "stream_token_received",
    CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
    SETTINGS_UPDATED: "settings_updated",
  };
  var iframe_events = {
    MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
    MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
    GENERATION_REQUESTED: "js_generation_requested",
    GENERATION_STARTED: "js_generation_started",
    STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
    STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
    GENERATION_ENDED: "js_generation_ended",
  };

  /** listeners[event] = [{ fn, win, once }] */
  var listeners = {};

  function on(win, event, fn, once, first) {
    if (typeof fn !== "function") throw new TypeError("eventOn needs a function for '" + event + "'.");
    var list = (listeners[event] = listeners[event] || []);
    if (list.some(function (l) { return l.fn === fn; })) return;
    var entry = { fn: fn, win: win, once: !!once };
    if (first) list.unshift(entry);
    else list.push(entry);
  }

  function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (l) { return l.fn !== fn; });
  }

  /** Calls each listener in turn and waits for it, as SillyTavern's eventSource.emit does. */
  async function emit(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (listeners[event] || []).slice();
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (l.once) off(event, l.fn);
      try {
        await l.fn.apply(null, args);
      } catch (e) {
        reportError(l.win, "Listener for '" + event + "' failed: " + (e && e.message ? e.message : e), 0, 0, e && e.stack);
      }
    }
  }

  function clearFrameListeners(win) {
    Object.keys(listeners).forEach(function (event) {
      listeners[event] = listeners[event].filter(function (l) { return l.win !== win; });
    });
  }

  // ---------------------------------------------------------------- the card's worldbook and regex

  function substitute(text) {
    return String(text)
      .replace(/\{\{char\}\}/gi, CHAR)
      .replace(/\{\{user\}\}/gi, USER)
      .replace(/<USER>/g, USER)
      .replace(/<BOT>/g, CHAR);
  }

  function parseRegex(source) {
    var match = /^\/([\s\S]*)\/([a-z]*)$/.exec(source || "");
    try {
      return match ? new RegExp(match[1], match[2]) : new RegExp(source, "g");
    } catch (e) {
      return null;
    }
  }

  /** Display-side regex, as SillyTavern runs it on a message before markdown. */
  function runRegex(text, message, depth) {
    (card.regex || []).forEach(function (script) {
      if (script.disabled || script.promptOnly) return;
      var placement = script.placement || [];
      if (placement.indexOf(message.is_user ? 1 : 2) < 0) return;
      if (typeof script.minDepth === "number" && script.minDepth >= 0 && depth < script.minDepth) return;
      if (typeof script.maxDepth === "number" && script.maxDepth >= 0 && depth > script.maxDepth) return;
      var re = parseRegex(script.findRegex);
      if (!re) return;
      text = text.replace(re, function () {
        var args = Array.prototype.slice.call(arguments);
        var named = typeof args[args.length - 1] === "object" ? args.pop() : null;
        var groups = args.slice(0, -2);
        var out = String(script.replaceString || "")
          .replace(/\{\{match\}\}/gi, groups[0])
          .replace(/\$(\d+)|\$<([^>]+)>/g, function (all, n, name) {
            var value = n !== undefined ? groups[Number(n)] : named ? named[name] : "";
            return value === undefined ? "" : value;
          });
        (script.trimStrings || []).forEach(function (t) {
          if (t) out = out.split(substitute(t)).join("");
        });
        return substitute(out);
      });
    });
    return text;
  }

  function worldbookEntries() {
    return (card.book || []).map(function (e, i) {
      return {
        uid: i,
        name: e.comment || "",
        enabled: e.enabled !== false,
        strategy: { type: e.constant ? "constant" : "selective", keys: e.keys || [], keys_secondary: { logic: "and_any", keys: e.secondary_keys || [] }, scan_depth: "same_as_global" },
        position: { type: "at_depth", role: "system", depth: e.depth == null ? 4 : e.depth, order: e.insertion_order || 100 },
        content: e.content || "",
        probability: 100,
        recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
        extra: {},
      };
    });
  }

  // ---------------------------------------------------------------- rendering (SillyTavern + Tavern Helper)

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /** Tavern Helper's rule: a code block holding an HTML document is a frontend, shown in an iframe. */
  function isFrontend(text) {
    return ["html>", "<head>", "<body"].some(function (tag) { return text.indexOf(tag) >= 0; });
  }

  /** SillyTavern sanitizes message HTML: no scripts, no inline handlers, no iframes of its own. */
  function sanitize(root) {
    root.querySelectorAll("script, iframe, object, embed, link, meta, base").forEach(function (el) { el.remove(); });
    root.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
  }

  /** The small part of SillyTavern's markdown that changes how a reply looks: emphasis and quotes. */
  function markdown(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (node.parentElement && node.parentElement.closest("pre, code, style, textarea")) return;
      var html = escapeHtml(node.nodeValue)
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
        .replace(/(^|[\s(>])(&quot;|"|“)([^"”\n]+)("|”|&quot;)/g, '$1<q>$2$3$4</q>')
        .replace(/\n/g, "<br>");
      if (html === escapeHtml(node.nodeValue)) return;
      var span = document.createElement("span");
      span.innerHTML = html;
      node.replaceWith.apply(node, Array.prototype.slice.call(span.childNodes));
    });
  }

  function messageFrames(id) {
    return frames.filter(function (f) { return f.messageId === id; });
  }

  function dropFrame(frame) {
    try {
      frame.win.dispatchEvent(new Event("pagehide"));
    } catch (e) {}
    clearFrameListeners(frame.win);
    frames.splice(frames.indexOf(frame), 1);
    if (frame.element && frame.element.parentNode) frame.element.remove();
  }

  var chatElement;

  function renderMessage(id) {
    var m = chat[id];
    var block = chatElement.querySelector('.mes[mesid="' + id + '"]');
    messageFrames(id).forEach(dropFrame);
    if (!block) {
      block = document.createElement("div");
      block.className = "mes";
      block.setAttribute("mesid", String(id));
      block.innerHTML =
        '<div class="mes_avatar"></div><div class="mes_block"><div class="ch_name"><span class="name_text"></span><small class="mesIDDisplay"></small><span class="swipes-counter"></span></div><div class="mes_text"></div></div>';
      chatElement.appendChild(block);
    }
    block.classList.toggle("is_user", !!m.is_user);
    block.setAttribute("is_user", String(!!m.is_user));
    block.querySelector(".mes_avatar").textContent = (m.name || "?").slice(0, 1).toUpperCase();
    block.querySelector(".name_text").textContent = m.name;
    block.querySelector(".mesIDDisplay").textContent = "#" + id;
    var swipes = (m.swipes || []).length;
    block.querySelector(".swipes-counter").textContent = swipes > 1 ? (m.swipe_id || 0) + 1 + "/" + swipes : "";
    var textElement = block.querySelector(".mes_text");
    textElement.innerHTML = formatMessage(id);
    textElement.querySelectorAll("pre[data-frontend]").forEach(function (pre, n) {
      mountMessageFrame(id, n, pre);
    });
  }

  /** The message as SillyTavern would display it, frontends left as marked code blocks. */
  function formatMessage(id) {
    var m = chat[id];
    var depth = chat.length - 1 - id;
    var text = runRegex(substitute(m.mes || ""), m, depth);
    var parts = text.split(/(```[^\n`]*\n[\s\S]*?```)/g);
    var holder = document.createElement("div");
    var frontends = [];
    holder.innerHTML = parts
      .map(function (part) {
        var fence = /^```[^\n`]*\n([\s\S]*?)```$/.exec(part);
        if (!fence) return part;
        if (isFrontend(fence[1])) {
          frontends.push(fence[1]);
          return '<pre data-frontend="' + (frontends.length - 1) + '"></pre>';
        }
        return "<pre><code>" + escapeHtml(fence[1]) + "</code></pre>";
      })
      .join("");
    sanitize(holder);
    markdown(holder);
    holder.querySelectorAll("pre[data-frontend]").forEach(function (pre) {
      pre.textContent = frontends[Number(pre.getAttribute("data-frontend"))];
    });
    return holder.innerHTML;
  }

  /** min-height in vh would grow an auto-height iframe forever; Tavern Helper maps it to the chat's height. */
  function fixViewportHeight(content) {
    return content.replace(/(min-height\s*:\s*)(\d+(?:\.\d+)?)vh/gi, function (all, prefix, value) {
      return prefix + "calc(var(--TH-viewport-height) * " + Number(value) / 100 + ")";
    });
  }

  var FRAME_HEAD =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    "<style>*,*::before,*::after{box-sizing:border-box;}html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}</style>";

  function frameDocument(kind, body) {
    return (
      "<!DOCTYPE html>\n<html>\n<head>\n" +
      FRAME_HEAD +
      "\n<script>parent.CF_INSTALL(window, " + JSON.stringify(kind) + ");<\/script>\n</head>\n<body>\n" +
      body +
      "\n</body>\n</html>\n"
    );
  }

  function mountMessageFrame(id, n, pre) {
    var content = pre.textContent;
    var iframe = document.createElement("iframe");
    var name = "TH-message--" + id + "--" + n;
    iframe.name = name;
    iframe.id = name;
    iframe.className = "TH-render";
    iframe.setAttribute("frameborder", "0");
    iframe.style.width = "100%";
    iframe.style.height = "60px";
    var source = frameDocument("message", fixViewportHeight(content));
    var frame = { name: name, kind: "message", messageId: id, element: iframe, source: source, win: null };
    frames.push(frame);
    iframe.addEventListener("load", function () {
      emit(iframe_events.MESSAGE_IFRAME_RENDER_ENDED, name);
    });
    pre.replaceWith(iframe);
    frame.win = iframe.contentWindow;
    emit(iframe_events.MESSAGE_IFRAME_RENDER_STARTED, name);
    iframe.srcdoc = source;
  }

  function renderAll() {
    frames.filter(function (f) { return f.kind === "message"; }).forEach(dropFrame);
    chatElement.innerHTML = "";
    chat.forEach(function (m, i) { renderMessage(i); });
    postState();
  }

  function renderFrom(id) {
    for (var i = id; i < chat.length; i++) renderMessage(i);
    chatElement.querySelectorAll(".mes").forEach(function (block) {
      if (Number(block.getAttribute("mesid")) >= chat.length) {
        messageFrames(Number(block.getAttribute("mesid"))).forEach(dropFrame);
        block.remove();
      }
    });
    postState();
  }

  // ---------------------------------------------------------------- script buttons and toasts

  var buttons = {};
  function renderButtons() {
    var bar = document.getElementById("cf-buttons");
    bar.innerHTML = "";
    Object.keys(buttons).forEach(function (scriptId) {
      buttons[scriptId].list.forEach(function (b) {
        if (!b.visible) return;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "menu_button";
        button.textContent = b.name;
        button.onclick = function () {
          log(buttons[scriptId].name, "button", b.name);
          emit(scriptId + "_" + b.name);
        };
        bar.appendChild(button);
      });
    });
  }

  function toast(type) {
    return function (message, title) {
      log("toastr", type, (title ? title + ": " : "") + message);
      var box = document.getElementById("cf-toasts");
      var el = document.createElement("div");
      el.className = "cf-toast cf-toast-" + type;
      el.textContent = (title ? title + " — " : "") + (message == null ? "" : message);
      box.appendChild(el);
      setTimeout(function () { el.remove(); }, 3500);
      return el;
    };
  }
  var toastr = {
    success: toast("success"),
    info: toast("info"),
    warning: toast("warning"),
    error: toast("error"),
    clear: function () { document.getElementById("cf-toasts").innerHTML = ""; },
    remove: function () {},
    options: {},
  };

  // ---------------------------------------------------------------- slash commands and the input box

  function input() {
    return document.getElementById("send_textarea");
  }

  async function sendUser(text) {
    chat.push(newMessage("user", text));
    var id = chat.length - 1;
    await emit(tavern_events.MESSAGE_SENT, id);
    renderMessage(id);
    await emit(tavern_events.USER_MESSAGE_RENDERED, id);
    postState();
    return id;
  }

  async function triggerSlash(command) {
    var text = String(command || "").trim();
    log("slash", "triggerSlash", text);
    var parts = text.split("|").map(function (s) { return s.trim(); });
    var result = "";
    for (var i = 0; i < parts.length; i++) {
      var match = /^\/(\w+)\s*([\s\S]*)$/.exec(parts[i]);
      if (!match) continue;
      var name = match[1].toLowerCase();
      var arg = match[2].replace(/^(?:\w+=\S+\s+)*/, "");
      if (name === "send") await sendUser(arg || result);
      else if (name === "setinput") input().value = arg || result;
      else if (name === "echo") toastr.info(arg || result);
      else if (name === "pass") result = arg;
      else if (name === "getvar") result = String(_.get(chatVariables, arg, ""));
      else if (name === "setvar") {
        var kv = /key=(\S+)\s+([\s\S]*)/.exec(match[2]);
        if (kv) _.set(chatVariables, kv[1], kv[2]);
      } else log("slash", "not run in the sandbox", "/" + name + (arg ? " " + arg : ""));
    }
    postState();
    return result;
  }

  // ---------------------------------------------------------------- Tavern Helper, bound to one iframe

  function nameOf(win) {
    var frame = frameOf(win);
    return frame ? frame.name : "";
  }

  function scriptIdOf(win) {
    var frame = frameOf(win);
    if (!frame || frame.kind !== "script") throw new Error("getScriptId only works inside a script iframe.");
    return frame.scriptId;
  }

  function currentMessageId(win) {
    var match = /^TH-message--(\d+)--\d+/.exec(nameOf(win));
    if (!match) throw new Error("getCurrentMessageId only works inside a message iframe, not in '" + nameOf(win) + "'.");
    return Number(match[1]);
  }

  function variableStore(win, option, create) {
    option = option || { type: "chat" };
    switch (option.type) {
      case "message": {
        var id = option.message_id === undefined || option.message_id === "latest" ? -1 : option.message_id;
        var m;
        if (id === -1) {
          var visible = chat.filter(function (c) { return !c.is_system; });
          m = visible[visible.length - 1];
          if (!m) throw new Error("There are no messages yet.");
        } else m = chat[messageIndex(id)];
        return {
          get: function () { return varsOf(m); },
          set: function (v) { m.variables[m.swipe_id || 0] = v; },
          message: chat.indexOf(m),
        };
      }
      case "chat":
        return { get: function () { return chatVariables; }, set: function (v) { chatVariables = v; } };
      case "character":
        return { get: function () { return characterVariables; }, set: function (v) { characterVariables = v; } };
      case "global":
      case "preset":
        return { get: function () { return globalVariables; }, set: function (v) { globalVariables = v; } };
      case "script": {
        var sid = option.script_id || scriptIdOf(win);
        if (!scriptVariables[sid]) scriptVariables[sid] = {};
        return { get: function () { return scriptVariables[sid]; }, set: function (v) { scriptVariables[sid] = v; } };
      }
      case "extension": {
        var key = "ext:" + option.extension_id;
        return { get: function () { return scriptVariables[key] || {}; }, set: function (v) { scriptVariables[key] = v; } };
      }
      default:
        throw new Error("Unknown variable type '" + option.type + "'.");
    }
  }

  /** Changes made from a message iframe are the player's own edits: worth seeing in the action log. */
  function written(win, option, variables) {
    var frame = frameOf(win);
    if (frame && frame.kind === "message") log(frame.name, "variables written (" + (option || { type: "chat" }).type + ")", variables);
    postState();
  }

  function chatMessages(range, options) {
    options = options || {};
    var ids = [];
    if (typeof range === "number") ids = [messageIndex(range)];
    else {
      var match = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(String(range));
      if (!match) throw new Error("Bad message range '" + range + "'.");
      var start = messageIndex(Number(match[1]));
      var end = match[2] === undefined ? start : messageIndex(Number(match[2]));
      for (var i = Math.min(start, end); i <= Math.max(start, end); i++) ids.push(i);
    }
    return ids
      .filter(function (i) {
        var role = roleOf(chat[i]);
        if (options.role && options.role !== "all" && options.role !== role) return false;
        if (options.hide_state === "hidden" && !chat[i].is_hidden) return false;
        if (options.hide_state === "unhidden" && chat[i].is_hidden) return false;
        return true;
      })
      .map(function (i) {
        var m = chat[i];
        var base = { message_id: i, name: m.name, role: roleOf(m), is_hidden: !!m.is_hidden };
        if (options.include_swipes) {
          return Object.assign(base, {
            swipe_id: m.swipe_id || 0,
            swipes: clone(m.swipes || [m.mes]),
            swipes_data: clone(m.variables || [{}]),
            swipes_info: (m.swipes || [m.mes]).map(function () { return {}; }),
          });
        }
        return Object.assign(base, { message: m.mes, data: clone(varsOf(m)), extra: clone(m.extra || {}) });
      });
  }

  async function setChatMessages(changes, options) {
    var refresh = (options || {}).refresh || "affected";
    var touched = [];
    (changes || []).forEach(function (change) {
      var id = messageIndex(change.message_id);
      var m = chat[id];
      if (change.name !== undefined) m.name = change.name;
      if (change.role !== undefined) {
        m.is_user = change.role === "user";
        m.is_system = change.role === "system";
      }
      if (change.is_hidden !== undefined) m.is_hidden = change.is_hidden;
      if (change.swipes !== undefined) {
        m.swipes = change.swipes.slice();
        m.swipe_id = Math.min(change.swipe_id !== undefined ? change.swipe_id : m.swipe_id || 0, m.swipes.length - 1);
        m.mes = m.swipes[m.swipe_id];
        if (change.swipes_data) m.variables = clone(change.swipes_data);
      } else if (change.swipe_id !== undefined) {
        m.swipe_id = change.swipe_id;
        m.mes = (m.swipes || [m.mes])[m.swipe_id];
      }
      if (change.message !== undefined) setText(m, change.message);
      if (change.data !== undefined) m.variables[m.swipe_id || 0] = clone(change.data);
      if (change.extra !== undefined) m.extra = clone(change.extra);
      touched.push(id);
    });
    if (refresh === "all") renderAll();
    else if (refresh === "affected") touched.forEach(renderMessage);
    postState();
  }

  async function createChatMessages(messages, options) {
    options = options || {};
    var at = options.insert_before !== undefined ? options.insert_before : options.insert_at;
    var index = at === undefined || at === "end" ? chat.length : messageIndex(at);
    var created = (messages || []).map(function (m) {
      var message = newMessage(m.role, m.message || "", m.name);
      message.is_hidden = !!m.is_hidden;
      if (m.data) message.variables = [clone(m.data)];
      if (m.extra) message.extra = clone(m.extra);
      return message;
    });
    chat.splice.apply(chat, [index, 0].concat(created));
    if ((options.refresh || "affected") !== "none") renderFrom(index);
    postState();
  }

  async function deleteChatMessages(ids, options) {
    var sorted = (ids || []).map(messageIndex).sort(function (a, b) { return b - a; });
    sorted.forEach(function (id) { chat.splice(id, 1); });
    if (sorted.length) {
      if ((options || {}).refresh !== "none") renderFrom(sorted[sorted.length - 1]);
      await emit(tavern_events.MESSAGE_DELETED, chat.length);
    }
    postState();
  }

  function makeApi(win, kind) {
    function emitFrom(event) {
      return emit.apply(null, arguments);
    }
    function onFrom(event, fn) {
      on(win, event, fn, false, false);
      return { stop: function () { off(event, fn); } };
    }
    var api = {
      // Variables
      getVariables: function (option) {
        return clone(variableStore(win, option).get());
      },
      replaceVariables: function (variables, option) {
        variableStore(win, option).set(clone(variables));
        written(win, option, variables);
      },
      updateVariablesWith: function (updater, option) {
        var store = variableStore(win, option);
        var result = updater(clone(store.get()));
        function finish(value) {
          store.set(clone(value));
          written(win, option, value);
          return value;
        }
        return result && typeof result.then === "function" ? result.then(finish) : finish(result);
      },
      insertOrAssignVariables: function (variables, option) {
        var store = variableStore(win, option);
        var next = _.merge(clone(store.get()), clone(variables));
        store.set(next);
        written(win, option, variables);
        return clone(next);
      },
      insertVariables: function (variables, option) {
        var store = variableStore(win, option);
        var next = _.defaultsDeep(clone(store.get()), clone(variables));
        store.set(next);
        written(win, option, variables);
        return clone(next);
      },
      deleteVariable: function (path, option) {
        var store = variableStore(win, option);
        var next = clone(store.get());
        var occurred = _.unset(next, path) && true;
        occurred = occurred && !_.has(next, path);
        store.set(next);
        written(win, option, { deleted: path });
        return { variables: clone(next), delete_occurred: occurred };
      },
      registerVariableSchema: function (schema, option) {
        schemas[(option || {}).type || "chat"] = schema;
        log(sourceName(win), "registerVariableSchema", (option || {}).type);
        postState();
      },
      getAllVariables: function () {
        var isMessage = kind === "message";
        var result = Object.assign({}, clone(globalVariables), clone(characterVariables));
        if (!isMessage && frameOf(win) && frameOf(win).kind === "script") Object.assign(result, clone(scriptVariables[frameOf(win).scriptId] || {}));
        Object.assign(result, clone(chatVariables));
        if (isMessage) {
          var upTo = currentMessageId(win);
          chat.slice(0, upTo + 1).forEach(function (m) { Object.assign(result, clone((m.variables || [])[m.swipe_id || 0] || {})); });
        }
        return result;
      },
      // Chat messages
      getChatMessages: chatMessages,
      setChatMessages: setChatMessages,
      createChatMessages: createChatMessages,
      deleteChatMessages: deleteChatMessages,
      rotateChatMessages: async function (begin, middle, end, options) {
        var moved = chat.splice(begin, middle - begin);
        chat.splice.apply(chat, [end - moved.length, 0].concat(moved));
        if ((options || {}).refresh !== "none") renderAll();
      },
      getLastMessageId: function () {
        return chat.length - 1;
      },
      getMessageId: function (name) {
        var match = /^TH-message--(\d+)--\d+/.exec(name);
        if (!match) throw new Error("Not a message iframe name: '" + name + "'.");
        return Number(match[1]);
      },
      getCurrentMessageId: function () {
        return currentMessageId(win);
      },
      getIframeName: function () {
        return nameOf(win);
      },
      getScriptId: function () {
        return scriptIdOf(win);
      },
      getScriptName: function () {
        return frameOf(win) ? frameOf(win).scriptName : "";
      },
      getScriptInfo: function () {
        return frameOf(win) ? frameOf(win).info || "" : "";
      },
      replaceScriptInfo: function (info) {
        if (frameOf(win)) frameOf(win).info = info;
      },
      refreshOneMessage: async function (id) {
        renderMessage(messageIndex(id));
      },
      formatAsDisplayedMessage: function (text, option) {
        var role = option && option.message_id !== undefined && chat[option.message_id] ? roleOf(chat[option.message_id]) : "assistant";
        chat.push(newMessage(role, text));
        try {
          return formatMessage(chat.length - 1);
        } finally {
          chat.pop();
        }
      },
      retrieveDisplayedMessage: function (id) {
        return jQuery('.mes[mesid="' + messageIndex(id) + '"] .mes_text', document);
      },
      reloadIframe: function () {
        var frame = frameOf(win);
        if (frame && frame.kind === "message") renderMessage(frame.messageId);
        else if (frame) {
          dropFrame(frame);
          startScript(frame.script);
        }
      },
      // Events
      eventOn: onFrom,
      eventOnce: function (event, fn) {
        on(win, event, fn, true, false);
        return { stop: function () { off(event, fn); } };
      },
      eventMakeFirst: function (event, fn) {
        off(event, fn);
        on(win, event, fn, false, true);
      },
      eventMakeLast: function (event, fn) {
        off(event, fn);
        on(win, event, fn, false, false);
      },
      eventEmit: emitFrom,
      eventEmitAndWait: emitFrom,
      eventRemoveListener: off,
      eventClearEvent: function (event) {
        delete listeners[event];
      },
      eventClearListener: function (fn) {
        Object.keys(listeners).forEach(function (event) { off(event, fn); });
      },
      eventClearAll: function () {
        clearFrameListeners(win);
      },
      getButtonEvent: function (name) {
        return scriptIdOf(win) + "_" + name;
      },
      eventOnButton: function (name, fn) {
        on(win, scriptIdOf(win) + "_" + name, fn, false, false);
      },
      getScriptButtons: function () {
        var id = scriptIdOf(win);
        return clone((buttons[id] || { list: [] }).list);
      },
      replaceScriptButtons: function (list) {
        var id = scriptIdOf(win);
        buttons[id] = { name: frameOf(win).scriptName, list: clone(list || []) };
        renderButtons();
      },
      updateScriptButtonsWith: function (fn) {
        var id = scriptIdOf(win);
        var next = fn(clone((buttons[id] || { list: [] }).list));
        buttons[id] = { name: frameOf(win).scriptName, list: clone(next || []) };
        renderButtons();
        return clone(next);
      },
      appendInexistentScriptButtons: function (list) {
        var id = scriptIdOf(win);
        var current = (buttons[id] || { list: [] }).list;
        (list || []).forEach(function (b) {
          if (!current.some(function (c) { return c.name === b.name; })) current.push(clone(b));
        });
        buttons[id] = { name: frameOf(win).scriptName, list: current };
        renderButtons();
      },
      getAllEnabledScriptButtons: function () {
        var out = {};
        Object.keys(buttons).forEach(function (id) {
          out[id] = buttons[id].list.filter(function (b) { return b.visible; }).map(function (b) { return { button_id: id + "_" + b.name, button_name: b.name }; });
        });
        return out;
      },
      // Globals shared between iframes
      initializeGlobal: function (name, value) {
        globals[name] = value;
        _.set(window, name, value);
        emit("global_" + name + "_initialized");
      },
      waitGlobalInitialized: function (name) {
        function bind() {
          Object.defineProperty(win, name, { get: function () { return _.get(window, name); }, configurable: true });
        }
        if (_.has(window, name)) {
          bind();
          return Promise.resolve();
        }
        return new Promise(function (resolve) {
          on(win, "global_" + name + "_initialized", function () {
            bind();
            resolve();
          }, true, false);
        });
      },
      // SillyTavern
      triggerSlash: triggerSlash,
      substitudeMacros: substitute,
      getCurrentCharacterName: function () {
        return CHAR;
      },
      getCharacterNames: function () {
        return [CHAR];
      },
      getCurrentPersonaName: function () {
        return USER;
      },
      getCharAvatarPath: function () {
        return card.avatar || "";
      },
      getCharWorldbookNames: function () {
        return { primary: card.book && card.book.length ? CHAR : null, additional: [] };
      },
      getWorldbookNames: function () {
        return card.book && card.book.length ? [CHAR] : [];
      },
      getWorldbook: async function (name) {
        if (name !== CHAR) throw new Error("No worldbook named '" + name + "' in the sandbox.");
        return worldbookEntries();
      },
      getTavernRegexes: function () {
        return clone(card.regex || []).map(function (r) {
          return { id: r.id, script_name: r.scriptName, enabled: !r.disabled, find_regex: r.findRegex, replace_string: r.replaceString };
        });
      },
      isCharacterTavernRegexesEnabled: function () {
        return true;
      },
      formatAsTavernRegexedString: function (text, source, destination, option) {
        var m = newMessage(source === "user_input" ? "user" : "assistant", text);
        return destination === "display" ? runRegex(text, m, (option && option.depth) || 0) : text;
      },
      generate: async function (config) {
        log(sourceName(win), "generate", config);
        await emit(iframe_events.GENERATION_REQUESTED, config);
        if (PLAYTEST) return askCardForge("generate", config);
        return "[Sandbox: generate() isn't connected to a model here. Playtest runs it for real.]";
      },
      generateRaw: async function (config) {
        log(sourceName(win), "generateRaw", config);
        if (PLAYTEST) return askCardForge("generateRaw", config);
        return "[Sandbox: generateRaw() isn't connected to a model here. Playtest runs it for real.]";
      },
      stopGenerationById: function () {
        return false;
      },
      stopAllGeneration: function () {
        return false;
      },
      injectPrompts: function (prompts, option) {
        log(sourceName(win), "injectPrompts", { prompts: prompts, option: option });
        var ids = (prompts || []).map(function (p) {
          var id = String(p.id || "prompt-" + Math.random().toString(36).slice(2));
          injected[id] = {
            id: id,
            position: p.position || "in_chat",
            depth: typeof p.depth === "number" ? p.depth : 0,
            role: p.role || "system",
            content: String(p.content || ""),
            should_scan: !!p.should_scan,
          };
          return id;
        });
        postState();
        return {
          uninject: function () {
            ids.forEach(function (id) { delete injected[id]; });
            postState();
          },
        };
      },
      uninjectPrompts: function (ids) {
        log(sourceName(win), "uninjectPrompts", ids);
        (ids || []).forEach(function (id) { delete injected[id]; });
        postState();
      },
      registerMacroLike: function (regex) {
        log(sourceName(win), "registerMacroLike", String(regex));
        return { unregister: function () {} };
      },
      unregisterMacroLike: function () {},
      errorCatched: function (fn) {
        return function () {
          try {
            var out = fn.apply(this, arguments);
            if (out && typeof out.catch === "function") {
              return out.catch(function (e) {
                reportError(win, e && e.message ? e.message : e, 0, 0, e && e.stack);
                throw e;
              });
            }
            return out;
          } catch (e) {
            reportError(win, e && e.message ? e.message : e, 0, 0, e && e.stack);
            throw e;
          }
        };
      },
      getTavernHelperVersion: function () {
        return config.thVersion;
      },
      getTavernVersion: function () {
        return ST_VERSION;
      },
      getTavernHelperExtensionId: function () {
        return "JS-Slash-Runner";
      },
      tavern_events: tavern_events,
      iframe_events: iframe_events,
      toastr: toastr,
    };
    // The rest of Tavern Helper exists here too, but only says what it would have done.
    (config.thFunctions || []).forEach(function (name) {
      if (api[name]) return;
      api[name] = function () {
        log(sourceName(win), name + " (not run in the sandbox)", Array.prototype.slice.call(arguments));
        return undefined;
      };
    });
    return api;
  }

  /** Called by each iframe's first script: Tavern Helper's functions, the libraries, error capture. */
  window.CF_INSTALL = function (win, kind) {
    var frame = frameOf(win);
    if (!frame) {
      frame = frames.find(function (f) { return f.element && f.element.contentWindow === win; });
      if (frame) frame.win = win;
    }
    win.eval(CF_LIBS.jquery);
    if (kind === "message") win.eval(CF_LIBS.vue);
    else {
      // Scripts work on SillyTavern's page, as Tavern Helper sets them up.
      win.$ = window.jQuery;
      win.jQuery = window.jQuery;
    }
    win._ = window._;
    win.YAML = window.YAML;
    win.z = window.z;
    win.toastr = toastr;
    win.SillyTavern = {
      getContext: function () {
        return { chat: chat, name1: USER, name2: CHAR, characterId: 0, chatMetadata: { variables: chatVariables }, eventTypes: tavern_events };
      },
    };
    Object.assign(win, makeApi(win, kind));
    win.TavernHelper = makeApi(win, kind);
    if (_.has(window, "Mvu")) {
      Object.defineProperty(win, "Mvu", { get: function () { return window.Mvu; }, set: function () {}, configurable: true });
    }
    try {
      win.document.documentElement.style.setProperty("--TH-viewport-height", window.innerHeight + "px");
    } catch (e) {}
    win.addEventListener("error", function (e) {
      reportError(win, e.message, e.lineno, e.colno, e.error && e.error.stack);
    });
    win.addEventListener("unhandledrejection", function (e) {
      var r = e.reason;
      reportError(win, "Unhandled promise rejection: " + (r && r.message ? r.message : r), 0, 0, r && r.stack);
    });
    win.document.addEventListener("securitypolicyviolation", function (e) {
      reportError(
        win,
        "Blocked a network request to " + (e.blockedURI || "an outside address") +
          ". Engine cards can't rely on the web: in SillyTavern this would break whenever the player is offline or the site is down.",
        e.lineNumber,
        e.columnNumber,
      );
    });
    ["error", "warn"].forEach(function (level) {
      var original = win.console[level];
      win.console[level] = function () {
        var text = Array.prototype.slice.call(arguments).map(function (a) {
          return a instanceof Error ? a.message : typeof a === "string" ? a : short(a);
        }).join(" ");
        post({ kind: "console", level: level, source: sourceName(win), message: text });
        return original.apply(win.console, arguments);
      };
    });
    if (kind === "message") {
      // Fit the iframe to its content, as Tavern Helper does.
      var resize = function () {
        try {
          var h = win.document.body.scrollHeight;
          if (h > 0) frame.element.style.height = h + "px";
        } catch (e) {}
      };
      win.addEventListener("DOMContentLoaded", function () {
        resize();
        new win.ResizeObserver(resize).observe(win.document.body);
      });
      win.addEventListener("load", resize);
    }
  };

  // ---------------------------------------------------------------- the card's scripts

  function startScript(script) {
    var iframe = document.createElement("iframe");
    var name = "TH-script--" + script.name + "--" + script.id;
    iframe.name = name;
    iframe.id = name;
    var source = frameDocument("script", '<script type="module">\n' + script.content + "\n<\/script>");
    var frame = { name: name, kind: "script", scriptId: script.id, scriptName: script.name, script: script, info: script.info, element: iframe, source: source, win: null };
    frames.push(frame);
    document.getElementById("cf-scripts").appendChild(iframe);
    frame.win = iframe.contentWindow;
    if (script.buttons && script.buttons.length) {
      buttons[script.id] = { name: script.name, list: clone(script.buttons) };
      renderButtons();
    }
    if (script.data) scriptVariables[script.id] = clone(script.data);
    iframe.srcdoc = source;
    return new Promise(function (resolve) {
      iframe.addEventListener("load", function () { resolve(); });
    });
  }

  // ---------------------------------------------------------------- pictures and checks for the UI engineer

  // A picture of what the player sees: each document is drawn through an SVG foreignObject, with the
  // iframes in it (panels, hub screens) drawn the same way first and put in as pictures.

  function visibleFrames(doc) {
    return Array.prototype.filter.call(doc.querySelectorAll("iframe"), function (el) {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      var style = doc.defaultView.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  function frameWindow(el) {
    try {
      return el.contentWindow && el.contentWindow.document ? el.contentWindow : null;
    } catch (e) {
      return null;
    }
  }

  /** The animations running in a document. */
  function animationsIn(doc) {
    try {
      return doc.getAnimations ? doc.getAnimations() : [];
    } catch (e) {
      return [];
    }
  }

  /** Each animated element in a document, with the CSS properties its animations change. */
  function animatedProperties(doc) {
    var out = new Map();
    animationsIn(doc).forEach(function (a) {
      var el = a.effect && a.effect.target;
      if (!el || a.effect.pseudoElement) return;
      var props = out.get(el) || [];
      if (a.transitionProperty) props.push(a.transitionProperty);
      else if (a.effect.getKeyframes)
        a.effect.getKeyframes().forEach(function (k) {
          Object.keys(k).forEach(function (p) {
            if (["offset", "computedOffset", "easing", "composite"].indexOf(p) < 0) props.push(p.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }));
          });
        });
      out.set(el, props);
    });
    return out;
  }

  function snapshotMarkup(win, pictures) {
    var doc = win.document;
    var originals = doc.documentElement.querySelectorAll("*");
    var clone = doc.documentElement.cloneNode(true);
    var copies = clone.querySelectorAll("*");
    var moving = animatedProperties(doc);
    for (var i = originals.length - 1; i >= 0; i--) {
      var o = originals[i];
      var c = copies[i];
      if (!c) continue;
      var tag = o.tagName;
      if (tag === "SCRIPT" || tag === "NOSCRIPT") {
        c.remove();
        continue;
      }
      // A moving element is drawn where it is right now: its animated values, held still.
      var props = moving.get(o);
      if (props && c.style) {
        var now = win.getComputedStyle(o);
        props.forEach(function (p) { c.style.setProperty(p, now.getPropertyValue(p)); });
      }
      if (tag === "IFRAME") {
        // The frame's own picture goes in its place, with its computed style, so whatever sits
        // above it (a close button) stays above it.
        var img = doc.createElement(pictures.has(o) ? "img" : "div");
        var cs = win.getComputedStyle(o);
        for (var k = 0; k < cs.length; k++) img.style.setProperty(cs[k], cs.getPropertyValue(cs[k]));
        if (pictures.has(o)) img.setAttribute("src", pictures.get(o));
        c.replaceWith(img);
        continue;
      }
      if (tag === "INPUT") {
        if (o.type === "checkbox" || o.type === "radio") {
          if (o.checked) c.setAttribute("checked", "");
          else c.removeAttribute("checked");
        } else c.setAttribute("value", o.value);
      } else if (tag === "TEXTAREA") c.textContent = o.value;
      else if (tag === "SELECT") {
        Array.prototype.forEach.call(c.options, function (opt, n) {
          if (n === o.selectedIndex) opt.setAttribute("selected", "");
          else opt.removeAttribute("selected");
        });
      } else if (tag === "CANVAS") {
        try {
          var img = doc.createElement("img");
          img.src = o.toDataURL();
          img.setAttribute("style", "width:" + o.clientWidth + "px;height:" + o.clientHeight + "px;");
          c.replaceWith(img);
          continue;
        } catch (e) {}
      }
      if (o.scrollTop || o.scrollLeft) {
        c.style.overflow = "hidden";
        Array.prototype.forEach.call(c.children, function (child) {
          child.style.translate = -o.scrollLeft + "px " + -o.scrollTop + "px";
        });
      }
    }
    // The picture's own copy of the page mustn't start its animations over from the first frame.
    var still = doc.createElement("style");
    still.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
    (clone.querySelector("head") || clone).appendChild(still);
    var body = clone.querySelector("body");
    if (body && (win.scrollX || win.scrollY)) body.style.translate = -win.scrollX + "px " + -win.scrollY + "px";
    clone.style.width = win.innerWidth + "px";
    clone.style.height = win.innerHeight + "px";
    clone.style.overflow = "hidden";
    return new XMLSerializer().serializeToString(clone);
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("The page couldn't be drawn.")); };
      img.src = src;
    });
  }

  async function snapshot(win) {
    var w = Math.max(1, Math.round(win.innerWidth));
    var h = Math.max(1, Math.round(win.innerHeight));
    var pictures = new Map();
    var list = visibleFrames(win.document);
    for (var i = 0; i < list.length; i++) {
      var child = frameWindow(list[i]);
      if (child) pictures.set(list[i], (await snapshot(child)).toDataURL("image/png"));
    }
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
      snapshotMarkup(win, pictures) +
      "</foreignObject></svg>";
    try {
      ctx.drawImage(await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)), 0, 0);
    } catch (e) {
      ctx.fillStyle = "#888";
      ctx.fillText("(not drawn)", 4, 12);
    }
    return canvas;
  }

  async function capture() {
    // Let pending layout and animations settle first.
    await new Promise(function (resolve) { setTimeout(resolve, 350); });
    var canvas = await snapshot(window);
    var data = canvas.toDataURL("image/png");
    return { image: data.slice(data.indexOf(",") + 1), width: canvas.width, height: canvas.height };
  }

  /** Every running animation on screen, in the page and its frames. */
  function runningAnimations() {
    return screens().reduce(function (all, screen) {
      return all.concat(animationsIn(screen.win.document).filter(function (a) { return a.playState === "running"; }));
    }, []);
  }

  /** A line for each moving element: what it is, which animation, how far along, and where it is now. */
  function movingLines(anims) {
    return anims.slice(0, 8).map(function (a) {
      var el = a.effect && a.effect.target;
      if (!el || !el.ownerDocument) return "";
      var now = el.ownerDocument.defaultView.getComputedStyle(el);
      var timing = a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      var name = a.animationName || (a.transitionProperty ? "transition of " + a.transitionProperty : "script animation");
      return describe(el) + " " + name + " " + Math.round((timing.progress || 0) * 100) + "% · opacity " + now.opacity + (now.transform && now.transform !== "none" ? " · transform " + now.transform : "");
    }).filter(Boolean);
  }

  async function frameTrigger(t) {
    if (!t) return;
    if (t.type === "open") {
      if (!window.CardForge) throw new Error("The engine core isn't running, so there's nothing to open.");
      window.CardForge.open(t.module);
    } else if (t.type === "click") await click(t, true);
    else if (t.type === "setVariables") await setVariables(t.id, t.variables);
  }

  /**
   * Pictures at set times after a trigger (a click, opening a screen, a change of state), to check
   * an animation. Animations are held still while each picture is drawn, and the times count only
   * the time they ran.
   */
  async function frames(command) {
    var at = (command.at || []).map(Number).filter(function (n) { return n >= 0 && n <= 10000; }).sort(function (a, b) { return a - b; }).slice(0, 6);
    await frameTrigger(command.trigger);
    var start = performance.now();
    var out = { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight), frames: [] };
    for (var i = 0; i < at.length; i++) {
      var wait = start + at[i] - performance.now();
      if (wait > 0) await new Promise(function (resolve) { setTimeout(resolve, wait); });
      var held = performance.now();
      var anims = runningAnimations();
      anims.forEach(function (a) { try { a.pause(); } catch (e) {} });
      var frame = { at: at[i], moving: movingLines(anims) };
      if (command.images !== false) {
        var data = (await snapshot(window)).toDataURL("image/png");
        frame.image = data.slice(data.indexOf(",") + 1);
      }
      anims.forEach(function (a) { try { a.play(); } catch (e) {} });
      out.frames.push(frame);
      start += performance.now() - held;
    }
    return out;
  }

  /** Every document the player can see, with a name for reports. */
  function screens() {
    var out = [{ name: "chat page", win: window }];
    (function walk(doc, prefix) {
      visibleFrames(doc).forEach(function (el) {
        var win = frameWindow(el);
        if (!win) return;
        var name = el.id && /^TH-message--/.test(el.id)
          ? "message " + el.id.split("--")[1] + (/<div id="cf-panel"/.test(win.document.documentElement.outerHTML) ? " (status panel)" : " (inline block)")
          : el.title ? "hub screen: " + el.title : prefix + "frame";
        out.push({ name: name, win: win });
        walk(win.document, name + " › ");
      });
    })(document, "");
    return out;
  }

  function describe(el) {
    var text = el.tagName.toLowerCase();
    if (el.id) text += "#" + el.id;
    var cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) text += "." + cls.join(".");
    return text;
  }

  function parseColor(value) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(value || "");
    if (!m) return null;
    var a = m[4] === undefined ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }

  function luminance(c) {
    var v = c.slice(0, 3).map(function (x) {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  function blend(top, bottom) {
    var a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  }

  /** The colour behind an element, or null when an image or gradient makes it unknowable. */
  function backdrop(el, fallback) {
    var layers = [];
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none" && !/gradient/.test(style.backgroundImage)) return null;
      var c = parseColor(style.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    var color = fallback;
    for (var i = layers.length - 1; i >= 0; i--) color = blend(layers[i], color);
    return color;
  }

  function inspectScreen(screen, base) {
    var win = screen.win;
    var doc = win.document;
    var vw = doc.documentElement.clientWidth;
    var report = {
      screen: screen.name, width: vw, height: doc.documentElement.scrollHeight,
      overflow: [], contrast: [], smallTargets: [], outline: [], smallText: [], overlaps: [], emptyImages: [], hiddenButtons: [],
    };
    var leaves = [];
    if (doc.documentElement.scrollWidth > vw + 1)
      Array.prototype.forEach.call(doc.body ? doc.body.querySelectorAll("*") : [], function (el) {
        var r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && report.overflow.length < 5) report.overflow.push(describe(el) + " reaches " + Math.round(r.right) + "px of " + vw + "px");
      });
    var page = parseColor(win.getComputedStyle(doc.body || doc.documentElement).backgroundColor);
    var fallback = page && page[3] >= 1 ? page : base;
    var seen = 0;
    Array.prototype.forEach.call(doc.body ? doc.body.querySelectorAll("*") : [], function (el) {
      var style = win.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var shown = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
      var tag = el.tagName;
      var button = tag === "BUTTON" || el.getAttribute("role") === "button";
      if (button && report.hiddenButtons.length < 6 && (el.textContent.trim() || el.getAttribute("aria-label"))) {
        var why = !shown ? "is not visible" : r.right <= 0 || r.left >= vw || r.bottom <= 0 ? "is off screen" : "";
        if (!why && doc.elementFromPoint) {
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if (cy < win.innerHeight) {
            var hit = doc.elementFromPoint(cx, cy);
            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) why = "is covered by " + describe(hit);
          }
        }
        if (why) report.hiddenButtons.push(describe(el) + ' "' + (el.textContent.trim() || el.getAttribute("aria-label")).slice(0, 30) + '" ' + why);
      }
      if (!shown) return;
      var own = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
      if (own && parseFloat(style.fontSize) < 12 && report.smallText.length < 6)
        report.smallText.push(describe(el) + ' "' + el.textContent.trim().slice(0, 30) + '" ' + parseFloat(style.fontSize).toFixed(1) + "px");
      if (tag === "IMG" && report.emptyImages.length < 6 && (!el.getAttribute("src") || (el.complete && !el.naturalWidth)))
        report.emptyImages.push(describe(el) + (el.getAttribute("alt") ? ' "' + el.getAttribute("alt") + '"' : "") + (el.getAttribute("src") ? " failed to load" : " has no src"));
      if ((own || button || tag === "INPUT" || tag === "IMG") && leaves.length < 200) leaves.push({ el: el, r: r });
      if (own && report.contrast.length < 8) {
        var fg = parseColor(style.color);
        var bg = backdrop(el, fallback);
        if (fg && bg) {
          var c = blend(fg, bg);
          var l1 = luminance(c), l2 = luminance(bg);
          var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          var size = parseFloat(style.fontSize);
          var large = size >= 24 || (size >= 18.6 && Number(style.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5))
            report.contrast.push(describe(el) + ' "' + el.textContent.trim().slice(0, 30) + '" ' + ratio.toFixed(2) + ":1");
        }
      }
      if ((tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button" || tag === "SELECT" || (tag === "INPUT" && el.type !== "hidden")) && (r.width < 30 || r.height < 30) && report.smallTargets.length < 6)
        report.smallTargets.push(describe(el) + " " + Math.round(r.width) + "×" + Math.round(r.height) + "px");
      if (seen < 60 && (own || tag === "BUTTON" || tag === "INPUT" || tag === "IMG" || tag === "SELECT")) {
        seen++;
        var label = own ? el.textContent.trim().replace(/\s+/g, " ").slice(0, 50) : el.getAttribute("aria-label") || el.getAttribute("alt") || el.value || "";
        report.outline.push(describe(el) + (label ? ' "' + label + '"' : "") + " " + Math.round(r.width) + "×" + Math.round(r.height) + " at " + Math.round(r.left) + "," + Math.round(r.top));
      }
    });
    // Text and controls on top of each other (not nested), by more than a quarter of the smaller one.
    for (var i = 0; i < leaves.length && report.overlaps.length < 6; i++)
      for (var j = i + 1; j < leaves.length && report.overlaps.length < 6; j++) {
        var a = leaves[i], b = leaves[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        var w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        var h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 0 || h <= 0) continue;
        var smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if (w * h > smaller / 4) report.overlaps.push(describe(a.el) + " and " + describe(b.el) + " overlap by " + Math.round(w) + "×" + Math.round(h) + "px");
      }
    return report;
  }

  function inspect() {
    var base = parseColor(getComputedStyle(document.body).backgroundColor) || [28, 28, 31, 1];
    return { screens: screens().map(function (s) { return inspectScreen(s, base); }) };
  }

  function findScreen(where) {
    var list = screens();
    if (!where || where === "chat") return list[0];
    if (where === "overlay") return list.filter(function (s) { return /^hub screen/.test(s.name); }).pop();
    if (where === "panel") return list.filter(function (s) { return /status panel/.test(s.name); }).pop();
    var m = /^message[: ]?(\d+)$/.exec(where);
    if (m) return list.filter(function (s) { return s.name.indexOf("message " + m[1] + " ") === 0; })[0];
    return list.filter(function (s) { return s.name.indexOf(where) >= 0; })[0];
  }

  async function click(command, quick) {
    var screen = findScreen(command.screen);
    if (!screen) throw new Error("There's no '" + (command.screen || "chat") + "' on screen. Screens: " + screens().map(function (s) { return s.name; }).join(", ") + ".");
    var doc = screen.win.document;
    var target = null;
    if (command.selector) target = doc.querySelector(command.selector);
    else if (command.text) {
      var want = String(command.text).trim().toLowerCase();
      var all = Array.prototype.filter.call(doc.querySelectorAll("button, a, [role=button], [role=tab], [data-cf-send], [data-cf-open], [data-cf-tab], [data-item], label, summary, li"), function (el) {
        return el.getBoundingClientRect().width > 0 && el.textContent.trim().toLowerCase().indexOf(want) >= 0;
      });
      all.sort(function (a, b) { return a.textContent.length - b.textContent.length; });
      target = all[0] || null;
    }
    if (!target) throw new Error("Nothing on the " + screen.name + " matches " + (command.selector ? "'" + command.selector + "'" : '"' + command.text + '"') + ".");
    var before = input().value;
    log("UI engineer", "clicked", describe(target) + ' "' + target.textContent.trim().slice(0, 40) + '" on the ' + screen.name);
    target.click();
    if (!quick) await new Promise(function (resolve) { setTimeout(resolve, 400); });
    return { clicked: describe(target), screen: screen.name, input: input().value !== before ? input().value : "" };
  }

  // ---------------------------------------------------------------- commands from CardForge

  /** Waits until the scripts' own async work (their update queues) has settled. */
  function settle() {
    return new Promise(function (resolve) { setTimeout(resolve, 30); });
  }

  async function reply(text) {
    chat.push(newMessage("assistant", text));
    var id = chat.length - 1;
    await emit(tavern_events.GENERATION_ENDED, id);
    await emit(tavern_events.MESSAGE_RECEIVED, id);
    renderMessage(id);
    await emit(tavern_events.CHARACTER_MESSAGE_RENDERED, id);
    await settle();
    postState();
    return id;
  }

  async function swipe(text) {
    var id = chat.length - 1;
    if (id < 0) return;
    var m = chat[id];
    if (m.is_user) return reply(text);
    m.swipes = m.swipes || [m.mes];
    m.swipes.push(text);
    m.swipe_id = m.swipes.length - 1;
    m.mes = text;
    m.variables = m.variables || [];
    m.variables[m.swipe_id] = {};
    await emit(tavern_events.MESSAGE_SWIPED, id);
    await emit(tavern_events.MESSAGE_RECEIVED, id);
    renderMessage(id);
    await emit(tavern_events.CHARACTER_MESSAGE_RENDERED, id);
    await settle();
    postState();
  }

  async function swipeTo(id, swipeId) {
    var m = chat[messageIndex(id)];
    var swipes = m.swipes || [m.mes];
    if (swipeId < 0 || swipeId >= swipes.length) return;
    m.swipe_id = swipeId;
    m.mes = swipes[swipeId];
    if (!m.variables) m.variables = [];
    if (!m.variables[swipeId]) m.variables[swipeId] = {};
    await emit(tavern_events.MESSAGE_SWIPED, id);
    if (id === 0) await emit(tavern_events.CHARACTER_FIRST_MESSAGE_SELECTED, id);
    await settle();
    renderFrom(id);
  }

  async function edit(id, text) {
    setText(chat[messageIndex(id)], text);
    await emit(tavern_events.MESSAGE_EDITED, id);
    await emit(tavern_events.MESSAGE_UPDATED, id);
    await settle();
    renderFrom(id);
  }

  async function rewind(id) {
    if (id < 1 || id >= chat.length) return;
    chat.splice(id);
    renderFrom(id);
    await emit(tavern_events.MESSAGE_DELETED, chat.length);
    postState();
  }

  async function setVariables(id, variables) {
    var m = chat[messageIndex(id)];
    m.variables = m.variables || [];
    m.variables[m.swipe_id || 0] = clone(variables);
    log("inspector", "variables set on message " + id, variables);
    renderFrom(id);
  }

  async function run(command) {
    switch (command.type) {
      case "send":
        return sendUser(command.text);
      case "reply":
        return reply(command.text);
      case "swipe":
        return swipe(command.text);
      case "swipeTo":
        return swipeTo(command.id, command.swipe);
      case "edit":
        return edit(command.id, command.text);
      case "rewind":
        return rewind(command.id);
      case "setVariables":
        return setVariables(command.id, command.variables);
      case "view":
        document.documentElement.style.fontSize = command.textScale * 100 + "%";
        return;
      case "open":
        if (!window.CardForge) throw new Error("The engine core isn't running, so there's nothing to open.");
        window.CardForge.open(command.module);
        await new Promise(function (resolve) { setTimeout(resolve, 300); });
        return;
      case "close":
        if (window.CardForge) window.CardForge.close();
        return;
      case "capture":
        return capture();
      case "frames":
        return frames(command);
      case "settings":
        if (!window.CardForge) throw new Error("The engine core isn't running, so there are no settings to change.");
        await window.CardForge.setSettings(command.settings);
        await new Promise(function (resolve) { setTimeout(resolve, 120); });
        return;
      case "inspect":
        return inspect();
      case "click":
        return click(command);
      case "scenario": {
        for (var i = 0; i < command.turns.length; i++) {
          var turn = command.turns[i];
          if (turn.role === "user") await sendUser(turn.text);
          else await reply(turn.text);
        }
        return;
      }
    }
  }

  var queue = Promise.resolve();
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || !e.data.cfCommand) return;
    var command = e.data.cfCommand;
    // Answers and the typing bubble skip the queue: a queued command may be waiting on them.
    if (command.type === "generated") return answered(command);
    if (command.type === "typing") return typing(command.text);
    var result;
    var failed = "";
    queue = queue
      .then(function () { return run(command); })
      .then(function (value) { result = value; })
      .catch(function (err) {
        failed = err && err.message ? err.message : String(err);
        reportError(window, failed, 0, 0, err && err.stack);
      })
      .then(function () { post({ kind: "done", id: command.requestId, result: result, failed: failed }); });
  });

  window.addEventListener("error", function (e) {
    reportError(window, e.message, e.lineno, e.colno, e.error && e.error.stack);
  });
  document.addEventListener("securitypolicyviolation", function (e) {
    reportError(window, "Blocked a network request to " + (e.blockedURI || "an outside address") + ".", 0, 0);
  });

  // ---------------------------------------------------------------- start: the chat opens on the greeting

  async function start() {
    (0, eval)(CF_LIBS.jquery);
    chatElement = document.getElementById("chat");
    document.documentElement.style.fontSize = (config.textScale || 1) * 100 + "%";
    // The page is sandboxed without forms, so a submit never fires: the button and Enter send instead.
    function submit(e) {
      e.preventDefault();
      var text = input().value.trim();
      if (!text) return;
      input().value = "";
      log("input box", "sent", text);
      queue = queue.then(function () {
        return sendUser(text).then(function (id) {
          // In a playtest, CardForge writes the reply with the real model.
          if (PLAYTEST) post({ kind: "turn", id: id });
        });
      });
    }
    document.getElementById("send_form").addEventListener("submit", submit);
    document.getElementById("send_but").addEventListener("click", submit);
    input().addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) submit(e);
    });
    var greetings = [card.first_mes || ""].concat(card.alternate_greetings || []);
    var first = newMessage("assistant", greetings[0]);
    first.swipes = greetings.slice();
    first.variables = greetings.map(function () { return {}; });
    if (greetings.join("").trim()) chat.push(first);
    renderAll();
    await emit(tavern_events.CHAT_CHANGED, "sandbox");
    for (var i = 0; i < card.scripts.length; i++) await startScript(card.scripts[i]);
    await settle();
    renderAll();
    post({ kind: "ready" });
  }

  start().catch(function (e) {
    reportError(window, "The sandbox didn't start: " + (e && e.message ? e.message : e), 0, 0, e && e.stack);
  });
})();
