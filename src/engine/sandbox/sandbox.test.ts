import { describe, expect, it } from "vitest";
import { newCard } from "../../card";
import { applyEngine, newEngine, newVar } from "../sheet";
import hostSource from "./host.js?raw";
import { cardScripts, SANDBOX_CSP, sandboxCard, sandboxDocument, sandboxUrl } from "./sandbox";
import { TAVERN_HELPER_FUNCTIONS } from "./th-api";

const libs = { libs: "window._ = {};", jquery: "/* jquery */", vue: "/* vue */" };
const engineCard = () =>
  applyEngine({ ...newCard().data, name: "Mina", first_mes: "Hello </script> there", alternate_greetings: ["Hi"] }, {
    ...newEngine(),
    vars: [newVar({ group: "Player", name: "Health", start: "80", min: 0, max: 100 })],
  });

describe("the sandbox page", () => {
  it("blocks the network and carries the card's scripts, regex and lorebook", () => {
    const data = engineCard();
    const doc = sandboxDocument({ data, libs });
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`);
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    expect(SANDBOX_CSP).not.toMatch(/https?:/);
    // The greeting's "</script>" can't close the config's script element early.
    expect(doc.match(/<\/script>/g)).toHaveLength(2);
    const card = sandboxCard(data);
    expect(card.scripts.map((s) => s.name)).toEqual(["CardForge engine"]);
    expect(card.regex).toHaveLength(7);
    expect(card.book.map((e) => e.comment)).toContain("[initvar] Starting values");
    expect(card.alternate_greetings).toEqual(["Hi"]);
  });

  it("flattens Tavern Helper folders and skips what is turned off", () => {
    const data = {
      ...newCard().data,
      extensions: {
        tavern_helper: {
          scripts: [
            { type: "script", name: "A", id: "a", content: "1", enabled: true },
            { type: "script", name: "Off", id: "b", content: "2", enabled: false },
            { type: "folder", name: "F", enabled: true, scripts: [{ type: "script", name: "C", id: "c", content: "3", enabled: true, button: { enabled: true, buttons: [{ name: "Go", visible: true }] } }] },
            { type: "folder", name: "Off folder", enabled: false, scripts: [{ type: "script", name: "D", id: "d", content: "4", enabled: true }] },
          ],
        },
      },
    };
    expect(cardScripts(data).map((s) => [s.id, s.buttons.length])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
  });

  it("keeps the runtime inlinable and answers every Tavern Helper function", () => {
    expect(hostSource).not.toMatch(/<\/script/i);
    expect(TAVERN_HELPER_FUNCTIONS.length).toBeGreaterThan(150);
    for (const name of ["getVariables", "updateVariablesWith", "getChatMessages", "setChatMessages", "eventOn", "eventEmit", "triggerSlash", "waitGlobalInitialized", "registerVariableSchema"]) {
      expect(TAVERN_HELPER_FUNCTIONS).toContain(name);
      expect(hostSource).toContain(`${name}:`);
    }
  });

  it("makes a data URL that keeps non-ASCII text", () => {
    const url = sandboxUrl("<p>Café ☕</p>");
    expect(url.startsWith("data:text/html;base64,")).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("<p>Café ☕</p>");
  });
});
