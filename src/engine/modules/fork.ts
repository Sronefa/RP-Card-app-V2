/**
 * Forking a built-in: its files, values, rules and regex copied into the card as a module of its
 * own, so its code can be changed like any other. A whole screen is forked in place (same id, slot
 * and hub button, so links and tags keep working) and the original goes away until the author
 * brings it back; one phone app can be forked on its own, so the rest of the phone keeps
 * CardForge's fixes. The fork remembers where it came from, to tell when CardForge updated it.
 */
import type { EngineConfig } from "../sheet";
import { coreModules, resolveModule } from "./compile";
import { cleanModule } from "./pack";
import { PHONE_APPS, phoneSettings, type PhoneAppId } from "./phone";
import type { CoreKind, EngineModule, ModuleRule } from "./types";

type Settings = Record<string, unknown>;

const isObject = (v: unknown): v is Settings => !!v && typeof v === "object" && !Array.isArray(v);

/** A short fingerprint of a module's code. */
export function codeHash(m: Pick<EngineModule, "html" | "css" | "js" | "script">): string {
  const text = [m.html, m.css, m.js, m.script].join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function stripLive(settings: Settings): Settings {
  const { live: _live, ...rest } = settings;
  return rest;
}

/**
 * A built-in's code reads `settings.live || settings`: the fork keeps them as one flat object, so
 * changing a setting on the fork changes what its code reads.
 */
function flatSettings(settings: Settings): Settings {
  const { live, ...rest } = settings;
  return isObject(live) ? structuredClone({ ...rest, ...live }) : structuredClone(rest);
}

/** CardForge's current code for a built-in, from its settings alone, so it compares the same over time. */
export function originalOf(core: CoreKind, settings: Settings): EngineModule {
  return resolveModule({ ...coreModules()[0], id: core, core, settings, enabled: true }, []);
}

/** Whether CardForge's code for the original changed since the module was forked. */
export const originalUpdated = (m: EngineModule) => !!m.fork && codeHash(originalOf(m.fork.core, m.fork.settings)) !== m.fork.code;

/** The phone apps that can be forked on their own from a phone module. */
export function forkablePieces(m: EngineModule): { id: PhoneAppId; label: string }[] {
  if (m.core !== "phone") return [];
  return phoneSettings(m.settings).apps.filter((a) => a !== "settings").map((id) => ({ id, label: PHONE_APPS[id].label }));
}

export const pieceId = (app: string) => `phone-${app}`;

const modulesIn = (config: EngineConfig) => config.modules ?? coreModules();

export interface Forked {
  config: EngineConfig;
  module: EngineModule;
}

/** Forks a built-in module, or with `piece` one app of the phone. Throws with a message for the author. */
export function forkModule(config: EngineConfig, id: string, piece?: string): Forked {
  const all = modulesIn(config);
  const at = all.findIndex((m) => m.id === id);
  if (at < 0) throw new Error(`There's no module "${id}". Modules: ${all.map((m) => m.id).join(", ") || "none"}.`);
  const original = all[at];
  if (!original.core) throw new Error(`"${id}" is already the card's own module: change its files directly.`);
  if (piece) return forkPiece(all, at, piece, config);
  const resolved = resolveModule(original, all);
  const settings = stripLive(original.settings);
  const { core: _core, ...rest } = resolved;
  const module: EngineModule = {
    ...structuredClone(rest),
    tags: [...resolved.tags.filter((t) => t !== "built-in"), "fork"],
    settings: flatSettings(resolved.settings),
    fork: { core: original.core, settings: structuredClone(settings), code: codeHash(originalOf(original.core, settings)), at: Date.now() },
  };
  return { config: { ...config, modules: all.map((m, i) => (i === at ? module : m)) }, module };
}

/** The lines of `rule` that `without` doesn't have, under the same first line. */
function ruleDiff(rule: ModuleRule, without: ModuleRule[]): ModuleRule | undefined {
  const other = without.find((r) => r.comment === rule.comment);
  if (!other) return structuredClone(rule);
  const have = new Set(other.content.split("\n"));
  const [head, ...lines] = rule.content.split("\n");
  const own = lines.filter((l) => !have.has(l));
  return own.length ? { ...structuredClone(rule), content: [head, ...own].join("\n") } : undefined;
}

function forkPiece(all: EngineModule[], at: number, app: string, config: EngineConfig): Forked {
  const phone = all[at];
  const label = PHONE_APPS[app as PhoneAppId]?.label;
  if (phone.core !== "phone" || !label) throw new Error(`Only the phone's apps can be forked on their own: give one of ${Object.keys(PHONE_APPS).join(", ")}.`);
  const s = phoneSettings(phone.settings);
  if (!s.apps.includes(app as PhoneAppId)) throw new Error(`The phone doesn't have the ${label} app. Its apps: ${s.apps.join(", ")}.`);
  if (app === "settings") throw new Error("The phone's Settings app is the card's settings module: change that one instead.");
  const id = pieceId(app);
  if (all.some((m) => m.id === id)) throw new Error(`The card already has a "${id}" module.`);
  const settings = stripLive(phone.settings);
  const full = resolveModule(phone, all);
  const rest = resolveModule({ ...phone, settings: { ...settings, apps: s.apps.filter((a) => a !== app) } }, all);
  const own = new Set(rest.vars.map((v) => v.id));
  const module: EngineModule = {
    id,
    name: label,
    version: full.version,
    description: `The phone's ${label} app, forked from CardForge's phone so its code can change. It opens inside the phone.`,
    slot: "overlay",
    button: `📱 ${label}`,
    tags: ["phone-app", "fork"],
    requires: ["phone"],
    enabled: true,
    vars: structuredClone(full.vars.filter((v) => !own.has(v.id))),
    rules: full.rules.map((r) => ruleDiff(r, rest.rules)).filter((r): r is ModuleRule => !!r),
    regex: [],
    html: full.html,
    css: full.css,
    js: full.js,
    script: "",
    settings: { ...flatSettings(full.settings), apps: [app], piece: app, extra: [] },
    fork: { core: "phone", settings: {}, code: codeHash(originalOf("phone", {})), piece: app, at: Date.now() },
  };
  const modules = all.map((m, i) => (i === at ? rest : m));
  return { config: { ...config, modules: [...modules, module] }, module };
}

/** Goes back to CardForge's own module: a whole fork becomes the built-in again; a forked phone app goes back into the phone. */
export function unforkModule(config: EngineConfig, id: string): EngineConfig {
  const all = modulesIn(config);
  const at = all.findIndex((m) => m.id === id);
  const m = all[at];
  if (!m?.fork) throw new Error(`"${id}" isn't a fork.`);
  if (m.fork.piece) {
    const p = all.findIndex((o) => o.core === "phone");
    if (p < 0) throw new Error("The card's phone isn't CardForge's own any more: bring it back first, or remove this app.");
    const phone = all[p];
    const s = phoneSettings(phone.settings);
    const apps = [...s.apps.filter((a) => a !== m.fork!.piece), m.fork.piece as PhoneAppId];
    const rest = all.filter((_, i) => i !== at);
    const back = resolveModule({ ...phone, settings: { ...stripLive(phone.settings), apps } }, rest);
    return { ...config, modules: rest.map((o) => (o === phone ? back : o)) };
  }
  const back = cleanModule({ ...m, core: m.fork.core, settings: m.fork.settings, fork: undefined });
  if (!back) throw new Error(`"${id}" can't go back to CardForge's version.`);
  return { ...config, modules: all.map((o, i) => (i === at ? back : o)) };
}
