/** Saved engine modules, shared by every project. */
import { getSetting, putSetting } from "../../db/db";
import { cleanModule } from "../../engine/modules/pack";
import type { EngineModule } from "../../engine/modules/types";

const KEY = "engineModuleLibrary";

export async function loadModuleLibrary(): Promise<EngineModule[]> {
  const list = await getSetting<unknown[]>(KEY);
  return Array.isArray(list) ? list.map(cleanModule).filter((m): m is EngineModule => !!m) : [];
}

/** Saves the modules, each replacing one saved under the same id. */
export async function saveModulesToLibrary(modules: EngineModule[]): Promise<EngineModule[]> {
  const ids = new Set(modules.map((m) => m.id));
  const list = (await loadModuleLibrary()).filter((m) => !ids.has(m.id));
  const next = [...list, ...modules.map((m) => ({ ...structuredClone(m), enabled: true }))].sort((a, b) => a.name.localeCompare(b.name));
  await putSetting(KEY, next);
  return next;
}

export async function removeFromModuleLibrary(id: string): Promise<EngineModule[]> {
  const next = (await loadModuleLibrary()).filter((m) => m.id !== id);
  await putSetting(KEY, next);
  return next;
}
