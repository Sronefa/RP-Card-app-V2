import { useObjectUrl } from "../../lib/useObjectUrl";
import { cardImage } from "../../lib/cardFiles";
import type { CardRecord } from "../../db/db";

export function CardAvatar({ record, className = "size-14" }: { record: CardRecord; className?: string }) {
  const url = useObjectUrl(cardImage(record));
  return url ? (
    <img src={url} alt="" className={`${className} shrink-0 rounded-lg object-cover`} />
  ) : (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-xl text-ink-muted`}>
      {record.card.data.name.slice(0, 1).toUpperCase() || "?"}
    </div>
  );
}

export function CardTile({
  record,
  onOpen,
  onMore,
}: {
  record: CardRecord;
  onOpen: () => void;
  onMore: () => void;
}) {
  const d = record.card.data;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-3">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <CardAvatar record={record} />
        <div className="min-w-0">
          <div className="truncate font-medium">{d.name || "Unnamed"}</div>
          <div className="truncate text-xs text-ink-muted">
            {d.nickname ? `${d.nickname} · ` : ""}
            {d.tags.slice(0, 3).join(", ") || (record.kind === "world" ? "World card" : "Character card")}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onMore}
        aria-label={`More actions for ${d.name || "card"}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        •••
      </button>
    </div>
  );
}
