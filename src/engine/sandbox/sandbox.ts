/**
 * The engine sandbox document: a fake SillyTavern chat with a mock Tavern Helper, run in an iframe
 * that can't reach the network (see host.js for the runtime).
 *
 * The iframe is sandboxed without same-origin access, so CardForge talks to it only by postMessage:
 * commands go in as `{ cfCommand }` and reports come out as `{ cfSandbox }`.
 */
import type { CardDataV3 } from "../../card";
import hostSource from "./host.js?raw";
import { TAVERN_HELPER_FUNCTIONS, TAVERN_HELPER_VERSION } from "./th-api";

/** Library sources the sandbox runs: lodash/YAML/Zod as one bundle, and jQuery and Vue for iframes. */
export interface SandboxLibs {
  libs: string;
  jquery: string;
  vue: string;
}

/** Loads the library sources. They are large, so they load only when the sandbox opens. */
export async function loadSandboxLibs(): Promise<SandboxLibs> {
  const [libs, jquery, vue] = await Promise.all([
    import("virtual:sandbox-libs"),
    import("jquery/dist/jquery.min.js?raw"),
    import("vue/dist/vue.runtime.global.prod.js?raw"),
  ]);
  return { libs: libs.default, jquery: jquery.default, vue: vue.default };
}

/**
 * Blocks every network request: scripts, styles, images, fonts and fetches may only come from the
 * document itself. A card that needs the web fails here, in CardForge, instead of in the player's chat.
 */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "frame-src 'self' about: data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
].join("; ");

interface ScriptNode {
  type?: string;
  enabled?: boolean;
  name?: string;
  id?: string;
  content?: string;
  info?: string;
  data?: Record<string, unknown>;
  button?: { enabled?: boolean; buttons?: { name: string; visible: boolean }[] };
  scripts?: ScriptNode[];
}

/** The card's enabled Tavern Helper scripts, folders flattened, in order. */
export function cardScripts(data: CardDataV3) {
  const helper = data.extensions?.tavern_helper as { scripts?: ScriptNode[] } | undefined;
  const out: { id: string; name: string; content: string; info: string; data: Record<string, unknown>; buttons: { name: string; visible: boolean }[] }[] = [];
  const walk = (nodes: ScriptNode[], enabled: boolean) => {
    for (const node of nodes) {
      const on = enabled && node.enabled !== false;
      if (node.type === "folder") walk(node.scripts ?? [], on);
      else if (on && typeof node.content === "string")
        out.push({
          id: node.id || `script-${out.length}`,
          name: node.name || "Script",
          content: node.content,
          info: node.info ?? "",
          data: node.data ?? {},
          buttons: node.button?.enabled === false ? [] : (node.button?.buttons ?? []),
        });
    }
  };
  walk(Array.isArray(helper?.scripts) ? helper.scripts : [], true);
  return out;
}

/** What the sandbox needs from the card. */
export function sandboxCard(data: CardDataV3) {
  return {
    name: data.nickname || data.name || "Character",
    first_mes: data.first_mes ?? "",
    alternate_greetings: data.alternate_greetings ?? [],
    regex: Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : [],
    scripts: cardScripts(data),
    book: (data.character_book?.entries ?? []).map((e) => ({
      comment: e.comment ?? e.name ?? "",
      keys: e.keys,
      secondary_keys: e.secondary_keys ?? [],
      content: e.content,
      enabled: e.enabled,
      constant: !!e.constant,
      insertion_order: e.insertion_order,
      depth: typeof e.extensions?.depth === "number" ? e.extensions.depth : 4,
    })),
  };
}

/** Text that can sit inside an inline script element. */
const inline = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Looks like SillyTavern's default dark theme, so panels look here as they will there. */
const ST_STYLE = `
:root { color-scheme: only light; --SmartThemeBodyColor: rgb(220, 220, 210); --SmartThemeEmColor: rgb(145, 145, 145); --SmartThemeQuoteColor: rgb(225, 138, 36); --SmartThemeBlurTintColor: rgba(23, 23, 23, 0.7); --SmartThemeBorderColor: rgba(0, 0, 0, 0.5); }
html, body { margin: 0; height: 100%; }
body { background: #1c1c1f; color: var(--SmartThemeBodyColor); font-family: "Noto Sans", system-ui, sans-serif; font-size: 15px; line-height: 1.5; display: flex; flex-direction: column; }
#chat { flex: 1; overflow-y: auto; padding: 6px; }
.mes { display: flex; gap: 10px; padding: 10px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.mes_avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; background: #3b3b44; display: grid; place-items: center; font-weight: 600; color: #ddd; }
.mes.is_user .mes_avatar { background: #2f4357; }
.mes_block { flex: 1; min-width: 0; }
.ch_name { display: flex; align-items: baseline; gap: 6px; font-weight: 600; margin-bottom: 2px; }
.mesIDDisplay, .swipes-counter { font-weight: 400; font-size: 12px; opacity: 0.5; }
.swipes-counter { margin-left: auto; }
.mes_text { overflow-wrap: anywhere; }
.mes_text em { color: var(--SmartThemeEmColor); }
.mes_text q { color: var(--SmartThemeQuoteColor); quotes: none; }
.mes_text pre { white-space: pre-wrap; background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 6px; font-size: 13px; }
.mes_text iframe { display: block; width: 100%; border: 0; }
#cf-buttons { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px; }
#cf-buttons:empty { display: none; }
.menu_button { font: inherit; font-size: 13px; color: inherit; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
#send_form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); background: var(--SmartThemeBlurTintColor); }
#send_textarea { flex: 1; resize: none; font: inherit; color: inherit; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 6px 8px; min-height: 38px; }
#cf-scripts { display: none; }
#cf-toasts { position: fixed; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 6px; z-index: 10; max-width: 80%; }
.cf-toast { background: #333; border-left: 4px solid #4b8bd8; padding: 6px 10px; border-radius: 4px; font-size: 13px; }
.cf-toast-success { border-color: #3fae5a; } .cf-toast-warning { border-color: #d8a33c; } .cf-toast-error { border-color: #d8483c; }
`;

export interface SandboxOptions {
  data: CardDataV3;
  libs: SandboxLibs;
  user?: string;
  textScale?: number;
}

/** The whole sandbox page, for an iframe's srcdoc. */
export function sandboxDocument({ data, libs, user, textScale }: SandboxOptions): string {
  const config = {
    card: sandboxCard(data),
    user: user || "You",
    textScale: textScale ?? 1,
    thVersion: TAVERN_HELPER_VERSION,
    thFunctions: TAVERN_HELPER_FUNCTIONS,
  };
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${ST_STYLE}</style>`,
    "</head><body>",
    '<div id="chat"></div>',
    '<div id="cf-buttons"></div>',
    '<form id="send_form"><textarea id="send_textarea" rows="1" placeholder="Type a message"></textarea><button type="submit" id="send_but" class="menu_button">Send</button></form>',
    '<div id="cf-toasts"></div>',
    '<div id="cf-scripts"></div>',
    `<script>var CF_SANDBOX = ${inline(config)}; var CF_LIBS = { jquery: ${inline(libs.jquery)}, vue: ${inline(libs.vue)} }; (0, eval)(${inline(libs.libs)});</script>`,
    `<script>${hostSource}</script>`,
    "</body></html>",
  ].join("\n");
}

/** A report from the sandbox. */
export type SandboxReport =
  | { kind: "ready" }
  | { kind: "done"; id?: number; result?: unknown; failed?: string }
  | { kind: "state"; chat: SandboxMessage[]; chatVariables: Record<string, unknown>; schema: string[] }
  | { kind: "log"; source: string; action: string; detail: string }
  | { kind: "console"; level: "error" | "warn"; source: string; message: string }
  | { kind: "error"; source: string; message: string; line: number; column: number; code: string; stack: string };

export interface SandboxMessage {
  id: number;
  role: "user" | "assistant" | "system";
  name: string;
  message: string;
  swipe_id: number;
  swipes: number;
  variables: Record<string, unknown>;
}

/** A command for the sandbox. */
export type SandboxCommand =
  | { type: "send"; text: string }
  | { type: "reply"; text: string }
  | { type: "swipe"; text: string }
  | { type: "swipeTo"; id: number; swipe: number }
  | { type: "edit"; id: number; text: string }
  | { type: "rewind"; id: number }
  | { type: "setVariables"; id: number; variables: Record<string, unknown> }
  | { type: "view"; textScale: number }
  | { type: "scenario"; turns: { role: "user" | "assistant"; text: string }[] }
  | { type: "open"; module: string }
  | { type: "close" }
  | { type: "capture" }
  | { type: "inspect" }
  | { type: "click"; screen?: string; selector?: string; text?: string };

/** What capture returns: a PNG of everything the player sees, base64. */
export interface SandboxCapture {
  image: string;
  width: number;
  height: number;
}

/** What inspect returns for each document on screen. */
export interface ScreenReport {
  screen: string;
  width: number;
  height: number;
  overflow: string[];
  contrast: string[];
  smallTargets: string[];
  outline: string[];
}

export interface ClickResult {
  clicked: string;
  screen: string;
  /** What the click wrote in the input box, if anything. */
  input: string;
}

/**
 * The page as a data: URL. A data: page has an origin of its own, so it can't reach CardForge, while
 * the iframes it makes share that origin with it, as Tavern Helper's iframes share SillyTavern's.
 */
export function sandboxUrl(doc: string): string {
  const bytes = new TextEncoder().encode(doc);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:text/html;base64,${btoa(binary)}`;
}
