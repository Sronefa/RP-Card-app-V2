/**
 * What the UI engineer reads on demand instead of carrying in its prompt: the docs (shipped with
 * the app, so they always match the engine core that gets exported), the skills (playbooks the
 * user can edit and add to) and the example modules.
 */
import { BUILT_IN_SCREENS, coreModules } from "../modules/compile";
import type { EngineModule } from "../modules/types";
import { EXAMPLES } from "./examples";

const docFiles = import.meta.glob("./docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const skillFiles = import.meta.glob("./skills/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const idOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

export interface DocSection {
  /** "core-api#reading-state" */
  id: string;
  doc: string;
  title: string;
  text: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The docs: id → title and text. */
export const DOCS: Record<string, { title: string; text: string }> = Object.fromEntries(
  Object.entries(docFiles)
    .map(([path, text]) => [idOf(path), { title: /^#\s+(.+)$/m.exec(text)?.[1] ?? idOf(path), text }] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
);

/** Every doc cut at its "## " headings. */
export const SECTIONS: DocSection[] = Object.entries(DOCS).flatMap(([doc, { title, text }]) => {
  const parts = text.split(/^(?=## )/m);
  return parts.map((part, i) => {
    const heading = i === 0 ? title : (/^##\s+(.+)$/m.exec(part)?.[1] ?? title);
    return { id: i === 0 ? doc : `${doc}#${slug(heading)}`, doc, title: i === 0 ? title : `${title}: ${heading}`, text: part.trim() };
  });
});

const words = (s: string) => s.toLowerCase().match(/[a-z0-9_$.]+/g) ?? [];

/** The sections that best match a query, best first. */
export function searchDocs(query: string, limit = 6): DocSection[] {
  const terms = [...new Set(words(query).filter((w) => w.length > 1))];
  if (!terms.length) return [];
  const scored = SECTIONS.map((s) => {
    const title = s.title.toLowerCase();
    const body = s.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      const hits = body.split(t).length - 1;
      score += Math.min(hits, 6);
    }
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

export function searchDocsText(query: string): string {
  const found = searchDocs(query);
  if (!found.length)
    return `Nothing matched "${query}". Docs: ${Object.entries(DOCS)
      .map(([id, d]) => `${id} (${d.title})`)
      .join(", ")}.`;
  return found
    .map((s) => {
      const lines = s.text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      const snippet = lines.slice(0, 2).join(" ").slice(0, 220);
      return `- ${s.id}: ${s.title}\n  ${snippet}${snippet.length >= 220 ? "…" : ""}`;
    })
    .join("\n");
}

/** A whole doc, or one section by "doc#section". */
export function readDoc(id: string): string | undefined {
  const section = SECTIONS.find((s) => s.id === id);
  if (section && id.includes("#")) return section.text;
  return DOCS[id]?.text;
}

export const docsIndex = () =>
  Object.entries(DOCS)
    .map(([id, d]) => `- ${id}: ${d.title}`)
    .join("\n");

// ---------------------------------------------------------------- skills

export interface Skill {
  id: string;
  title: string;
  /** When to use it, one line. */
  when: string;
  text: string;
  builtIn: boolean;
}

function parseSkill(id: string, text: string, builtIn: boolean): Skill {
  return {
    id,
    title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? id,
    when: /^When:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "",
    text: text.trim(),
    builtIn,
  };
}

export const BUILT_IN_SKILLS: Skill[] = Object.entries(skillFiles)
  .map(([path, text]) => parseSkill(idOf(path), text, true))
  .sort((a, b) => a.title.localeCompare(b.title));

/** The user's changes: their own skills, edited built-in ones, and built-in ones they removed. */
export interface SkillOverrides {
  /** By id; text is the whole skill. */
  edited: Record<string, string>;
  removed: string[];
}

export const EMPTY_OVERRIDES: SkillOverrides = { edited: {}, removed: [] };

/** The skills the engineer has, the user's changes applied. */
export function skillsWith(overrides: SkillOverrides = EMPTY_OVERRIDES): Skill[] {
  const builtIn = BUILT_IN_SKILLS.filter((s) => !overrides.removed.includes(s.id)).map((s) =>
    overrides.edited[s.id] !== undefined ? { ...parseSkill(s.id, overrides.edited[s.id], true) } : s,
  );
  const own = Object.entries(overrides.edited)
    .filter(([id]) => !BUILT_IN_SKILLS.some((s) => s.id === id))
    .map(([id, text]) => parseSkill(id, text, false));
  return [...builtIn, ...own].sort((a, b) => a.title.localeCompare(b.title));
}

export const skillsIndex = (skills: Skill[]) => skills.map((s) => `- ${s.id}: ${s.title}${s.when ? `. ${s.when}` : ""}`).join("\n");

// ---------------------------------------------------------------- examples

/** The example library: reference modules, and the core modules as they are built. */
export function examples(): EngineModule[] {
  return [...EXAMPLES, ...coreModules(), ...BUILT_IN_SCREENS.map((b) => b.make())];
}

export const examplesIndex = () =>
  examples()
    .map((m) => `- ${m.id}: ${m.name} (${m.slot}). ${m.description}`)
    .join("\n");

/** A core module's settings as the author sets them, without what CardForge works out from them. */
function authorSettings(m: EngineModule) {
  const { live: _live, catalog: _catalog, extra: _extra, ...rest } = m.settings;
  return rest;
}

export function readExample(id: string): string | undefined {
  const m = examples().find((e) => e.id === id);
  if (!m) return undefined;
  const values = m.vars.map((v) => ({
    group: v.group,
    name: v.name,
    type: v.type,
    start: v.start,
    ...(v.min !== undefined ? { min: v.min } : {}),
    ...(v.max !== undefined ? { max: v.max } : {}),
    ...(v.options ? { options: v.options } : {}),
    ...(v.readOnly ? { readOnly: true } : {}),
    rule: v.rule,
  }));
  return [
    `Example module "${m.name}" (${m.id}, slot ${m.slot}${m.button ? `, button "${m.button}"` : ""}). ${m.description}`,
    `<file name="values.json">\n${JSON.stringify(values, null, 2)}\n</file>`,
    m.core ? `<file name="settings.json">\n${JSON.stringify(authorSettings(m), null, 2)}\n</file>` : "",
    m.rules.length ? `<file name="rules.json">\n${JSON.stringify(m.rules, null, 2)}\n</file>` : "",
    m.html ? `<file name="html">\n${m.html}\n</file>` : "",
    m.css ? `<file name="css">\n${m.css}\n</file>` : "",
    m.js ? `<file name="js">\n${m.js.trim()}\n</file>` : "",
    m.script ? `<file name="script">\n${m.script.trim()}\n</file>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
