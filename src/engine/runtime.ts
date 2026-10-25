/**
 * The engine core's JavaScript, as CardForge ships it inside a card and runs it in the app.
 *
 * The same updater source goes into the card's Tavern Helper script and runs here (preview and
 * tests), so what CardForge shows is what SillyTavern will do.
 */
import glueSource from "./runtime/glue.js?raw";
import updaterSource from "./runtime/updater.js?raw";

export const ENGINE_VERSION = "0.1.0";

export interface UpdateResult {
  stat_data: Record<string, unknown>;
  /** Changed paths, as `{ "Player.Health": [old, new] }`. */
  delta: Record<string, [unknown, unknown]>;
  applied: string[];
  skipped: { command: string; error: string }[];
}

/** The subset of a Zod schema the updater uses. */
export interface StateSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: { issues?: { message: string }[] } };
}

export interface Command {
  type: "set" | "add" | "insert" | "delete" | "move";
  path: string[];
  value?: unknown;
  key?: string;
  item?: unknown;
  from?: string[];
  full: string;
}

interface Runtime {
  cfUpdate(stat: Record<string, unknown> | undefined, text: string, schema?: StateSchema | null): UpdateResult;
  cfExtractCommands(text: string): Command[];
  cfPath(path: string): string[];
  cfYaml(value: unknown): string;
  cfForAi(value: unknown): unknown;
}

export const runtime: Runtime = new Function(
  `${updaterSource}\nreturn { cfUpdate, cfExtractCommands, cfPath, cfYaml, cfForAi };`,
)() as Runtime;

/** The whole Tavern Helper script: the card's settings, then the core. */
export function scriptSource(settings: string): string {
  return `(function () {\n"use strict";\n${settings}\n${updaterSource}\n${glueSource}\n})();\n`;
}
