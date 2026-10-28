import { useEffect, useState } from "react";
import { scanGaps } from "../../app/handoff";
import { readEngine } from "../../engine/sheet";
import { acceptAll, collectInbox, rejectAll, SOURCE_LABEL, useInboxVersion, type InboxItem, type InboxSource } from "../../app/inbox";
import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog } from "../../components/ui";
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
  const record = useEditor((s) => s.record);
  const engineOn = !!record && !!readEngine(record.card.data);
  const [editing, setEditing] = useState<{ key: string; text: string }>();
  const scan = () =>
    run(async () => {
      if (!record) return;
      const out = await scanGaps(record.id, record.card.data);
      const n = out.filed.length;
      toast(
        out.found === 0
          ? "No gaps: the card and the engine match."
          : `${n ? `${n} new ${n === 1 ? "task" : "tasks"} to approve` : "Nothing new"}${out.skipped ? `; ${out.skipped} you dismissed or started before ${out.skipped === 1 ? "isn't" : "aren't"} listed again` : ""}.`,
      );
    });
  const groups = new Map<InboxSource, InboxItem[]>();
  for (const item of items) groups.set(item.source, [...(groups.get(item.source) ?? []), item]);
  const acceptable = items.filter((i) => i.accept).length;

  return (
    <Dialog open={open} title="Inbox" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        {engineOn && (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void scan()}>
              Find gaps between card and engine
            </Button>
            <span className="text-xs text-ink-muted">NPCs without contacts, values without rules, screens without words: each becomes a task to approve.</span>
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-ink-muted">Nothing is waiting. Proposals from the co-writer, the UI engineer, the Game Wizard, bulk items and the Image Studio show up here, and so do the tasks the co-writer and the engineer hand each other.</p>
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
                        {item.detail && <span className="block text-xs text-ink-muted">{item.detail}</span>}
                      </span>
                      {item.edit && (
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${item.summary}`}
                          disabled={busy}
                          onClick={() => setEditing(editing?.key === item.key ? undefined : { key: item.key, text: item.edit!.text })}
                        >
                          Edit
                        </Button>
                      )}
                      {item.accept ? (
                        <Button variant="ghost" aria-label={`${item.edit ? "Approve" : "Accept"} ${item.summary}`} disabled={busy} onClick={() => void run(item.accept!)}>
                          {item.edit ? "Approve" : "Accept"}
                        </Button>
                      ) : (
                        <span className="text-xs text-ink-muted">{item.note}</span>
                      )}
                      <Button variant="ghost" aria-label={`${item.edit ? "Dismiss" : "Reject"} ${item.summary}`} disabled={busy} onClick={() => void run(item.reject)}>
                        {item.edit ? "Dismiss" : "Reject"}
                      </Button>
                      {editing?.key === item.key && item.edit && (
                        <div className="flex w-full flex-col gap-2">
                          <AutoTextarea aria-label={`Brief for ${item.summary}`} value={editing.text} onChange={(e) => setEditing({ key: item.key, text: e.target.value })} />
                          <Button
                            className="self-start"
                            disabled={busy || !editing.text.trim()}
                            onClick={() => void run(() => item.edit!.save(editing.text.trim()), "Brief saved").then(() => setEditing(undefined))}
                          >
                            Save the brief
                          </Button>
                        </div>
                      )}
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
