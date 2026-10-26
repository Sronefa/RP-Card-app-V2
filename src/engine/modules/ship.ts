/**
 * Kit part (Sci-fi / space): the ship. Hull, shields and fuel; a reactor whose power the player
 * shares out between the ship's systems; systems that get knocked offline; the crew; a cargo hold
 * with a limit; and an alert level. The model plays damage, repairs and trade; the engine caps the
 * values, recharges the shields with the clock by the power they get, burns fuel on each jump the
 * star chart makes, and raises banners when the hull or the fuel runs low.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export interface ShipSystem {
  name: string;
  /** Power it starts with. */
  power: number;
  /** The most power it takes. */
  max: number;
  /** What its power does, for the model and the screen. */
  effect: string;
}

export interface CrewMember {
  name: string;
  role: string;
}

export interface ShipCargo {
  name: string;
  count: number;
}

export interface ShipSettings {
  title: string;
  button: string;
  shipName: string;
  shipClass: string;
  hull: number;
  shields: number;
  /** Shields regained per in-game hour for each point of power the Shields system gets. */
  recharge: number;
  fuel: number;
  /** Fuel each jump on the star chart burns; 0 leaves fuel to the story. */
  jumpFuel: number;
  /** Power the reactor puts out, shared between the systems. */
  reactor: number;
  systems: ShipSystem[];
  crew: CrewMember[];
  /** How many cargo units the hold takes; 0 for no limit. */
  capacity: number;
  cargo: ShipCargo[];
}

export const ALERTS = ["Green", "Yellow", "Red"];

export const defaultShipSettings = (): ShipSettings => ({
  title: "Ship",
  button: "🚀 Ship",
  shipName: "Wayfarer",
  shipClass: "Light freighter",
  hull: 100,
  shields: 60,
  recharge: 5,
  fuel: 20,
  jumpFuel: 2,
  reactor: 8,
  systems: [
    { name: "Engines", power: 2, max: 4, effect: "Speed, evasion and getting away" },
    { name: "Shields", power: 2, max: 4, effect: "Shield recharge" },
    { name: "Weapons", power: 2, max: 4, effect: "Firepower in a fight" },
    { name: "Sensors", power: 1, max: 3, effect: "Scans, range and spotting ambushes" },
    { name: "Life support", power: 1, max: 2, effect: "Air and warmth; at 0 the crew has hours" },
  ],
  crew: [
    { name: "Juno Reyes", role: "Pilot" },
    { name: "Okafor", role: "Engineer" },
    { name: "Doc Lin", role: "Medic" },
  ],
  capacity: 20,
  cargo: [
    { name: "Ration packs", count: 4 },
    { name: "Spare parts", count: 3 },
    { name: "Medical supplies", count: 2 },
  ],
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$:,]/g, " ").trim();
const whole = (v: unknown, fallback: number, max: number) => Math.max(0, Math.min(max, Math.round(num(v, fallback))));

export function shipSettings(raw: Record<string, unknown> | undefined): ShipSettings {
  const base = defaultShipSettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    shipName: str(raw.shipName, base.shipName),
    shipClass: str(raw.shipClass, base.shipClass),
    hull: Math.max(1, whole(raw.hull, base.hull, 100000)),
    shields: whole(raw.shields, base.shields, 100000),
    recharge: Math.max(0, num(raw.recharge, base.recharge)),
    fuel: whole(raw.fuel, base.fuel, 100000),
    jumpFuel: whole(raw.jumpFuel, base.jumpFuel, 100000),
    reactor: whole(raw.reactor, base.reactor, 40),
    systems: Array.isArray(raw.systems)
      ? rows(raw.systems).map((s) => {
          const max = Math.max(1, whole(s.max, 3, 10));
          return { name: str(s.name), power: Math.min(max, whole(s.power, 0, 10)), max, effect: str(s.effect) };
        })
      : base.systems,
    crew: Array.isArray(raw.crew) ? rows(raw.crew).map((c) => ({ name: str(c.name), role: str(c.role) })) : base.crew,
    capacity: whole(raw.capacity, base.capacity, 100000),
    cargo: Array.isArray(raw.cargo) ? rows(raw.cargo).map((c) => ({ name: str(c.name), count: whole(c.count, 1, 100000) })) : base.cargo,
  };
}

/** A crew member as a line in the state: "Name — role". */
export const crewLine = (c: CrewMember) => (c.role.trim() ? `${c.name.trim()} — ${c.role.trim()}` : c.name.trim());

/** Named rows, with the starting power cut down to what the reactor gives. */
function usable(s: ShipSettings, chart: boolean) {
  let left = s.reactor;
  const systems = s.systems
    .filter((x) => clean(x.name))
    .map((x) => {
      const power = Math.min(x.power, left);
      left -= power;
      return { ...x, name: clean(x.name), power };
    });
  return {
    ...s,
    systems,
    crew: s.crew.filter((c) => c.name.trim()),
    cargo: s.cargo.filter((c) => clean(c.name) && c.count > 0).map((c) => ({ ...c, name: clean(c.name) })),
    chart,
  };
}
type Live = ReturnType<typeof usable>;

function shipVars(s: Live): EngineVar[] {
  const vars = [
    newVar({ id: "ship-hull", group: "Ship", name: "Hull", type: "number", start: String(s.hull), min: 0, rule: "The hull's integrity. Delta it down for hits the shields don't stop, up for repairs at a dock. At 0 the ship is breaking apart." }),
    newVar({ id: "ship-maxhull", group: "Ship", name: "MaxHull", type: "number", start: String(s.hull), readOnly: true, pinned: false, rule: "The hull at full integrity." }),
  ];
  if (s.shields) {
    vars.push(newVar({ id: "ship-shields", group: "Ship", name: "Shields", type: "number", start: String(s.shields), min: 0, rule: "Shields take hits before the hull. Delta them down in a fight; the engine recharges them with time by the power they get." }));
    vars.push(newVar({ id: "ship-maxshields", group: "Ship", name: "MaxShields", type: "number", start: String(s.shields), readOnly: true, pinned: false, rule: "Shields at full charge." }));
  }
  vars.push(
    newVar({ id: "ship-fuel", group: "Ship", name: "Fuel", type: "number", start: String(s.fuel), min: 0, rule: s.jumpFuel && s.chart ? `Fuel. The engine burns ${s.jumpFuel} for each jump; delta it up when {{user}} refuels or buys some.` : "Fuel. Delta it down for each jump or long burn, up when {{user}} refuels." }),
    newVar({ id: "ship-maxfuel", group: "Ship", name: "MaxFuel", type: "number", start: String(s.fuel), readOnly: true, pinned: false, rule: "What the tanks hold." }),
  );
  if (s.systems.length) {
    vars.push(
      newVar({
        id: "ship-power",
        group: "Ship",
        name: "Power",
        type: "counts",
        start: s.systems.map((x) => `${x.name}: ${x.power}`).join(", "),
        readOnly: true,
        pinned: false,
        rule: `How the player shares the reactor's ${s.reactor} power between systems. More power means a system works better: ${s.systems.map((x) => `${x.name} (${x.effect || "its job"})`).join("; ")}. A system with 0 power or in Damaged does nothing.`,
      }),
      newVar({ id: "ship-damaged", group: "Ship", name: "Damaged", type: "list", start: "", rule: "Systems knocked offline by a hit, a fault or sabotage, by name. Remove one when it's repaired." }),
    );
  }
  vars.push(newVar({ id: "ship-alert", group: "Ship", name: "Alert", type: "choice", options: ALERTS, start: ALERTS[0], rule: "The alert level. Red in a fight or a boarding, Yellow when trouble is near, Green otherwise; the player can set it too, and the crew acts on it." }));
  if (s.crew.length)
    vars.push(newVar({ id: "ship-crew", group: "Ship", name: "Crew", type: "list", start: s.crew.map(crewLine).join(", "), pinned: false, rule: 'Who serves aboard, as "Name — role". Insert one who signs on; remove one who leaves or dies.' }));
  vars.push(
    newVar({
      id: "ship-cargo",
      group: "Ship",
      name: "Cargo",
      type: "counts",
      start: s.cargo.map((c) => `${c.name}: ${c.count}`).join(", "),
      pinned: false,
      rule: `What's in the hold, in units${s.capacity ? ` (it takes ${s.capacity})` : ""}. Insert a load when {{user}} takes it on; delta it down when sold, used or lost; remove it at 0.`,
    }),
  );
  return vars;
}

function shipRules(s: Live): ModuleRule[] {
  return [
    {
      comment: "Ship actions",
      content: [
        `<action app="ship"> is an order {{user}} gave aboard the ${s.shipName || "ship"}:`,
        '- {"repair":S}: the crew works on the damaged system S. It takes time and parts from /Ship/Cargo; remove S from /Ship/Damaged when it works again, or say why it can\'t be fixed here.',
        '- {"talk":N}: {{user}} finds crew member N for a word. N answers in their own voice, with what is on their mind.',
        '- {"jettison":C}: {{user}} dumps the cargo C out of the airlock. Remove it from /Ship/Cargo; somebody may want it back.',
        '- {"alert":L}: {{user}} sets the alert to L. The crew reacts.',
      ].join("\n"),
      constant: false,
      keys: ['app="ship"'],
      depth: 2,
      order: 100,
    },
    {
      comment: "The ship",
      content: [
        `{{user}}'s ship is the ${[s.shipClass, s.shipName].filter(Boolean).join(" ")}. In a fight, hits drain /Ship/Shields first, then /Ship/Hull; a hard hit can put a system into /Ship/Damaged.`,
        s.systems.length ? "Weigh /Ship/Power: the systems the player powers up do their job better, and one without power or damaged doesn't work." : "",
        s.capacity ? `The hold takes ${s.capacity} units of cargo; nothing more fits.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      constant: true,
      keys: [],
      order: 100,
    },
  ];
}

// Runs in the card's script: caps, the reactor's limit, shield recharge, fuel for jumps and banners.
const SCRIPT = String.raw`
var S = settings.live || settings;
function minutes(clock) {
  var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(clock == null ? "" : clock));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hours(stat, before) {
  var t = stat.Time, b = before && before.Time;
  if (!t || !b) return 0;
  var x = minutes(b.Clock), y = minutes(t.Clock);
  if (x === null || y === null) return 0;
  return Math.max(0, Math.min(24, ((Number(t.Day) || 1) - (Number(b.Day) || 1)) * 24 + (y - x) / 60));
}
function say(title, text, icon) {
  setTimeout(function () { CF.bus.emit("notify", { title: title, text: text, icon: icon, open: "ship" }); }, 450);
}
function cap(v, max, fallback) { v = typeof v === "number" ? v : fallback; return Math.round(Math.max(0, Math.min(max, v))); }
hooks.afterUpdate(function (stat, before, info) {
  var P = stat && stat.Ship;
  if (!P || typeof P !== "object") return stat;
  var B = (before && before.Ship) || {};
  P._MaxHull = S.hull;
  P.Hull = cap(P.Hull, S.hull, S.hull);
  P._MaxFuel = S.fuel;
  if (S.shields) P._MaxShields = S.shields;
  var power = P._Power && typeof P._Power === "object" ? P._Power : {};
  if (S.systems.length) {
    // The player shares the power out; it never comes to more than the reactor gives.
    var left = S.reactor, out = {};
    S.systems.forEach(function (x) {
      var v = Math.max(0, Math.min(x.max, Math.round(Number(power[x.name]) || 0), left));
      out[x.name] = v;
      left -= v;
    });
    P._Power = power = out;
  }
  var damaged = Array.isArray(P.Damaged) ? P.Damaged : [];
  var h = hours(stat, before);
  if (S.shields) {
    var sh = cap(P.Shields, S.shields, S.shields);
    var feed = damaged.indexOf("Shields") >= 0 ? 0 : power.Shields == null ? 1 : Number(power.Shields) || 0;
    // Shields the story changed this turn are left as it set them; otherwise they recharge.
    if (h > 0 && sh === B.Shields) sh = Math.min(S.shields, Math.round(sh + S.recharge * feed * h));
    P.Shields = sh;
  }
  var fuel = cap(P.Fuel, S.fuel, S.fuel);
  var here = stat.Map && stat.Map.Location, was = before && before.Map && before.Map.Location;
  if (S.chart && S.jumpFuel && before && here && was && here !== was && fuel === B.Fuel) fuel = Math.max(0, fuel - S.jumpFuel);
  P.Fuel = fuel;
  if (before && info && info.latest && typeof B.Hull === "number") {
    if (P.Hull <= S.hull * 0.3 && B.Hull > S.hull * 0.3) say("Hull critical", "Hull at " + P.Hull + " of " + S.hull, "skull");
    if (S.jumpFuel && P.Fuel < S.jumpFuel && B.Fuel >= S.jumpFuel) say("Fuel", "Not enough fuel for another jump", "bolt");
    damaged.filter(function (d) { return (B.Damaged || []).indexOf(d) < 0; }).forEach(function (d) { say("System damaged", d + " is offline", "bolt"); });
    (B.Damaged || []).filter(function (d) { return damaged.indexOf(d) < 0; }).forEach(function (d) { say("Repaired", d + " is back online", "check"); });
  }
  return stat;
});
`;

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "bridge";
var plan = null;
function me() { return app.state("Ship") || {}; }
function delta(name) { var d = app.delta()["Ship." + name]; return d && typeof d[0] === "number" && typeof d[1] === "number" ? d[1] - d[0] : undefined; }
function damaged() { var v = me().Damaged; return Array.isArray(v) ? v : []; }
function power() { var p = me()._Power; return plan || (p && typeof p === "object" ? p : {}); }
function used(p) { var n = 0; S.systems.forEach(function (x) { n += Number(p[x.name]) || 0; }); return n; }
function act(payload, text) { app.send("ship", payload, text).then(function () { app.toast("In your message box: send it when you're ready"); }); }
function num(v, f) { v = Number(v); return isFinite(v) ? v : f; }
// Scorch marks on the hull, more as it takes damage.
var SPOTS = [[118, 34], [72, 54], [140, 52], [92, 36], [60, 40], [128, 44], [100, 56], [80, 44]];
function scorch(hp) {
  var n = Math.min(SPOTS.length, Math.ceil((1 - hp) * SPOTS.length));
  return SPOTS.slice(0, n).map(function (p, i) { return '<circle class="sh-dmg" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (3 + (i % 3)) + '"/>'; }).join("");
}
function hull() {
  var p = me();
  var hp = num(p.Hull, S.hull) / S.hull, sh = S.shields ? num(p.Shields, S.shields) / S.shields : 0;
  var alert = String(p.Alert || "Green").toLowerCase();
  return '<div class="sh-view a-' + esc(alert) + (hp <= 0.3 ? " crit" : "") + '" aria-hidden="true"><svg viewBox="0 0 200 90">' +
    (S.shields ? '<ellipse class="sh-bubble" cx="100" cy="45" rx="94" ry="40" style="opacity:' + (0.12 + sh * 0.6).toFixed(2) + '"/>' : "") +
    '<path class="sh-hull" d="M30 45 L55 28 L120 26 L168 38 L182 45 L168 52 L120 64 L55 62 Z"/>' +
    '<path class="sh-wing" d="M70 28 L92 8 L112 8 L104 27 Z M70 62 L92 82 L112 82 L104 63 Z"/>' +
    '<rect class="sh-cockpit" x="150" y="40" width="16" height="10" rx="4"/>' +
    '<g class="sh-flame"><path d="M30 38 L12 41 L30 44 Z"/><path d="M30 46 L8 49 L30 52 Z"/></g>' +
    scorch(hp) +
    "</svg></div>";
}
function meters() {
  var p = me(), out = [];
  out.push('<div class="sh-m sh-hullm' + (num(p.Hull, S.hull) <= S.hull * 0.3 ? " low" : "") + '">' + ui.meter({ label: "Hull", value: num(p.Hull, S.hull), max: S.hull, delta: delta("Hull") }) + "</div>");
  if (S.shields) out.push('<div class="sh-m sh-shm">' + ui.meter({ label: "Shields", value: num(p.Shields, S.shields), max: S.shields, delta: delta("Shields") }) + "</div>");
  out.push('<div class="sh-m sh-fuelm' + (S.jumpFuel && num(p.Fuel, S.fuel) < S.jumpFuel ? " low" : "") + '">' + ui.meter({ label: "Fuel" + (S.jumpFuel && S.chart ? " · " + Math.floor(num(p.Fuel, S.fuel) / S.jumpFuel) + " jumps" : ""), value: num(p.Fuel, S.fuel), max: S.fuel, delta: delta("Fuel") }) + "</div>");
  return out.join("");
}
function bridge() {
  var p = me(), alert = p.Alert || "Green", dmg = damaged();
  return '<div class="cf-stack"><div class="cf-card sh-top"><div class="sh-name"><span class="cf-label">' + esc(S.shipClass || "Ship") + "</span><h2>" + esc(S.shipName || S.title) + "</h2></div>" + hull() + "</div>" +
    '<div class="cf-card cf-stack">' + meters() + "</div>" +
    '<div class="cf-card"><span class="cf-label">Alert</span><div class="sh-alerts" role="group" aria-label="Alert level">' +
    ["Green", "Yellow", "Red"].map(function (a) { return '<button type="button" class="sh-al sh-' + a.toLowerCase() + (a === alert ? " on" : "") + '" data-alert="' + a + '" aria-pressed="' + (a === alert) + '">' + a + "</button>"; }).join("") + "</div></div>" +
    (dmg.length ? '<div class="cf-card"><span class="cf-label">Damaged systems</span><ul class="sh-list">' + dmg.map(function (d) {
      return '<li class="sh-row bad">' + ui.icon("bolt") + "<span>" + esc(d) + '</span><button type="button" class="cf-btn primary" data-repair="' + esc(d) + '">Repair</button></li>';
    }).join("") + "</ul></div>" : "") + "</div>";
}
function powerView() {
  var p = power(), free = S.reactor - used(p), dmg = damaged();
  var cells = "";
  for (var i = 0; i < S.reactor; i++) cells += '<i class="' + (i < S.reactor - free ? "on" : "") + '"></i>';
  return '<div class="cf-stack"><div class="cf-card sh-reactor"><div class="cf-spread"><span class="cf-label">Reactor</span><b>' + free + " of " + S.reactor + ' free</b></div><div class="sh-cells">' + cells + "</div></div>" +
    '<div class="cf-card sh-systems">' + S.systems.map(function (x) {
      var v = Number(p[x.name]) || 0, off = dmg.indexOf(x.name) >= 0, pips = "";
      for (var j = 1; j <= x.max; j++) pips += '<button type="button" class="sh-pip' + (j <= v ? " on" : "") + '" data-pip="' + esc(x.name) + '" data-n="' + (j === v ? j - 1 : j) + '" aria-label="' + esc(x.name) + " power " + j + '"' + (j > v && j - v > free ? " disabled" : "") + "></button>";
      return '<div class="sh-sys' + (off ? " off" : "") + '"><div class="sh-sysname"><b>' + esc(x.name) + "</b>" + (off ? '<span class="sh-offline">Offline</span>' : "") +
        (x.effect ? '<span class="cf-small cf-muted">' + esc(x.effect) + "</span>" : "") + '</div><div class="sh-pips">' + pips + "</div></div>";
    }).join("") + "</div>" +
    (plan ? '<div class="sh-two"><button type="button" class="cf-btn primary" data-confirm>Route power</button><button type="button" class="cf-btn ghost" data-undo>Undo</button></div>' : '<p class="cf-small cf-muted">Tap a bar to route power. More power, better work.</p>') + "</div>";
}
function crew() {
  var list = me().Crew;
  list = Array.isArray(list) ? list : [];
  if (!list.length) return '<p class="cf-muted">No crew aboard.</p>';
  return '<ul class="sh-list">' + list.map(function (l) {
    var m = /^(.*?)\s+[—–-]\s+(.*)$/.exec(String(l)), name = m ? m[1] : String(l), role = m ? m[2] : "";
    return '<li class="sh-row">' + ui.avatar(null, name) + '<div class="sh-who"><b>' + esc(name) + "</b>" + (role ? '<span class="cf-small cf-muted">' + esc(role) + "</span>" : "") + '</div><button type="button" class="cf-btn" data-talk="' + esc(name) + '">Talk</button></li>';
  }).join("") + "</ul>";
}
function cargo() {
  var c = me().Cargo, names = c && typeof c === "object" ? Object.keys(c).filter(function (k) { return Number(c[k]) > 0; }) : [];
  var n = 0;
  names.forEach(function (k) { n += Number(c[k]) || 0; });
  return '<div class="cf-stack">' + (S.capacity ? '<div class="cf-card' + (n > S.capacity ? " sh-over" : "") + '">' + ui.meter({ label: "Hold", value: n, max: S.capacity }) + "</div>" : "") +
    (names.length ? '<ul class="sh-list">' + names.map(function (k) {
      return '<li class="sh-row"><span class="sh-crate">' + esc(c[k]) + '</span><span class="sh-who">' + esc(k) + '</span><button type="button" class="cf-btn ghost" data-jettison="' + esc(k) + '">Jettison</button></li>';
    }).join("") + "</ul>" : '<p class="cf-muted">The hold is empty.</p>') + "</div>";
}
function draw() {
  var tabs = [{ id: "bridge", label: "Bridge", html: bridge() }];
  if (S.systems.length) tabs.push({ id: "power", label: "Power", html: powerView() });
  if (S.crew.length || (me().Crew || []).length) tabs.push({ id: "crew", label: "Crew", html: crew() });
  tabs.push({ id: "cargo", label: "Cargo", html: cargo() });
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-pip]"))) {
    var p = Object.assign({}, power());
    p[b.getAttribute("data-pip")] = Number(b.getAttribute("data-n"));
    plan = p;
    return draw();
  }
  if (t.closest("[data-undo]")) { plan = null; return draw(); }
  if (t.closest("[data-confirm]")) {
    var next = plan;
    plan = null;
    return app.setMany([[["Ship", "_Power"], next]], "routed power: " + S.systems.map(function (x) { return x.name + " " + (next[x.name] || 0); }).join(", ")).then(function () { app.toast("Power routed"); });
  }
  if ((b = t.closest("[data-alert]"))) { var a = b.getAttribute("data-alert"); if (a !== me().Alert) act({ alert: a }, a === "Green" ? "Stand down. Green alert." : a + " alert!"); return; }
  if ((b = t.closest("[data-repair]"))) { var r = b.getAttribute("data-repair"); return act({ repair: r }, "Get " + r + " back online."); }
  if ((b = t.closest("[data-talk]"))) { var n = b.getAttribute("data-talk"); return act({ talk: n }, "I go find " + n + "."); }
  if ((b = t.closest("[data-jettison]"))) {
    var j = b.getAttribute("data-jettison");
    var m = app.modal("<h2>Jettison " + esc(j) + '?</h2><p class="cf-muted">It goes out the airlock, all of it.</p><div class="cf-stack"><button type="button" class="cf-btn primary" data-yes>Jettison</button><button type="button" class="cf-btn ghost" data-cf-close>Keep it</button></div>');
    m.addEventListener("click", function (ev) { if (ev.target.closest("[data-yes]")) { m.remove(); act({ jettison: j }, "Dump the " + j + "."); } });
  }
});
draw();
app.onState(function () { plan = null; draw(); });
`;

const CSS = String.raw`
.sh-top { display: flex; flex-direction: column; gap: 6px; }
.sh-name h2 { font-family: var(--cf-heading); font-size: 1.3em; letter-spacing: .04em; }
.sh-view svg { display: block; width: 100%; max-width: 360px; margin: 0 auto; height: auto; }
.sh-bubble { fill: color-mix(in srgb, var(--cf-accent2) 25%, transparent); stroke: var(--cf-accent2); stroke-width: 1; transition: opacity .4s; }
.sh-hull { fill: var(--cf-surface2); stroke: var(--cf-text); stroke-width: 1.4; }
.sh-wing { fill: color-mix(in srgb, var(--cf-accent) 25%, var(--cf-surface2)); stroke: var(--cf-text); stroke-width: 1.2; }
.sh-cockpit { fill: var(--cf-accent2); }
.sh-flame path { fill: var(--cf-accent); animation: sh-flame .35s ease-in-out infinite alternate; transform-origin: 30px 45px; }
@keyframes sh-flame { from { transform: scaleX(.75); opacity: .7; } to { transform: scaleX(1.1); opacity: 1; } }
.sh-dmg { fill: #1a1210; stroke: var(--cf-bad); stroke-width: 1; opacity: .85; }
.sh-view.a-red .sh-hull { stroke: var(--cf-bad); }
.sh-view.a-red { animation: sh-red 1.4s ease-in-out infinite; }
.sh-view.a-yellow .sh-hull { stroke: #e5b400; }
.sh-view.crit svg { animation: sh-shake .4s linear infinite; }
@keyframes sh-red { 50% { filter: drop-shadow(0 0 10px color-mix(in srgb, var(--cf-bad) 70%, transparent)); } }
@keyframes sh-shake { 25% { transform: translate(1px, -1px); } 75% { transform: translate(-1px, 1px); } }
.sh-hullm .cf-meter-fill { background: linear-gradient(90deg, #8a96a8, #d7dee8); }
.sh-shm .cf-meter-fill { background: linear-gradient(90deg, color-mix(in srgb, var(--cf-accent2) 60%, #000), var(--cf-accent2)); }
.sh-fuelm .cf-meter-fill { background: linear-gradient(90deg, #b36b00, #ffb000); }
.sh-m.low .cf-meter-fill { animation: sh-pulse 1.1s ease-in-out infinite; }
@keyframes sh-pulse { 50% { opacity: .5; } }
.sh-alerts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
.sh-al { font: inherit; min-height: 44px; border-radius: var(--cf-radius); border: 1px solid var(--cf-border); background: var(--cf-surface2); color: var(--cf-text); cursor: pointer; text-transform: uppercase; letter-spacing: .1em; font-size: .8em; }
.sh-al.on.sh-green { background: color-mix(in srgb, var(--cf-good) 30%, var(--cf-surface)); border-color: var(--cf-good); }
.sh-al.on.sh-yellow { background: color-mix(in srgb, #e5b400 30%, var(--cf-surface)); border-color: #e5b400; }
.sh-al.on.sh-red { background: color-mix(in srgb, var(--cf-bad) 35%, var(--cf-surface)); border-color: var(--cf-bad); }
.sh-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sh-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); }
.sh-row .cf-icon { width: 18px; height: 18px; flex: none; }
.sh-row.bad .cf-icon { color: var(--cf-bad); }
.sh-row > span:not(.sh-crate):not(.cf-avatar), .sh-who { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
.sh-row .cf-btn { flex: none; min-height: 40px; }
.sh-crate { flex: none; min-width: 36px; height: 36px; display: grid; place-items: center; border-radius: 4px; font-variant-numeric: tabular-nums; font-weight: 700; background: color-mix(in srgb, var(--cf-accent) 18%, var(--cf-surface)); border: 1px dashed var(--cf-accent); }
.sh-over .cf-meter-fill { background: var(--cf-bad); }
.sh-reactor b { font-variant-numeric: tabular-nums; }
.sh-cells { display: flex; gap: 4px; margin-top: 8px; }
.sh-cells i { flex: 1; height: 10px; border-radius: 2px; background: var(--cf-surface2); border: 1px solid var(--cf-border); }
.sh-cells i.on { background: var(--cf-accent); border-color: var(--cf-accent); box-shadow: 0 0 6px color-mix(in srgb, var(--cf-accent) 60%, transparent); }
.sh-systems { display: flex; flex-direction: column; }
.sh-sys { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--cf-border); }
.sh-sys:last-child { border-bottom: 0; }
.sh-sysname { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sh-offline { font-size: .72em; text-transform: uppercase; letter-spacing: .1em; color: var(--cf-bad); }
.sh-sys.off .sh-pip.on { background: var(--cf-bad); border-color: var(--cf-bad); box-shadow: none; }
.sh-pips { display: flex; gap: 4px; flex: none; }
.sh-pip { width: 26px; height: 40px; padding: 0; border-radius: 3px; cursor: pointer; border: 1px solid var(--cf-border); background: var(--cf-surface2); }
.sh-pip.on { background: var(--cf-accent2); border-color: var(--cf-accent2); box-shadow: 0 0 6px color-mix(in srgb, var(--cf-accent2) 55%, transparent); }
.sh-pip:disabled { opacity: .35; cursor: default; }
.sh-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sh-two .cf-btn { justify-content: center; min-height: 44px; }
@media (prefers-reduced-motion: reduce) { .sh-flame path, .sh-view, .sh-view svg, .sh-m.low .cf-meter-fill { animation: none !important; } }
`;

/** `chart` is whether the card has a star chart (the map) whose jumps burn fuel. */
export function shipModule(raw?: Record<string, unknown>, enabled = true, chart = false): EngineModule {
  const settings = shipSettings(raw);
  const live = usable(settings, chart);
  return {
    id: "ship",
    name: "Ship",
    version: "1.0.0",
    description: "Hull, shields and fuel; reactor power to route between systems; damaged systems to repair; the crew; a cargo hold; the alert level.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "ship", "scifi"],
    requires: [],
    core: "ship",
    enabled,
    vars: shipVars(live),
    rules: shipRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: SCRIPT,
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
