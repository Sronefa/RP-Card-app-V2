import { AutoTextarea } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { estimateTokens } from "../../lib/tokens";
import type { FieldInfo } from "./fields";

export function TextField({ info }: { info: FieldInfo }) {
  const value = useEditor((s) => s.record!.card.data[info.field]);
  const kind = useEditor((s) => s.record!.kind);
  const setField = useEditor((s) => s.setField);
  const id = `field-${info.field}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {info.label}
        </label>
        <span className="text-xs text-ink-muted">~{estimateTokens(value ?? "")} tokens</span>
      </div>
      <p className="text-xs text-ink-muted">{typeof info.help === "function" ? info.help(kind) : info.help}</p>
      <AutoTextarea
        id={id}
        value={value ?? ""}
        placeholder={info.placeholder}
        onChange={(e) => setField(info.field, e.target.value)}
        className="min-h-24"
      />
    </div>
  );
}
