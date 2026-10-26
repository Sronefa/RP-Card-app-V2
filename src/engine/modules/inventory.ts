/**
 * Kit part (Fantasy RPG, Dark fantasy, Isekai): the inventory. A bag of item stacks with a slot
 * limit, gear slots to equip weapons and armour, gold, and merchants to buy from and sell to. The
 * item catalog says what each item is (its kind, the slot it fits, its effect and price); items the
 * story hands out that aren't in it still show, as plain items. Equipping, dropping and trading are
 * the player's own moves and change the state at once; using an item goes to the story.
 */
import { newVar, type EngineVar } from "../sheet";
import type { EngineModule, ModuleRule } from "./types";

export const ITEM_KINDS = ["weapon", "armor", "accessory", "consumable", "material", "key", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface InvItem {
  name: string;
  kind: ItemKind;
  /** The gear slot it fits; empty for its kind's own (weapon → Weapon). */
  slot: string;
  /** What it does, for the player and the model: "Heals 30 health", "+4 attack". */
  effect: string;
  price: number;
}

export interface InvStart {
  name: string;
  count: number;
}

export interface Merchant {
  name: string;
  /** The map place they trade at; empty for anywhere. */
  where: string;
  /** Item names, comma-separated. */
  stock: string;
}

export interface InventorySettings {
  title: string;
  button: string;
  currency: string;
  startGold: number;
  /** A value of the card's to use for gold, like "Phone.Money"; empty for the part's own. */
  moneyPath: string;
  /** Different items the bag holds; 0 for no limit. */
  capacity: number;
  slots: string[];
  items: InvItem[];
  start: InvStart[];
  merchants: Merchant[];
  /** What a merchant pays, as a percent of the price. */
  sellRate: number;
}

export const defaultInventorySettings = (): InventorySettings => ({
  title: "Inventory",
  button: "🎒 Bag",
  currency: "G",
  startGold: 50,
  moneyPath: "",
  capacity: 20,
  slots: ["Weapon", "Armor", "Accessory"],
  items: [
    { name: "Health potion", kind: "consumable", slot: "", effect: "Heals 40 health", price: 25 },
    { name: "Mana potion", kind: "consumable", slot: "", effect: "Restores 25 mana", price: 30 },
    { name: "Rations", kind: "consumable", slot: "", effect: "A day's food", price: 5 },
    { name: "Torch", kind: "consumable", slot: "", effect: "Light for an hour", price: 2 },
    { name: "Rope", kind: "other", slot: "", effect: "15 metres of hemp rope", price: 4 },
    { name: "Shortsword", kind: "weapon", slot: "", effect: "+3 attack", price: 40 },
    { name: "Longsword", kind: "weapon", slot: "", effect: "+6 attack", price: 120 },
    { name: "Leather armor", kind: "armor", slot: "", effect: "+3 defence", price: 45 },
    { name: "Chainmail", kind: "armor", slot: "", effect: "+6 defence, noisy", price: 150 },
    { name: "Lucky charm", kind: "accessory", slot: "", effect: "+1 luck", price: 60 },
    { name: "Wolf pelt", kind: "material", slot: "", effect: "Sells well to tanners", price: 12 },
  ],
  start: [
    { name: "Shortsword", count: 1 },
    { name: "Leather armor", count: 1 },
    { name: "Health potion", count: 2 },
    { name: "Rations", count: 3 },
  ],
  merchants: [
    { name: "General store", where: "", stock: "Health potion, Mana potion, Rations, Torch, Rope" },
    { name: "Blacksmith", where: "", stock: "Shortsword, Longsword, Leather armor, Chainmail" },
  ],
  sellRate: 50,
});

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const clean = (name: string) => name.replace(/[.[\]"'/~$]/g, " ").trim();
const pathText = (v: unknown) => str(v).replace(/[^\w$. -]/g, "").trim();
const kindOf = (v: unknown): ItemKind => ((ITEM_KINDS as readonly string[]).includes(String(v)) ? (v as ItemKind) : "other");

export function inventorySettings(raw: Record<string, unknown> | undefined): InventorySettings {
  const base = defaultInventorySettings();
  if (!raw) return base;
  return {
    title: str(raw.title, base.title),
    button: str(raw.button, base.button) || base.button,
    currency: str(raw.currency, base.currency),
    startGold: Math.max(0, num(raw.startGold, base.startGold)),
    moneyPath: pathText(raw.moneyPath),
    capacity: Math.max(0, Math.round(num(raw.capacity, base.capacity))),
    slots: Array.isArray(raw.slots) ? raw.slots.map((x) => clean(String(x))) : base.slots,
    items: Array.isArray(raw.items)
      ? rows(raw.items).map((i) => ({ name: str(i.name), kind: kindOf(i.kind), slot: str(i.slot), effect: str(i.effect), price: Math.max(0, num(i.price, 0)) }))
      : base.items,
    start: Array.isArray(raw.start) ? rows(raw.start).map((x) => ({ name: str(x.name), count: Math.max(1, Math.round(num(x.count, 1))) })) : base.start,
    merchants: Array.isArray(raw.merchants) ? rows(raw.merchants).map((m) => ({ name: str(m.name), where: str(m.where), stock: str(m.stock) })) : base.merchants,
    sellRate: Math.max(0, Math.min(100, num(raw.sellRate, base.sellRate))),
  };
}

const DEFAULT_SLOT: Partial<Record<ItemKind, string>> = { weapon: "Weapon", armor: "Armor", accessory: "Accessory" };

/** What the screen and script use: unnamed rows out, slots worked out, gold and bag resolved. */
function usable(s: InventorySettings, shared: string, bag: string) {
  const slots = s.slots.filter(Boolean);
  const items = s.items
    .filter((i) => i.name.trim())
    .map((i) => {
      const slot = clean(i.slot) || DEFAULT_SLOT[i.kind] || "";
      return { ...i, name: i.name.trim(), slot: slots.includes(slot) ? slot : "" };
    });
  return {
    ...s,
    slots,
    items,
    start: s.start.filter((x) => x.name.trim()).map((x) => ({ ...x, name: x.name.trim() })),
    merchants: s.merchants
      .filter((m) => m.name.trim())
      .map((m) => ({ name: m.name.trim(), where: m.where.trim(), stock: m.stock.split(",").map((x) => x.trim()).filter(Boolean) })),
    money: s.moneyPath || shared || "Inventory.Gold",
    bag: bag || "Inventory.Items",
  };
}
type Live = ReturnType<typeof usable>;

function inventoryVars(s: Live, shared: string, bag: string): EngineVar[] {
  const vars: EngineVar[] = [];
  if (!bag)
    vars.push(
      newVar({
        id: "inv-items",
        group: "Inventory",
        name: "Items",
        type: "counts",
        start: s.start.map((x) => `${x.name}: ${x.count}`).join(", "),
        rule: "What {{user}} carries, by name and count. Insert an item when {{user}} gets one; delta −1 when one is used up; remove it at 0. Use the exact names of known items.",
      }),
    );
  if (!s.moneyPath && !shared)
    vars.push(newVar({ id: "inv-gold", group: "Inventory", name: "Gold", type: "number", start: String(s.startGold), min: 0, pinned: true, rule: `{{user}}'s money in ${s.currency || "coins"}. Delta it for loot, rewards and payments.` }));
  for (const slot of s.slots) {
    const worn = s.start.find((x) => s.items.find((i) => i.name === x.name)?.slot === slot);
    vars.push(
      newVar({
        id: `inv-slot-${slot}`,
        group: "Equipped",
        name: clean(slot),
        type: "text",
        start: worn?.name ?? "",
        pinned: false,
        rule: `What {{user}} has equipped as ${slot.toLowerCase()}; the player equips from the bag. Weigh it in fights. Empty it if it breaks or is lost.`,
      }),
    );
  }
  return vars;
}

function inventoryRules(s: Live): ModuleRule[] {
  const known = s.items.filter((i) => i.effect).map((i) => `${i.name} (${i.effect})`);
  const rules: ModuleRule[] = [
    {
      comment: "Inventory actions",
      content: [
        '<action app="inventory"> is something {{user}} did from the bag:',
        `- {"use":I}: {{user}} uses I. Play out its effect, apply it to the state (health, mana, light…), and delta /${s.bag.replace(/\./g, "/")}/I by −1.`,
        `- {"give":I,"to":P}: {{user}} hands I to P. Move it out of the bag and play P's reaction.`,
        "Equipping, dropping and trading are done by the player in the screen; they show in _PlayerEdits.",
      ].join("\n"),
      constant: false,
      keys: ['app="inventory"'],
      depth: 2,
      order: 100,
    },
  ];
  const lines = [`Items live in ${s.bag} (exact names, with counts) and money in ${s.money}.`];
  if (s.capacity) lines.push(`The bag holds at most ${s.capacity} different items; when it's full, {{user}} must drop something to take more.`);
  if (known.length) lines.push(`Known items: ${known.join("; ")}.`);
  rules.push({ comment: "Inventory", content: lines.join(" "), constant: false, keys: ["bag", "item", "inventory", "loot", "buy", "sell", "equip", "potion"], order: 100 });
  return rules;
}

const JS = String.raw`
var S = settings.live || settings;
var ui = CF.ui, esc = ui.esc;
var tab = (CF.openParams() || {}).tab || "bag";
var shopAt = 0;
var ICON = { weapon: "sword", armor: "shield", accessory: "star", consumable: "flask", material: "note", key: "lock", other: "bag" };
function get(path) { return app.state(path); }
function bag() { var b = get(S.bag); return b && typeof b === "object" ? b : {}; }
function names() { var b = bag(); return Object.keys(b).filter(function (k) { return Number(b[k]) > 0; }); }
function gold() { var n = Number(get(S.money)); return isFinite(n) ? n : 0; }
function cash(n) { return Math.round(n * 100) / 100 + (S.currency ? " " + S.currency : ""); }
function info(name) {
  for (var i = 0; i < S.items.length; i++) if (S.items[i].name.toLowerCase() === String(name).toLowerCase()) return S.items[i];
  return { name: name, kind: "other", slot: "", effect: "", price: 0 };
}
function worn() { return get("Equipped") || {}; }
function wornIn(name) { var w = worn(); for (var k in w) if (w[k] === name) return k; return ""; }
function full() { return S.capacity > 0 && names().length >= S.capacity; }
function here() { return get("Map.Location"); }
function open(m) { return !m.where || typeof here() !== "string" || here() === m.where; }
function act(payload, text) { app.send("inventory", payload, text).then(function () { app.toast("In your message box: send it when you're ready"); }); }
function tile(n) {
  var it = info(n), count = bag()[n], w = wornIn(n);
  return '<button type="button" class="iv-tile ' + esc(it.kind) + (w ? " worn" : "") + '" data-item="' + esc(n) + '">' +
    '<span class="iv-ic">' + ui.icon(ICON[it.kind] || "bag") + "</span><b>" + esc(n) + "</b>" +
    (count > 1 ? '<span class="iv-count">×' + esc(count) + "</span>" : "") + (w ? '<span class="iv-worn">' + esc(w) + "</span>" : "") + "</button>";
}
function head() {
  var used = names().length;
  return '<div class="cf-card iv-head"><span class="iv-gold">' + ui.icon("coin") + "<b>" + esc(cash(gold())) + "</b>" + ui.delta((function () { var d = app.delta()[S.money]; return d && typeof d[0] === "number" ? d[1] - d[0] : undefined; })()) + "</span>" +
    (S.capacity ? '<span class="cf-small' + (used >= S.capacity ? " iv-full" : " cf-muted") + '">' + used + " / " + S.capacity + " slots</span>" : "") + "</div>";
}
function bagView() {
  var list = names();
  return '<div class="cf-stack">' + head() + (list.length ? '<div class="iv-grid">' + list.map(tile).join("") + "</div>" : '<p class="cf-muted">The bag is empty.</p>') + "</div>";
}
function gearView() {
  var w = worn();
  return '<div class="iv-gear">' + S.slots.map(function (slot) {
    var n = w[slot], it = n ? info(n) : null;
    return '<button type="button" class="iv-slot' + (n ? " on" : "") + '" data-slot="' + esc(slot) + '"><span class="iv-ic">' + ui.icon(n ? ICON[it.kind] || "bag" : "plus") + '</span><span class="iv-slotmain"><span class="cf-label">' + esc(slot) + "</span><b>" + esc(n || "Empty") + "</b>" +
      (it && it.effect ? '<span class="cf-small cf-muted">' + esc(it.effect) + "</span>" : "") + "</span></button>";
  }).join("") + "</div>";
}
function shopView() {
  var m = S.merchants[shopAt] || S.merchants[0];
  var ok = open(m);
  var picker = S.merchants.length > 1 ? '<div class="iv-merchants">' + S.merchants.map(function (x, i) {
    return '<button type="button" class="cf-chip' + (x === m ? " on" : "") + '" data-merchant="' + i + '">' + esc(x.name) + "</button>";
  }).join("") + "</div>" : "";
  var buy = m.stock.map(function (n) {
    var it = info(n), short = gold() < it.price, room = !full() || bag()[n] > 0;
    return '<li><span class="iv-ic">' + ui.icon(ICON[it.kind] || "bag") + '</span><span class="iv-main"><b>' + esc(n) + "</b>" + (it.effect ? '<span class="cf-small cf-muted">' + esc(it.effect) + "</span>" : "") + "</span>" +
      '<button type="button" class="cf-btn' + (ok && !short && room ? " primary" : "") + '" data-buy="' + esc(n) + '"' + (ok && !short && room ? "" : " disabled") + ">" + esc(cash(it.price)) + "</button></li>";
  }).join("");
  var sell = names().filter(function (n) { return info(n).price > 0 && !wornIn(n); }).map(function (n) {
    var it = info(n), pay = Math.floor(it.price * S.sellRate / 100);
    return '<li><span class="iv-ic">' + ui.icon(ICON[it.kind] || "bag") + '</span><span class="iv-main"><b>' + esc(n) + '</b><span class="cf-small cf-muted">You have ' + esc(bag()[n]) + "</span></span>" +
      '<button type="button" class="cf-btn" data-sell="' + esc(n) + '"' + (ok && pay > 0 ? "" : " disabled") + ">+" + esc(cash(pay)) + "</button></li>";
  }).join("");
  return '<div class="cf-stack">' + head() + picker +
    (ok ? "" : '<p class="cf-card iv-away">' + ui.icon("map") + " " + esc(m.name) + " trades at " + esc(m.where) + ". Go there to trade.</p>") +
    '<section class="cf-card"><span class="cf-label">Buy from ' + esc(m.name) + '</span><ul class="iv-list">' + (buy || '<li class="cf-muted">Nothing for sale.</li>') + "</ul></section>" +
    '<section class="cf-card"><span class="cf-label">Sell</span><ul class="iv-list">' + (sell || '<li class="cf-muted">Nothing they would buy.</li>') + "</ul></section></div>";
}
function draw() {
  var tabs = [{ id: "bag", label: "Bag", html: bagView() }];
  if (S.slots.length) tabs.push({ id: "gear", label: "Gear", html: gearView() });
  if (S.merchants.length) tabs.push({ id: "shop", label: "Trade", html: shopView() });
  root.innerHTML = ui.appBar(S.title) + '<div class="cf-appbody">' + ui.tabs(tabs, tab) + "</div>";
}
function change(name, by) {
  var b = Object.assign({}, bag());
  var n = (Number(b[name]) || 0) + by;
  if (n > 0) b[name] = n; else delete b[name];
  return [S.bag.split("."), b];
}
function itemModal(n) {
  var it = info(n), w = wornIn(n);
  var btns = [];
  if (it.kind === "consumable") btns.push('<button type="button" class="cf-btn primary" data-do="use">' + ui.icon("flask") + "Use</button>");
  if (it.slot) btns.push(w ? '<button type="button" class="cf-btn" data-do="off">Unequip</button>' : '<button type="button" class="cf-btn primary" data-do="on">' + ui.icon(ICON[it.kind]) + "Equip</button>");
  btns.push('<button type="button" class="cf-btn ghost" data-do="drop">Drop one</button>', '<button type="button" class="cf-btn ghost" data-cf-close>Close</button>');
  var m = app.modal('<div class="iv-modal"><span class="iv-ic big ' + esc(it.kind) + '">' + ui.icon(ICON[it.kind] || "bag") + "</span><h2>" + esc(n) + "</h2>" +
    '<span class="cf-small cf-muted">' + esc(it.kind) + (it.slot ? " · " + esc(it.slot) : "") + " · ×" + esc(bag()[n]) + "</span>" +
    (it.effect ? "<p>" + esc(it.effect) + "</p>" : "") + '<div class="cf-stack">' + btns.join("") + "</div></div>");
  m.addEventListener("click", function (e) {
    var b = e.target.closest("[data-do]");
    if (!b) return;
    var d = b.getAttribute("data-do");
    m.remove();
    if (d === "use") return act({ use: n }, "I use the " + n.toLowerCase() + ".");
    if (d === "on") return app.setMany([[["Equipped", it.slot], n]], "equipped " + n);
    if (d === "off") return app.setMany([[["Equipped", w], ""]], "unequipped " + n);
    if (d === "drop") {
      var changes = [change(n, -1)];
      if (w && Number(bag()[n]) <= 1) changes.push([["Equipped", w], ""]);
      return app.setMany(changes, "dropped a " + n.toLowerCase()).then(function () { app.toast("Dropped: " + n); });
    }
  });
}
function slotModal(slot) {
  var fits = names().filter(function (n) { return info(n).slot === slot; });
  var cur = worn()[slot];
  var m = app.modal("<h2>" + esc(slot) + '</h2><div class="cf-stack">' +
    (fits.length ? fits.map(function (n) { return '<button type="button" class="cf-btn' + (n === cur ? " primary" : "") + '" data-wear="' + esc(n) + '">' + esc(n) + (info(n).effect ? " · " + esc(info(n).effect) : "") + "</button>"; }).join("") : '<p class="cf-muted">Nothing in the bag fits.</p>') +
    (cur ? '<button type="button" class="cf-btn ghost" data-wear="">Take it off</button>' : "") + '<button type="button" class="cf-btn ghost" data-cf-close>Close</button></div>');
  m.addEventListener("click", function (e) {
    var b = e.target.closest("[data-wear]");
    if (!b) return;
    var n = b.getAttribute("data-wear");
    m.remove();
    app.setMany([[["Equipped", slot], n]], n ? "equipped " + n : "unequipped " + cur);
  });
}
root.addEventListener("click", function (e) {
  var t = e.target, b;
  if ((b = t.closest("[data-cf-tab]"))) { tab = b.getAttribute("data-cf-tab"); return; }
  if ((b = t.closest("[data-item]"))) return itemModal(b.getAttribute("data-item"));
  if ((b = t.closest("[data-slot]"))) return slotModal(b.getAttribute("data-slot"));
  if ((b = t.closest("[data-merchant]"))) { shopAt = Number(b.getAttribute("data-merchant")); return draw(); }
  var m = S.merchants[shopAt] || S.merchants[0];
  if ((b = t.closest("[data-buy]"))) {
    var n = b.getAttribute("data-buy"), it = info(n);
    return app.setMany([[S.money.split("."), gold() - it.price], change(n, 1)], "bought a " + n.toLowerCase() + " from " + m.name).then(function () { app.toast("Bought: " + n); });
  }
  if ((b = t.closest("[data-sell]"))) {
    var s = b.getAttribute("data-sell"), pay = Math.floor(info(s).price * S.sellRate / 100);
    return app.setMany([[S.money.split("."), gold() + pay], change(s, -1)], "sold a " + s.toLowerCase() + " to " + m.name).then(function () { app.toast("Sold: " + s); });
  }
});
draw();
app.onState(draw);
`;

const CSS = String.raw`
.iv-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.iv-gold { display: flex; align-items: center; gap: 6px; font-size: 1.25em; color: var(--cf-accent2); font-variant-numeric: tabular-nums; }
.iv-gold b { font-family: var(--cf-heading); }
.iv-gold .cf-icon { width: 20px; height: 20px; }
.iv-full { color: var(--cf-bad); font-weight: 600; }
.iv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.iv-tile { position: relative; font: inherit; color: var(--cf-text); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px 10px; min-height: 96px; border: 1px solid var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface2); cursor: pointer; text-align: center; transition: transform .12s, border-color .12s; }
.iv-tile:hover, .iv-tile:focus-visible { border-color: var(--cf-accent); transform: translateY(-2px); }
.iv-tile b { font-size: .82em; line-height: 1.2; overflow-wrap: anywhere; }
.iv-tile.worn { border-color: var(--cf-accent2); box-shadow: inset 0 0 0 1px var(--cf-accent2); }
.iv-ic { flex: none; width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--cf-accent) 16%, var(--cf-surface)); color: var(--cf-accent); }
.iv-ic .cf-icon { width: 22px; height: 22px; }
.consumable .iv-ic, .iv-ic.consumable { color: var(--cf-good); background: color-mix(in srgb, var(--cf-good) 16%, var(--cf-surface)); }
.armor .iv-ic, .accessory .iv-ic, .iv-ic.armor, .iv-ic.accessory { color: var(--cf-accent2); background: color-mix(in srgb, var(--cf-accent2) 18%, var(--cf-surface)); }
.iv-count { position: absolute; top: 6px; right: 8px; font-size: .75em; font-weight: 700; color: var(--cf-muted); }
.iv-worn { position: absolute; top: 6px; left: 6px; font-size: .62em; text-transform: uppercase; letter-spacing: .06em; padding: 1px 5px; border-radius: 999px; background: var(--cf-accent2); color: #fff; }
.iv-gear { display: flex; flex-direction: column; gap: 8px; }
.iv-slot { font: inherit; color: var(--cf-text); text-align: left; display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px dashed var(--cf-border); border-radius: var(--cf-radius); background: var(--cf-surface); cursor: pointer; }
.iv-slot.on { border-style: solid; background: var(--cf-surface2); }
.iv-slot:hover, .iv-slot:focus-visible { border-color: var(--cf-accent); }
.iv-slotmain { display: flex; flex-direction: column; min-width: 0; }
.iv-merchants { display: flex; flex-wrap: wrap; gap: 6px; }
.iv-merchants .cf-chip { cursor: pointer; font: inherit; font-size: .85em; }
.iv-merchants .cf-chip.on { background: var(--cf-accent); color: #fff; border-color: var(--cf-accent); }
.iv-away { display: flex; align-items: center; gap: 8px; color: var(--cf-muted); }
.iv-away .cf-icon { width: 18px; height: 18px; flex: none; }
.iv-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.iv-list li { display: flex; align-items: center; gap: 10px; }
.iv-list .iv-ic { width: 32px; height: 32px; }
.iv-list .iv-ic .cf-icon { width: 18px; height: 18px; }
.iv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.iv-list .cf-btn { flex: none; min-height: 40px; min-width: 76px; justify-content: center; }
.iv-modal { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; margin-bottom: 10px; }
.iv-ic.big { width: 64px; height: 64px; border-radius: 16px; }
.iv-ic.big .cf-icon { width: 34px; height: 34px; }
@media (prefers-reduced-motion: reduce) { .iv-tile { transition: none; } }
`;

/** `shared` is a money value another part keeps; `bag` is an item list another part keeps (the creator's). */
export function inventoryModule(raw?: Record<string, unknown>, enabled = true, shared = "", bag = ""): EngineModule {
  const settings = inventorySettings(raw);
  const live = usable(settings, shared, bag);
  return {
    id: "inventory",
    name: "Inventory",
    version: "1.0.0",
    description: "A bag with a slot limit, gear to equip, gold, and merchants to buy from and sell to.",
    slot: "overlay",
    button: settings.button,
    tags: ["built-in", "rpg", "items", "money", "fantasy"],
    requires: [],
    core: "inventory",
    enabled,
    vars: inventoryVars(live, settings.moneyPath ? "" : shared, bag),
    rules: inventoryRules(live),
    regex: [],
    html: "",
    css: CSS,
    js: JS,
    script: "",
    settings: { ...(settings as unknown as Record<string, unknown>), live },
  };
}
