/**
 * Engine-ready checks: for a card on the Immersive Engine, the things MVU cards get wrong most
 * (see the engine-card-writing skill). Numbers belong in values, not prose; each greeting sets its
 * starting state the same way; each core number has tiers; rules say when and by how much.
 */
import type { CardDataV3 } from "../card";
import { readEngine, varLabel, type EngineVar } from "../engine/sheet";
import { splitGreetingState, tiersEntryOf } from "../ai/engineTools";
import type { GroupId } from "../features/editor/fields";
import type { Issue, IssueLevel, IssueTarget } from "./checker";

const PROSE: { field: "description" | "personality" | "scenario" | "first_mes"; label: string; group: GroupId }[] = [
  { field: "description", label: "The description", group: "description" },
  { field: "personality", label: "The personality", group: "personality" },
  { field: "scenario", label: "The scenario", group: "scenario" },
  { field: "first_mes", label: "The first message", group: "greetings" },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Trust: 40", "trust is 40", "trust at 40/100": a value's number written into the prose. */
function statedValue(text: string, name: string): string | undefined {
  if (!name) return undefined;
  const m = new RegExp(`\\b${escape(name)}\\b\\s*(?::|=|is|at|of)?\\s*(\\d+(?:\\s*/\\s*\\d+)?)\\b`, "i").exec(text);
  return m?.[0];
}

/** A rule says when it changes and by how much, not just that it does. */
function vagueRule(v: EngineVar): boolean {
  const rule = v.rule.trim();
  if (v.type === "number") return !/\d/.test(rule);
  return rule.split(/\s+/).length < 5;
}

export function engineReadyIssues(d: CardDataV3): Issue[] {
  const config = readEngine(d);
  if (!config) return [];
  const issues: Issue[] = [];
  const add = (level: IssueLevel, message: string, target: IssueTarget, request?: string) =>
    issues.push({ level, kind: "engine", message, target, ...(request ? { request } : {}) });
  const engine: IssueTarget = { section: "engine" };
  const vars = config.vars.filter((v) => v.name.trim());

  for (const v of vars) {
    const label = varLabel(v);
    if (/\{\{|\}\}/.test(v.name + v.group))
      add("error", `The value "${label}" has a macro in its name. Use a fixed word like protagonist; {{user}} changes with every persona.`, engine);
    if (v.name.includes(".") || v.group.includes("."))
      add("warning", `"${label}" sits more than one level deep. Keep values one group deep, so the model writes the path right.`, engine);
    if (v.readOnly) continue;
    if (!v.rule.trim())
      add("warning", `"${label}" has no update rule, so the model guesses when it changes.`, engine,
        `The engine value "${label}" has no update rule. Write one with set_update_rule: what triggers it, by how much (like +3 to 6), when it doesn't change${v.type === "list" || v.type === "counts" ? ", and the cap on entries" : ""}.`);
    else if (vagueRule(v))
      add("tip", `The rule for "${label}" is vague: "${v.rule.trim()}". Say what triggers it and by how much.`, engine,
        `The update rule of "${label}" ("${v.rule.trim()}") is vague. Rewrite it with set_update_rule: the trigger, the size of the change, and when it stays put.`);
    if (v.type === "number" && !v.hidden && !tiersEntryOf(d, label))
      add("tip", `The number "${label}" has no tiers, so its value doesn't change how anyone behaves.`, { section: "lorebook" },
        `Write tiers for the engine value "${label}" with write_tiers: ranges that change behaviour, and events at the thresholds.`);
  }

  // Numbers live in values; prose that repeats one goes stale on the first change.
  for (const { field, label, group } of PROSE) {
    const prose = field === "first_mes" ? splitGreetingState(d[field]).prose : d[field];
    for (const v of vars) {
      const hit = statedValue(prose, v.name.trim());
      if (hit)
        add("warning", `${label} states "${hit}". The engine tracks ${varLabel(v)}; prose that repeats it goes stale.`, { section: "editor", group },
          `${label} writes the engine value ${varLabel(v)} into the prose ("${hit}"). Take the number out and describe the behaviour instead; the engine tracks the value.`);
    }
  }

  // Greetings: one approach, consistently.
  if (vars.length) {
    const greetings = [d.first_mes, ...d.alternate_greetings].filter((g) => g.trim());
    const withState = greetings.filter((g) => splitGreetingState(g).state);
    const name = (i: number) => (i === 0 ? "The first message" : `Alternate greeting ${i}`);
    if (withState.length && withState.length < greetings.length)
      greetings.forEach((g, i) => {
        if (!splitGreetingState(g).state)
          add("warning", `${name(i)} has no starting state, but other greetings do. It starts from the defaults.`, { section: "editor", group: "greetings" },
            `${name(i)} has no starting state while other greetings do. Give it one with set_greeting_state (greeting ${i}).`);
      });
    else if (!withState.length && greetings.length > 1)
      add("tip", "No greeting sets its starting state, so every opening starts from the same values.", { section: "editor", group: "greetings" },
        "No greeting has a starting state. Give each greeting the values its scene starts from with set_greeting_state.");
  }
  return issues;
}
