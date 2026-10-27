import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { contentLines, interviewKickoff, proseLines, settingsContext, systemPrompt } from "../../ai/prompts";
import { contentLabel, DEFAULT_COWRITER, withCowriterDefaults, type CowriterSettings } from "../../ai/records";
import { useAiSettings, DEFAULT_IMAGE_STYLES } from "../../ai/settings";
import { newCard } from "../../card";
import { projectSettings } from "../../cowriter/engine";
import { createProject, getProject, resetDbForTests, saveProject } from "../../db/db";
import { withContentTags } from "../../lib/contentTags";
import { ProjectStyleDialog } from "../cowriter/ProjectStyleDialog";

const settings = (patch: Partial<CowriterSettings>): CowriterSettings => ({ ...DEFAULT_COWRITER, ...patch });

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  useAiSettings.setState({ loaded: true, settings: { providers: [], modeModels: {}, noToolModels: [], presets: [], imageStyles: DEFAULT_IMAGE_STYLES } });
});

describe("content levels", () => {
  it("migrates old content modes into the two levels", async () => {
    expect(withCowriterDefaults({ contentMode: "dark" })).toMatchObject({ dark: "dark", unhinged: "off" });
    expect(withCowriterDefaults({ contentMode: "unhinged" })).toMatchObject({ dark: "off", unhinged: "normal" });
    expect(withCowriterDefaults(undefined)).toMatchObject({ dark: "off", unhinged: "off" });
    expect(withCowriterDefaults({ contentMode: "dark", dark: "horror" }).dark).toBe("horror");
    expect(withCowriterDefaults({ contentMode: "dark" })).not.toHaveProperty("contentMode");

    const p = await createProject("Old");
    await saveProject({ ...p, cowriter: { contentMode: "unhinged", tone: "grim" } });
    expect((await projectSettings(p.id)).settings).toMatchObject({ unhinged: "normal", dark: "off", tone: "grim" });
  });

  it("sends both levels' lines and themes when they combine", () => {
    const both = settings({ dark: "horror", unhinged: "absolute" });
    expect(contentLabel(both)).toBe("Horror + Absolutely unhinged");
    expect(contentLabel(settings({}))).toBe("Normal");
    const lines = contentLines(both);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Content: Horror\. Fear is the engine/);
    expect(lines[1]).toMatch(/^Content: Absolutely unhinged\. .*including ones where it isn't obviously relevant/);
    expect(contentLines(settings({}))[0]).toMatch(/^Content: Normal/);
    expect(contentLines(settings({ dark: "deaddove" }))[0]).toMatch(/no redemption arc, no rescue/);

    const kickoff = interviewKickoff("character", both, "A lighthouse keeper");
    const themes = kickoff.split("Themes to cover:\n")[1].split("\n\n")[0].split("\n");
    // The kink list and hard limits come right after the core concept; horror just before the opening scene.
    expect(themes[1]).toMatch(/^- Kinks and hard limits/);
    expect(themes[themes.length - 2]).toMatch(/^- Horror: what is feared/);
  });

  it("adds export tags and the dead dove warning", () => {
    const d = { ...newCard("Sera").data, tags: ["fantasy", "nsfw"], creator_notes: "Have fun." };
    const out = withContentTags(d, { dark: "deaddove", unhinged: "normal" });
    expect(out.tags).toEqual(["fantasy", "nsfw", "dark", "dead dove"]);
    expect(out.creator_notes).toMatch(/^Content warning: dead dove, do not eat\.[\s\S]*\n\nHave fun\.$/);
    expect(withContentTags(out, { dark: "deaddove", unhinged: "normal" }).creator_notes).toBe(out.creator_notes);
    expect(withContentTags(d, { dark: "off", unhinged: "off" })).toEqual(d);
  });

  it("picks levels under each mode in the project settings, and Normal turns both off", async () => {
    const p = await createProject("P");
    render(<ProjectStyleDialog projectId={p.id} open onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Dark/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Horror/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Unhinged/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Absolutely unhinged/ }));
    await waitFor(async () => expect((await getProject(p.id))!.cowriter).toMatchObject({ dark: "horror", unhinged: "absolute" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Normal/ }));
    await waitFor(async () => expect((await getProject(p.id))!.cowriter).toMatchObject({ dark: "off", unhinged: "off" }));
    expect(screen.queryByRole("radio", { name: /^Horror/ })).toBeNull();
  });
});

describe("prose settings and prompt fixes", () => {
  it("turns prose settings into prompt lines, explicitness only for NSFW in the dialog", async () => {
    expect(proseLines({ pov: "second", tense: "present", format: "asterisks" })).toEqual([
      "Point of view: second person, addressing {{user}} as you.",
      "Tense: present.",
      "Formatting: actions and narration in *asterisks*, speech in quotes.",
    ]);
    expect(settingsContext(settings({ prose: { register: "pulpy" } }), [])).toContain("Register: pulpy, punchy and vivid.");

    const p = await createProject("P");
    render(<ProjectStyleDialog projectId={p.id} open onClose={() => undefined} />);
    fireEvent.click((await screen.findAllByRole("radio", { name: "Present" }))[0]);
    await waitFor(async () => expect((await getProject(p.id))!.cowriter!.prose).toEqual({ tense: "present" }));
    expect(screen.queryByRole("radiogroup", { name: "Explicitness" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Unhinged/ }));
    expect(screen.getByRole("radiogroup", { name: "Explicitness" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("radio", { name: "Any" })[1]);
    await waitFor(async () => expect((await getProject(p.id))!.cowriter!.prose).toEqual({}));
  });

  it("states rules positively and names the AI habits to avoid", () => {
    const base = systemPrompt("refine");
    const nevers = base.split("\n").filter((l) => /\bnever\b/i.test(l));
    // The only "never" left is the hard rule on minors, and the explanation of why "never" backfires.
    expect(nevers).toHaveLength(2);
    expect(nevers.some((l) => l.startsWith("Characters in sexual content are always adults"))).toBe(true);
    expect(base).toContain("Write like a person, not like a model:");
    expect(base).toMatch(/settle a short plan: who is there, where, what is at stake, and the hook/);
  });
});
