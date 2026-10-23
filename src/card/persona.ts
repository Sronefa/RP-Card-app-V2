/**
 * Persona files. SillyTavern has no persona file format (personas live in its settings),
 * so CardForge uses a small JSON file of its own. Persona avatars are exported as plain images.
 */
import { utf8Decode } from "./bytes";
import { parseCardJson } from "./normalize";

export interface Persona {
  name: string;
  description: string;
  extensions: Record<string, unknown>;
}

export interface PersonaFile {
  spec: "cardforge_persona";
  spec_version: "1.0";
  data: Persona;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function toPersonaFile(persona: Persona): PersonaFile {
  return { spec: "cardforge_persona", spec_version: "1.0", data: persona };
}

/** Reads a CardForge persona file. A character card also works: its name and description are used. */
export function importPersona(input: Uint8Array | string): Persona {
  const json = parseCardJson(typeof input === "string" ? input : utf8Decode(input));
  if (!isObject(json)) throw new Error("Persona file is not a JSON object");
  const d = isObject(json.data) ? json.data : json;
  if (typeof d.name !== "string") throw new Error("This file doesn't contain a persona");
  return {
    name: d.name,
    description: typeof d.description === "string" ? d.description : "",
    extensions: isObject(d.extensions) && json.spec === "cardforge_persona" ? { ...d.extensions } : {},
  };
}
