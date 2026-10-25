import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runtime, type StateSchema } from "./runtime";
import { newEngine, newVar, schemaSource, type EngineConfig } from "./sheet";

const { cfUpdate, cfExtractCommands, cfPath, cfYaml, cfForAi } = runtime;

const schemaOf = (config: EngineConfig): StateSchema => new Function("z", `${schemaSource(config)}\nreturn cfSchema();`)(z);

const sheet = (): EngineConfig => ({
  ...newEngine(),
  vars: [
    newVar({ group: "Player", name: "Health", type: "number", start: "80", min: 0, max: 100 }),
    newVar({ group: "Player", name: "Mood", type: "text", start: "calm" }),
    newVar({ group: "Player", name: "Effects", type: "list", start: "" }),
    newVar({ group: "Player", name: "Bag", type: "counts", start: "rope: 1" }),
    newVar({ group: "Mina", name: "Stage", type: "choice", options: ["Strangers", "Friends"], start: "Strangers" }),
    newVar({ group: "World", name: "Day", type: "number", start: "1", readOnly: true }),
    newVar({ name: "Secret", type: "toggle", start: "no", hidden: true }),
  ],
});

const start = () => ({
  Player: { Health: 80, Mood: "calm", Effects: [], Bag: { rope: 1 } },
  Mina: { Stage: "Strangers" },
  World: { _Day: 1 },
  $Secret: false,
});

describe("paths", () => {
  it("reads dot, bracket and pointer paths", () => {
    expect(cfPath("Player.Health")).toEqual(["Player", "Health"]);
    expect(cfPath('stat_data.Player["Bag"][0]')).toEqual(["Player", "Bag", "0"]);
    expect(cfPath("/Player/Bag/rope~1net")).toEqual(["Player", "Bag", "rope/net"]);
  });
});

describe("the update block", () => {
  it("applies JSONPatch ops inside <UpdateVariable>", () => {
    const reply = `She smiles.
<UpdateVariable>
<Analysis>Player.Health: hurt by the fall</Analysis>
<JSONPatch>
[
  { "op": "delta", "path": "/Player/Health", "value": -15 },
  { "op": "replace", "path": "/Player/Mood", "value": "shaken" },
  { "op": "insert", "path": "/Player/Effects/-", "value": "bruised" },
  { "op": "insert", "path": "/Player/Bag/arrows", "value": 20 },
  { "op": "remove", "path": "/Player/Bag/rope" },
]
</JSONPatch>
</UpdateVariable>`;
    const result = cfUpdate(start(), reply);
    expect(result.stat_data.Player).toEqual({ Health: 65, Mood: "shaken", Effects: ["bruised"], Bag: { arrows: 20 } });
    expect(result.delta["Player.Health"]).toEqual([80, 65]);
    expect(result.applied).toHaveLength(5);
  });

  it("applies MVU's _.set-style commands, ignoring ones quoted in thinking", () => {
    const reply = `<think>maybe _.set('Player.Mood', 'angry');</think>
Text.
<UpdateVariable>
_.set('Player.Mood', 'calm', 'happy');//she laughs
_.add('Player.Health', 5);
_.insert('Player.Effects', 'warm');
_.delete('Player.Bag', 'rope');
</UpdateVariable>`;
    const result = cfUpdate(start(), reply);
    expect(result.stat_data.Player).toEqual({ Health: 85, Mood: "happy", Effects: ["warm"], Bag: {} });
    expect(cfExtractCommands(reply)).toHaveLength(4);
  });

  it("refuses read-only fields and repairs values through the schema", () => {
    const schema = schemaOf(sheet());
    const reply = `<UpdateVariable><JSONPatch>[
      { "op": "delta", "path": "/Player/Health", "value": 50 },
      { "op": "replace", "path": "/World/_Day", "value": 9 },
      { "op": "replace", "path": "/Mina/Stage", "value": "Enemies" },
      { "op": "replace", "path": "/Mina/Stage", "value": "Friends" }
    ]</JSONPatch></UpdateVariable>`;
    const result = cfUpdate(start(), reply, schema);
    expect(result.stat_data.Player).toMatchObject({ Health: 100 });
    expect(result.stat_data.World).toEqual({ _Day: 1 });
    expect(result.stat_data.Mina).toEqual({ Stage: "Friends" });
    expect(result.skipped.map((s) => s.error)).toEqual(["read-only field", expect.stringContaining("schema")]);
  });

  it("fills missing values from the schema's defaults", () => {
    const schema = schemaOf(sheet());
    const repaired = schema.safeParse({});
    expect(repaired.data).toEqual({ ...start(), Player: { ...start().Player } });
  });

  it("leaves the state alone when a reply has no block", () => {
    const result = cfUpdate(start(), "Just a story.");
    expect(result.stat_data).toEqual(start());
    expect(result.delta).toEqual({});
  });
});

describe("what the AI sees", () => {
  it("drops $ fields and writes YAML", () => {
    expect(cfYaml(cfForAi(start()))).toBe(
      ["Player:", "  Health: 80", "  Mood: calm", "  Effects: []", "  Bag:", "    rope: 1", "Mina:", "  Stage: Strangers", "World:", "  _Day: 1"].join("\n"),
    );
  });
});
