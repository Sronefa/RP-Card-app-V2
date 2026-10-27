/**
 * Shared plumbing for every co-writer session: the model for a mode, the tool fallback, and the
 * context about the card and project that goes into user messages.
 */
import { changesText, readChanges } from "./changeLog";
import { withCowriterDefaults, type CowriterSettings } from "../ai/records";
import { activePacks, cardSampleIds, craftContext, packsWith, REFERENCE_EXAMPLES, styleContext } from "./style";
import { skillsWith } from "../engine/engineer/knowledge";
import { bibleContext, cardContext, ENGINE_GUIDE, personasContext, settingsContext, worldContext } from "../ai/prompts";
import { createProvider, jailbreakText, type AiSettings, modelInfo, modelKey, resolveModel, useAiSettings } from "../ai/settings";
import { scopeOf, useUsage } from "../ai/usage";
import { useEditor } from "../editor/store";
import { DEFAULT_SLOP_PHRASES } from "../editor/slop";
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
  if (resolved.config.banPhrases && mode !== "engineer") {
    const phrases = (useAiSettings.getState().settings.slopPhrases ?? DEFAULT_SLOP_PHRASES).filter((p) => !p.includes("*"));
    request = { ...request, bannedPhrases: phrases };
  }
  const seconds = resolved.config.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const run = async (useTools: boolean) => {
    const timeout = AbortSignal.timeout(seconds * 1000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      const result = await provider.complete({ ...request, signal, model: resolved.choice.model, useTools });
      if (result.usage)
        useUsage
          .getState()
          .record(
            scopeOf(mode),
            result.usage,
            modelInfo(useAiSettings.getState().settings, resolved.choice),
            useEditor.getState().record?.projectId,
          );
      return result;
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
  const settings = withCowriterDefaults(project?.cowriter);
  await useAiSettings.getState().load();
  const ai = useAiSettings.getState().settings;
  const presets = ai.presets.filter((p) => p.kind !== "jailbreak" && settings.presetIds.includes(p.id));
  // The engine card guide is a UI engineer skill, with the user's edits.
  const guide = skillsWith(ai.engineerSkills).find((s) => s.id === "engine-card-writing")?.text ?? ENGINE_GUIDE;
  return { project, settings, presets, guide };
}

export interface ContextPart {
  key: string;
  title: string;
  text: string;
}

/** Everything the co-writer should know about the card and its project, in parts. */
export async function gatherContext(record: CardRecord): Promise<ContextPart[]> {
  const { project, settings, presets, guide } = await projectSettings(record.projectId);
  const ai = useAiSettings.getState().settings;
  const world = record.kind === "character" ? (await listCards(record.projectId)).find((c) => c.kind === "world") : undefined;
  const personas = (await listPersonas()).filter((p) => project?.personaIds.includes(p.id));
  const bible = (await getInterview(record.id))?.bible;
  const engineer = changesText(await readChanges(record.id), "engineer");
  return [
    { key: "settings", title: "Project settings", text: settingsContext(settings, presets, guide) },
    ...(bible?.trim() ? [{ key: "bible", title: "Story bible", text: bibleContext(bible) }] : []),
    { key: "card", title: "The card as it is now", text: cardContext(record.card.data, record.kind) },
    ...(world ? [{ key: "world", title: "The project's world", text: worldContext(world) }] : []),
    ...(personas.length ? [{ key: "personas", title: "The user's personas", text: personasContext(personas) }] : []),
    ...styleParts(record, settings, ai),
    ...(engineer
      ? [{ key: "engineer_changes", title: "What the UI engineer changed (the user accepted these)", text: engineer }]
      : []),
  ];
}

/** The user's style notes, style samples, craft packs and reference examples, each when the project uses them. */
function styleParts(record: CardRecord, settings: CowriterSettings, ai: AiSettings): ContextPart[] {
  const ids = new Set([...(settings.styleSampleIds ?? []), ...cardSampleIds(record.card.data)]);
  const samples = (ai.styleSamples ?? []).filter((s) => ids.has(s.id));
  const packs = activePacks(settings, packsWith(ai.craftPacks));
  const notes = ai.styleNotes ?? [];
  return [
    ...(notes.length
      ? [{ key: "notes", title: "The user's style notes", text: `Follow these in everything you write:\n${notes.map((n) => `- ${n}`).join("\n")}` }]
      : []),
    ...(samples.length ? [{ key: "style", title: "Style to imitate", text: styleContext(samples) }] : []),
    ...(packs.length ? [{ key: "craft", title: "Genre craft notes", text: craftContext(packs) }] : []),
    ...(settings.referenceExamples !== false ? [{ key: "examples", title: "Reference examples", text: REFERENCE_EXAMPLES }] : []),
  ];
}

/** Context parts as one block of text, for one-off calls that don't keep a conversation. */
export const partsText = (parts: ContextPart[]) =>
  parts.map((p) => `<${p.key} title="${p.title}">\n${p.text}\n</${p.key}>`).join("\n\n");
