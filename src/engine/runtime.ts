/**
 * The engine core's JavaScript, as CardForge ships it inside a card and runs it in the app.
 *
 * The same updater source goes into the card's Tavern Helper script and runs here (preview and
 * tests), so what CardForge shows is what SillyTavern will do.
 */
import artSource from "./runtime/art.js?raw";
import coreSource from "./runtime/core.js?raw";
import fxSource from "./runtime/fx.js?raw";
import gameSource from "./runtime/game.js?raw";
import glueSource from "./runtime/glue.js?raw";
import liveSource from "./runtime/live.js?raw";
import moodSource from "./runtime/mood.js?raw";
import sceneSource from "./runtime/scene.js?raw";
import updaterSource from "./runtime/updater.js?raw";

export const ENGINE_VERSION = "0.2.0";

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

/** The scene director's own check of a scene's steps, for the lint: [] when it can play. */
export const sceneCheck = new Function(`${sceneSource}\nreturn cfSceneCheck;`)() as (steps: unknown) => string[];

/** The whole Tavern Helper script: the card's settings, the updater, the effects and art kits, the scene director, moods and portraits, the minigame toolkit, and the engine core, then the glue that starts it. */
export function scriptSource(settings: string): string {
  return `(function () {\n"use strict";\n${settings}\n${updaterSource}\n${fxSource}\n${artSource}\n${sceneSource}\n${moodSource}\n${gameSource}\n${liveSource}\n${coreSource}\n${glueSource}\n})();\n`;
}
