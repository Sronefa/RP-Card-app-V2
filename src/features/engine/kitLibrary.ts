/** The author's saved kits (a theme plus parts), shared by every project. */
import { getSetting, putSetting } from "../../db/db";
import { cleanKit, type Kit } from "../../engine/parts/catalog";

const KEY = "engineKits";

export async function loadKits(): Promise<Kit[]> {
  const list = await getSetting<unknown[]>(KEY);
  return Array.isArray(list) ? list.map(cleanKit).filter((k): k is Kit => !!k) : [];
}

/** Saves the kit, replacing one saved under the same name. */
export async function saveKit(kit: Kit): Promise<Kit[]> {
  const name = kit.name.trim().toLowerCase();
  const next = [...(await loadKits()).filter((k) => k.name.trim().toLowerCase() !== name), structuredClone(kit)].sort((a, b) => a.name.localeCompare(b.name));
  await putSetting(KEY, next);
  return next;
}

export async function removeKit(id: string): Promise<Kit[]> {
  const next = (await loadKits()).filter((k) => k.id !== id);
  await putSetting(KEY, next);
  return next;
}
