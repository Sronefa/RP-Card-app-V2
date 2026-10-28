/**
 * Gaps between a card and its engine: what the card's words describe that no screen shows yet (an
 * NPC who isn't a phone contact, a shop whose goods aren't in the shop app, a number nobody sees),
 * and what the engine has that has no words yet (a value without a rule, a map place without a
 * lorebook page, a living screen without a content pack). Each gap is a task for the UI engineer or
 * the co-writer, with a stable key so it is filed once.
 */
import type { CardDataV3, LorebookEntry } from "../card";
import { statePaths } from "../engine/engineer/lint";
import { kindOf } from "../engine/modules/types";
import { modulesOf } from "../engine/modules/compile";
import { liveFeedsOf } from "../engine/modules/live";
import { inventorySettings } from "../engine/modules/inventory";
import { mapSettings } from "../engine/modules/map";
import { phoneSettings } from "../engine/modules/phone";
import { readEngine, themeOf, varLabel, varPath } from "../engine/sheet";
import { cleanMoods, cleanPortraits } from "../engine/theme";
import { engineReadyIssues } from "./engineReady";
import { pageMeta } from "./world";

export type GapTo = "engineer" | "cowriter";

export interface Gap {
  /** Stable for the same gap: "contact:mina", "rule:Mina.Affection". */
  key: string;
  to: GapTo;
  /** One line for the inbox: "Add Mina as a phone contact". */
  title: string;
  /** What to do and why, for the engineer's or co-writer's brief. */
  brief: string;
  /** What it came from, quoted into the brief: a lorebook page, a value, a module. */
  source?: { label: string; text?: string };
}

const low = (s: string) => s.trim().toLowerCase();
const has = (names: (string | undefined)[], name: string) => names.some((n) => !!n && low(n) === low(name));

function pages(data: CardDataV3) {
  return (data.character_book?.entries ?? [])
    .filter((e) => e.enabled !== false)
    .map((e) => ({ entry: e, meta: pageMeta(e) }))
    .filter((p): p is { entry: LorebookEntry; meta: NonNullable<ReturnType<typeof pageMeta>> } => !!p.meta);
}

const pageSource = (e: LorebookEntry) => ({ label: `lorebook page "${e.comment}"`, text: e.content });

/** Every gap on the card, engineer tasks first. None when the engine is off. */
export function engineGaps(data: CardDataV3): Gap[] {
  const config = readEngine(data);
  if (!config) return [];
  const out: Gap[] = [];
  const modules = modulesOf(config).filter((m) => m.enabled);
  const world = pages(data);
  const named = (kind: string) => world.filter((p) => p.meta.kind === kind && p.meta.fields.name?.trim());

  // ---- the card describes it; a screen should show it (UI engineer)
  const phone = modules.find((m) => kindOf(m) === "phone");
  const ps = phone ? phoneSettings(phone.settings) : undefined;
  if (ps && (ps.apps.includes("contacts") || ps.apps.includes("messages")))
    for (const { entry, meta } of named("npc")) {
      const name = meta.fields.name.trim();
      if (has(ps.contacts.map((c) => c.name), name)) continue;
      out.push({
        key: `contact:${low(name)}`,
        to: "engineer",
        title: `Add ${name} as a phone contact`,
        brief: `The card has an NPC, ${name}${meta.fields.role ? ` (${meta.fields.role})` : ""}, who isn't on the phone. Add them to the phone's contacts (set_module_settings on the phone) with their role, so the player can text them.`,
        source: pageSource(entry),
      });
    }

  const inventory = modules.find((m) => kindOf(m) === "inventory");
  const merchants = inventory ? inventorySettings(inventory.settings).merchants.map((m) => m.name) : [];
  const phoneShop = ps?.apps.includes("shop") ? ps.shop.map((i) => i.name) : undefined;
  if (inventory || phoneShop)
    for (const { entry, meta } of named("shop")) {
      const name = meta.fields.name.trim();
      const goods = named("item").filter((p) => low(p.meta.fields.shop ?? "") === low(name)).map((p) => p.meta.fields.name.trim());
      const missing = phoneShop ? goods.filter((g) => !has(phoneShop, g)) : [];
      if (inventory ? has(merchants, name) && !missing.length : !missing.length && (goods.length || phoneShop!.length)) continue;
      out.push({
        key: `shop:${low(name)}`,
        to: "engineer",
        title: `Add ${name}'s goods to the ${inventory ? "inventory's merchants" : "phone's shop"}`,
        brief: `The card has a shop, ${name}${meta.fields.place ? ` at ${meta.fields.place}` : ""}, that the ${inventory ? "inventory part doesn't list as a merchant" : "phone's shop app doesn't sell from"}. Add ${inventory ? "it as a merchant with its stock" : "its goods to the shop app"} with the prices the lorebook gives${goods.length ? `: ${goods.join(", ")}` : ""}.`,
        source: pageSource(entry),
      });
    }

  const map = modules.find((m) => kindOf(m) === "map");
  if (map) {
    const places = mapSettings(map.settings).places.map((p) => p.name);
    for (const { entry, meta } of named("location")) {
      const name = meta.fields.name.trim();
      if (has(places, name)) continue;
      out.push({
        key: `place:${low(name)}`,
        to: "engineer",
        title: `Put ${name} on the map`,
        brief: `The card has a place, ${name}, that the map doesn't show. Add it to the map's places (set_module_settings on the map), with roads to the places it's near and a danger level that fits the lorebook.`,
        source: pageSource(entry),
      });
    }
  }

  // A number the player should feel but no screen shows at a glance.
  const read = new Set(modules.flatMap((m) => statePaths(m.html + "\n" + m.js)));
  for (const v of config.vars)
    if (v.type === "number" && v.name.trim() && !v.hidden && !v.pinned && !read.has(varPath(v).join(".")))
      out.push({
        key: `meter:${low(varPath(v).join("."))}`,
        to: "engineer",
        title: `Show ${varLabel(v)} as a meter`,
        brief: `${varLabel(v)} is a number the story tracks, but no screen shows it at a glance (it isn't pinned in the panel and no module reads it). Show it as a meter where the player looks: pin it in the status panel, or add it to a panel section with its change.`,
        source: { label: `the value ${varLabel(v)}`, text: v.rule.trim() || undefined },
      });

  // ---- the engine has it; it needs words (co-writer)
  for (const issue of engineReadyIssues(data))
    if (issue.request)
      out.push({ key: `ready:${low(issue.message).slice(0, 120)}`, to: "cowriter", title: issue.message, brief: issue.request });

  const places = [
    ...(map ? mapSettings(map.settings).places.map((p) => ({ name: p.name, text: p.description, from: "the map" })) : []),
    ...(ps ? ps.places.map((p) => ({ name: p.name, text: p.description, from: "the phone's map" })) : []),
  ];
  const known = named("location").map((p) => p.meta.fields.name);
  const plain = (data.character_book?.entries ?? []).flatMap((e) => [e.comment, ...e.keys]);
  for (const p of places)
    if (p.name.trim() && !has(known, p.name) && !has(plain, p.name))
      out.push({
        key: `place-lore:${low(p.name)}`,
        to: "cowriter",
        title: `Write a lorebook page for ${p.name.trim()}`,
        brief: `${p.name.trim()} is a place on ${p.from}, but the lorebook has no page for it, so the narrator invents it fresh each time. Write it as a place page (mood, senses, details) that fits the world.`,
        source: { label: `${p.from}'s place "${p.name.trim()}"`, text: p.text || undefined },
      });

  if (ps)
    for (const c of ps.contacts)
      if (c.name.trim() && !has(named("npc").map((p) => p.meta.fields.name), c.name) && !has(plain, c.name))
        out.push({
          key: `contact-lore:${low(c.name)}`,
          to: "cowriter",
          title: `Write an NPC page for ${c.name.trim()}`,
          brief: `${c.name.trim()}${c.role ? ` (${c.role})` : ""} is a contact on the phone, but the lorebook has no page for them, so their texts and scenes have no voice to follow. Write them as an NPC page, with a voice that works in texts too.`,
          source: { label: `the phone contact "${c.name.trim()}"` },
        });

  if (ps?.apps.includes("shop") && !ps.shop.length && !named("item").length)
    out.push({
      key: "shop-goods",
      to: "cowriter",
      title: "Write goods for the phone's shop",
      brief: "The phone has a shop app with nothing to sell. Write five to eight goods as item pages (name, price in the world's currency, effect, where it's sold) that fit the world; the UI engineer can then stock the shop from them.",
    });

  // Words for the new engine features.
  for (const { module: m, feed } of liveFeedsOf(modules))
    if (!feed.pack.voice.trim() || !feed.pack.format.trim())
      out.push({
        key: `pack:${m.id}:${feed.id}`,
        to: "cowriter",
        title: `Write the content pack for ${feed.name}`,
        brief: `The living screen "${feed.name}" (feed ${feed.id} on module ${m.id}) has no content pack yet, so its background writer has no voice. Write it with write_live_pack: voice, tone, format and length, plus two or three fallback lines in that voice.`,
        source: { label: `the ${m.name} module` },
      });

  for (const m of modules) {
    if (m.core || !/\b(?:app\.game|CF\.game\.create)\(/.test(m.js)) continue;
    const outcomes = (m.settings?.outcomes ?? {}) as Record<string, { line?: unknown } | undefined>;
    const missing = ["win", "loss"].filter((k) => typeof outcomes[k]?.line !== "string" || !String(outcomes[k]!.line).trim());
    if (missing.length)
      out.push({
        key: `game-lines:${m.id}`,
        to: "cowriter",
        title: `Write the outcome lines for the ${m.name} minigame`,
        brief: `The minigame "${m.name}" has no ${missing.join(" or ")} line, so its result reaches the story as a bare word. Write them with write_minigame_lines: one line each for win and loss (and skip if the story needs it), in the story's voice.`,
      });
  }

  const theme = themeOf(config);
  for (const mood of cleanMoods(theme.moods))
    if (/^mood\s*\d*$/i.test(mood.name) || !mood.description?.trim())
      out.push({
        key: `mood:${mood.id}`,
        to: "cowriter",
        title: `Name and describe the ${mood.name} mood`,
        brief: `The theme mood "${mood.name}" (on while ${mood.path}${mood.is?.length ? ` is ${mood.is.join(" or ")}` : mood.min !== undefined || mood.max !== undefined ? ` is ${mood.min ?? "…"} to ${mood.max ?? "…"}` : " is true"}) has ${/^mood\s*\d*$/i.test(mood.name) ? "a placeholder name" : "no description"}. Give it a name the player would recognise and a one-sentence description of how the story feels then, with name_mood.`,
      });
  const vars = new Map(config.vars.map((v) => [varPath(v).join("."), v]));
  for (const b of cleanPortraits(theme.portraits)) {
    const choice = b.emotion ? vars.get(b.emotion)?.options?.length : 0;
    if (!choice && !b.emotions?.length)
      out.push({
        key: `expressions:${low(b.name)}`,
        to: "cowriter",
        title: `List ${b.name}'s expressions and outfits`,
        brief: `${b.name}'s portrait follows the state, but there's no list of the expressions${b.outfit ? "" : " and outfits"} to draw. List the ones the story uses most (neutral first, five to eight in all) with list_expressions, so they can go on the shot list.`,
      });
  }
  return out;
}

/** Gaps in `after` that weren't in `before`: what an accepted change opened up. */
export function newGaps(before: CardDataV3, after: CardDataV3, to?: GapTo): Gap[] {
  const old = new Set(engineGaps(before).map((g) => g.key));
  return engineGaps(after).filter((g) => !old.has(g.key) && (!to || g.to === to));
}
