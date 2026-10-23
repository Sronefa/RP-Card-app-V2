import { isTauri } from "@tauri-apps/api/core";

/**
 * fetch for model APIs. In the app, requests go through Tauri's HTTP plugin, which is not
 * limited by CORS, so any OpenAI-compatible endpoint works. In a browser, the normal fetch.
 */
export async function getFetch(): Promise<typeof fetch> {
  if (isTauri()) return (await import("@tauri-apps/plugin-http")).fetch as typeof fetch;
  return globalThis.fetch.bind(globalThis);
}
