import { useEffect } from "react";
import { useUi } from "../../app/store";
import { resolveModel, useAiSettings } from "../../ai/settings";
import { Button } from "../../components/ui";
import { useLoreChat } from "../../cowriter/store";
import { ChatView } from "../cowriter/ChatView";

const STARTERS = [
  "Pitch places worth having entries for",
  "Pitch people and NPCs",
  "Pitch factions and what they fight over",
  "Pitch secrets that unlock through play",
  "Check the entries for contradictions and weak keys",
];

/** The lorebook brainstorm: the co-writer pitches entries one at a time. */
export function LoreBrainstorm() {
  const { settings, load } = useAiSettings();
  const setSection = useUi((s) => s.setSection);
  const { chat, busy, clear } = useLoreChat();
  useEffect(() => void load(), [load]);

  if (!resolveModel(settings, "lore"))
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">Connect a model in Settings to brainstorm entries with the co-writer.</p>
        <Button variant="primary" className="self-start" onClick={() => setSection("settings")}>
          Set up a model
        </Button>
      </div>
    );

  return (
    <div className="flex flex-1 flex-col gap-3">
      {(chat?.messages.length ?? 0) > 0 && (
        <Button variant="ghost" className="self-end" disabled={busy} onClick={() => void clear()}>
          Clear brainstorm
        </Button>
      )}
      <ChatView
        store={useLoreChat}
        starters={STARTERS}
        intro="I pitch entries one or two at a time, each checked against the card and the entries you have. Accept, reject, tell me how to change one, or ask for more like it."
        moreLikeThis
      />
    </div>
  );
}
