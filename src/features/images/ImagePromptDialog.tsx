import { useEffect, useRef, useState } from "react";
import { readImagePrompt, WRITE_IMAGE_PROMPT } from "../../ai/interviewTools";
import { FRAMINGS, imagePromptRequest, systemPrompt, type Framing } from "../../ai/prompts";
import { useAiSettings } from "../../ai/settings";
import { toast } from "../../components/toast";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { complete, isAbort, projectSettings } from "../../cowriter/engine";
import { listCards, type CardRecord } from "../../db/db";
import { entryTitle } from "../../editor/lorebook";
import { useEditor } from "../../editor/store";

interface Subject {
  id: string;
  label: string;
  /** What the subject is, from the card or lorebook. */
  text: string;
  /** The world it lives in, for backgrounds and clothing. */
  setting?: string;
  framing: Framing;
}

const cardText = (c: CardRecord) =>
  [`${c.card.data.name}`, c.card.data.description, c.kind === "world" && c.card.data.scenario].filter(Boolean).join("\n\n");

/** The card, the other cards in its project, and lorebook entries, as things to draw. */
function subjects(record: CardRecord, others: CardRecord[]): Subject[] {
  const world = record.kind === "world" ? record : others.find((c) => c.kind === "world");
  const setting = world ? cardText(world) : undefined;
  const asSubject = (c: CardRecord): Subject => ({
    id: `card:${c.id}`,
    label: c.kind === "world" ? `The world: ${c.card.data.name}` : c.card.data.name,
    text: cardText(c),
    setting: c.kind === "world" ? undefined : setting,
    framing: c.kind === "world" ? "landscape" : "portrait",
  });
  const books = [record, ...(world && world !== record ? [world] : [])];
  return [
    asSubject(record),
    ...others.filter((c) => c.id !== record.id).map(asSubject),
    ...books.flatMap((c) =>
      (c.card.data.character_book?.entries ?? [])
        .filter((e) => e.content.trim())
        .map(
          (e): Subject => ({
            id: `lore:${c.id}:${String(e.id)}`,
            label: `Lorebook: ${entryTitle(e)}`,
            text: `${entryTitle(e)}\n\n${e.content}`,
            setting,
            framing: "scene",
          }),
        ),
    ),
  ];
}

/** Writes prompts for image generators from the card, in the user's saved styles. */
export function ImagePromptDialog({ onClose }: { onClose: () => void }) {
  const record = useEditor((s) => s.record)!;
  const { settings, load } = useAiSettings();
  const [list, setList] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [framing, setFraming] = useState<Framing>("portrait");
  const [instructions, setInstructions] = useState("");
  const [results, setResults] = useState<{ positive: string; negative: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    void listCards(record.projectId).then((cards) => {
      const all = subjects(record, cards);
      setList(all);
      setSubjectId(all[0].id);
      setFraming(all[0].framing);
    });
    return () => controller.current?.abort();
    // Built once when the dialog opens.
  }, []);

  const styles = settings.imageStyles;
  const style = styles.find((s) => s.id === styleId) ?? styles[0];
  const subject = list.find((s) => s.id === subjectId);

  async function generate() {
    if (!subject || !style) return;
    setBusy(true);
    setError(undefined);
    controller.current = new AbortController();
    try {
      const { settings: cw } = await projectSettings(record.projectId);
      const result = await complete("image", {
        system: systemPrompt("image"),
        messages: [
          {
            role: "user",
            text: imagePromptRequest({
              subject: subject.text,
              setting: subject.setting,
              contentMode: cw.contentMode,
              style,
              framing,
              instructions,
            }),
          },
        ],
        tools: [WRITE_IMAGE_PROMPT],
        signal: controller.current.signal,
      });
      const call = result.toolCalls.find((c) => c.name === WRITE_IMAGE_PROMPT.name);
      const prompt = call ? readImagePrompt(call) : { positive: result.text.trim(), negative: "" };
      if (!prompt.positive) throw new Error("The co-writer didn't write a prompt. Try again.");
      setResults((r) => [prompt, ...r]);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const select = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";
  return (
    <Dialog open title="Image prompt" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          What to draw
          <select
            className={select}
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              const next = list.find((s) => s.id === e.target.value);
              if (next) setFraming(next.framing);
            }}
          >
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Style
            <select className={select} value={style?.id ?? ""} onChange={(e) => setStyleId(e.target.value)}>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Framing
            <select className={select} value={framing} onChange={(e) => setFraming(e.target.value as Framing)}>
              {Object.keys(FRAMINGS).map((f) => (
                <option key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {styles.length === 0 && <p className="text-sm text-ink-muted">Add an image style in Settings first.</p>}
        <label className="flex flex-col gap-1 text-sm">
          Anything else
          <TextInput
            value={instructions}
            placeholder="e.g. at night, in her armour, smiling"
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy || !subject || !style} onClick={() => void generate()}>
            {results.length ? "Write another" : "Write the prompt"}
          </Button>
          {busy && (
            <Button variant="ghost" onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          )}
        </div>
        {busy && (
          <p className="text-sm text-ink-muted" aria-live="polite">
            Writing the prompt…
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {results.map((r, i) => (
          <div key={results.length - i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <PromptBox label="Prompt" text={r.positive} />
            {r.negative && <PromptBox label="Negative prompt" text={r.negative} />}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function PromptBox({ label, text }: { label: string; text: string }) {
  const [value, setValue] = useState(text);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <Button
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(
              () => toast(`${label} copied`),
              () => toast("Couldn't copy. Select the text and copy it instead.", "error"),
            )
          }
        >
          Copy
        </Button>
      </div>
      <AutoTextarea aria-label={label} value={value} className="text-sm" onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}
