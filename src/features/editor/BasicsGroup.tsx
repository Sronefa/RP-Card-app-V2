import { useEffect, useState } from "react";
import { toast } from "../../components/toast";
import { Button, TextInput } from "../../components/ui";
import { useEditor } from "../../editor/store";
import { pickFiles, toPng } from "../../lib/files";
import { ImagePromptDialog } from "../images/ImagePromptDialog";
import { CardAvatar } from "../library/CardTile";

export function BasicsGroup() {
  const record = useEditor((s) => s.record!);
  const { setField, setKind, setImage } = useEditor();
  const d = record.card.data;
  // Tags are edited as text so typing a trailing comma doesn't get eaten.
  const [tagText, setTagText] = useState(d.tags.join(", "));
  const [prompting, setPrompting] = useState(false);
  useEffect(() => {
    // Follow undo/redo and other outside changes.
    if (parseTags(tagText).join("\n") !== d.tags.join("\n")) setTagText(d.tags.join(", "));
  }, [d.tags]);

  async function pickAvatar() {
    const [file] = await pickFiles("image/*");
    if (!file) return;
    try {
      setImage(await toPng(file));
    } catch (e) {
      toast(`Couldn't use that image: ${(e as Error).message}`, "error");
    }
  }

  const row = (label: string, input: React.ReactNode, help?: string) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      {help && <span className="text-xs text-ink-muted">{help}</span>}
      {input}
    </label>
  );

  return (
    <>
      <div className="flex items-center gap-4">
        <CardAvatar record={record} className="size-24" />
        <div className="flex flex-col gap-2">
          <Button onClick={() => void pickAvatar()}>{record.image ? "Change image" : "Add image"}</Button>
          <Button variant="ghost" className="text-accent" onClick={() => setPrompting(true)}>
            ✦ Image prompt
          </Button>
          <p className="text-xs text-ink-muted">Becomes the PNG you export.</p>
        </div>
      </div>
      {prompting && <ImagePromptDialog onClose={() => setPrompting(false)} />}

      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Card type</span>
        <div role="radiogroup" className="flex gap-2">
          {(["character", "world"] as const).map((k) => (
            <Button
              key={k}
              role="radio"
              aria-checked={record.kind === k}
              variant={record.kind === k ? "primary" : "secondary"}
              onClick={() => setKind(k)}
            >
              {k === "world" ? "World" : "Character"}
            </Button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">
          A world card makes the world itself the character: it narrates and plays the NPCs.
        </span>
      </div>

      {row("Name", <TextInput value={d.name} onChange={(e) => setField("name", e.target.value)} />)}
      {row(
        "Nickname",
        <TextInput value={d.nickname ?? ""} onChange={(e) => setField("nickname", e.target.value || undefined)} />,
        "Used for {{char}} instead of the name, if set.",
      )}
      {row(
        "Tags",
        <TextInput
          value={tagText}
          placeholder="fantasy, mystery, slow burn"
          onChange={(e) => {
            setTagText(e.target.value);
            setField("tags", parseTags(e.target.value));
          }}
        />,
        "Separate tags with commas.",
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {row("Creator", <TextInput value={d.creator} onChange={(e) => setField("creator", e.target.value)} />)}
        {row(
          "Version",
          <TextInput value={d.character_version} onChange={(e) => setField("character_version", e.target.value)} />,
        )}
      </div>
      {d.creation_date && (
        <p className="text-xs text-ink-muted">
          Created {new Date(d.creation_date * 1000).toLocaleDateString()}
          {d.modification_date ? ` · modified ${new Date(d.modification_date * 1000).toLocaleString()}` : ""}
        </p>
      )}
    </>
  );
}

const parseTags = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);
