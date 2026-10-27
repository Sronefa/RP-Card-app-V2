/**
 * Shared part: the stage. A visual-novel scene in the status panel: the background of where the
 * story is, at the time of day, and a sprite for each cast member showing their current mood. Art
 * comes from the card's tagged images by meaning, so it fills in as the Image Studio files pictures;
 * each cast member gets a mood value the model keeps up to date.
 */
import { newVar } from "../sheet";
import type { EngineModule } from "./types";

export interface StageMember {
  name: string;
  /** The emotions the card has art for; the mood value picks from these. */
  moods: string[];
}

export interface StageSettings {
  cast: StageMember[];
  /** The value that says where the scene is, like "World.location". Empty for no background. */
  place: string;
  /** The value that says the time of day, like "Time._PartOfDay". */
  time: string;
}

export const defaultStageSettings = (): StageSettings => ({ cast: [], place: "World.location", time: "Time._PartOfDay" });

export function stageSettings(raw: Record<string, unknown> | undefined): StageSettings {
  const base = defaultStageSettings();
  if (!raw) return base;
  const cast = Array.isArray(raw.cast)
    ? raw.cast
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof c.name === "string" && !!c.name.trim())
        .map((c) => ({
          name: String(c.name).trim(),
          moods: Array.isArray(c.moods) ? c.moods.filter((m): m is string => typeof m === "string" && !!m.trim()) : [],
        }))
    : base.cast;
  return {
    cast,
    place: typeof raw.place === "string" ? raw.place : base.place,
    time: typeof raw.time === "string" ? raw.time : base.time,
  };
}

const JS = String.raw`
var esc = CF.ui.esc;
function read(path) { return path ? app.state(path) : undefined; }
function draw() {
  var place = read(settings.place), time = read(settings.time);
  var bg = place ? CF.assets.background(String(place), time ? String(time) : "") : null;
  var who = [];
  var sprites = settings.cast.map(function (c) {
    var mood = read(c.name + ".mood");
    var url = CF.assets.portrait(c.name, { emotion: mood ? String(mood) : "" });
    if (!url) return "";
    who.push(c.name + (mood ? " (" + mood + ")" : ""));
    return '<img class="st-sprite" alt="" src="' + esc(url) + '" onerror="this.remove()">';
  }).join("");
  if (!bg && !sprites) { root.innerHTML = ""; return; }
  var label = [place ? String(place) : "", time ? String(time) : "", who.join(", ")].filter(Boolean).join(" · ");
  root.innerHTML = '<div class="st-stage" role="img" aria-label="' + esc(label) + '"' +
    (bg ? " style=\"background-image:url('" + esc(bg).replace(/'/g, "%27") + "')\"" : "") +
    '><div class="st-cast">' + sprites + "</div></div>";
}
draw();
app.onState(draw);
`;

const CSS = `.st-stage { position: relative; aspect-ratio: 16 / 9; margin-bottom: 6px; overflow: hidden; border-radius: calc(var(--cf-radius) + 4px);
  background: linear-gradient(160deg, var(--cf-surface), var(--cf-bg)) center / cover no-repeat; border: 1px solid var(--cf-border); }
.st-cast { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; gap: 2%; }
.st-sprite { max-height: 96%; max-width: 48%; object-fit: contain; filter: drop-shadow(0 6px 12px rgba(0,0,0,.35)); }`;

export function stageModule(raw?: Record<string, unknown>, enabled = true): EngineModule {
  const settings = stageSettings(raw);
  return {
    id: "stage",
    name: "Stage",
    version: "1.0.0",
    description: "A visual-novel scene in the status panel: the place's background at the time of day, and each character's sprite in their current mood.",
    slot: "panel",
    tags: ["built-in", "art", "visual novel"],
    requires: [],
    core: "stage",
    enabled,
    // A mood per cast member, from the emotions the card has art for.
    vars: settings.cast
      .filter((c) => c.moods.length)
      .map((c) =>
        newVar({
          group: c.name,
          name: "mood",
          type: "choice",
          options: c.moods,
          start: c.moods.includes("neutral") ? "neutral" : c.moods[0],
          rule: `${c.name}'s expression at the end of the reply, one of the listed emotions. Change it when their mood visibly shifts; keep it otherwise.`,
        }),
      ),
    rules: [],
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: settings as unknown as Record<string, unknown>,
  };
}
