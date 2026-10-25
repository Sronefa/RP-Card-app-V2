// CardForge engine core: the Tavern Helper side.
//
// Runs as the card's Tavern Helper script, after updater.js and the card's own settings
// (CF_CONFIG and cfSchema, written by CardForge). It keeps the game state in each message's
// variables as MVU does (stat_data per message and per swipe, so swipes and edits roll back),
// updates it after every reply, and shares an MVU-compatible `Mvu` object so panels written for
// MVU work too.

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
  return initial;
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
  cfLog("Game state initialized.");
}

var cfBusy = Promise.resolve();

/** Re-reads one message's update block, from the state before it. */
function cfHandle(messageId) {
  cfBusy = cfBusy.then(function () {
    return cfHandleNow(messageId).catch(function (e) {
      console.error("[CardForge engine] Update failed.", e);
    });
  });
  return cfBusy;
}

async function cfHandleNow(messageId) {
  var message = getChatMessages(messageId)[0];
  if (!message) return;
  if (messageId === 0) return cfInitialize();
  var before = cfStateBefore(messageId);
  if (!before) {
    await cfInitialize();
    before = cfStateBefore(messageId);
    if (!before) return;
  }
  var data = cfClone(before);
  await eventEmit(CF_EVENTS.VARIABLE_UPDATE_STARTED, data);
  var result = cfUpdate(before.stat_data, message.message, cfSchemaOrNull());
  if (result.skipped.length) cfLog("Skipped updates", result.skipped);
  data.stat_data = result.stat_data;
  data.delta_data = result.delta;
  await eventEmit(CF_EVENTS.VARIABLE_UPDATE_ENDED, data, before);
  await cfWrite(messageId, data);
  if (message.role === "assistant" && CF_CONFIG.panel && message.message.indexOf(CF_PLACEHOLDER) < 0) {
    await setChatMessages([{ message_id: messageId, message: message.message.trimEnd() + "\n\n" + CF_PLACEHOLDER }], {
      refresh: "affected",
    });
  } else if (message.role === "assistant") {
    await setChatMessages([{ message_id: messageId }], { refresh: "affected" });
  }
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
  initializeGlobal("CardForgeEngine", { version: CF_CONFIG.version, state: cfLatestState, update: cfUpdate });
  eventOn(tavern_events.MESSAGE_RECEIVED, function (id) {
    return cfHandle(id);
  });
  eventOn(tavern_events.MESSAGE_SENT, function (id) {
    return cfHandle(id);
  });
  eventOn(tavern_events.MESSAGE_EDITED, function (id) {
    return cfHandle(id);
  });
  eventOn(tavern_events.CHAT_CHANGED, function () {
    cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
      console.error("[CardForge engine] Start failed.", e);
    });
  });
  eventOn(tavern_events.MESSAGE_SWIPED, function (id) {
    if (id === 0)
      cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
        console.error("[CardForge engine] Start failed.", e);
      });
  });
  cfBusy = cfBusy.then(cfInitialize).catch(function (e) {
    console.error("[CardForge engine] Start failed.", e);
  });
  cfLog("Engine " + CF_CONFIG.version + " running.");
}

cfStart();
