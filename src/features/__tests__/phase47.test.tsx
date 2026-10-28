import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../../ai/types";
import { newCard } from "../../card";
import { useEditor } from "../../editor/store";
import { BUILT_IN_SKILLS, readDoc } from "../../engine/engineer/knowledge";
import { lintConfig } from "../../engine/engineer/lint";
import { runEngineerTool, type EngineerContext } from "../../engine/engineer/tools";
import { coreModules, moduleConflicts, modulesOf } from "../../engine/modules/compile";
import { codeHash, forkModule, originalUpdated, unforkModule } from "../../engine/modules/fork";
import { modulePack, readPack } from "../../engine/modules/pack";
import { phoneModule, phoneSettings } from "../../engine/modules/phone";
import { inventoryModule } from "../../engine/modules/inventory";
import type { EngineModule } from "../../engine/modules/types";
import { newEngine, type EngineConfig } from "../../engine/sheet";
import { loadKits } from "../engine/kitLibrary";
import { ModulesPage } from "../engine/ModulesPage";
import { loadModuleLibrary } from "../engine/moduleLibrary";

const withPhone = (settings: Record<string, unknown> = {}, more: EngineModule[] = []): EngineConfig => ({
  ...newEngine(),
  modules: [...coreModules(), phoneModule({ contacts: [{ name: "Mina", role: "Friend", avatar: "" }], ...settings }), ...more],
});
const byId = (c: EngineConfig, id: string) => modulesOf(c).find((m) => m.id === id)!;
const paths = (m: EngineModule) => m.vars.map((v) => `${v.group}.${v.name}`);

let n = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `f${++n}`, name, input });

describe("forking a whole built-in", () => {
  it("copies the phone in place: same id, values, slot and button, its own code, and the original gone", () => {
    const before = withPhone();
    const { config, module } = forkModule(before, "phone");
    const phone = byId(config, "phone");
    expect(phone.core).toBeUndefined();
    expect(phone.fork).toMatchObject({ core: "phone" });
    expect(phone.tags).toContain("fork");
    expect(phone.tags).not.toContain("built-in");
    expect(paths(phone)).toEqual(paths(byId(before, "phone")));
    expect([phone.slot, phone.button, phone.js]).toEqual(["overlay", "📱 Phone", byId(before, "phone").js]);
    expect(modulesOf(config).filter((m) => m.id === "phone")).toHaveLength(1);
    expect(moduleConflicts(config)).toEqual([]);
    // One flat settings object, so the fork's code reads what set_module_settings changes.
    expect(phone.settings.live).toBeUndefined();
    expect((phone.settings.contacts as { name: string }[])[0].name).toBe("Mina");
    expect(module.id).toBe("phone");
    expect(originalUpdated(phone)).toBe(false);
    expect(originalUpdated({ ...phone, fork: { ...phone.fork!, code: "00000000" } })).toBe(true);
  });

  it("keeps the links other parts have to it, and its own list of phone apps", () => {
    const bank: EngineModule = { ...coreModules()[1], id: "bank", name: "Bank", core: undefined, tags: ["phone-app"], button: "🏦 Bank", vars: [] };
    const { config } = forkModule(withPhone({}, [inventoryModule(), bank]), "phone");
    // The inventory still pays from the phone's wallet.
    expect(paths(byId(config, "inventory"))).not.toContain("Inventory.Gold");
    expect(byId(config, "phone").settings.extra).toEqual([{ id: "bank", name: "Bank" }]);
  });

  it("refuses what isn't a built-in, and goes back to CardForge's version", () => {
    const { config } = forkModule(withPhone(), "phone");
    expect(() => forkModule(config, "phone")).toThrow(/already the card's own/);
    expect(() => forkModule(config, "nope")).toThrow(/no module "nope"/);
    const back = byId(unforkModule(config, "phone"), "phone");
    expect(back.core).toBe("phone");
    expect(back.fork).toBeUndefined();
    expect(phoneSettings(back.settings).contacts[0].name).toBe("Mina");
  });

  it("survives the module library and pack files", () => {
    const { module } = forkModule(withPhone(), "phone");
    const [again] = readPack(JSON.stringify(modulePack([module])));
    expect(again.fork).toEqual(module.fork);
    expect(again.core).toBeUndefined();
  });
});

describe("forking one phone app", () => {
  it("moves the app, its values and its rule lines into a module of its own, and the phone keeps the rest", () => {
    const before = withPhone();
    const { config, module } = forkModule(before, "phone", "messages");
    expect(module.id).toBe("phone-messages");
    const app = byId(config, "phone-messages");
    const phone = byId(config, "phone");
    expect(phone.core).toBe("phone");
    expect(phoneSettings(phone.settings).apps).not.toContain("messages");
    expect(paths(app).sort()).toEqual(["Phone.Read", "Phone.Texts"]);
    expect(paths(phone)).not.toContain("Phone.Texts");
    expect(app.tags).toEqual(["phone-app", "fork"]);
    expect(app.rules[0].content).toMatch(/^<action app="phone">/);
    expect(app.rules[0].content).toContain('"app":"messages"');
    expect(app.rules[0].content).not.toContain('"app":"social"');
    expect(phone.rules[0].content).not.toContain('"app":"messages"');
    expect(app.settings).toMatchObject({ piece: "messages", apps: ["messages"] });
    // The phone shows it on its home screen.
    expect(phone.settings.extra).toEqual([{ id: "phone-messages", name: "Messages" }]);
    expect(moduleConflicts(config)).toEqual([]);
    expect(() => forkModule(config, "phone", "messages")).toThrow(/doesn't have the Messages app/);
    expect(() => forkModule(before, "time", "messages")).toThrow(/Only the phone's apps/);
  });

  it("goes back into the phone", () => {
    const { config } = forkModule(withPhone(), "phone", "shop");
    const back = unforkModule(config, "phone-shop");
    expect(modulesOf(back).some((m) => m.id === "phone-shop")).toBe(false);
    expect(phoneSettings(byId(back, "phone").settings).apps).toContain("shop");
    expect(paths(byId(back, "phone"))).toEqual(paths(byId(withPhone(), "phone")));
  });

  it("shows only its app, with no lock or home screen of its own", () => {
    const { module } = forkModule(withPhone(), "phone", "contacts");
    const root = document.createElement("div");
    const ui = { esc: (s: unknown) => String(s ?? ""), icon: (n: string) => `<i>${n}</i>`, avatar: () => "", meter: () => "", delta: () => "" };
    const CF = { ui, asset: () => "", assets: { portrait: () => null, scene: () => null }, modules: () => [], mount: vi.fn(), open: vi.fn() };
    const app = { state: () => undefined, onState: vi.fn(), send: vi.fn(), setMany: () => Promise.resolve(), toast: vi.fn(), delta: () => null };
    new Function("CF", "app", "root", "settings", module.js)(CF, app, root, module.settings);
    expect(root.querySelector(".ph-piece")).not.toBeNull();
    expect(root.querySelector(".ph-lock, .ph-home, .ph-homebar")).toBeNull();
    expect(root.textContent).toContain("Mina");
    // Its top screen has no back button; "home" leads back to the app.
    expect(root.querySelector('[data-go="home"]')).toBeNull();
  });
});

describe("the engineer's fork_module tool", () => {
  const ctx = (): EngineerContext => ({ data: { name: "Mina" } as EngineerContext["data"], draft: withPhone(), ops: [], skills: BUILT_IN_SKILLS });

  it("forks into the draft, then the fork can be patched; the lint checks only what changed", async () => {
    const c = ctx();
    const refused = await runEngineerTool(c, call("patch_file", { module: "phone", file: "js", find: "var piece", replace: "var piece2" }));
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain("fork_module");
    const done = await runEngineerTool(c, call("fork_module", { module: "phone", app: "shop" }));
    expect(done.isError).toBeFalsy();
    expect(done.content).toContain('"phone-shop"');
    expect(c.ops.map((o) => o.name)).toEqual(["fork_module"]);
    const mine = (f: { message: string }) => f.message.startsWith("phone-shop");
    expect(lintConfig(c.draft).filter(mine)).toEqual([]);
    const patched = await runEngineerTool(c, call("patch_file", { module: "phone-shop", file: "js", find: "var piece", replace: 'fetch("x");\nvar piece' }));
    expect(patched.isError).toBeFalsy();
    expect(lintConfig(c.draft).filter(mine).map((f) => f.check)).toEqual(["network"]);
  });

  it("is taught by the fork-and-tailor skill and the modules doc", () => {
    const skill = BUILT_IN_SKILLS.find((s) => s.id === "fork-and-tailor");
    expect(skill?.text).toMatch(/Settings first/);
    expect(readDoc("modules#forking-a-built-in")).toContain("fork_module");
  });
});

describe("the Modules tab", () => {
  it("forks a built-in, says so, and brings the original back", async () => {
    useEditor.setState({ record: { card: newCard("Mina") } as never });
    let config = withPhone();
    const save = vi.fn((c: EngineConfig) => (config = c));
    const { rerender, unmount } = render(<ModulesPage config={config} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: /^Phone/ }));
    fireEvent.change(screen.getByLabelText("Phone app to fork"), { target: { value: "news" } });
    fireEvent.click(screen.getByRole("button", { name: "Fork only this app" }));
    expect(byId(config, "phone-news").fork?.piece).toBe("news");
    // The phone stays open.
    rerender(<ModulesPage config={config} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Fork Phone" }));
    expect(byId(config, "phone").fork?.core).toBe("phone");
    rerender(<ModulesPage config={config} save={save} />);
    expect(screen.getAllByText("Fork").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Use CardForge's version again" }));
    expect(byId(config, "phone").core).toBe("phone");
    expect(codeHash(byId(config, "phone"))).toBe(codeHash(phoneModule()));
    // Let the parts browser's library and kits finish loading before the page goes away.
    await act(async () => {
      await Promise.all([loadModuleLibrary(), loadKits()]);
    });
    unmount();
  });
});
