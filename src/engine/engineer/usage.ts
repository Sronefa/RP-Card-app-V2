/** What fills the UI engineer's context: an estimate by source, for the token meter's breakdown. */
import type { ChatMessage } from "../../ai/types";
import { estimateTokens, imageTokens } from "../../lib/tokens";

const SOURCES: Record<string, string> = {
  search_docs: "Docs",
  read_doc: "Docs",
  list_skills: "Docs",
  load_skill: "Docs",
  read_module: "Module files",
  read_example: "Module files",
  list_examples: "Module files",
  read_part: "Module files",
  list_parts: "Module files",
  list_modules: "Module files",
  read_values: "Module files",
  read_theme: "Module files",
  read_card: "Module files",
  run_worker: "Worker reports",
};

export function contextBreakdown(system: string, messages: ChatMessage[]): { label: string; tokens: number }[] {
  const out: Record<string, number> = { "System prompt": estimateTokens(system), "Chat history": 0, Docs: 0, "Module files": 0, "Worker reports": 0, Screenshots: 0, "Tool results": 0 };
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "user") out["Chat history"] += estimateTokens(m.text);
    else if (m.role === "assistant") {
      out["Chat history"] += estimateTokens(m.text) + m.toolCalls.reduce((n, c) => n + estimateTokens(JSON.stringify(c.input)), 0);
      for (const c of m.toolCalls) names.set(c.id, c.name);
    } else
      for (const r of m.results) {
        out[SOURCES[names.get(r.id) ?? ""] ?? "Tool results"] += estimateTokens(r.content);
        for (const i of r.images ?? []) out.Screenshots += imageTokens(i.data);
      }
  }
  return Object.entries(out).map(([label, tokens]) => ({ label, tokens }));
}

/** Screenshots in the chat that the model still sees, and their estimated tokens. */
export function screenshotTokens(messages: ChatMessage[]): { count: number; tokens: number } {
  let count = 0;
  let tokens = 0;
  for (const m of messages)
    if (m.role === "tool")
      for (const r of m.results)
        for (const i of r.images ?? []) {
          count++;
          tokens += imageTokens(i.data);
        }
  return { count, tokens };
}
