import { useState } from "react";
import { useUi } from "../../app/store";
import { Button } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import { BasicsGroup } from "./BasicsGroup";
import { CardBar } from "./CardBar";
import { GROUPS, PERMANENT_FIELDS, TEXT_FIELDS } from "./fields";
import { GreetingsGroup } from "./GreetingsGroup";
import { HistoryDialog } from "./HistoryDialog";
import { NoCard } from "./NoCard";
import { TextField } from "./TextField";

export function EditorView() {
  const record = useEditor((s) => s.record);
  const { editorGroup: group, setEditorGroup: setGroup } = useUi();
  const [history, setHistory] = useState(false);

  if (!record) return <NoCard />;

  const d = record.card.data;
  const permanent = PERMANENT_FIELDS.reduce((n, f) => n + estimateTokens(d[f]), 0);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <CardBar detail={`~${permanent} permanent tokens`}>
          <Button onClick={() => setHistory(true)}>History</Button>
        </CardBar>
        <nav aria-label="Card sections" className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 py-2">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-current={group === g.id ? "true" : undefined}
              onClick={() => setGroup(g.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                group === g.id ? "bg-accent/15 text-accent" : "text-ink-muted hover:text-ink"
              }`}
            >
              {g.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4">
        {group === "basics" && <BasicsGroup key={record.id} />}
        {group === "greetings" && <GreetingsGroup />}
        {TEXT_FIELDS[group]?.map((info) => <TextField key={info.field} info={info} />)}
      </div>

      <HistoryDialog open={history} onClose={() => setHistory(false)} />
    </div>
  );
}
