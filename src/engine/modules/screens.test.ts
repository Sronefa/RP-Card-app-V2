import { describe, expect, it } from "vitest";
import { panelActions, panelFields, panelHtml, panelTabs } from "../panel";
import { newEngine, newVar, type EngineConfig } from "../sheet";
import { BUILT_IN_SCREENS, coreModules, effectiveVars, moduleConflicts, moduleRegex, modulesOf, newModule, PHONE_APP_TAG } from "./compile";
import { CREATOR_TAG, creatorModule, creatorSettings, defaultCreatorSettings } from "./creator";
import { cleanModule } from "./pack";
import { defaultPhoneSettings, PHONE_APP_IDS, phoneModule, phoneSettings } from "./phone";

const engine = (fields: Partial<EngineConfig> = {}): EngineConfig => ({ ...newEngine(), ...fields });
const parses = (code: string, args: string[]) => expect(() => new Function(...args, code)).not.toThrow();

describe("the status panel", () => {
  const config = () =>
    engine({
      vars: [
        newVar({ group: "Player", name: "Health", start: "80", min: 0, max: 100 }),
        newVar({ group: "Player", name: "Gold", start: "5" }),
        newVar({ group: "Mina", name: "Affection", start: "10", min: 0, max: 100, pinned: false }),
        newVar({ group: "World", name: "Weather", type: "text", start: "rain" }),
      ],
    });

  it("puts groups in the author's tabs, with the rest under Other", () => {
    const c = config();
    c.panel = { ...c.panel, tabs: [{ label: "Me", groups: ["Player"] }, { label: "People", groups: ["Mina"] }, { label: "", groups: ["World"] }] };
    expect(panelTabs(c).map((t) => t.label)).toEqual(["Me", "People", "Other"]);
    expect(panelFields(c).map((f) => [f.label, f.tab])).toEqual([
      ["Health", 0],
      ["Gold", 0],
      ["Affection", 1],
      ["Weather", 2],
    ]);
    expect(panelTabs(config())).toEqual([]);
  });

  it("keeps only finished action buttons and stays safe for a regex", () => {
    const c = config();
    c.panel = { ...c.panel, actions: [{ label: "Rest", text: "I rest for $1 hour {{char}}", now: true }, { label: "", text: "x", now: false }] };
    expect(panelActions(c)).toHaveLength(1);
    const html = panelHtml(c);
    expect(html).not.toMatch(/\$\d|\$<|\{\{/);
    expect(html).not.toMatch(/&[a-z]+;|&#/i);
    const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
    parses(script, []);
  });
});

describe("the character creator", () => {
  it("cleans its settings and adds the character's values", () => {
    const s = creatorSettings({ group: "Hero.$", points: -3, stats: [{ name: "Str", base: 2, max: 1 }, { name: "" }], choices: [{ name: "Class", options: [{ name: "Mage" }, { name: "" }] }, { name: "Empty", options: [] }] });
    expect(s.group).toBe("Hero");
    expect(s.points).toBe(0);
    const m = creatorModule(s as unknown as Record<string, unknown>);
    const vars = m.vars.map((v) => [v.group, v.name, v.type, v.hidden ?? false]);
    expect(vars).toContainEqual(["Hero", "Name", "text", false]);
    expect(vars).toContainEqual(["Hero", "Class", "choice", false]);
    expect(vars.find((v) => v[1] === "Empty")).toBeUndefined();
    expect(vars.find((v) => v[1] === "Str")?.[2]).toBe("number");
    expect(m.vars.find((v) => v.name === "Str")?.max).toBe(2);
    expect(vars.some((v) => v[1] === "Created" && v[3] === true)).toBe(true);
    expect((m.settings.live as { stats: unknown[] }).stats).toHaveLength(1);
  });

  it("shows in a message through its tag, and its code parses", () => {
    const m = creatorModule();
    expect(m.slot).toBe("message");
    const regex = moduleRegex(engine({ modules: [...coreModules(), m] }));
    const show = regex.find((r) => r.id === "cf-creator-show")!;
    expect(CREATOR_TAG).toMatch(new RegExp(show.findRegex.slice(1, show.findRegex.lastIndexOf("/"))));
    expect(show.replaceString).not.toMatch(/\$\d|\$<|\{\{/);
    parses(m.js, ["CF", "app", "root", "settings"]);
    expect(defaultCreatorSettings().routes[0].message).toContain("{name}");
  });
});

describe("the phone", () => {
  it("cleans its settings", () => {
    const s = phoneSettings({ apps: ["messages", "bogus", "messages", "map"], keep: 1, moneyPath: "Player.Gold;<x>", contactFields: { notes: true } });
    expect(s.apps).toEqual(["messages", "map"]);
    expect(s.keep).toBe(5);
    expect(s.moneyPath).toBe("Player.Goldx");
    expect(s.contactFields).toEqual({ affection: true, outfit: true, location: true, notes: true });
    expect(phoneSettings(undefined)).toEqual(defaultPhoneSettings());
    expect(PHONE_APP_IDS).toHaveLength(12);
  });

  it("adds values for its apps and contacts, and uses the card's own money", () => {
    const m = phoneModule({ ...defaultPhoneSettings(), contacts: [{ name: "Mina", role: "neighbour", avatar: "" }, { name: " ", role: "", avatar: "" }] });
    const paths = m.vars.map((v) => `${v.group}.${v.name}`);
    expect(paths).toEqual(expect.arrayContaining(["Phone.Texts", "Phone.Money", "Phone.Items", "Phone.Location", "Mina.Affection", "Mina.Outfit"]));
    expect(m.vars.find((v) => v.name === "Read")?.hidden).toBe(true);
    const own = phoneModule({ ...defaultPhoneSettings(), moneyPath: "Player.Gold", apps: ["wallet"] });
    expect(own.vars.map((v) => v.name)).toEqual(["Transactions"]);
    expect(own.rules[0].keys).toEqual(['app="phone"']);
    parses(m.js, ["CF", "app", "root", "settings"]);
    parses(m.script, ["CF", "settings", "hooks"]);
  });

  it("is a built-in screen the author adds, with apps from other modules", () => {
    expect(BUILT_IN_SCREENS.map((s) => s.core)).toEqual(["creator", "phone"]);
    expect(coreModules().map((m) => m.id)).not.toContain("phone");
    const bank = { ...newModule("Bank"), tags: [PHONE_APP_TAG] };
    const config = engine({ modules: [...coreModules(), phoneModule(), bank] });
    const phone = modulesOf(config).find((m) => m.id === "phone")!;
    expect(phone.settings.extra).toEqual([{ id: "bank", name: "Bank" }]);
    expect(moduleConflicts(config)).toEqual([]);
    expect(effectiveVars(config).some((v) => v.group === "Phone")).toBe(true);
  });

  it("shows inside a message when inline is on", () => {
    const on = moduleRegex(engine({ modules: [...coreModules(), phoneModule()] }));
    expect(on.find((r) => r.id === "cf-phone-show")?.replaceString).toContain('data-cf-inline="1"');
    const off = moduleRegex(engine({ modules: [...coreModules(), phoneModule({ inline: false })] }));
    expect(off.find((r) => r.id === "cf-phone-show")).toBeUndefined();
  });

  it("needs the time module", () => {
    const config = engine({ modules: [...coreModules().filter((m) => m.id !== "time"), phoneModule()] });
    expect(moduleConflicts(config).map((c) => c.message)).toContain('Needs the "time" module, which isn\'t installed and on.');
  });

  it("is rebuilt from a pack file's settings, not its code", () => {
    const m = cleanModule({ ...phoneModule({ name: "Pocket" }), js: "evil()" })!;
    expect(m.core).toBe("phone");
    expect(m.js).not.toBe("evil()");
    expect(m.settings.name).toBe("Pocket");
  });
});
