/**
 * The UI engineer's worker: one task from the lead's brief, with the docs, skills, examples and lore
 * it needs attached, in a fresh context that is dropped when it finishes. It writes to the same draft
 * as the lead's turn, so every worker's changes join the one proposal; the lead keeps only its report.
 */
import { complete, isAbort } from "../../cowriter/engine";
import { ToolInputError } from "../../ai/tools";
import type { ChatMessage, Effort, ToolCall, ToolDef, ToolResult } from "../../ai/types";
import { modulesOf } from "../modules/compile";
import { readDoc, readExample, type Skill } from "./knowledge";
import { findingsText, lintConfig } from "./lint";
import { readLoreText } from "./lore";
import { engineSummary } from "./prompt";
import {
  ART_TOOLS,
  CONVERT_TOOLS,
  describeCall,
  ENGINEER_TOOLS,
  KNOWLEDGE_TOOLS,
  LORE_TOOLS,
  loreSources,
  READ_TOOLS,
  runEngineerTool,
  TEST_TOOLS,
  WRITE_NAMES,
  type EngineerContext,
} from "./tools";
import { diffConfigs } from "./workspace";

const str = (description: string) => ({ type: "string", description });
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const RUN_WORKER: ToolDef = {
  name: "run_worker",
  description:
    "Hand one task to a worker, who builds and tests it on the draft in its own fresh context and reports back. Attach what it needs so it doesn't search. Returns its report, the files it changed and the lint.",
  parameters: {
    type: "object",
    properties: {
      task: str("What to build or fix, how it should look and behave, and when it's done. Plain and specific."),
      modules: ids('Module ids it may create or change, like ["phone", "shop-app"]; "sheet" for the card\'s own values. Empty lets it touch any.'),
      skills: ids("Skill ids to attach"),
      docs: ids('Doc or section ids to attach, like "core-api#reading-state"'),
      examples: ids("Example ids to attach"),
      lore: ids('Lorebook entry ids from list_lore to attach, like ["c3", "w0"]'),
      notes: str("The plan, the user's wishes, and what earlier workers built that this task builds on"),
    },
    required: ["task"],
    additionalProperties: false,
  },
};

/** What the lead reads and checks itself; building goes to workers. */
const LEAD_NAMES = new Set([
  ...READ_TOOLS.map((t) => t.name),
  ...LORE_TOOLS.map((t) => t.name),
  ...CONVERT_TOOLS.map((t) => t.name),
  "search_docs",
  "list_skills",
  "list_examples",
  "list_parts",
  "list_assets",
  "lint",
]);

export const LEAD_TOOLS: ToolDef[] = [
  ...[...READ_TOOLS, ...LORE_TOOLS, ...CONVERT_TOOLS, ...KNOWLEDGE_TOOLS, ...ART_TOOLS, ...TEST_TOOLS].filter((t) => LEAD_NAMES.has(t.name)),
  RUN_WORKER,
];

/** The worker builds with everything except converting a light card, which needs the user's yes in the lead's chat. */
export const WORKER_TOOLS: ToolDef[] = ENGINEER_TOOLS.filter((t) => !CONVERT_TOOLS.some((c) => c.name === t.name));

export const isLeadTool = (name: string) => LEAD_NAMES.has(name);

export interface WorkerBrief {
  task: string;
  modules: string[];
  skills: string[];
  docs: string[];
  examples: string[];
  lore: string[];
  notes: string;
}

const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : []);

export function readBrief(input: Record<string, unknown>): WorkerBrief {
  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (!task) throw new ToolInputError("Say what the worker should build in task.");
  return {
    task,
    modules: list(input.modules),
    skills: list(input.skills),
    docs: list(input.docs),
    examples: list(input.examples),
    lore: list(input.lore),
    notes: typeof input.notes === "string" ? input.notes.trim() : "",
  };
}

/** The worker's first message: the task, the engine as it is now, and everything attached. */
export function briefText(ctx: EngineerContext, brief: WorkerBrief, skills: Skill[], extra: string[] = []): string {
  const missing: string[] = [];
  const attach = (kind: string, id: string, text: string | undefined) => {
    if (text === undefined) {
      missing.push(`${kind} "${id}"`);
      return "";
    }
    return `<${kind} id="${id}">\n${text}\n</${kind}>`;
  };
  const parts = [
    `<task>\n${brief.task}\n</task>`,
    brief.modules.length
      ? `You may create or change only these modules: ${brief.modules.join(", ")}.`
      : "You may change any module the task needs.",
    brief.notes && `<notes from the lead>\n${brief.notes}\n</notes from the lead>`,
    extra.length ? `<notes>\n${extra.map((n) => `- ${n}`).join("\n")}\n</notes>` : "",
    `<engine>\n${engineSummary(ctx.draft, ctx.data.name)}\n</engine>`,
    ...brief.skills.map((id) => attach("skill", id, skills.find((s) => s.id === id)?.text)),
    ...brief.docs.map((id) => attach("doc", id, readDoc(id))),
    ...brief.examples.map((id) => attach("example", id, readExample(id))),
    brief.lore.length ? `<lore>\n${loreOrMissing(ctx, brief.lore, missing)}\n</lore>` : "",
  ];
  if (missing.length) parts.push(`Not found, so not attached: ${missing.join(", ")}. Look them up if you need them.`);
  return parts.filter(Boolean).join("\n\n");
}

function loreOrMissing(ctx: EngineerContext, ids: string[], missing: string[]): string {
  try {
    return readLoreText(loreSources(ctx), { ids });
  } catch {
    missing.push(`lore ${ids.join(", ")}`);
    return "";
  }
}

/** Write ops outside the brief's modules are refused, so a worker doesn't wander into the rest of the engine. */
export function outsideBrief(brief: WorkerBrief, call: ToolCall): string | undefined {
  if (!brief.modules.length || !WRITE_NAMES.has(call.name)) return undefined;
  const named = typeof call.input.module === "string" ? call.input.module.trim() : "";
  const target =
    call.name === "create_module" ? String(call.input.id ?? "").trim() : named || (call.name === "set_value" || call.name === "remove_value" ? "sheet" : "");
  if (!target || brief.modules.includes(target)) return undefined;
  return `"${target}" isn't in your brief (${brief.modules.join(", ")}). Stay within it, or say in your report what else needs changing.`;
}

export interface WorkerStep {
  label: string;
  error?: boolean;
}

export interface WorkerRun {
  task: string;
  steps: WorkerStep[];
  status: "running" | "done" | "stopped" | "failed";
  /** The worker's report, as the lead got it. */
  report?: string;
}

export interface WorkerOptions {
  skills: Skill[];
  system: string;
  effort: Effort;
  maxTokens: number;
  maxRounds: number;
  signal: AbortSignal;
  /** Notes for the worker, like "no screenshots this turn". */
  notes?: string[];
  /** A reason to stop before the next model call, like the user's token limit. */
  limit?: () => string | undefined;
  onRun?: (run: WorkerRun) => void;
  onText?: (delta: string) => void;
}

/** Runs one worker to the end of its task and answers the lead's run_worker call. */
export async function runWorker(ctx: EngineerContext, call: ToolCall, opts: WorkerOptions): Promise<ToolResult & { run: WorkerRun }> {
  let brief: WorkerBrief;
  try {
    brief = readBrief(call.input);
  } catch (e) {
    const run: WorkerRun = { task: "", steps: [], status: "failed" };
    return { id: call.id, content: (e as Error).message, isError: true, run };
  }
  const before = ctx.draft;
  const opsBefore = ctx.ops.length;
  let run: WorkerRun = { task: brief.task, steps: [], status: "running" };
  const show = (patch: Partial<WorkerRun>) => {
    run = { ...run, ...patch };
    opts.onRun?.(run);
  };
  show({});
  const messages: ChatMessage[] = [{ role: "user", text: briefText(ctx, brief, opts.skills, opts.notes) }];
  let report = "";
  let ending = "";
  try {
    for (let round = 0; ; round++) {
      if (round >= opts.maxRounds) {
        ending = `The worker stopped after ${opts.maxRounds} model calls, the step limit, before it finished.`;
        break;
      }
      const limited = opts.limit?.();
      if (limited && round > 0) {
        ending = limited;
        break;
      }
      const result = await complete("worker", {
        system: opts.system,
        messages,
        tools: WORKER_TOOLS,
        effort: opts.effort,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
        onText: opts.onText,
      });
      messages.push({ role: "assistant", text: result.text, toolCalls: result.toolCalls, raw: result.raw });
      if (result.text.trim()) report = result.text.trim();
      if (!result.useTools) {
        ending = "The worker's model can't call tools. Pick another one for the UI engineer worker in Settings.";
        break;
      }
      if (result.toolCalls.length) {
        const results: ToolResult[] = [];
        for (const c of result.toolCalls) {
          if (opts.signal.aborted) break;
          const refused = outsideBrief(brief, c);
          const out = refused ? { id: c.id, content: refused, isError: true } : await runEngineerTool(ctx, c);
          results.push(out);
          show({ steps: [...run.steps, { label: describeCall(c), ...(out.isError ? { error: true } : {}) }] });
        }
        for (const c of result.toolCalls.slice(results.length)) results.push({ id: c.id, content: "Stopped by the user.", isError: true });
        messages.push({ role: "tool", results });
      }
      if (result.stop === "refusal") {
        ending = "The worker's model declined the task.";
        break;
      }
      if (result.stop === "max_tokens") {
        ending = "The worker's reply was cut off at the length limit.";
        break;
      }
      if (opts.signal.aborted || !(result.stop === "tool_use" && result.toolCalls.length)) break;
    }
  } catch (e) {
    if (isAbort(e) || opts.signal.aborted) ending = "Stopped by the user.";
    else ending = `The worker failed: ${(e as Error).message || "something went wrong"}.`;
  }
  const status: WorkerRun["status"] = opts.signal.aborted ? "stopped" : ending ? "failed" : "done";
  const content = workerReport(ctx, before, opsBefore, report, ending);
  show({ status, report: content });
  return { id: call.id, content, ...(ending ? { isError: true } : {}), run };
}

/** What the lead gets back: the report, what changed, and the lint on the whole draft. */
function workerReport(ctx: EngineerContext, before: EngineerContext["draft"], opsBefore: number, report: string, ending: string): string {
  const changes = diffConfigs(before, ctx.draft);
  const findings = lintConfig(ctx.draft);
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  return [
    ending,
    `Worker's report:\n${report || "(none)"}`,
    changes.length
      ? `Changed ${changes.length} files in ${ctx.ops.length - opsBefore} edits: ${changes.map((c) => c.path).join(", ")}.`
      : "It changed nothing.",
    `Modules now: ${modulesOf(ctx.draft)
      .map((m) => m.id)
      .join(", ") || "none"}.`,
    `Lint on the draft: ${errors} errors, ${warnings} warnings.${errors + warnings ? `\n${findingsText(findings.filter((f) => f.level !== "info"))}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
