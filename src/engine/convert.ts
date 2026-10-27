/**
 * Light card to engine card. A light card tracks its state with the status tracker, relationship
 * stages and mechanics modules; the engine tracks it in values. The UI engineer reads the plan,
 * confirms it with the user, and proposes it; turning the engine off later brings the tracker back.
 */
import type { CardDataV3 } from "../card";
import { applyEdit, planEdit } from "../ai/tools";
import { tiersEntryOf } from "../ai/engineTools";
import { readMechanics } from "../editor/mechanics";
import { applyTracker, readTracker, stageRanges, type TrackerConfig, type TrackerField } from "../editor/trackers";
import { pageMeta } from "../editor/world";
import { applyEngine, readEngine, type EngineConfig } from "./sheet";

/** One value the conversion adds, as the input of a set_value op. */
export interface PlannedValue {
  group: string;
  name: string;
  type: "number" | "text" | "choice" | "list";
  start: string;
  min?: number;
  max?: number;
  options?: string[];
  rule: string;
  /** Where it came from, for the user. */
  from: string;
}

export interface ConversionPlan {
  values: PlannedValue[];
  /** The stages, as tiers of the affection value. */
  stages?: { variable: string; tiers: { from: number; to: number; name: string; behavior: string }[] };
  /** The tracker as it was, kept so turning the engine off restores it. */
  backup?: TrackerConfig;
  notes: string[];
}

export interface ConvertOptions {
  /** A value per NPC for where {{user}} stands with them. */
  people?: boolean;
  /** A location value with the places as its options. */
  places?: boolean;
}

/** Most people records; past this the state gets long for little gain. */
const MAX_PEOPLE = 8;

const clean = (s: string) => s.replace(/[.[\]"'/~]/g, " ").replace(/\s+/g, " ").trim();

function trackerValue(f: TrackerField, group: string): PlannedValue {
  const base = { group, name: clean(f.label), rule: f.rule, start: f.start };
  if (f.kind === "bar") return { ...base, type: "number", min: 0, max: f.max ?? 100, from: "status tracker" };
  if (f.kind === "number") return { ...base, type: "number", from: "status tracker" };
  if (f.kind === "list") return { ...base, type: "list", from: "status tracker" };
  return { ...base, type: "text", from: "status tracker" };
}

export function planConversion(data: CardDataV3, options: ConvertOptions = {}): ConversionPlan {
  const tracker = readTracker(data);
  const modules = readMechanics(data);
  const existing = new Set((readEngine(data)?.vars ?? []).map((v) => `${v.group}.${v.name}`.toLowerCase()));
  const values: PlannedValue[] = [];
  const notes: string[] = [];
  const add = (v: PlannedValue) => {
    if (!v.name || existing.has(`${v.group}.${v.name}`.toLowerCase())) return;
    existing.add(`${v.group}.${v.name}`.toLowerCase());
    values.push(v);
  };
  let stages: ConversionPlan["stages"];

  for (const f of tracker?.fields ?? []) {
    // Stages become tiers of the one affection value, not a second value to keep in step.
    if (f.addon === "relationship" && f.label === "Stage") continue;
    if (f.addon === "mechanic") {
      const m = modules.find((x) => x.id === f.module);
      add({ ...trackerValue(f, clean(m?.name ?? "Mechanics")), from: `mechanic "${m?.name ?? "module"}"` });
    } else add(trackerValue(f, f.addon === "relationship" ? "Relationship" : f.addon === "custom" ? "Status" : "Player"));
  }
  // Mechanics whose values never made it into the tracker.
  for (const m of modules)
    for (const t of m.tracked)
      add({ ...trackerValue({ ...t, id: "", addon: "mechanic" }, clean(m.name)), from: `mechanic "${m.name}"` });

  const affection = tracker?.fields.find((f) => f.addon === "relationship" && f.label === "Affection");
  if (tracker?.stages?.length && affection) {
    stages = {
      variable: `Relationship.${clean(affection.label)}`,
      tiers: stageRanges(tracker.stages).map((s) => ({ from: s.from, to: s.to, name: s.name, behavior: s.attitude })),
    };
    notes.push(`The ${tracker.stages.length} relationship stages become tiers of ${stages.variable}.`);
  }

  const entries = data.character_book?.entries ?? [];
  if (options.people) {
    const npcs = entries.map(pageMeta).filter((m) => m?.kind === "npc" && m.fields.name?.trim());
    for (const m of npcs.slice(0, MAX_PEOPLE))
      add({
        group: "People",
        name: clean(m!.fields.name),
        type: "text",
        start: "not met",
        rule: `Where {{user}} stands with ${m!.fields.name.trim()}, in a few words. Change it only when something between them changes.`,
        from: "NPC page",
      });
    if (npcs.length > MAX_PEOPLE) notes.push(`Only the first ${MAX_PEOPLE} of ${npcs.length} NPCs get a value; the rest stay lorebook entries.`);
  }
  if (options.places) {
    const places = entries.map(pageMeta).filter((m) => m?.kind === "location" && m.fields.name?.trim()).map((m) => clean(m!.fields.name));
    if (places.length)
      add({
        group: "World",
        name: "location",
        type: "choice",
        options: places,
        start: places[0],
        rule: "Set it when {{user}} arrives somewhere new on this list; leave it while they stay.",
        from: "Places page",
      });
  }
  if (tracker?.fields.length) notes.push("The status tracker is turned off when you accept, and comes back if the engine is turned off.");
  return { values, ...(stages ? { stages } : {}), ...(tracker?.fields.length ? { backup: tracker } : {}), notes };
}

/** The plan as the engineer reads it. */
export function planText(data: CardDataV3, plan: ConversionPlan): string {
  const tracker = readTracker(data);
  const lines = [
    `Light card "${data.name}": ${tracker?.fields.length ?? 0} tracker fields, ${tracker?.stages?.length ?? 0} relationship stages, ${readMechanics(data).length} mechanics modules.`,
    "",
    "Values it would add:",
    ...(plan.values.length
      ? plan.values.map((v) => {
          const bits = [v.type, `start ${JSON.stringify(v.start)}`];
          if (v.max !== undefined) bits.push(`${v.min ?? 0} to ${v.max}`);
          if (v.options) bits.push(`options ${v.options.join(" / ")}`);
          return `- ${v.group}.${v.name} (${bits.join(", ")}) from the ${v.from}${v.rule ? `: ${v.rule}` : ""}`;
        })
      : ["- none"]),
    ...(plan.stages ? ["", `Tiers for ${plan.stages.variable}:`, ...plan.stages.tiers.map((t) => `- ${t.from} to ${t.to}, ${t.name}`)] : []),
    ...(plan.notes.length ? ["", ...plan.notes] : []),
  ];
  return lines.join("\n");
}

/** The ops that make the plan's values, replayable like any engineer write. */
export function conversionOps(plan: ConversionPlan, id: string) {
  const values = plan.values.map(({ from: _from, ...v }, i) => ({ id: `${id}-${i}`, name: "set_value", input: { ...v } }));
  return plan.backup || plan.stages
    ? [...values, { id: `${id}-light`, name: "keep_light_backup", input: { tracker: plan.backup ?? null, stages: plan.stages ?? null } }]
    : values;
}

/**
 * After an accepted conversion: the tracker goes (the engine replaces it) and the stages become the
 * affection value's tiers.
 */
export function finishConversion(data: CardDataV3): CardDataV3 {
  const config = readEngine(data);
  const light = config?.light;
  if (!config || !light) return data;
  let next = light.tracker && readTracker(data)?.fields.length ? applyTracker(data, undefined) : data;
  if (light.stages && !tiersEntryOf(next, light.stages.variable) && config.vars.some((v) => `${v.group}.${v.name}` === light.stages!.variable)) {
    const call = { id: "light-tiers", name: "write_tiers", input: { variable: light.stages.variable, tiers: light.stages.tiers } };
    next = applyEdit(next, planEdit(next, call));
  }
  return next;
}

/** Turns the engine off; a converted card gets its status tracker back. */
export function turnEngineOff(data: CardDataV3): CardDataV3 {
  const light = readEngine(data)?.light;
  const off = applyEngine(data, undefined);
  return light?.tracker && !readTracker(off)?.fields.length ? applyTracker(off, light.tracker) : off;
}

export type LightBackup = NonNullable<EngineConfig["light"]>;
