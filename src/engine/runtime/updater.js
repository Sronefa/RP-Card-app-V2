// CardForge engine core: the variable updater.
//
// Plain JavaScript with no imports: CardForge pastes this file into every engine card's Tavern Helper
// script, and the tests load it the same way. It reads the update block a reply ends with and applies
// it to the game state, the way MVU (MagVarUpdate) does: the same <UpdateVariable> block, the same
// JSONPatch ops (replace, delta, insert/add, remove, move) and the same _.set / _.add / _.insert /
// _.delete commands, all on stat_data paths.

/** Splits a path ("a.b[0]", 'a["x y"]', "/a/b/0") into its keys. A leading "stat_data" is dropped. */
function cfPath(path) {
  var p = String(path == null ? "" : path).trim();
  var keys = [];
  if (p.charAt(0) === "/") {
    keys = p
      .slice(1)
      .split("/")
      .map(function (k) {
        return k.replace(/~1/g, "/").replace(/~0/g, "~");
      });
  } else {
    var re = /\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+))\s*\]|([^.[\]]+)/g;
    var m;
    while ((m = re.exec(p))) {
      var k = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
      keys.push(String(k).replace(/\\(.)/g, "$1").trim());
    }
  }
  keys = keys.filter(function (k) {
    return k !== "";
  });
  if (keys[0] === "stat_data") keys.shift();
  return keys;
}

function cfClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cfIsObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cfGet(root, keys) {
  var node = root;
  for (var i = 0; i < keys.length; i++) {
    if (node === null || typeof node !== "object") return undefined;
    node = node[keys[i]];
  }
  return node;
}

/** Sets a value, creating objects on the way. Returns false if a key on the way isn't an object. */
function cfSet(root, keys, value) {
  if (!keys.length) return false;
  var node = root;
  for (var i = 0; i < keys.length - 1; i++) {
    var next = node[keys[i]];
    if (next === undefined) next = node[keys[i]] = {};
    if (next === null || typeof next !== "object") return false;
    node = next;
  }
  node[keys[keys.length - 1]] = value;
  return true;
}

function cfUnset(root, keys) {
  var parent = cfGet(root, keys.slice(0, -1));
  var last = keys[keys.length - 1];
  if (parent === null || typeof parent !== "object" || !(last in parent)) return false;
  if (Array.isArray(parent) && /^\d+$/.test(last)) parent.splice(Number(last), 1);
  else delete parent[last];
  return true;
}

/** Reads a value the model wrote: JSON when it parses, else the text without quotes. */
function cfValue(literal) {
  if (typeof literal !== "string") return literal;
  var s = literal.trim();
  if (s === "") return "";
  try {
    return JSON.parse(s);
  } catch (e) {
    /* not JSON */
  }
  var q = /^'([\s\S]*)'$/.exec(s) || /^`([\s\S]*)`$/.exec(s);
  if (q) return q[1].replace(/\\'/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === "true" || s === "false") return s === "true";
  if (s === "null" || s === "undefined") return null;
  return s;
}

/** Replaces thinking and analysis sections with spaces, so commands quoted there don't run. */
function cfMask(text) {
  return text.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, function (block) {
    return block.replace(/[^\n]/g, " ");
  });
}

/** Lenient JSON for patches: code fences, comments and trailing commas are tolerated. */
function cfParseJson(text) {
  var s = text
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    var cleaned = s.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(cleaned);
  }
}

/** Finds the closing parenthesis of a call, skipping strings and nested brackets. */
function cfCloseParen(text, open) {
  var depth = 1;
  var quote = "";
  for (var i = open; i < text.length; i++) {
    var c = text.charAt(i);
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return c === ")" ? i : -1;
    }
  }
  return -1;
}

/** Splits call arguments on top-level commas. */
function cfArgs(text) {
  var args = [];
  var depth = 0;
  var quote = "";
  var start = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) args.push(text.slice(start).trim());
  return args;
}

function cfPatchCommands(ops) {
  var out = [];
  (Array.isArray(ops) ? ops : [ops]).forEach(function (op) {
    if (!op || typeof op !== "object") return;
    var path = cfPath(op.path != null ? op.path : op.to);
    var full = JSON.stringify(op);
    if (op.op === "replace") out.push({ type: "set", path: path, value: op.value, full: full });
    else if (op.op === "delta") out.push({ type: "add", path: path, value: op.value, full: full });
    else if (op.op === "add" || op.op === "insert")
      out.push({ type: "insert", path: path.slice(0, -1), key: path[path.length - 1], value: op.value, full: full });
    else if (op.op === "remove") out.push({ type: "delete", path: path, full: full });
    else if (op.op === "move") out.push({ type: "move", from: cfPath(op.from), path: path, full: full });
  });
  return out;
}

/**
 * Reads every update command in a reply, in order. Inside an <UpdateVariable> block when there is
 * one (anywhere in the reply otherwise): JSONPatch blocks, then _.set-style calls.
 */
function cfExtractCommands(text) {
  var source = cfMask(String(text || ""));
  var blocks = [];
  var blockRe = /<(updatevariable|variableupdate|update)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  var m;
  while ((m = blockRe.exec(source))) blocks.push(m[2]);
  var scan = blocks.length ? blocks : [source];
  var out = [];
  scan.forEach(function (body) {
    var patchRe = /<json_?patch\b[^>]*>([\s\S]*?)<\/json_?patch>/gi;
    var p;
    while ((p = patchRe.exec(body))) {
      try {
        out.push.apply(out, cfPatchCommands(cfParseJson(p[1])));
      } catch (e) {
        /* a broken patch is skipped */
      }
    }
    var rest = body.replace(patchRe, function (b) {
      return b.replace(/[^\n]/g, " ");
    });
    var callRe = /_\.(set|add|insert|assign|delete|remove|unset)\(/g;
    var c;
    while ((c = callRe.exec(rest))) {
      var open = c.index + c[0].length;
      var close = cfCloseParen(rest, open);
      if (close < 0) continue;
      var args = cfArgs(rest.slice(open, close)).map(cfValue);
      var full = rest.slice(c.index, close + 1);
      var type = c[1];
      var path = cfPath(args[0]);
      callRe.lastIndex = close + 1;
      if (type === "set" && args.length >= 2) out.push({ type: "set", path: path, value: args[args.length - 1], full: full });
      else if (type === "add" && args.length === 2) out.push({ type: "add", path: path, value: args[1], full: full });
      else if ((type === "insert" || type === "assign") && args.length >= 2)
        out.push(
          args.length >= 3
            ? { type: "insert", path: path, key: String(args[1]), value: args[2], full: full }
            : { type: "insert", path: path, value: args[1], full: full },
        );
      else if (args.length >= 1 && (type === "delete" || type === "remove" || type === "unset"))
        out.push(args.length >= 2 ? { type: "delete", path: path, item: args[1], full: full } : { type: "delete", path: path, full: full });
    }
  });
  return out;
}

/** True when a command touches a read-only field (a key starting with "_"). */
function cfReadOnly(command) {
  var keys = command.path.concat(command.from || []);
  return keys.some(function (k) {
    return String(k).charAt(0) === "_";
  });
}

/** Applies one command to `data` in place. Returns an error message, or "" when it applied. */
function cfApply(data, command) {
  var path = command.path;
  if (cfReadOnly(command)) return "read-only field";
  if (command.type === "set") {
    if (!path.length) return "no path";
    return cfSet(data, path, cfClone(command.value)) ? "" : "bad path";
  }
  if (command.type === "add") {
    var current = cfGet(data, path);
    var delta = command.value;
    if (typeof current === "boolean") return cfSet(data, path, !current) ? "" : "bad path";
    if (typeof delta === "string" && delta.trim() !== "" && !isNaN(Number(delta))) delta = Number(delta);
    if (typeof delta !== "number") return "delta is not a number";
    var base = typeof current === "number" ? current : Number(current);
    if (current === undefined) base = 0;
    if (isNaN(base)) return "value is not a number";
    return cfSet(data, path, Math.round((base + delta) * 1e6) / 1e6) ? "" : "bad path";
  }
  if (command.type === "insert") {
    var target = path.length ? cfGet(data, path) : data;
    if (target === undefined && path.length) {
      target = command.key == null || /^\d+$/.test(command.key) || command.key === "-" ? [] : {};
      if (!cfSet(data, path, target)) return "bad path";
    }
    if (Array.isArray(target)) {
      if (command.key == null || command.key === "-") target.push(cfClone(command.value));
      else if (/^\d+$/.test(command.key)) target.splice(Number(command.key), 0, cfClone(command.value));
      else return "not an object";
      return "";
    }
    if (cfIsObject(target)) {
      if (command.key == null) {
        if (!cfIsObject(command.value)) return "not a list";
        Object.keys(command.value).forEach(function (k) {
          target[k] = cfClone(command.value[k]);
        });
      } else target[command.key] = cfClone(command.value);
      return "";
    }
    return "not a list or object";
  }
  if (command.type === "delete") {
    if (!("item" in command)) return path.length && cfUnset(data, path) ? "" : "nothing to delete";
    var holder = cfGet(data, path);
    if (Array.isArray(holder)) {
      var item = command.item;
      var at = holder.findIndex(function (v) {
        return JSON.stringify(v) === JSON.stringify(item);
      });
      if (at < 0 && typeof item === "number" && item < holder.length) at = item;
      if (at < 0) return "item not found";
      holder.splice(at, 1);
      return "";
    }
    if (cfIsObject(holder) && String(command.item) in holder) {
      delete holder[String(command.item)];
      return "";
    }
    return "item not found";
  }
  if (command.type === "move") {
    var value = cfGet(data, command.from);
    if (value === undefined) return "nothing to move";
    cfUnset(data, command.from);
    return cfSet(data, path, value) ? "" : "bad path";
  }
  return "unknown command";
}

/** Lists the paths whose value changed, as { path: [old, new] }. */
function cfDelta(before, after, prefix, out) {
  out = out || {};
  prefix = prefix || "";
  var keys = {};
  [before, after].forEach(function (o) {
    if (cfIsObject(o))
      Object.keys(o).forEach(function (k) {
        keys[k] = true;
      });
  });
  Object.keys(keys).forEach(function (k) {
    var a = cfIsObject(before) ? before[k] : undefined;
    var b = cfIsObject(after) ? after[k] : undefined;
    var path = prefix ? prefix + "." + k : k;
    if (cfIsObject(a) && cfIsObject(b)) cfDelta(a, b, path, out);
    else if (JSON.stringify(a) !== JSON.stringify(b)) out[path] = [a, b];
  });
  return out;
}

/**
 * Runs a reply's commands on a copy of `stat`. With a Zod `schema`, each command must leave the
 * state valid or it is undone, and the result goes through the schema's repairs (clamps, defaults).
 * Returns { stat_data, delta, applied, skipped }.
 */
function cfUpdate(stat, text, schema) {
  var data = cfClone(stat) || {};
  var commands = cfExtractCommands(text);
  var applied = [];
  var skipped = [];
  commands.forEach(function (command) {
    var before = cfClone(data);
    var error = cfApply(data, command);
    if (!error && schema) {
      var check = schema.safeParse(data);
      if (!check.success) error = "rejected by the schema: " + ((check.error.issues || [])[0] || {}).message;
    }
    if (error) {
      data = before;
      skipped.push({ command: command.full, error: error });
    } else applied.push(command.full);
  });
  if (schema) {
    var repaired = schema.safeParse(data);
    if (repaired.success) data = repaired.data;
  }
  return { stat_data: data, delta: cfDelta(stat || {}, data), applied: applied, skipped: skipped };
}

/** Copies the state with every key starting with "$" left out: those fields are hidden from the AI. */
function cfForAi(value) {
  if (Array.isArray(value)) return value.map(cfForAi);
  if (!cfIsObject(value)) return value;
  var out = {};
  Object.keys(value).forEach(function (k) {
    if (k.charAt(0) !== "$") out[k] = cfForAi(value[k]);
  });
  return out;
}

/** A small YAML writer for the state the AI reads. */
function cfYaml(value, indent) {
  indent = indent || "";
  var scalar = function (v) {
    if (typeof v === "string") return /^[\w][\w .,'!?()-]*$/.test(v) && !/^(true|false|null|-?\d)/.test(v) ? v : JSON.stringify(v);
    return JSON.stringify(v === undefined ? null : v);
  };
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map(function (v) {
        return cfIsObject(v) || (Array.isArray(v) && v.length)
          ? indent + "-\n" + cfYaml(v, indent + "  ")
          : indent + "- " + scalar(v);
      })
      .join("\n");
  }
  if (cfIsObject(value)) {
    var keys = Object.keys(value);
    if (!keys.length) return "{}";
    return keys
      .map(function (k) {
        var v = value[k];
        var key = indent + (/^[\w$][\w $-]*$/.test(k) ? k : JSON.stringify(k)) + ":";
        if ((cfIsObject(v) && Object.keys(v).length) || (Array.isArray(v) && v.length)) return key + "\n" + cfYaml(v, indent + "  ");
        return key + " " + (cfIsObject(v) ? "{}" : Array.isArray(v) ? "[]" : scalar(v));
      })
      .join("\n");
  }
  return indent + scalar(value);
}
