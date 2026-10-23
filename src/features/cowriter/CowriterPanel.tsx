import { useEffect, useRef, useState } from "react";
import { useUi } from "../../app/store";
import { resolveModel, useAiSettings } from "../../ai/settings";
import { AutoTextarea, Button } from "../../components/ui";
import { useCowriter } from "../../cowriter/store";
import { useEditor } from "../../editor/store";
import { ProjectStyleDialog } from "./ProjectStyleDialog";
import { ProposalCard } from "./ProposalCard";

const STARTERS = [
  "Tighten the description and put the most important facts first",
  "Write two more alternate greetings with different openings",
  "Add example dialogues that show the voice",
  "Suggest lorebook entries for this card",
  "Find contradictions and weak spots",
];

export function CowriterPanel() {
  const record = useEditor((s) => s.record);
  const { chat, busy, streaming, error, draft, setDraft, load, send, stop, decide, acceptAll, clear } = useCowriter();
  const { settings, load: loadSettings } = useAiSettings();
  const setSection = useUi((s) => s.setSection);
  const [styling, setStyling] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => void loadSettings(), [loadSettings]);
  useEffect(() => {
    if (record) void load(record.id);
  }, [record?.id, load]);

  const messageCount = chat?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messageCount, streaming, busy]);

  const resolved = resolveModel(settings, "refine");

  if (!record) {
    return (
      <Shell>
        <p className="text-sm text-ink-muted">Open a card to work on it with the co-writer.</p>
      </Shell>
    );
  }
  if (!resolved) {
    return (
      <Shell>
        <p className="text-sm text-ink-muted">
          Connect Claude or an OpenAI-compatible service such as NanoGPT with your API key, then pick a model.
        </p>
        <Button variant="primary" className="self-start" onClick={() => setSection("settings")}>
          Set up a model
        </Button>
      </Shell>
    );
  }

  const proposals = new Map(chat?.proposals.map((p) => [p.id, p]));
  const pending = chat?.proposals.filter((p) => p.status === "pending" && p.call.name !== "pitch").length ?? 0;

  function submit(text = draft) {
    const request = text.trim();
    if (!request || busy) return;
    setDraft("");
    void send(request);
  }

  return (
    <Shell
      detail={`${resolved.config.name} · ${resolved.choice.model}`}
      actions={
        <>
          <Button variant="ghost" onClick={() => setStyling(true)}>
            Style
          </Button>
          <Button variant="ghost" disabled={busy || messageCount === 0} onClick={() => void clear()}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-3">
        {messageCount === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">
              Tell me what to change, or pick a starting point. I edit the card through proposals you accept or reject.
            </p>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-muted hover:border-ink-muted hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {chat?.messages.map((m, i) => {
          if (m.role === "user")
            return (
              <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-sm whitespace-pre-wrap">
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
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
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
      <ProjectStyleDialog projectId={record.projectId} open={styling} onClose={() => setStyling(false)} />
    </Shell>
  );
}

function Shell({ detail, actions, children }: { detail?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pt-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Co-writer</h2>
          {detail && <p className="truncate text-xs text-ink-muted">{detail}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
