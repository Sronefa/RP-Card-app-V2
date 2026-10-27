/**
 * The Test button on each provider: one tiny request, and when it fails, what went wrong in plain
 * words (wrong address, bad key, model unavailable, no balance) instead of a raw HTTP error.
 */
import { getFetch } from "./http";
import { comfyInfo } from "../images/comfy";
import type { ImageProviderConfig } from "../images/providers";
import type { Provider, ProviderConfig } from "./types";

export interface TestResult {
  ok: boolean;
  /** One or two plain sentences for the user. */
  message: string;
  /** Something the user should know even though it worked, like an empty balance. */
  warning?: string;
}

/** How long a test may take before it counts as unreachable. */
const TEST_TIMEOUT_MS = 30_000;

const statusOf = (e: unknown): number | undefined => {
  const status = (e as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
};

const detailOf = (e: unknown): string => {
  const body = (e as { body?: unknown } | undefined)?.body;
  return typeof body === "string" && body ? body : e instanceof Error ? e.message : String(e);
};

const isLocal = (url: string) => /\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[::1\])/i.test(url);

/** A failed request, explained. `model` is the model the request asked for, if any. */
export function explainFailure(e: unknown, opts: { name: string; baseUrl?: string; model?: string }): string {
  const status = statusOf(e);
  const detail = detailOf(e).replace(/\s+/g, " ").trim().slice(0, 200);
  const where = opts.baseUrl?.trim() || "the provider";
  const model = opts.model ? `the model "${opts.model}"` : "the model";
  const tail = detail ? ` (${status ? `HTTP ${status}: ` : ""}${detail})` : "";
  const says = (re: RegExp) => re.test(detail);
  const modelProblem = says(/model/i) && says(/not.?found|does ?n[o']t exist|unknown|invalid|unavailable|not (available|supported)|no such|no access|not allowed|deprecated/i);

  if (status === undefined) {
    if ((e as Error)?.name === "TimeoutError" || says(/timed? ?out|timeout/i))
      return `${opts.name} didn't answer within ${TEST_TIMEOUT_MS / 1000} seconds. The address may be wrong, or the server is busy or asleep.${tail}`;
    return `Couldn't reach ${where}. Check the address${isLocal(where) ? ", and that the server is running and reachable from this device" : " and your internet connection"}.${tail}`;
  }
  if (status === 402 || says(/insufficient|balance|credit|quota|funds|billing|payment required|top.?up/i))
    return `${opts.name} has no balance left on this account. Top it up on the provider's site, or use a model your subscription covers.${tail}`;
  if (modelProblem) return `${opts.name} doesn't offer ${model}, or not to this key. Check its exact name with Load models.${tail}`;
  if (status === 401 || status === 403) return `${opts.name} refused the API key. Check that it's copied in full and still active.${tail}`;
  if (status === 404)
    return `Wrong address: nothing answers at ${where}. OpenAI-compatible addresses usually end in /v1, like https://nano-gpt.com/api/v1.${tail}`;
  if (status === 429) return `${opts.name} is rate limiting this key right now. Wait a minute and test again.${tail}`;
  if (status >= 500) return `${opts.name} had a problem on its side. ${opts.model ? `${model} may be down; ` : ""}try again later or another model.${tail}`;
  return `${opts.name} turned the request down.${tail}`;
}

/** NanoGPT's balance, when the address is NanoGPT's. A warning when it's empty, an error when the key is refused. */
async function nanoBalance(baseUrl: string, apiKey: string): Promise<{ refused?: true; empty?: true } | undefined> {
  let origin: string;
  try {
    const url = new URL(baseUrl);
    if (!/(^|\.)nano-gpt\.com$/i.test(url.hostname) || !apiKey) return undefined;
    origin = url.origin;
  } catch {
    return undefined;
  }
  try {
    const f = await getFetch();
    const res = await f(`${origin}/api/check-balance`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { refused: true };
    if (!res.ok) return undefined;
    const body = (await res.json()) as { usd_balance?: unknown; nano_balance?: unknown };
    const usd = Number(body.usd_balance);
    const nano = Number(body.nano_balance);
    return Number.isFinite(usd) && usd <= 0 && !(nano > 0) ? { empty: true } : {};
  } catch {
    // The balance is a bonus; the test stands on the main request.
    return undefined;
  }
}

const EMPTY_BALANCE = "The NanoGPT balance is empty: pay-as-you-go models won't run, only the ones a subscription covers.";

/**
 * A text provider: a one-word reply from `model` (it checks the address, key, model and balance at
 * once), or the model list when no model is saved yet.
 */
export async function testTextProvider(config: ProviderConfig, model: string | undefined, provider: Provider): Promise<TestResult> {
  const opts = { name: config.name, baseUrl: config.kind === "openai" ? config.baseUrl : undefined, model };
  if (config.kind === "openai" && !config.baseUrl?.trim()) return { ok: false, message: "Fill in the base URL first." };
  if (config.kind === "anthropic" && !config.apiKey) return { ok: false, message: "Paste your Claude API key first." };
  try {
    if (!model) {
      const list = await provider.listModels();
      return {
        ok: true,
        message: `Reached ${config.name}: ${list.length} models listed. Add a model to test a reply, which also checks the key and balance.`,
      };
    }
    const result = await provider.complete({
      model,
      system: "This is a connection test. Reply with the single word OK.",
      messages: [{ role: "user", text: "Connection test: reply OK." }],
      tools: [],
      useTools: false,
      maxTokens: 16,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const balance = config.kind === "openai" ? await nanoBalance(config.baseUrl ?? "", config.apiKey) : undefined;
    if (result.stop === "refusal") return { ok: true, message: `${model} answered but declined the test message. The connection works.` };
    return { ok: true, message: `${model} answered. The address, key and model work.`, ...(balance?.empty ? { warning: EMPTY_BALANCE } : {}) };
  } catch (e) {
    return { ok: false, message: explainFailure(e, opts) };
  }
}

class StatusError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
  }
}

/**
 * An image provider: its model list with the key, which costs nothing, plus the balance on NanoGPT.
 * No picture is made, so the test doesn't spend money.
 */
export async function testImageProvider(p: ImageProviderConfig): Promise<TestResult> {
  const base = p.baseUrl.trim().replace(/\/+$/, "");
  const opts = { name: p.name, baseUrl: base };
  if (!base) return { ok: false, message: "Fill in the address first." };
  try {
    if (p.kind === "comfyui") {
      const info = await comfyInfo(p).catch((e: Error) => {
        // ComfyUI's own answer is already explained; a network failure isn't.
        if (e.message.startsWith("ComfyUI")) throw Object.assign(new Error(e.message), { explained: true });
        throw e;
      });
      return { ok: true, message: `Reached ComfyUI: ${info.checkpoints.length} checkpoints, ${info.loras.length} LoRAs.` };
    }
    if (!p.apiKey) return { ok: false, message: "Paste the API key first." };
    const f = await getFetch();
    const res = await f(`${base}/models`, {
      headers: { Authorization: `Bearer ${p.apiKey}`, "x-api-key": p.apiKey },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new StatusError(res.status, await res.text().catch(() => ""));
    const balance = p.kind === "nanogpt" ? await nanoBalance(base, p.apiKey) : undefined;
    if (balance?.refused) return { ok: false, message: explainFailure(new StatusError(401, ""), opts) };
    return {
      ok: true,
      message: `Reached ${p.name}${balance ? " and the key works" : ""}. Load models to pick one.`,
      ...(balance?.empty ? { warning: EMPTY_BALANCE } : {}),
    };
  } catch (e) {
    return { ok: false, message: (e as { explained?: boolean }).explained ? (e as Error).message : explainFailure(e, opts) };
  }
}
