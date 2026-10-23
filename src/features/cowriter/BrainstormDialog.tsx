import { useEffect, useRef, useState } from "react";
import { BRAINSTORM_TOOLS, readIdeas } from "../../ai/interviewTools";
import { brainstormKickoff, settingsContext, systemPrompt } from "../../ai/prompts";
import type { Question } from "../../ai/records";
import type { ChatMessage } from "../../ai/types";
import { AutoTextarea, Button, Dialog } from "../../components/ui";
import { complete, isAbort, projectSettings } from "../../cowriter/engine";

/**
 * A mini session for one interview question: the co-writer pitches answers, riffs on the ones
 * the user likes, combines them, and writes up the final answer.
 */
export function BrainstormDialog({
  question,
  projectId,
  known,
  onUse,
  onClose,
}: {
  question: Question;
  projectId: string;
  /** What the interview has settled so far. */
  known: string;
  onUse: (answer: string) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const controller = useRef<AbortController>(undefined);

  async function send(text: string, history = messages) {
    const last = history.at(-1);
    const next: ChatMessage[] = [
      ...history,
      // Ideas the model pitched were shown; that is the result of its tool calls.
      ...(last?.role === "assistant" && last.toolCalls.length
        ? [{ role: "tool" as const, results: last.toolCalls.map((c) => ({ id: c.id, content: "Shown to the user." })) }]
        : []),
      { role: "user", text },
    ];
    setMessages(next);
    setBusy(true);
    setError(undefined);
    setPicked([]);
    controller.current = new AbortController();
    try {
      const result = await complete("suggest", {
        system: systemPrompt("suggest"),
        messages: next,
        tools: BRAINSTORM_TOOLS,
        signal: controller.current.signal,
      });
      setMessages([...next, { role: "assistant", text: result.text, toolCalls: result.toolCalls, raw: result.raw }]);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void projectSettings(projectId).then(({ settings, presets }) => {
      if (cancelled) return;
      const context = [settingsContext(settings, presets), known].filter(Boolean).join("\n\n");
      void send(brainstormKickoff(question.question, question.suggestions, context), []);
    });
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
    // Runs once per dialog; the dialog is remounted for each question.
  }, []);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send(text);
  }

  const ideas = messages.flatMap((m, i) =>
    m.role === "assistant"
      ? m.toolCalls.flatMap((c) =>
          readIdeas(c).map((idea, j) => ({ ...idea, key: `${i}-${c.id}-${j}`, final: c.name === "final_answer" })),
        )
      : [],
  );
  const latest = messages.map((m) => m.role).lastIndexOf("assistant");

  return (
    <Dialog open title="Brainstorm" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{question.question}</p>
        {messages.map((m, i) => {
          if (m.role === "user" && i > 0)
            return (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-sm whitespace-pre-wrap"
              >
                {m.text}
              </div>
            );
          if (m.role !== "assistant") return null;
          return (
            <div key={i} className={`flex flex-col gap-2 ${i < latest ? "opacity-70" : ""}`}>
              {m.text && <p className="text-sm whitespace-pre-wrap">{m.text}</p>}
              {ideas
                .filter((idea) => idea.key.startsWith(`${i}-`))
                .map((idea) => (
                  <div
                    key={idea.key}
                    className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${idea.final ? "border-accent bg-accent/10" : "border-border"}`}
                  >
                    <label className="flex items-start gap-2">
                      {!idea.final && (
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          aria-label={`Pick ${idea.title}`}
                          checked={picked.includes(idea.key)}
                          onChange={(e) =>
                            setPicked(e.target.checked ? [...picked, idea.key] : picked.filter((k) => k !== idea.key))
                          }
                        />
                      )}
                      <span className="flex flex-col gap-1">
                        <span className="font-medium">{idea.title}</span>
                        <span className="whitespace-pre-wrap text-ink-muted">{idea.answer}</span>
                      </span>
                    </label>
                    <div className="flex justify-end gap-2">
                      {!idea.final && (
                        <Button variant="ghost" disabled={busy} onClick={() => void send(`More like "${idea.title}".`)}>
                          Riff on it
                        </Button>
                      )}
                      <Button
                        variant={idea.final ? "primary" : "secondary"}
                        onClick={() => {
                          onUse(idea.answer);
                          onClose();
                        }}
                      >
                        Use this
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          );
        })}
        {busy && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            Thinking of ideas…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {picked.length > 1 && (
          <Button
            className="self-start"
            disabled={busy}
            onClick={() => {
              const titles = ideas.filter((i) => picked.includes(i.key)).map((i) => `"${i.title}"`);
              void send(`Combine ${titles.join(" and ")} into one answer.`);
            }}
          >
            Combine {picked.length} picked
          </Button>
        )}
        <div className="flex items-end gap-2">
          <AutoTextarea
            aria-label="Message to the brainstorm"
            rows={1}
            value={input}
            placeholder="Steer it: darker, funnier, mix two…"
            className="max-h-32 min-h-10"
            onChange={(e) => setInput(e.target.value)}
          />
          <Button variant="primary" disabled={busy || !input.trim()} onClick={submit}>
            Send
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
