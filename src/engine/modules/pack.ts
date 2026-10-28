/**
 * Module pack files: a JSON list of modules to move between machines or share. Anything read from
 * a file is checked field by field, so a broken or hand-edited pack can't put odd values in a card.
 */
import { newId } from "../../lib/id";
import { VAR_TYPES, type EngineVar, type VarType } from "../sheet";
import { resolveModule } from "./compile";
import { cleanLiveFeeds } from "./live";
import { CORE_KINDS, PACK_FORMAT, SLOTS, type CoreKind, type EngineModule, type ModuleFork, type ModulePack, type ModuleRegex, type ModuleRule, type Slot } from "./types";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function cleanVar(raw: unknown): EngineVar | null {
  if (!isObject(raw)) return null;
  const type = (str(raw.type) in VAR_TYPES ? raw.type : "text") as VarType;
  return {
    id: str(raw.id) || newId(),
    group: str(raw.group),
    name: str(raw.name),
    type,
    start: str(raw.start),
    min: num(raw.min),
    max: num(raw.max),
    options: Array.isArray(raw.options) ? strings(raw.options) : undefined,
    rule: str(raw.rule),
    hidden: raw.hidden === true || undefined,
    readOnly: raw.readOnly === true || undefined,
    pinned: raw.pinned !== false,
  };
}

function cleanRule(raw: unknown): ModuleRule | null {
  if (!isObject(raw) || !str(raw.content).trim()) return null;
  return {
    comment: str(raw.comment, "Rule"),
    content: str(raw.content),
    constant: raw.constant !== false,
    keys: strings(raw.keys),
    depth: num(raw.depth),
    order: num(raw.order) ?? 100,
  };
}

function cleanRegex(raw: unknown): ModuleRegex | null {
  if (!isObject(raw) || !str(raw.find).trim()) return null;
  const only = raw.only === "display" || raw.only === "prompt" ? raw.only : "both";
  return {
    name: str(raw.name),
    find: str(raw.find),
    replace: str(raw.replace),
    ai: raw.ai !== false,
    user: raw.user === true,
    only,
    minDepth: num(raw.minDepth),
  };
}

function cleanFork(raw: unknown): ModuleFork | undefined {
  if (!isObject(raw) || !(CORE_KINDS as readonly string[]).includes(str(raw.core))) return undefined;
  return {
    core: raw.core as CoreKind,
    settings: isObject(raw.settings) ? structuredClone(raw.settings) : {},
    code: str(raw.code),
    ...(str(raw.piece) ? { piece: str(raw.piece) } : {}),
    at: num(raw.at) ?? 0,
  };
}

/** A module from untrusted JSON, or null when it isn't one. */
export function cleanModule(raw: unknown): EngineModule | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name).trim();
  const id = str(raw.id).trim();
  if (!name && !id) return null;
  const core = (CORE_KINDS as readonly string[]).includes(str(raw.core)) ? (raw.core as CoreKind) : undefined;
  const slot = (str(raw.slot) in SLOTS ? raw.slot : "overlay") as Slot;
  const m: EngineModule = {
    id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "module",
    name: name || id,
    version: str(raw.version, "1.0.0"),
    description: str(raw.description),
    slot,
    button: typeof raw.button === "string" ? raw.button : undefined,
    tags: strings(raw.tags),
    requires: strings(raw.requires),
    core,
    ...(!core && cleanFork(raw.fork) ? { fork: cleanFork(raw.fork) } : {}),
    enabled: raw.enabled !== false,
    vars: (Array.isArray(raw.vars) ? raw.vars : []).map(cleanVar).filter((v): v is EngineVar => !!v),
    rules: (Array.isArray(raw.rules) ? raw.rules : []).map(cleanRule).filter((r): r is ModuleRule => !!r),
    regex: (Array.isArray(raw.regex) ? raw.regex : []).map(cleanRegex).filter((r): r is ModuleRegex => !!r),
    html: str(raw.html),
    css: str(raw.css),
    js: str(raw.js),
    script: str(raw.script),
    settings: isObject(raw.settings) ? structuredClone(raw.settings) : {},
    ...(Array.isArray(raw.live) && raw.live.length ? { live: cleanLiveFeeds(raw.live) } : {}),
  };
  // A core module's code comes from this app, never from the file.
  return core ? resolveModule(m) : m;
}

export function modulePack(modules: EngineModule[]): ModulePack {
  return { format: PACK_FORMAT, version: 1, modules: structuredClone(modules) };
}

/** The modules in a pack file's text. Throws with a message for the author when it isn't one. */
export function readPack(text: string): EngineModule[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file isn't JSON.");
  }
  // A single module saved on its own is fine too.
  const list = isObject(raw) && raw.format === PACK_FORMAT ? raw.modules : isObject(raw) && "slot" in raw ? [raw] : null;
  if (!Array.isArray(list)) throw new Error("This isn't a CardForge module pack.");
  const modules = list.map(cleanModule).filter((m): m is EngineModule => !!m);
  if (!modules.length) throw new Error("The pack has no modules in it.");
  return modules;
}

/**
 * Adds modules to a card's list. A core module replaces the card's own copy (its settings come
 * along); any other module whose id is taken gets a free one, so nothing is lost.
 */
export function addModules(current: EngineModule[], incoming: EngineModule[]): EngineModule[] {
  const out = [...current];
  for (const m of incoming) {
    if (m.core) {
      const at = out.findIndex((o) => o.core === m.core);
      if (at >= 0) {
        out[at] = structuredClone(m);
        continue;
      }
    }
    let id = m.id;
    for (let n = 2; out.some((o) => o.id === id); n++) id = `${m.id}-${n}`;
    out.push({ ...structuredClone(m), id });
  }
  return out;
}
