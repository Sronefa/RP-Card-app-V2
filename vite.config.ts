/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import type { Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * `virtual:sandbox-libs`: lodash, YAML and Zod bundled into one script the engine sandbox runs
 * inside its iframe, the way Tavern Helper offers them to the iframes it makes in SillyTavern.
 */
function sandboxLibs(): Plugin {
  const id = "virtual:sandbox-libs";
  const entry = fileURLToPath(new URL("./src/engine/sandbox/libs.js", import.meta.url));
  return {
    name: "cardforge-sandbox-libs",
    resolveId: (source) => (source === id ? "\0" + id : undefined),
    async load(resolved) {
      if (resolved !== "\0" + id) return;
      const bundle = await rolldown({ input: entry, logLevel: "silent" });
      const { output } = await bundle.generate({ format: "iife", minify: true });
      await bundle.close();
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(output[0].code)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), sandboxLibs()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
}));
