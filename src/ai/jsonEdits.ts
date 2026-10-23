/**
 * Fallback for models that can't call tools: the model writes its edits as a JSON block at the
 * end of its reply, in the same shape as the tool calls.
 */
import { newId } from "../lib/id";
import type { ChatMessage, ToolCall, ToolDef } from "./types";

export function jsonEditInstructions(tools: ToolDef[]): string {
  const list = tools
    .map((t) => `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(t.parameters.properties)}`)
    .join("\n");
  return `You cannot call tools directly. To use one, end your reply with a single fenced block:

\`\`\`json
{"edits": [{"tool": "<tool name>", "input": { ... }}]}
\`\`\`

Write nothing after the block. Leave it out when you make no edits. Available tools:
${list}`;
}

const BLOCK = /```(?:json)?\s*(\{[\s\S]*?"edits"[\s\S]*\})\s*```\s*$/;

/** Splits a reply into the text to show and the edits in its JSON block. */
export function extractJsonEdits(text: string): { text: string; toolCalls: ToolCall[] } {
  const m = BLOCK.exec(text.trimEnd());
  if (!m) return { text, toolCalls: [] };
  try {
    const parsed = JSON.parse(m[1]) as { edits?: unknown };
    const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
    const toolCalls = edits.flatMap((e): ToolCall[] => {
      const edit = e as { tool?: unknown; input?: unknown };
      if (typeof edit.tool !== "string" || typeof edit.input !== "object" || edit.input === null) return [];
      return [{ id: `json-${newId()}`, name: edit.tool, input: edit.input as Record<string, unknown> }];
    });
    return { text: text.trimEnd().slice(0, m.index).trimEnd(), toolCalls };
  } catch {
    return { text, toolCalls: [] };
  }
}

/** Without tools, results of earlier edits go back to the model as plain text. */
export function resultsAsText(message: Extract<ChatMessage, { role: "tool" }>): string {
  return (
    "Results of your edits:\n" +
    message.results.map((r) => `- ${r.isError ? "Error: " : ""}${r.content}`).join("\n")
  );
}
