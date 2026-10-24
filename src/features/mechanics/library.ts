/** Saved mechanics modules, shared by every project. */
import { getSetting, putSetting } from "../../db/db";
import { cleanModule, type MechanicModule } from "../../editor/mechanics";
import { newId } from "../../lib/id";

const KEY = "mechanicsLibrary";

export async function loadLibrary(): Promise<MechanicModule[]> {
  const list = await getSetting<MechanicModule[]>(KEY);
  return Array.isArray(list) ? list.map(cleanModule) : [];
}

/** Saves the module, replacing one saved under the same name. Images stay with their card. */
export async function saveToLibrary(module: MechanicModule): Promise<MechanicModule[]> {
  const saved = { ...structuredClone(module), images: [] };
  const list = (await loadLibrary()).filter((m) => m.name.toLowerCase() !== module.name.toLowerCase());
  const next = [...list, saved].sort((a, b) => a.name.localeCompare(b.name));
  await putSetting(KEY, next);
  return next;
}

export async function removeFromLibrary(id: string): Promise<MechanicModule[]> {
  const next = (await loadLibrary()).filter((m) => m.id !== id);
  await putSetting(KEY, next);
  return next;
}

/** A copy for a card, with an id of its own. */
export const fromLibrary = (module: MechanicModule): MechanicModule => ({ ...structuredClone(module), id: newId() });
