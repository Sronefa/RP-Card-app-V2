/** Starts a big co-writer job in the background: many NPCs, places or greetings at once, landing in the inbox. */
import { useState } from "react";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { BATCH_KINDS, MAX_COUNT, runBatch, type BatchKind } from "../../cowriter/batch";
import { useEditor } from "../../editor/store";
import { selectClass } from "../engine/VarEditor";

export function BigJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const record = useEditor((s) => s.record);
  const [kind, setKind] = useState<BatchKind>("npcs");
  const [count, setCount] = useState(10);
  const [ask, setAsk] = useState("");
  if (!record) return null;

  function start() {
    const what = ask.trim();
    if (!record || !what) return;
    void runBatch(record.id, record.card.data.name, { kind, ask: what, count, label: `${count} ${BATCH_KINDS[kind].label.toLowerCase()}: ${what.split("\n")[0]}` });
    toast("Started in the background. What it writes lands in the inbox.");
    setAsk("");
    onClose();
  }

  return (
    <Dialog open={open} title="Big job" onClose={onClose}>
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <p className="text-ink-muted">
          The co-writer writes them in the background, a few at a time, while you keep working. Each one lands in the inbox to accept or reject on
          its own; the activity chip shows how far it got, and you can stop it there.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            What
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as BatchKind)}>
              {(Object.keys(BATCH_KINDS) as BatchKind[]).map((k) => (
                <option key={k} value={k}>
                  {BATCH_KINDS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            How many
            <TextInput
              type="number"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setCount(Math.max(1, Math.min(MAX_COUNT, Math.round(n))));
              }}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          Describe them
          <AutoTextarea rows={2} value={ask} placeholder={BATCH_KINDS[kind].placeholder} onChange={(e) => setAsk(e.target.value)} />
        </label>
        <p className="text-xs text-ink-muted">Each call writes up to five, so {count} takes about {Math.ceil(count / 5)} calls on your model.</p>
        <Button type="submit" variant="primary" className="self-start" disabled={!ask.trim()}>
          Start in the background
        </Button>
      </form>
    </Dialog>
  );
}
