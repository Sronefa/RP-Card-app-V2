/**
 * Keeps people, places, items and shops on the world pages: files plain lorebook entries under the
 * right page ("Sort my lorebook"), and turns names a co-writer turn mentioned into typed proposals.
 */
import { fileWorldTool, readFiled, type Filed } from "../ai/interviewTools";
import { mentionScanRequest, sortLorebookRequest, systemPrompt } from "../ai/prompts";
import { WORLD_TOOL_KINDS } from "../ai/tools";
import type { ToolCall } from "../ai/types";
import type { CardDataV3 } from "../card";
import type { CardRecord } from "../db/db";
import { entryTitle } from "../editor/lorebook";
import { isPlainEntry, type TypedKind } from "../editor/world";
import { newId } from "../lib/id";
import { complete, gatherContext, partsText } from "./engine";

const ADD_TOOL = Object.fromEntries(Object.entries(WORLD_TOOL_KINDS).map(([tool, kind]) => [kind, tool])) as Record<
  TypedKind,
  keyof typeof WORLD_TOOL_KINDS
>;

/** The add_npc (or place, item, shop) call for a filed name. */
export const addCall = (kind: TypedKind, fields: Record<string, string>): ToolCall => ({
  id: newId(),
  name: ADD_TOOL[kind],
  input: fields,
});

async function fileWorld(record: CardRecord, request: string, withIds: boolean, signal: AbortSignal): Promise<Filed[]> {
  const tool = fileWorldTool(withIds);
  const parts = await gatherContext(record);
  const result = await complete("world", {
    system: systemPrompt("world"),
    messages: [{ role: "user", text: `${partsText(parts)}\n\n${request}` }],
    tools: [tool],
    signal,
  });
  const call = result.toolCalls.find((c) => c.name === tool.name);
  return call ? readFiled(call) : [];
}

export const plainEntries = (data: CardDataV3) => (data.character_book?.entries ?? []).filter(isPlainEntry);

/** Asks the co-writer which world page each plain entry belongs on. Entries it leaves out stay plain. */
export async function sortLorebook(record: CardRecord, signal: AbortSignal): Promise<Filed[]> {
  const entries = plainEntries(record.card.data);
  if (!entries.length) return [];
  const request = sortLorebookRequest(
    entries.map((e) => ({ id: String(e.id), title: entryTitle(e), keys: e.keys, content: e.content })),
  );
  const ids = new Set(entries.map((e) => String(e.id)));
  return (await fileWorld(record, request, true, signal)).filter((f) => f.id && ids.has(f.id) && (f.kind === "other" || f.fields.name));
}

/** Typed add calls for names a turn mentioned without an entry. */
export async function scanNames(record: CardRecord, names: string[], newText: string, signal: AbortSignal): Promise<ToolCall[]> {
  const filed = await fileWorld(record, mentionScanRequest(names, newText), false, signal);
  return filed.flatMap((f) => (f.kind === "other" || !f.fields.name ? [] : [addCall(f.kind, f.fields)]));
}
