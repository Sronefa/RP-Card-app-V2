import { describe, expect, it } from "vitest";
import { emptyBook } from "./lorebook";
import { castText, isKind, setCastList, syncCast, worldEntry, worldMeta } from "./world";

describe("world entries", () => {
  it("writes the entry text and keys from the fields", () => {
    const book = emptyBook();
    const npc = worldEntry(book, "npc", {
      name: "Varen Holt",
      role: "ferryman",
      age: "50s",
      look: "one ear, tar-black hands",
      voice: "Short. Counts coins aloud.",
      notes: "",
      aliases: "the ferryman, Holt",
    });
    expect(npc.comment).toBe("Varen Holt");
    expect(npc.keys).toEqual(["Varen Holt", "the ferryman", "Holt"]);
    expect(npc.content).toBe("Varen Holt (ferryman), 50s\nLook: one ear, tar-black hands\nVoice: Short. Counts coins aloud.");
    expect(worldMeta(npc)?.kind).toBe("npc");

    const money = worldEntry(book, "currency", { name: "crowns", units: "1 crown = 12 shillings", notes: "" });
    expect(money.content).toBe('<currency name="crowns">\nCoins: 1 crown = 12 shillings\n</currency>');
    expect(money.keys).toContain("price");

    // Editing keeps the entry's own settings.
    const edited = worldEntry(book, "npc", { ...worldMeta(npc)!.fields, name: "Varen" }, { ...npc, insertion_order: 7 });
    expect(edited).toMatchObject({ comment: "Varen", insertion_order: 7, id: npc.id });
  });

  it("keeps an always-on cast list in step with the NPCs", () => {
    let book = emptyBook();
    book = { ...book, entries: [worldEntry(book, "npc", { name: "Ada", role: "smith", voice: "Loud." })] };
    book = setCastList(book, true);
    const cast = book.entries.find((e) => isKind(e, "cast"))!;
    expect(cast.constant).toBe(true);
    expect(cast.content).toBe("Cast. Keep each character's voice distinct:\n- Ada (smith): Loud.");
    book = syncCast({ ...book, entries: [...book.entries, worldEntry(book, "npc", { name: "Bo", voice: "" })] });
    expect(castText(book.entries)).toContain("- Bo: voice not set");
    expect(book.entries.find((e) => isKind(e, "cast"))!.content).toContain("- Bo: voice not set");
    expect(setCastList(book, false).entries.some((e) => isKind(e, "cast"))).toBe(false);
  });
});
