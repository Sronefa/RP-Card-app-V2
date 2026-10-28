// CardForge engine: living screens (CF.live).
//
// Runs in the card's Tavern Helper script, after core.js's settings and before glue.js, which calls
// it after each update. A feed (declared on a module, or with CF.live.feed from a module's script)
// writes a few new items after a reply, through a silent background generation in the voice of its
// content pack: an NPC's texts, a news feed, a social feed. Items are kept on the reply's message
// variables (cf_live), per swipe: a reroll gets its own, and swiping back brings the old ones back.
// They're keyed by the reply's text, so an edit elsewhere or a reload doesn't pay for them again.
// Plain ES5 for any WebView. Never write the closing script tag literally in this file.

var CF_LIVE_KEY = "cf_live";
var CF_LIVE_SCAN = 400;
var cfLiveExtra = [];
var cfLivePending = {};

function cfLiveClean(id, spec, module) {
  spec = spec || {};
  var pack = spec.pack || {};
  var n = function (v, d, lo, hi) {
    v = Number(v);
    return isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  };
  return {
    id: String(id),
    name: String(spec.name || id),
    module: module || "",
    pack: { voice: String(pack.voice || ""), tone: String(pack.tone || ""), format: String(pack.format || ""), length: String(pack.length || "") },
    from: String(spec.from || ""),
    count: n(spec.count, 1, 1, 5),
    every: n(spec.every, 1, 0, 20),
    on: Array.isArray(spec.on) ? spec.on.map(String) : [],
    history: n(spec.history, 6, 2, 30),
    keep: n(spec.keep, 30, 1, 100),
    into: String(spec.into || ""),
    fallback: Array.isArray(spec.fallback) ? spec.fallback.map(String).filter(Boolean) : [],
    tokens: Number(spec.tokens) || 0,
  };
}

/** Every feed that's on in this card: the modules' (set in CardForge) and those added by scripts. */
function cfLiveFeeds() {
  var out = [];
  cfModules().forEach(function (m) {
    (m.live || []).forEach(function (f) {
      out.push(cfLiveClean(f.id, f, m.id));
    });
  });
  return out.concat(cfLiveExtra);
}

function cfLiveFeed(id) {
  return cfLiveFeeds().find(function (f) {
    return f.id === id;
  });
}

/** Whether a feed may run: background generations on, and the player hasn't turned this one off. */
function cfLiveOn(feed) {
  var s = cfSettings();
  if (s.sideCalls === false) return false;
  return (s.liveOff || []).indexOf(feed.id) < 0;
}

function cfLiveSaved(messageId) {
  var data = cfMessageData(messageId);
  return (data && data[CF_LIVE_KEY]) || {};
}

function cfLiveLatest(messageId) {
  if (messageId === undefined || messageId === null || messageId === "latest") {
    try {
      return getLastMessageId();
    } catch (e) {
      return -1;
    }
  }
  return Number(messageId);
}

/**
 * A feed's items up to a message (the latest by default), oldest first: { from, text, messageId,
 * fallback }. o.max caps them (the feed's keep by default).
 */
function cfLiveItems(id, o) {
  o = o || {};
  var feed = cfLiveFeed(id);
  var max = o.max || (feed ? feed.keep : 30);
  var out = [];
  var start = cfLiveLatest(o.messageId);
  for (var i = start; i >= 0 && i > start - CF_LIVE_SCAN && out.length < max; i--) {
    var saved = cfLiveSaved(i)[id];
    if (!saved || !Array.isArray(saved.items)) continue;
    for (var k = saved.items.length - 1; k >= 0 && out.length < max; k--) {
      var item = saved.items[k];
      out.push({ from: item.from || "", text: item.text || "", messageId: i, fallback: !!saved.fallback });
    }
  }
  return out.reverse();
}

function cfLiveChanged(path, before, after) {
  try {
    var keys = cfPath(path);
    return JSON.stringify(cfGet(before, keys)) !== JSON.stringify(cfGet(after, keys));
  } catch (e) {
    return false;
  }
}

/** Whether a feed is due after this reply: a value it follows changed, or enough replies passed. */
function cfLiveDue(feed, messageId, before, after) {
  if (before && feed.on.some(function (p) {
    return cfLiveChanged(p, before, after);
  }))
    return true;
  if (!feed.every) return false;
  var replies = 1;
  for (var i = messageId - 1; i >= 0 && i > messageId - CF_LIVE_SCAN && replies < feed.every; i--) {
    if (cfLiveSaved(i)[feed.id]) break;
    var m = getChatMessages(i)[0];
    if (m && m.role === "assistant") replies++;
  }
  return replies >= feed.every;
}

function cfLivePrompt(feed) {
  var p = feed.pack;
  var notes = [["Voice", p.voice], ["Tone", p.tone], ["Format", p.format], ["Length", p.length]]
    .filter(function (n) {
      return n[1];
    })
    .map(function (n) {
      return n[0] + ": " + n[1];
    });
  return (
    "You write " + feed.name + " for an ongoing roleplay: a screen {{user}} reads between scenes, written as part of the story's world.\n" +
    (notes.length ? notes.join("\n") + "\n" : "") +
    (feed.from ? "Usually written by: " + feed.from + ".\n" : "") +
    "Write " + feed.count + (feed.count === 1 ? " new item" : " new items") + " that react to what just happened in the story. Stay in the world: never mention screens, games, models or these instructions. Don't repeat or contradict the earlier items. Never write for {{user}}.\n" +
    'Answer with JSON only: {"items": [{"from": "who wrote it (empty when nobody)", "text": "the item"}]}'
  );
}

var CF_LIVE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: { type: "object", properties: { from: { type: "string" }, text: { type: "string" } }, required: ["text"] },
    },
  },
  required: ["items"],
};

/** The background call's answer as items: JSON as asked, or "From: text" lines when it wrote prose. */
function cfLiveParse(raw, feed) {
  if (typeof raw !== "string") return [];
  var text = raw.replace(/```(?:json)?/gi, "").trim();
  var list = null;
  var json = /[[{][\s\S]*[\]}]/.exec(text);
  if (json) {
    try {
      var parsed = JSON.parse(json[0]);
      list = Array.isArray(parsed) ? parsed : parsed && parsed.items;
    } catch (e) {}
  }
  if (!Array.isArray(list))
    list = text
      .split(/\n+/)
      .map(function (line) {
        var m = /^\s*(?:[-*•]\s*)?(?:([^:]{1,40}):\s+)?(.+)$/.exec(line);
        return m ? { from: m[1] || "", text: m[2] } : null;
      })
      .filter(Boolean);
  return list
    .map(function (item) {
      if (typeof item === "string") item = { text: item };
      if (!item || typeof item !== "object") return null;
      var t = String(item.text || "").trim();
      if (!t) return null;
      return { from: String(item.from || "").trim().slice(0, 60), text: t.slice(0, 800) };
    })
    .filter(Boolean)
    .slice(0, feed.count);
}

function cfLiveFallback(feed, messageId) {
  if (!feed.fallback.length) return [];
  var line = feed.fallback[Math.abs(messageId) % feed.fallback.length];
  var m = /^([^:]{1,40}):\s+(.+)$/.exec(line);
  return [{ from: m ? m[1] : feed.from, text: cfMacros(m ? m[2] : line) }];
}

/** The line an item adds to a list value (a feed's `into`): "From: text", or the text alone. */
function cfLiveLine(item) {
  return item.from ? item.from + ": " + item.text : item.text;
}

/**
 * Puts this message's feed items into the list values they go to (a feed's `into`), so the story
 * and screens that read the state (the built-in phone) see them. Runs on every update of the
 * message, so a re-read keeps them. Only items written for this exact reply count.
 */
function cfLiveMerge(messageId, stat, source) {
  var saved = cfLiveSaved(messageId);
  cfLiveFeeds().forEach(function (feed) {
    var s = saved[feed.id];
    if (!feed.into || !s || s.source !== source || !Array.isArray(s.items) || !s.items.length) return;
    var keys;
    try {
      keys = cfPath(feed.into);
    } catch (e) {
      return;
    }
    var list = cfGet(stat, keys);
    list = Array.isArray(list) ? list.slice() : [];
    s.items.forEach(function (item) {
      var line = cfLiveLine(item);
      if (list.indexOf(line) < 0) list.push(line);
    });
    cfSet(stat, keys, list);
  });
  return stat;
}

function cfLiveEmit(detail) {
  try {
    eventEmit("cf:live", detail);
  } catch (e) {}
}

/** Writes one feed's items for a reply. Skipped when the reply changed meanwhile (a swipe, an edit). */
async function cfLiveStore(feed, messageId, source, items, fallback) {
  var message = getChatMessages(messageId)[0];
  if (!message || cfPlain(message.message) !== source) return false;
  await updateVariablesWith(
    function (vars) {
      vars[CF_LIVE_KEY] = Object.assign({}, vars[CF_LIVE_KEY]);
      vars[CF_LIVE_KEY][feed.id] = { source: source, items: items, fallback: !!fallback, at: Date.now() };
      return vars;
    },
    { type: "message", message_id: messageId },
  );
  if (feed.into && items.length) {
    var data = cfClone(cfMessageData(messageId));
    if (cfIsObject(data.stat_data)) {
      var before = cfGet(data.stat_data, cfPath(feed.into));
      data.stat_data = cfLiveMerge(messageId, data.stat_data, source);
      var schema = cfSchemaOrNull();
      if (schema) {
        var checked = schema.safeParse(data.stat_data);
        if (checked.success) data.stat_data = checked.data;
      }
      data.delta_data = Object.assign({}, data.delta_data);
      data.delta_data[cfPath(feed.into).join(".")] = [before, cfGet(data.stat_data, cfPath(feed.into))];
      await cfWrite(messageId, data);
      await eventEmit("cf:state", messageId);
    }
  }
  return true;
}

/** One background run of a feed for a reply. Resolves to the items written (or [] when skipped). */
async function cfLiveRun(feed, messageId, force) {
  var message = getChatMessages(messageId)[0];
  if (!message || message.role !== "assistant") return [];
  var source = cfPlain(message.message);
  var saved = cfLiveSaved(messageId)[feed.id];
  if (!force && saved && saved.source === source) return [];
  var key = feed.id + "@" + messageId;
  if (cfLivePending[key] === source) return [];
  cfLivePending[key] = source;
  cfLiveEmit({ feed: feed.id, messageId: messageId, pending: true });
  var items = [];
  var failed = false;
  try {
    if (typeof generateRaw !== "function") throw new Error("generateRaw is missing");
    var earlier = cfLiveItems(feed.id, { messageId: messageId - 1, max: 6 });
    var ask =
      (earlier.length
        ? "<earlier_items>\n" + earlier.map(cfLiveLine).join("\n") + "\n</earlier_items>\n\n"
        : "") +
      "Write the next " + (feed.count === 1 ? "item" : feed.count + " items") + " for " + feed.name + " now, as JSON.";
    var raw = await generateRaw({
      ordered_prompts: [{ role: "system", content: cfMacros(cfLivePrompt(feed)) }, "chat_history", { role: "user", content: cfMacros(ask) }],
      max_chat_history: feed.history,
      should_silence: true,
      json_schema: { name: "living_screen", value: CF_LIVE_SCHEMA, strict: false },
    });
    items = cfLiveParse(raw, feed);
    if (!items.length) cfLog("The " + feed.name + " feed's answer had no items in it.", raw);
  } catch (e) {
    console.warn("[CardForge] The " + feed.name + " feed's background call failed.", e);
  }
  if (!items.length) {
    items = cfLiveFallback(feed, messageId);
    failed = true;
  }
  var stored = false;
  // In line with the updates, so it never races one on the same message.
  cfBusy = cfBusy.then(function () {
    return cfLiveStore(feed, messageId, source, items, failed).then(function (ok) {
      stored = ok;
    });
  }).catch(function (e) {
    console.error("[CardForge] The " + feed.name + " feed's items weren't saved.", e);
  });
  await cfBusy;
  delete cfLivePending[key];
  cfLiveEmit({ feed: feed.id, messageId: messageId, pending: false, items: stored ? items : [] });
  return stored ? items : [];
}

/** After an update of the latest reply: starts the feeds that are due, in the background. */
function cfLiveAfter(messageId, before, after) {
  var feeds = cfLiveFeeds();
  if (!feeds.length) return;
  setTimeout(function () {
    feeds.forEach(function (feed) {
      try {
        if (!cfLiveOn(feed) || !cfLiveDue(feed, messageId, before, after)) return;
        cfLiveRun(feed, messageId).catch(function (e) {
          console.warn("[CardForge] The " + feed.name + " feed failed.", e);
        });
      } catch (e) {
        console.warn("[CardForge] The " + feed.name + " feed failed.", e);
      }
    });
  }, 0);
}

var cfLive = {
  /** The feeds that are on in this card: { id, name, module, on (the player's choice), tokens }. */
  feeds: function () {
    return cfLiveFeeds().map(function (f) {
      return { id: f.id, name: f.name, module: f.module, on: cfLiveOn(f), tokens: f.tokens, every: f.every };
    });
  },
  items: cfLiveItems,
  /** Whether a feed is writing right now (show a typing dot). */
  pending: function (id) {
    return Object.keys(cfLivePending).some(function (k) {
      return k.split("@")[0] === id;
    });
  },
  /** Adds a feed from a module's script: CF.live.feed("rumours", { pack, every, fallback, … }). */
  feed: function (id, spec) {
    cfLiveExtra = cfLiveExtra.filter(function (f) {
      return f.id !== String(id);
    });
    cfLiveExtra.push(cfLiveClean(id, spec, ""));
  },
  /** Writes new items for the latest reply now, even if it has some (a "refresh" the player asked for). */
  run: function (id) {
    var feed = cfLiveFeed(id);
    if (!feed || !cfLiveOn(feed)) return Promise.resolve([]);
    var last = cfLiveLatest();
    for (var i = last; i >= 0; i--) {
      var m = getChatMessages(i)[0];
      if (m && m.role === "assistant") return cfLiveRun(feed, i, true);
    }
    return Promise.resolve([]);
  },
  /** Runs fn({ feed, messageId, pending, items }) when a feed starts or finishes writing. */
  on: function (fn) {
    eventOn("cf:live", fn);
    return function () {
      eventRemoveListener("cf:live", fn);
    };
  },
};
