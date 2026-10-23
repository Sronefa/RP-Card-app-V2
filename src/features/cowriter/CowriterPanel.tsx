import { useEffect, useState } from "react";
import { useUi, type CowriterTab } from "../../app/store";
import { resolveModel, useAiSettings } from "../../ai/settings";
import { Button } from "../../components/ui";
import { useCowriter } from "../../cowriter/store";
import { useEditor } from "../../editor/store";
import { ChatView } from "./ChatView";
import { InterviewPanel } from "./InterviewPanel";
import { ProjectStyleDialog } from "./ProjectStyleDialog";

const STARTERS = [
  "Tighten the description and put the most important facts first",
  "Write two more alternate greetings with different openings",
  "Add example dialogues that show the voice",
  "Suggest lorebook entries for this card",
  "Find contradictions and weak spots",
];

const TABS: { id: CowriterTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "interview", label: "Interview" },
];

export function CowriterPanel() {
  const record = useEditor((s) => s.record);
  const { busy, chat, clear, critique } = useCowriter();
  const { settings, load: loadSettings } = useAiSettings();
  const { setSection, cowriterTab: tab, setCowriterTab: setTab } = useUi();
  const [styling, setStyling] = useState(false);

  useEffect(() => void loadSettings(), [loadSettings]);

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

  const messageCount = chat?.messages.length ?? 0;
  return (
    <Shell
      detail={`${resolved.config.name} · ${resolved.choice.model}`}
      actions={
        <>
          <Button variant="ghost" onClick={() => setStyling(true)}>
            Style
          </Button>
          {tab === "chat" && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void critique()}>
                Critic
              </Button>
              <Button variant="ghost" disabled={busy || messageCount === 0} onClick={() => void clear()}>
                Clear
              </Button>
            </>
          )}
        </>
      }
    >
      <div role="tablist" aria-label="Co-writer" className="flex rounded-lg border border-border p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-9 flex-1 rounded-md px-2 text-sm ${tab === t.id ? "bg-accent/15 text-accent" : "text-ink-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "chat" ? (
        <ChatView
          store={useCowriter}
          starters={STARTERS}
          intro="Tell me what to change, or pick a starting point. I edit the card through proposals you accept or reject."
          empty={
            <Button className="self-start" onClick={() => setTab("interview")}>
              Start from scratch with an interview
            </Button>
          }
        />
      ) : (
        <InterviewPanel />
      )}
      <ProjectStyleDialog projectId={record.projectId} open={styling} onClose={() => setStyling(false)} />
    </Shell>
  );
}

function Shell({
  detail,
  actions,
  children,
}: {
  detail?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
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
