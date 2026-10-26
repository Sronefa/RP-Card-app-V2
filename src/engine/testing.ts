/** Test helpers: a stand-in for Tavern Helper that runs the engine's card script. */
import { z } from "zod";

/** A stand-in for Tavern Helper: a chat whose messages keep variables per message, and the events. */
export function fakeTavern(messages: { role: string; message: string }[]) {
  const vars: Record<string, unknown>[] = messages.map(() => ({}));
  const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const globals: Record<string, unknown> = {};
  const id = (option: { message_id?: number | "latest" }) =>
    option.message_id === "latest" || option.message_id === undefined ? messages.length - 1 : option.message_id;
  // Chat and character variables; anything else is a message's.
  const scopes: Record<string, Record<string, unknown>> = { chat: {}, character: {} };
  type Option = { type?: string; message_id?: number | "latest" };
  const read = (o: Option) => (o.type && o.type in scopes ? scopes[o.type] : vars[id(o)]);
  const write = (o: Option, v: Record<string, unknown>) => (o.type && o.type in scopes ? (scopes[o.type] = v) : (vars[id(o)] = v));
  const api = {
    z,
    YAML: { parse: (s: string) => JSON.parse(s) },
    getVariables: (o: Option) => structuredClone(read(o)),
    replaceVariables: (v: Record<string, unknown>, o: Option) => write(o, structuredClone(v)),
    updateVariablesWith: async (fn: (v: Record<string, unknown>) => Record<string, unknown>, o: Option) => write(o, fn(structuredClone(read(o) ?? {}))),
    getChatMessages: (i: number) => (messages[i] ? [{ message_id: i, ...messages[i] }] : []),
    setChatMessages: async (changes: { message_id: number; message?: string }[]) => {
      for (const c of changes) if (c.message !== undefined) messages[c.message_id].message = c.message;
    },
    getLastMessageId: () => messages.length - 1,
    getCharWorldbookNames: () => ({ primary: null, additional: [] }),
    getWorldbook: async () => [],
    eventOn: (name: string, fn: (...args: unknown[]) => unknown) => (listeners[name] ??= []).push(fn),
    eventEmit: async (name: string, ...args: unknown[]) => {
      for (const fn of listeners[name] ?? []) await fn(...args);
    },
    tavern_events: {
      MESSAGE_RECEIVED: "message_received",
      MESSAGE_SENT: "message_sent",
      MESSAGE_EDITED: "message_edited",
      MESSAGE_SWIPED: "message_swiped",
      CHAT_CHANGED: "chat_id_changed",
    },
    initializeGlobal: (name: string, value: unknown) => (globals[name] = value),
    registerVariableSchema: () => {},
    console: { info: () => {}, warn: console.warn, error: console.error },
  };
  return { api, vars, scopes, messages, listeners, globals };
}

const ours = new Set<string>();

export async function runScript(source: string, tavern: ReturnType<typeof fakeTavern>) {
  const names = Object.keys(tavern.api);
  // Module scripts are made with new Function, so they see Tavern Helper's functions as globals,
  // as they are in SillyTavern.
  const g = globalThis as Record<string, unknown>;
  for (const n of names) {
    if (n in g && !ours.has(n)) continue;
    g[n] = tavern.api[n as keyof typeof tavern.api];
    ours.add(n);
  }
  new Function(...names, source)(...names.map((n) => tavern.api[n as keyof typeof tavern.api]));
  // Let the start-up initialization finish.
  await new Promise((r) => setTimeout(r, 0));
}
