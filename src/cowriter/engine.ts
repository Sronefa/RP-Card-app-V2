/**
 * Shared plumbing for every co-writer session: the model for a mode, the tool fallback, and the
 * context about the card and project that goes into user messages.
 */
import { DEFAULT_COWRITER } from "../ai/records";
import { bibleContext, cardContext, personasContext, settingsContext, worldContext } from "../ai/prompts";
import { createProvider, jailbreakText, modelKey, resolveModel, useAiSettings } from "../ai/settings";
import {
  DEFAULT_TIMEOUT_SEC,
  ToolsUnsupportedError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type ModeId,
} from "../ai/types";
import { getInterview, getProject, listCards, listPersonas, type CardRecord } from "../db/db";

export const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError");

export class NoModelError extends Error {
  constructor() {
    super("Choose a model in Settings first.");
  }
}

/** Puts the jailbreak after the last message, the deepest spot in the prompt. Only this request carries it. */
export function withJailbreak(messages: ChatMessage[], jailbreak: string): ChatMessage[] {
  const last = messages.at(-1);
  const tagged = `<jailbreak>\n${jailbreak}\n</jailbreak>`;
  if (!last) return messages;
  const rest = messages.slice(0, -1);
  if (last.role === "user") return [...rest, { ...last, text: `${last.text}\n\n${tagged}` }];
  if (last.role === "tool" && last.results.length) {
    const results = [...last.results];
    const end = results.length - 1;
    results[end] = { ...results[end], content: `${results[end].content}\n\n${tagged}` };
    return [...rest, { ...last, results }];
  }
  return messages;
}

/**
 * Runs one model call for a mode. When the endpoint turns out not to support tools, the model is
 * remembered as tool-less and the call is repeated with JSON edits.
 */
export async function complete(
  mode: ModeId,
  request: Omit<CompletionRequest, "model" | "useTools">,
): Promise<CompletionResult & { useTools: boolean }> {
  await useAiSettings.getState().load();
  const resolved = resolveModel(useAiSettings.getState().settings, mode);
  if (!resolved) throw new NoModelError();
  const provider = createProvider(resolved.config);
  const jailbreak = jailbreakText(useAiSettings.getState().settings);
  if (jailbreak) request = { ...request, messages: withJailbreak(request.messages, jailbreak) };
  const seconds = resolved.config.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const run = async (useTools: boolean) => {
    const timeout = AbortSignal.timeout(seconds * 1000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await provider.complete({ ...request, signal, model: resolved.choice.model, useTools });
    } catch (e) {
      if (timeout.aborted && !request.signal?.aborted)
        throw new Error(
          `${resolved.config.name} didn't finish within ${seconds} seconds. You can give it longer in Settings.`,
        );
      throw e;
    }
  };
  try {
    return { ...(await run(resolved.useTools)), useTools: resolved.useTools };
  } catch (e) {
    if (!(e instanceof ToolsUnsupportedError) || !resolved.useTools) throw e;
    const settings = useAiSettings.getState().settings;
    await useAiSettings.getState().update({ noToolModels: [...settings.noToolModels, modelKey(resolved.choice)] });
    return { ...(await run(false)), useTools: false };
  }
}

/** The project's co-writer settings with the presets it uses. */
export async function projectSettings(projectId: string) {
  const project = await getProject(projectId);
  const settings = { ...DEFAULT_COWRITER, ...project?.cowriter };
  await useAiSettings.getState().load();
  const presets = useAiSettings.getState().settings.presets.filter((p) => p.kind !== "jailbreak" && settings.presetIds.includes(p.id));
  return { project, settings, presets };
}

export interface ContextPart {
  key: string;
  title: string;
  text: string;
}

/** Everything the co-writer should know about the card and its project, in parts. */
export async function gatherContext(record: CardRecord): Promise<ContextPart[]> {
  const { project, settings, presets } = await projectSettings(record.projectId);
  const world = record.kind === "character" ? (await listCards(record.projectId)).find((c) => c.kind === "world") : undefined;
  const personas = (await listPersonas()).filter((p) => project?.personaIds.includes(p.id));
  const bible = (await getInterview(record.id))?.bible;
  return [
    { key: "settings", title: "Project settings", text: settingsContext(settings, presets) },
    ...(bible?.trim() ? [{ key: "bible", title: "Story bible", text: bibleContext(bible) }] : []),
    { key: "card", title: "The card as it is now", text: cardContext(record.card.data, record.kind) },
    ...(world ? [{ key: "world", title: "The project's world", text: worldContext(world) }] : []),
    ...(personas.length ? [{ key: "personas", title: "The user's personas", text: personasContext(personas) }] : []),
  ];
}

/** Context parts as one block of text, for one-off calls that don't keep a conversation. */
export const partsText = (parts: ContextPart[]) =>
  parts.map((p) => `<${p.key} title="${p.title}">\n${p.text}\n</${p.key}>`).join("\n\n");
