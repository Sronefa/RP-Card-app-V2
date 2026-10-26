/**
 * The UI engineer's eyes: a hidden sandbox page that runs the draft card, so the engineer can set
 * sample state, look at a screenshot, read the console, click things and play a turn, the way the
 * user does in the Sandbox tab.
 */
import type { CardDataV3 } from "../../card";
import {
  sandboxDocument,
  sandboxUrl,
  type ClickResult,
  type SandboxCapture,
  type SandboxCommand,
  type SandboxLibs,
  type SandboxMessage,
  type SandboxReport,
  type ScreenReport,
} from "../sandbox/sandbox";
import type { ScenarioTurn } from "../sheet";

export const PREVIEW_DEVICES = {
  phone: { width: 390, height: 760 },
  desktop: { width: 1280, height: 800 },
} as const;
export type PreviewDevice = keyof typeof PREVIEW_DEVICES;

const READY_MS = 20_000;
const COMMAND_MS = 30_000;

type Pending = { resolve: (value: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !base || typeof base !== "object" || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}

export class EnginePreview {
  private frame?: HTMLIFrameElement;
  private key = "";
  private device: PreviewDevice = "phone";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready?: { resolve: () => void; reject: (e: Error) => void };
  private problems: string[] = [];
  private logs: string[] = [];
  /** The sandbox chat as it last reported it. */
  chat: SandboxMessage[] = [];

  constructor(private host: HTMLElement = document.body) {
    window.addEventListener("message", this.onMessage);
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const report = (e.data as { cfSandbox?: SandboxReport })?.cfSandbox;
    if (!report) return;
    switch (report.kind) {
      case "ready":
        this.ready?.resolve();
        this.ready = undefined;
        break;
      case "done": {
        const waiting = report.id !== undefined ? this.pending.get(report.id) : undefined;
        if (!waiting) break;
        this.pending.delete(report.id!);
        clearTimeout(waiting.timer);
        if (report.failed) waiting.reject(new Error(report.failed));
        else waiting.resolve(report.result);
        break;
      }
      case "state":
        this.chat = report.chat;
        break;
      case "log":
        this.logs.push(`${report.source}: ${report.action}${report.detail ? ` ${report.detail.slice(0, 200)}` : ""}`);
        break;
      case "console":
        this.problems.push(`console.${report.level} in ${report.source}: ${report.message}`);
        break;
      case "error":
        this.problems.push(
          `Error in ${report.source}${report.line ? ` at line ${report.line}` : ""}: ${report.message}${report.code ? `\n    ${report.code.trim()}` : ""}`,
        );
        break;
    }
  };

  get loaded() {
    return !!this.frame;
  }

  /**
   * Starts the card on a fresh page and plays the scenario, unless the same card is already
   * running on the same device and `fresh` is false.
   */
  async load(opts: { data: CardDataV3; libs: SandboxLibs; device: PreviewDevice; scenario: ScenarioTurn[]; fresh?: boolean }) {
    const doc = sandboxDocument({ data: opts.data, libs: opts.libs });
    const key = `${opts.device}\n${JSON.stringify(opts.scenario)}\n${doc}`;
    if (this.frame && key === this.key && !opts.fresh) return false;
    this.unload();
    this.key = key;
    this.device = opts.device;
    const { width, height } = PREVIEW_DEVICES[opts.device];
    const frame = document.createElement("iframe");
    frame.title = "UI engineer preview";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // On screen but invisible: browsers slow down pages they think nobody can see.
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-1;`;
    const ready = new Promise<void>((resolve, reject) => {
      this.ready = { resolve, reject };
      setTimeout(() => reject(new Error("The preview page didn't start in time.")), READY_MS);
    });
    frame.src = sandboxUrl(doc);
    this.frame = frame;
    this.host.appendChild(frame);
    await ready;
    if (opts.scenario.length) await this.command({ type: "scenario", turns: opts.scenario });
    return true;
  }

  unload() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("The preview page was closed."));
    }
    this.pending.clear();
    this.ready?.reject(new Error("The preview page was closed."));
    this.ready = undefined;
    this.frame?.remove();
    this.frame = undefined;
    this.key = "";
    this.chat = [];
  }

  dispose() {
    this.unload();
    window.removeEventListener("message", this.onMessage);
  }

  command<T = unknown>(command: SandboxCommand, ms = COMMAND_MS): Promise<T> {
    const win = this.frame?.contentWindow;
    if (!win) return Promise.reject(new Error("The preview isn't running. Render it first."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The preview didn't finish "${command.type}" in time.`));
      }, ms);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      win.postMessage({ cfCommand: { ...command, requestId: id } }, "*");
    });
  }

  /** The id of the newest message, where sample state goes. */
  get latestId() {
    return this.chat.at(-1)?.id ?? 0;
  }

  /** Puts sample values (merged into what is there) and changes on the newest message. */
  async setSample(state: Record<string, unknown>, delta?: Record<string, [unknown, unknown]>) {
    const latest = this.chat.at(-1);
    const variables = { ...(latest?.variables ?? {}) } as Record<string, unknown>;
    variables.stat_data = deepMerge(variables.stat_data ?? {}, state);
    if (delta) variables.delta_data = delta;
    await this.command({ type: "setVariables", id: latest?.id ?? 0, variables });
  }

  open = (module: string) => this.command({ type: "open", module });
  close = () => this.command({ type: "close" });
  capture = () => this.command<SandboxCapture>({ type: "capture" });
  inspect = () => this.command<{ screens: ScreenReport[] }>({ type: "inspect" }).then((r) => r.screens);
  click = (target: { screen?: string; selector?: string; text?: string }) => this.command<ClickResult>({ type: "click", ...target });

  /** Problems and log lines since the last call. */
  take() {
    const out = { problems: this.problems, logs: this.logs };
    this.problems = [];
    this.logs = [];
    return out;
  }

  get size() {
    return PREVIEW_DEVICES[this.device];
  }
}
