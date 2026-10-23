import { useEffect, useRef } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { AutoTextarea, Button } from "../../components/ui";
import type { ChatState } from "../../cowriter/store";
import { useEditor } from "../../editor/store";
import { ProposalCard } from "./ProposalCard";

/**
 * A co-writer conversation: messages, the proposals in them, and the message box.
 * Used for the main chat and for the lorebook brainstorm.
 */
export function ChatView({
  store,
  starters,
  intro,
  empty,
  moreLikeThis = false,
}: {
  store: UseBoundStore<StoreApi<ChatState>>;
  starters: string[];
  intro: string;
  /** Shown under the starters while the chat is empty. */
  empty?: React.ReactNode;
  /** Offer "More like this" on pitched lorebook entries. */
  moreLikeThis?: boolean;
}) {
  const record = useEditor((s) => s.record);
  const { chat, busy, streaming, error, draft, setDraft, load, send, stop, decide, acceptAll } = store();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (record) void load(record.id);
  }, [record?.id, load]);

  const messageCount = chat?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messageCount, streaming, busy]);

  if (!record) return null;

  const proposals = new Map(chat?.proposals.map((p) => [p.id, p]));
  const pending = chat?.proposals.filter((p) => p.status === "pending" && p.call.name !== "pitch").length ?? 0;

  function submit(text = draft) {
    const request = text.trim();
    if (!request || busy) return;
    setDraft("");
    void send(request);
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-3">
        {messageCount === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">{intro}</p>
            {starters.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-muted hover:border-ink-muted hover:text-ink"
              >
                {s}
              </button>
            ))}
            {empty}
          </div>
        )}
        {chat?.messages.map((m, i) => {
          if (m.role === "user")
            return (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-sm whitespace-pre-wrap"
              >
                {m.display ?? m.text}
              </div>
            );
          if (m.role === "tool") return null;
          return (
            <div key={i} className="flex flex-col gap-2">
              {m.text && <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</div>}
              {m.toolCalls.map((call) => {
                const p = proposals.get(call.id);
                return p ? (
                  <ProposalCard
                    key={call.id}
                    proposal={p}
                    data={record.card.data}
                    onDecide={(accept) => {
                      decide(p.id, accept);
                      if (accept && p.call.name === "pitch")
                        void send(`Use idea ${p.number} ("${String(p.call.input.title)}"). Work it into the card.`);
                    }}
                    onMore={
                      moreLikeThis && p.call.name === "add_lore_entry" && !busy
                        ? () => void send(`More like edit ${p.number} ("${String(p.call.input.title)}").`)
                        : undefined
                    }
                  />
                ) : null;
              })}
            </div>
          );
        })}
        {busy && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-ink-muted" aria-live="polite">
            {streaming || "Thinking…"}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-surface-sunken px-4 pt-3 pb-3">
        {pending > 1 && (
          <Button className="self-start" onClick={acceptAll}>
            Accept all {pending} edits
          </Button>
        )}
        <div className="flex items-end gap-2">
          <AutoTextarea
            aria-label="Message to the co-writer"
            rows={1}
            value={draft}
            placeholder="Ask for a change…"
            className="max-h-40 min-h-10 overflow-y-auto"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; Shift+Enter is a new line. Phones use the button.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                window.matchMedia("(pointer: fine)").matches
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <Button onClick={stop}>Stop</Button>
          ) : (
            <Button variant="primary" disabled={!draft.trim()} onClick={() => submit()}>
              Send
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
