// CardForge engine core: the Tavern Helper side.
//
// Runs as the card's Tavern Helper script, after updater.js and the card's own settings
// (CF_CONFIG and cfSchema, written by CardForge). It keeps the game state in each message's
// variables as MVU does (stat_data per message and per swipe, so swipes and edits roll back),
// updates it after every reply, and shares an MVU-compatible `Mvu` object so panels written for
// MVU work too.
//
// The chat text is the source of truth: each message's state can be rebuilt from the state before
// it, its update block (or the side call's answer kept with it) and the player's edits kept on it.
// A fingerprint of the text and of the state before is stored with the state, so a message whose
// text changed (an edit, a deleted swipe) or whose earlier state changed is noticed and rebuilt.

var CF_EVENTS = {
  VARIABLE_INITIALIZED: "mag_variable_initiailized",
  VARIABLE_UPDATE_STARTED: "mag_variable_update_started",
  COMMAND_PARSED: "mag_command_parsed",
  VARIABLE_UPDATE_ENDED: "mag_variable_update_ended",
  BEFORE_MESSAGE_UPDATE: "mag_before_message_update",
};
var CF_PLACEHOLDER = "<StatusPlaceHolderImpl/>";
var cfStateSchema = null;

function cfLog(message, detail) {
  console.info("[CardForge engine] " + message, detail === undefined ? "" : detail);
}

function cfSchemaOrNull() {
  if (cfStateSchema) return cfStateSchema;
  try {
    cfStateSchema = cfSchema();
  } catch (e) {
    console.warn("[CardForge engine] The variable schema didn't load; values are kept unchecked.", e);
  }
  return cfStateSchema;
}

function cfMessageData(messageId) {
  try {
    return getVariables({ type: "message", message_id: messageId }) || {};
  } catch (e) {
    return {};
  }
}

/** The state before `messageId`: the latest earlier message that has one. */
function cfStateBefore(messageId) {
  for (var i = messageId - 1; i >= 0; i--) {
    var data = cfMessageData(i);
    if (data && cfIsObject(data.stat_data)) return cfClone(data);
  }
  return null;
}

/** The initial state: [initvar] lorebook entries if the card's book has them, else the card's built-in values. */
async function cfInitialState(greeting) {
  var initial = cfClone(CF_CONFIG.initial);
  try {
    var names = getCharWorldbookNames("current");
    var books = [names.primary].concat(names.additional || []).filter(Boolean);
    for (var b = 0; b < books.length; b++) {
      var entries = await getWorldbook(books[b]);
      entries
        .filter(function (e) {
          return /\[initvar\]/i.test(e.name || "");
        })
        .forEach(function (e) {
          var parsed = YAML.parse(e.content);
          if (cfIsObject(parsed)) initial = cfMerge(initial, parsed);
        });
    }
  } catch (e) {
    cfLog("No [initvar] entry read; using the built-in values.", e);
  }
  // A greeting can set its own start: <initvar>…</initvar> replaces the values it names.
  var own = /<initvar>(?:\s*```[a-z]*)?([\s\S]*?)(?:```\s*)?<\/initvar>/i.exec(greeting || "");
  if (own) {
    try {
      var values = YAML.parse(own[1]);
      if (cfIsObject(values)) initial = cfMerge(initial, values);
    } catch (e) {
      console.warn("[CardForge engine] The greeting's <initvar> block didn't parse.", e);
    }
  }
  var schema = cfSchemaOrNull();
  if (schema) {
    var checked = schema.safeParse(initial);
    if (checked.success) initial = checked.data;
  }
  return cfRunHooks(initial, null, 0);
}

function cfMerge(base, extra) {
  var out = cfIsObject(base) ? cfClone(base) : {};
  Object.keys(extra).forEach(function (k) {
    out[k] = cfIsObject(out[k]) && cfIsObject(extra[k]) ? cfMerge(out[k], extra[k]) : cfClone(extra[k]);
  });
  return out;
}

async function cfWrite(messageId, data) {
  await updateVariablesWith(
    function (vars) {
      vars.stat_data = data.stat_data;
      if (data.delta_data) vars.delta_data = data.delta_data;
      else delete vars.delta_data;
      // The player's edits on this message, replayed whenever it is read again.
      if (data.cf_edits && data.cf_edits.length) vars.cf_edits = data.cf_edits;
      else delete vars.cf_edits;
      if (data.cf_key) vars.cf_key = data.cf_key;
      // A fingerprint of the state itself, so the next message can be checked even after this
      // one's values are cleared to keep the chat small.
      vars.cf_out = cfHash(JSON.stringify(data.stat_data === undefined ? null : data.stat_data));
      delete vars.cf_trimmed;
      if (!vars.initialized_lorebooks) vars.initialized_lorebooks = {};
      return vars;
    },
    { type: "message", message_id: messageId },
  );
}

/** Gives the first message its starting state, once per greeting swipe. */
async function cfInitialize() {
  var last = getLastMessageId();
  if (last < 0) return;
  var first = cfMessageData(0);
  if (cfIsObject(first.stat_data)) return;
  var greeting = (getChatMessages(0)[0] || {}).message || "";
  var data = { stat_data: await cfInitialState(greeting), initialized_lorebooks: {} };
  await cfWrite(0, data);
  await eventEmit(CF_EVENTS.VARIABLE_INITIALIZED, data, 0);
  await eventEmit("cf:state", 0);
  cfLog("Game state initialized.");
}

var cfBusy = Promise.resolve();

/** Shortest reply, in characters of story, that counts as a whole one. */
var CF_MIN_REPLY = 20;
var CF_BLOCK_OPEN = /<(updatevariable|variableupdate|update)\b[^>]*>/i;

/** A short fingerprint of a text (FNV-1a). */
function cfHash(text) {
  var s = String(text);
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** What a message's state was built from: its text and the state before it. */
function cfKey(plain, before) {
  return cfHash(plain) + "." + cfHash(JSON.stringify(before ? before.stat_data : null));
}

function cfChatId() {
  try {
    if (typeof SillyTavern !== "undefined") {
      if (typeof SillyTavern.getCurrentChatId === "function") return String(SillyTavern.getCurrentChatId() || "");
      var context = typeof SillyTavern.getContext === "function" ? SillyTavern.getContext() : SillyTavern;
      return String((context && context.chatId) || "");
    }
  } catch (e) {}
  return "";
}

/** The story part of a reply: no update block (closed or cut off), no panel placeholder. */
function cfStory(text) {
  return cfPlain(text)
    .replace(/<(updatevariable|variableupdate|update)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, "")
    .trim();
}

/**
 * Why a reply's own update can't be trusted, or "" when it can: no block, a block cut off (the
 * reply hit its length limit), commands in a reply too short to be whole, or a block whose every
 * change failed.
 */
function cfReplyProblem(text, result) {
  var masked = cfMask(String(text || ""));
  var open = CF_BLOCK_OPEN.exec(masked);
  if (open && !new RegExp("</" + open[1] + ">", "i").test(masked.slice(open.index))) return "its update block was cut off";
  if (!open && !result.applied.length && !result.skipped.length) return "it has no update block";
  // Bare commands with almost no story around them: likely a reply cut off early.
  if (!open && cfStory(text).length < CF_MIN_REPLY) return "it is too short to be a whole reply";
  if (!result.applied.length && result.skipped.length) return "every change in its update block was rejected";
  return "";
}

/** Who writes the updates: the card's choice, or the player's when the card doesn't lock it. */
function cfUpdateMode() {
  var card = CF_CONFIG.updateMode === "side" ? "side" : "reply";
  if (CF_CONFIG.lockMode) return card;
  var mine = cfSettings().updateMode;
  return mine === "reply" || mine === "side" ? mine : card;
}

/** Tells the player about changes the schema turned away, on the newest message only. */
function cfWarnSkipped(skipped) {
  var rejected = skipped.filter(function (s) {
    return /schema/.test(s.error);
  });
  if (!rejected.length) return;
  try {
    toastr.warning(
      "A game-state change didn't fit the card's rules and was skipped: " + rejected[0].command + (rejected.length > 1 ? " (and " + (rejected.length - 1) + " more)" : "") + ". Reroll if the values look wrong.",
    );
  } catch (e) {}
}

/** Re-reads one message's update, from the state before it. */
function cfHandle(messageId, options) {
  cfBusy = cfBusy.then(function () {
    return cfHandleNow(messageId, options).catch(function (e) {
      console.error("[CardForge engine] Update failed.", e);
    });
  });
  return cfBusy;
}

/**
 * Brings every message from `from` on up to date, in order: after an edit or a delete, the
 * messages after the change are rebuilt from the state it left. `first` options apply to the
 * first message and `rest` to the others; without `force`, only messages whose text or earlier
 * state changed are rebuilt.
 */
function cfReplay(from, first, rest) {
  cfBusy = cfBusy.then(async function () {
    for (var i = Math.max(1, from); i <= getLastMessageId(); i++) {
      try {
        await cfHandleNow(i, i === from ? first : rest);
      } catch (e) {
        console.error("[CardForge engine] Update failed.", e);
      }
    }
  });
  return cfBusy;
}

/** A message's state fingerprint: kept with it (also once its values are cleared), or worked out. */
function cfOutHash(messageId) {
  var data = cfMessageData(messageId);
  if (data.cf_out) return data.cf_out;
  return cfIsObject(data.stat_data) ? cfHash(JSON.stringify(data.stat_data)) : null;
}

/** Whether a message's state is current: built from its text as it is and the state before it now. */
function cfIsFresh(messageId, plain, saved) {
  if (!saved.cf_key || (!cfIsObject(saved.stat_data) && !saved.cf_trimmed)) return false;
  var out = messageId > 0 ? cfOutHash(messageId - 1) : null;
  if (out === null) return false;
  return saved.cf_key === cfHash(plain) + "." + out;
}

/**
 * Old messages whose values were cleared (to keep the chat small) are rebuilt from the snapshot
 * before them, quietly, when a message after them needs their state.
 */
async function cfEnsureBefore(messageId) {
  var j = messageId - 1;
  while (j >= 1 && !cfIsObject(cfMessageData(j).stat_data)) j--;
  for (var k = j + 1; k < messageId; k++) await cfHandleNow(k, { force: true, quiet: true });
}

/**
 * Builds a message's state. `options.force` rebuilds it even when it is up to date;
 * `options.call` lets it make a new side call (the newest message always may; older ones use the
 * answer kept with them, so a replay doesn't pay again); `options.redo` asks a new side call for
 * the update whatever the mode; `options.quiet` writes the state without refreshing the message.
 */
async function cfHandleNow(messageId, options) {
  options = options || {};
  var message = getChatMessages(messageId)[0];
  if (!message) return;
  if (messageId === 0) return cfInitialize();
  var plain = cfPlain(message.message);
  var saved = cfMessageData(messageId);
  if (!options.force && cfIsFresh(messageId, plain, saved)) return;
  await cfEnsureBefore(messageId);
  var before = cfStateBefore(messageId);
  if (!before) {
    await cfInitialize();
    before = cfStateBefore(messageId);
    if (!before) return;
  }
  var key = cfKey(plain, before);
  if (!options.force && cfIsObject(saved.stat_data) && saved.cf_key === key) return;
  // A swipe still being written has no text yet; it is read once it renders.
  if (message.role === "assistant" && !plain) return;
  var chatId = cfChatId();
  var swipe = message.swipe_id;
  var latest = messageId >= getLastMessageId();
  var call = latest || !!options.call;
  var data = cfClone(before);
  delete data.cf_side;
  delete data.cf_live;
  await eventEmit(CF_EVENTS.VARIABLE_UPDATE_STARTED, data);
  var schema = cfSchemaOrNull();
  var text = message.message;
  var result;
  var skipped = [];
  var redone = options.redo && message.role === "assistant" ? await cfSideUpdate(messageId, before, true, true) : "";
  if (redone) {
    result = cfUpdate(before.stat_data, redone, schema);
  } else if (message.role === "assistant" && cfUpdateMode() === "side" && !/<UpdateVariable>/i.test(text)) {
    result = cfUpdate(before.stat_data, await cfSideUpdate(messageId, before, call), schema);
  } else {
    result = cfUpdate(before.stat_data, text, schema);
    skipped = result.skipped;
    var problem = message.role === "assistant" ? cfReplyProblem(text, result) : "";
    if (problem) {
      // The reply's own update is missing or can't be trusted: a separate call writes it instead.
      cfLog("This reply's update was replaced by a side call: " + problem + ".");
      var side = await cfSideUpdate(messageId, before, call);
      // Without an answer, a cut-off reply's commands are still dropped; anything else stands.
      if (side || /cut off|too short/.test(problem)) result = cfUpdate(before.stat_data, side, schema);
    }
  }
  // What the reply's own block had turned away, even when a side call stood in for it.
  skipped = skipped.concat(result.skipped.filter(function (s) {
    return skipped.indexOf(s) < 0;
  }));
  if (skipped.length) {
    cfLog("Skipped updates", skipped);
    if (latest) cfWarnSkipped(skipped);
  }
  // Modules keep derived values (the clock, routines) in step with what the model changed.
  data.stat_data = cfRunHooks(result.stat_data, before.stat_data, messageId);
  // Living screens' items for this reply that go into list values (the phone's texts) stay in.
  data.stat_data = cfLiveMerge(messageId, data.stat_data, plain);
  data.delta_data = cfDelta(before.stat_data, data.stat_data);
  // The player's own edits on this message come last, so a re-read keeps them.
  data.cf_edits = Array.isArray(saved.cf_edits) ? saved.cf_edits : [];
  data.cf_edits.forEach(function (edit) {
    cfEditData(data, edit, messageId);
  });
  data.cf_key = key;
  // The answer may have taken a while: write only if it is still the same chat, swipe and text.
  var now = getChatMessages(messageId)[0];
  if (cfChatId() !== chatId || !now || now.swipe_id !== swipe || cfPlain(now.message) !== plain) {
    cfLog("The chat changed while message " + messageId + " was updating; its state wasn't written.");
    return;
  }
  await eventEmit(CF_EVENTS.VARIABLE_UPDATE_ENDED, data, before);
  await cfWrite(messageId, data);
  // An old message rebuilt: the next clearing pass looks at it again.
  if (messageId <= cfTrimmedTo) cfTrimmedTo = messageId - 1;
  if (options.quiet) return;
  if (message.role === "assistant" && CF_CONFIG.panel && message.message.indexOf(CF_PLACEHOLDER) < 0) {
    await setChatMessages([{ message_id: messageId, message: message.message.trimEnd() + "\n\n" + CF_PLACEHOLDER }], {
      refresh: "affected",
    });
  } else if (message.role === "assistant") {
    await setChatMessages([{ message_id: messageId }], { refresh: "affected" });
  }
  await eventEmit("cf:state", messageId);
  if (message.role === "assistant" && latest) cfLiveAfter(messageId, before.stat_data, data.stat_data);
  if (latest) await cfTrim();
}

// ---------------------------------------------------------------- keeping chats small

/** Messages at the end of the chat that keep their values. */
var CF_KEEP_RECENT = 30;
/** Every this many messages, one keeps its values as a snapshot to rebuild from. */
var CF_SNAPSHOT_EVERY = 50;
/** Messages up to here were already checked for clearing, in this chat. */
var cfTrimmedTo = 0;
var cfTrimChat = "";

/**
 * Clears the values from old messages, as MVU does, so a long chat stays light: the first message
 * and a snapshot every 50 keep theirs, and so do the last 30. A cleared message keeps its
 * fingerprints, the player's edits and the side call's answer, so it can be rebuilt from the
 * snapshot before it when something needs it. Off when the player keeps every panel live, or turns
 * it off in the settings app.
 */
async function cfTrim() {
  var settings = cfSettings();
  if (settings.trimOld === false || Number(settings.livePanels) === 0) return;
  var chat = cfChatId();
  if (chat !== cfTrimChat) {
    cfTrimChat = chat;
    cfTrimmedTo = 0;
  }
  var upTo = getLastMessageId() - CF_KEEP_RECENT;
  for (var i = Math.max(1, cfTrimmedTo + 1); i <= upTo; i++) {
    if (i % CF_SNAPSHOT_EVERY === 0 || !cfIsObject(cfMessageData(i).stat_data)) continue;
    await updateVariablesWith(
      function (vars) {
        delete vars.stat_data;
        delete vars.delta_data;
        vars.cf_trimmed = true;
        return vars;
      },
      { type: "message", message_id: i },
    );
  }
  if (upTo > cfTrimmedTo) cfTrimmedTo = upTo;
}

/** Rebuilds every message's state from the chat: the repair for values that went wrong. */
function cfRebuild() {
  return cfReplay(1, { force: true }, { force: true });
}

/** Asks a new side call for the newest reply's update, whatever the mode, and rebuilds it. */
function cfRedo() {
  for (var i = getLastMessageId(); i >= 1; i--) {
    var m = getChatMessages(i)[0];
    if (m && m.role === "assistant") return cfHandle(i, { force: true, call: true, redo: true });
  }
  return cfBusy;
}

// ---------------------------------------------------------------- side calls

/** A message's text without the panel placeholder, as the side call reads it. */
function cfPlain(text) {
  return String(text || "").split(CF_PLACEHOLDER).join("").trim();
}

function cfMacros(text) {
  try {
    return typeof substitudeMacros === "function" ? substitudeMacros(text) : text;
  } catch (e) {
    return text;
  }
}

/** The side call's answer as an update block: JSON ops, or a block the model wrote anyway. */
function cfSideBlock(raw) {
  var text = String(raw || "");
  if (/<UpdateVariable>/i.test(text)) return text;
  var json = /[[{][\s\S]*[\]}]/.exec(text.replace(/```(?:json)?/gi, ""));
  if (!json) return "";
  var parsed;
  try {
    parsed = JSON.parse(json[0]);
  } catch (e) {
    return "";
  }
  var ops = Array.isArray(parsed) ? parsed : parsed && parsed.ops;
  if (!Array.isArray(ops)) return "";
  return "<UpdateVariable>\n<JSONPatch>\n" + JSON.stringify(ops) + "\n</JSONPatch>\n</UpdateVariable>";
}

/** Messages before the reply that the side call reads. */
var CF_SIDE_MESSAGES = 2;
/** Most lore, in characters, that the side call reads. */
var CF_SIDE_LORE = 6000;

/** Whether a lorebook entry's keys appear in `text`: plain words (any case) or /regex/flags. */
function cfKeysHit(keys, text) {
  var low = String(text).toLowerCase();
  return (Array.isArray(keys) ? keys : []).some(function (key) {
    var k = String(key || "").trim();
    if (!k) return false;
    var re = /^\/([\s\S]+)\/([a-z]*)$/.exec(k);
    if (re) {
      try {
        return new RegExp(re[1], re[2]).test(text);
      } catch (e) {
        return false;
      }
    }
    return low.indexOf(k.toLowerCase()) >= 0;
  });
}

/**
 * The lore the side call reads, as MVU's extra-model parsing does: the card's entries that are on
 * (always, or by their keys in the latest messages), without the ones tagged [mvu_plot] (for the
 * story only) and without the engine's own (the side call has its own rules and state). Entries
 * tagged [mvu_update] are for the update alone and stay out of the story's prompt in side mode.
 */
async function cfSideLore(scanText) {
  var own = CF_CONFIG.ownLore || [];
  var out = [];
  try {
    var names = getCharWorldbookNames("current");
    var books = [names.primary].concat(names.additional || []).filter(Boolean);
    for (var b = 0; b < books.length; b++) {
      var entries = await getWorldbook(books[b]);
      (entries || []).forEach(function (e) {
        var name = String(e.name || e.comment || "");
        if (e.enabled === false || e.disable === true || own.indexOf(name) >= 0 || /\[(initvar|mvu_plot)\]/i.test(name)) return;
        var strategy = e.strategy || {};
        var constant = strategy.type === "constant" || e.constant === true;
        if (!constant && !cfKeysHit(strategy.keys || e.keys, scanText)) return;
        var content = String(e.content || "").trim();
        if (content) out.push(content);
      });
    }
  } catch (e) {
    cfLog("The side call read no lore.", e);
  }
  var text = cfMacros(out.join("\n\n"));
  return text.length > CF_SIDE_LORE ? text.slice(0, CF_SIDE_LORE) + "\n…" : text;
}

/**
 * Shows a folded "Updating the game state…" line under a message while a side call writes its
 * update, so the player knows the values are on their way. Only on SillyTavern's page; the message
 * text isn't touched.
 */
function cfShowUpdating(messageId, on) {
  try {
    eventEmit("cf:updating", { messageId: messageId, on: on });
  } catch (e) {}
  try {
    var doc = cfHost().document;
    var box = doc.querySelector('#chat .mes[mesid="' + messageId + '"] .mes_text');
    if (!box) return;
    var old = box.querySelector(".cf-updating");
    if (old) old.remove();
    if (!on) return;
    var fold = doc.createElement("details");
    fold.className = "cf-updating";
    fold.style.cssText = "opacity:.75;font-size:.9em;margin-top:.4em";
    fold.innerHTML = "<summary>Updating the game state…</summary><p>A second call is writing what this turn changed.</p>";
    box.appendChild(fold);
  } catch (e) {}
}

/**
 * A silent generation reads the latest turn and writes the update: after every reply with side
 * calls on (so the reply stays pure prose), and in place of a reply's own update when it is
 * missing or cut off. Its answer is kept on the message, so a re-read (an edit elsewhere, a
 * reload) doesn't pay for it again; a changed reply gets a new one. Without `call`, only a kept
 * answer is used.
 */
async function cfSideUpdate(messageId, before, call, fresh) {
  var chatId = cfChatId();
  var message = getChatMessages(messageId)[0];
  var source = cfPlain(message && message.message);
  var saved = cfMessageData(messageId).cf_side;
  if (!fresh && saved && saved.source === source) return saved.block;
  if (call === false || cfSettings().sideCalls === false) return "";
  // The last two messages before the reply: what {{user}} did, and what came before it.
  var earlier = [];
  for (var i = messageId - 1; i >= 0 && earlier.length < CF_SIDE_MESSAGES; i--) {
    var m = getChatMessages(i)[0];
    if (m && (m.role === "user" || m.role === "assistant")) earlier.unshift(m);
  }
  var line = function (m) {
    return (m.role === "user" ? "{{user}}: " : "{{char}}: ") + cfStory(m.message);
  };
  var previous = earlier.length && earlier[earlier.length - 1].role === "user" ? earlier.pop() : null;
  var lore = await cfSideLore(earlier.concat(previous ? [previous] : []).map(line).join("\n") + "\n" + source);
  var turn =
    (lore ? "<lore>\n" + lore + "\n</lore>\n\n" : "") +
    "<game_state>\n" + cfYaml(cfForAi(before.stat_data)) + "\n</game_state>\n\n" +
    (earlier.length ? "<earlier>\n" + earlier.map(line).join("\n\n") + "\n</earlier>\n\n" : "") +
    "<latest_turn>\n" +
    (previous ? line(previous) + "\n\n" : "") +
    "{{char}}: " + source + "\n</latest_turn>\n\nWrite the update for this turn.";
  cfShowUpdating(messageId, true);
  var raw;
  try {
    raw = await generateRaw({
      ordered_prompts: [
        { role: "system", content: CF_CONFIG.side.prompt },
        { role: "user", content: cfMacros(turn) },
      ],
      should_silence: true,
      json_schema: { name: "game_state_update", value: CF_CONFIG.side.schema, strict: false },
    });
  } catch (e) {
    cfShowUpdating(messageId, false);
    console.warn("[CardForge engine] The side call failed.", e);
    try {
      toastr.warning("The game state didn't update: the side call failed.");
    } catch (ignored) {}
    return "";
  }
  cfShowUpdating(messageId, false);
  var block = cfSideBlock(raw);
  if (!block) cfLog("The side call's answer had no update in it.", raw);
  // A swipe or an edit while it ran: the answer is for text that's gone.
  var now = getChatMessages(messageId)[0];
  if (cfChatId() !== chatId || !now || now.swipe_id !== message.swipe_id || cfPlain(now.message) !== source) return block;
  await updateVariablesWith(
    function (vars) {
      vars.cf_side = { source: source, block: block };
      return vars;
    },
    { type: "message", message_id: messageId },
  );
  return block;
}

/** The MVU-compatible interface panels use (`await waitGlobalInitialized('Mvu')`). */
var cfMvu = {
  events: CF_EVENTS,
  getMvuData: function (options) {
    return getVariables(options || { type: "message", message_id: "latest" });
  },
  replaceMvuData: async function (data, options) {
    replaceVariables(data, options || { type: "message", message_id: "latest" });
  },
  parseMessage: async function (message, old) {
    var result = cfUpdate((old || {}).stat_data, message, cfSchemaOrNull());
    if (!result.applied.length) return undefined;
    var next = cfClone(old || {});
    next.stat_data = result.stat_data;
    next.delta_data = result.delta;
    return next;
  },
  isDuringExtraAnalysis: function () {
    return false;
  },
};

function cfLatestState() {
  var last = getLastMessageId();
  var before = cfStateBefore(last + 1);
  return before ? before.stat_data : CF_CONFIG.initial;
}

function cfStart() {
  var schema = cfSchemaOrNull();
  if (schema && typeof registerVariableSchema === "function") {
    try {
      registerVariableSchema(z.object({ stat_data: schema }), { type: "message" });
    } catch (e) {
      cfLog("Tavern Helper's variable manager didn't take the schema.", e);
    }
  }
  initializeGlobal("Mvu", cfMvu);
  cfCoreStart();
  initializeGlobal("CardForgeEngine", { version: CF_CONFIG.version, state: cfLatestState, update: cfUpdate });
  // New messages are read once they render, so the player sees the reply before any side call.
  eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, function (id) {
    return cfHandle(Number(id));
  });
  eventOn(tavern_events.USER_MESSAGE_RENDERED, function (id) {
    return cfHandle(Number(id));
  });
  // An edited message is read again, and the messages after it rebuilt from what it left.
  eventOn(tavern_events.MESSAGE_EDITED, function (id) {
    return cfReplay(Number(id), { force: true, call: true }, { force: true });
  });
  // After a delete the later messages moved up: each whose earlier state changed is rebuilt.
  if (tavern_events.MESSAGE_DELETED)
    eventOn(tavern_events.MESSAGE_DELETED, function () {
      return cfReplay(1);
    });
  // With the side call writing the updates, the update rules stay out of the story's prompt.
  if (tavern_events.WORLDINFO_ENTRIES_LOADED)
    eventOn(tavern_events.WORLDINFO_ENTRIES_LOADED, function (lists) {
      if (cfUpdateMode() !== "side" || !lists) return;
      ["globalLore", "characterLore", "chatLore", "personaLore"].forEach(function (k) {
        var list = lists[k];
        if (!Array.isArray(list)) return;
        for (var i = list.length - 1; i >= 0; i--) if (/^\[mvu_update\]/i.test((list[i] && list[i].comment) || "")) list.splice(i, 1);
      });
    });
  eventOn(tavern_events.CHAT_CHANGED, function () {
    cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
      console.error("[CardForge engine] Start failed.", e);
    });
  });
  // A swipe shows that swipe's own state; if its text no longer matches it (a deleted swipe
  // moved another's text in), it is rebuilt.
  eventOn(tavern_events.MESSAGE_SWIPED, function (id) {
    id = Number(id);
    if (id === 0)
      cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
        console.error("[CardForge engine] Start failed.", e);
      });
    else return cfReplay(id);
  });
  cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
    console.error("[CardForge engine] Start failed.", e);
  });
  cfLog("Engine " + CF_CONFIG.version + " running.");
}

cfStart();
