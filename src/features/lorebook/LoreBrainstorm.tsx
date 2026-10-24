import { useEffect, useState } from "react";
import { useUi } from "../../app/store";
import { bringInRequest, cardContext } from "../../ai/prompts";
import { resolveModel, useAiSettings } from "../../ai/settings";
import { importCard, type CardDataV3 } from "../../card";
import { toast } from "../../components/toast";
import { Button, Dialog } from "../../components/ui";
import { useLoreChat } from "../../cowriter/store";
import { listCards, type CardRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { pickFiles, readFileBytes } from "../../lib/files";
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
  const { chat, busy, clear, send } = useLoreChat();
  const record = useEditor((s) => s.record);
  const [choosing, setChoosing] = useState(false);

  function bringIn(data: CardDataV3) {
    setChoosing(false);
    void send(bringInRequest(cardContext(data, "character")), `Bring ${data.name} into this world`);
  }
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
      {record?.kind === "world" && (
        <Button className="self-start" disabled={busy} onClick={() => setChoosing(true)}>
          Bring in a character
        </Button>
      )}
      {choosing && record && <CharacterPicker projectId={record.projectId} onPick={bringIn} onClose={() => setChoosing(false)} />}
      <ChatView
        store={useLoreChat}
        starters={STARTERS}
        intro="I pitch entries one or two at a time, each checked against the card and the entries you have. Accept, reject, tell me how to change one, or ask for more like it."
        moreLikeThis
      />
    </div>
  );
}

/** Picks a character card to bring into the world: one from the project, or a card file. */
function CharacterPicker({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  onPick: (data: CardDataV3) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<CardRecord[]>();
  useEffect(() => void listCards(projectId).then((all) => setCards(all.filter((c) => c.kind === "character"))), [projectId]);

  async function fromFile() {
    const [file] = await pickFiles(".png,.json,.charx,image/png,application/json");
    if (!file) return;
    try {
      onPick(importCard(await readFileBytes(file)).card.data);
    } catch (e) {
      toast(`Couldn't read ${file.name}: ${(e as Error).message}`, "error");
    }
  }

  return (
    <Dialog open title="Bring in a character" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">
          The co-writer suggests how they fit into this world and pitches lorebook entries for them. Nothing changes until
          you accept it, and the character card itself stays as it is.
        </p>
        {cards?.map((c) => (
          <Button key={c.id} onClick={() => onPick(c.card.data)}>
            {c.card.data.name}
          </Button>
        ))}
        {cards?.length === 0 && <p className="text-sm text-ink-muted">No character cards in this project.</p>}
        <Button variant="ghost" onClick={() => void fromFile()}>
          From a card file…
        </Button>
      </div>
    </Dialog>
  );
}
