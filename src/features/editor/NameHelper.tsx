import { useRef, useState } from "react";
import { systemPrompt } from "../../ai/prompts";
import type { ToolDef } from "../../ai/types";
import { Button, Dialog, TextInput } from "../../components/ui";
import { complete, gatherContext, isAbort, partsText } from "../../cowriter/engine";
import { OVERUSED_NAMES } from "../../editor/patterns";
import { useEditor } from "../../editor/store";

const SUGGEST_NAMES: ToolDef = {
  name: "suggest_names",
  description: "Hand in the names.",
  parameters: {
    type: "object",
    properties: {
      names: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, why: { type: "string", description: "Where it comes from, in a few words" } },
          required: ["name", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["names"],
    additionalProperties: false,
  },
};

export const namesRequest = (culture: string, current: string) =>
  [
    `Suggest eight names for this card's ${current ? `character (now "${current}")` : "character"} that fit the setting's culture${culture.trim() ? `: ${culture.trim()}` : ""}.`,
    "Draw on real naming traditions for that culture (given names, family names, bynames), mix common and rarer ones, and vary sound and length.",
    `These are names AI models overuse, so pick others: ${OVERUSED_NAMES.join(", ")}.`,
    "Hand them in with suggest_names.",
  ].join("\n\n");

/** Names that fit the setting and avoid the ones every AI card uses. */
export function NameHelper() {
  const [open, setOpen] = useState(false);
  const [culture, setCulture] = useState("");
  const [names, setNames] = useState<{ name: string; why: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);

  async function suggest() {
    const record = useEditor.getState().record!;
    setBusy(true);
    setError(undefined);
    controller.current = new AbortController();
    try {
      const parts = await gatherContext(record);
      const result = await complete("world", {
        system: systemPrompt("world"),
        messages: [{ role: "user", text: `${partsText(parts.filter((p) => p.key !== "examples"))}\n\n${namesRequest(culture, record.card.data.name)}` }],
        tools: [SUGGEST_NAMES],
        signal: controller.current.signal,
      });
      const call = result.toolCalls.find((c) => c.name === SUGGEST_NAMES.name);
      const list = Array.isArray(call?.input.names) ? (call!.input.names as { name?: unknown; why?: unknown }[]) : [];
      const next = list
        .filter((n) => typeof n.name === "string" && n.name.trim())
        .map((n) => ({ name: String(n.name).trim(), why: typeof n.why === "string" ? n.why : "" }))
        .filter((n) => !OVERUSED_NAMES.some((o) => o.toLowerCase() === n.name.toLowerCase()));
      if (!next.length) throw new Error("No names came back. Try again.");
      setNames(next);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" className="self-start text-accent" onClick={() => setOpen(true)}>
        ✦ Suggest names
      </Button>
      <Dialog
        open={open}
        title="Names"
        onClose={() => {
          controller.current?.abort();
          setOpen(false);
        }}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-ink-muted">Names that fit the setting's culture, steering clear of the ones every AI card uses (Elara, Kael, Lyra…).</p>
          <label className="flex flex-col gap-1">
            Culture or naming style
            <TextInput value={culture} placeholder="Optional, e.g. Welsh mining town, Edo Japan, Martian colony" onChange={(e) => setCulture(e.target.value)} />
          </label>
          <Button variant="primary" className="self-start" disabled={busy} onClick={() => void suggest()}>
            {busy ? "Thinking…" : names.length ? "✦ More names" : "✦ Suggest"}
          </Button>
          {error && <p className="text-red-300">{error}</p>}
          <ul className="flex flex-col gap-1">
            {names.map((n) => (
              <li key={n.name} className="flex items-center gap-2 rounded-lg bg-surface-sunken p-2">
                <span className="flex-1">
                  <span className="font-medium">{n.name}</span> <span className="text-xs text-ink-muted">{n.why}</span>
                </span>
                <Button
                  aria-label={`Use ${n.name}`}
                  onClick={() => {
                    useEditor.getState().setField("name", n.name, null);
                    setOpen(false);
                  }}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
