import { useEffect, useState } from "react";
import { acceptAll, collectInbox, rejectAll, SOURCE_LABEL, useInboxVersion, type InboxItem, type InboxSource } from "../../app/inbox";
import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { Button, Dialog } from "../../components/ui";
import { useCowriter, useLoreChat } from "../../cowriter/store";
import { useEditor } from "../../editor/store";
import { useEngineer } from "../../engine/engineer/session";
import { useImageQueue } from "../../images/queue";

/** What's waiting on the open card, counted again whenever a chat, the parked list or the image queue changes. */
export function useInbox() {
  const cardId = useEditor((s) => s.record?.id);
  const cowriter = useCowriter((s) => s.chat);
  const lore = useLoreChat((s) => s.chat);
  const engineer = useEngineer((s) => s.chat);
  const parked = useInboxVersion((s) => s.version);
  const images = useImageQueue((s) => s.version);
  const [items, setItems] = useState<InboxItem[]>([]);
  useEffect(() => {
    if (!cardId) return setItems([]);
    let live = true;
    void collectInbox(cardId)
      .then((next) => live && setItems(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cardId, cowriter, lore, engineer, parked, images]);
  return items;
}

/** Everything pending from the co-writer, the UI engineer, the Game Wizard, bulk items and the Image Studio. */
export function InboxDialog({ items, open, onClose }: { items: InboxItem[]; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (what: () => Promise<void>, done?: string) => {
    setBusy(true);
    try {
      await what();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      useInboxVersion.getState().bump();
    }
  };
  const go = (item: InboxItem) => {
    useUi.getState().goTo(item.lands.section, item.lands.tab);
    onClose();
  };
  const groups = new Map<InboxSource, InboxItem[]>();
  for (const item of items) groups.set(item.source, [...(groups.get(item.source) ?? []), item]);
  const acceptable = items.filter((i) => i.accept).length;

  return (
    <Dialog open={open} title="Inbox" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        {items.length === 0 ? (
          <p className="text-ink-muted">Nothing is waiting. Proposals from the co-writer, the UI engineer, the Game Wizard, bulk items and the Image Studio show up here.</p>
        ) : (
          <>
            <p className="text-ink-muted">
              Everything waiting for your decision on this card. The chats keep their own cards too; deciding here or there is the same.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || !acceptable} onClick={() => void run(() => acceptAll(items), `Accepted ${acceptable}`)}>
                Accept all ({acceptable})
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => rejectAll(items), `Rejected ${items.length}`)}>
                Reject all
              </Button>
            </div>
            {acceptable < items.length && <p className="text-xs text-ink-muted">Shots with several images wait for you to pick one in the Image Studio.</p>}
            {[...groups].map(([source, list]) => (
              <section key={source} className="flex flex-col gap-1" aria-label={SOURCE_LABEL[source]}>
                <h3 className="font-medium">
                  {SOURCE_LABEL[source]} <span className="text-ink-muted">({list.length})</span>
                </h3>
                <ul className="flex flex-col gap-1">
                  {list.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-sunken p-2">
                      <span className="min-w-0 flex-1">
                        {item.summary}
                        <button type="button" className="ml-2 text-xs text-accent underline" onClick={() => go(item)}>
                          {item.lands.label} →
                        </button>
                      </span>
                      {item.accept ? (
                        <Button variant="ghost" aria-label={`Accept ${item.summary}`} disabled={busy} onClick={() => void run(item.accept!)}>
                          Accept
                        </Button>
                      ) : (
                        <span className="text-xs text-ink-muted">{item.note}</span>
                      )}
                      <Button variant="ghost" aria-label={`Reject ${item.summary}`} disabled={busy} onClick={() => void run(item.reject)}>
                        Reject
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
