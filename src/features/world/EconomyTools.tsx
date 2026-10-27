import { useState } from "react";
import { ASK_QUESTIONS, pitchWorldTool, readQuestions, readWorldPitches } from "../../ai/interviewTools";
import {
  answersText,
  bulkItemsRequest,
  currencyKickoff,
  currencyWriteRequest,
  ITEM_PRICES,
  ITEM_QUALITIES,
  ITEM_RARITIES,
  systemPrompt,
  type BulkItemSettings,
} from "../../ai/prompts";
import type { InterviewRound, Question } from "../../ai/records";
import { AutoTextarea, Button, Dialog, TextInput } from "../../components/ui";
import { complete, gatherContext, partsText } from "../../cowriter/engine";
import type { CardRecord } from "../../db/db";
import { KINDS } from "../../editor/world";
import { BrainstormDialog } from "../cowriter/BrainstormDialog";
import { QuestionCard } from "../cowriter/QuestionCard";
import { useRun } from "../cowriter/useRun";

const selectClass = "min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm";
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A short interview on the economy and the coin, then the currency to save. */
export function CurrencyInterview({
  record,
  onClose,
  onSave,
}: {
  record: CardRecord;
  onClose: () => void;
  onSave: (fields: Record<string, string>) => void;
}) {
  const [idea, setIdea] = useState("");
  const [round, setRound] = useState<InterviewRound>();
  const [currency, setCurrency] = useState<Record<string, string>>();
  const [brainstorm, setBrainstorm] = useState<Question>();
  const { busy, run, status } = useRun();

  const start = () =>
    run("Preparing questions…", async (signal) => {
      const parts = await gatherContext(record);
      const result = await complete("world", {
        system: systemPrompt("world"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${currencyKickoff(idea)}` }],
        tools: [ASK_QUESTIONS],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === ASK_QUESTIONS.name);
      const questions = call ? readQuestions(call) : [];
      if (!questions.length)
        throw new Error("The co-writer didn't ask any questions. Try again, or pick another model.");
      setRound({ callId: call!.id, questions, answers: {}, submitted: false });
    });

  const write = () =>
    run("Writing the currency…", async (signal) => {
      const tool = pitchWorldTool("currency");
      const parts = await gatherContext(record);
      const result = await complete("world", {
        system: systemPrompt("world"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${currencyWriteRequest(answersText(round!))}` }],
        tools: [tool],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === tool.name);
      const [written] = call ? readWorldPitches(call, "currency") : [];
      if (!written) throw new Error("The co-writer didn't write the currency. Try again.");
      setCurrency(written);
    });

  return (
    <Dialog open title="Build the currency" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {currency ? (
          <>
            {KINDS.currency.fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                {f.label}
                <AutoTextarea
                  rows={1}
                  value={currency[f.key] ?? ""}
                  onChange={(e) => setCurrency({ ...currency, [f.key]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={!!busy} onClick={() => void write()}>
                Write it again
              </Button>
              <Button variant="primary" disabled={!currency.name?.trim() || !!busy} onClick={() => onSave(currency)}>
                Use this currency
              </Button>
            </div>
          </>
        ) : round ? (
          <>
            {round.questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                answer={round.answers[q.id] ?? ""}
                onAnswer={(a) => setRound({ ...round, answers: { ...round.answers, [q.id]: a } })}
                onBrainstorm={() => setBrainstorm(q)}
              />
            ))}
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void write()}>
              Write the currency
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              A few questions on the coin and how money works here, with answers you can tap. The co-writer then writes
              the currency with concrete prices.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Your idea, if you have one
              <AutoTextarea
                rows={2}
                value={idea}
                placeholder="e.g. square iron coins, and debt matters more than cash"
                onChange={(e) => setIdea(e.target.value)}
              />
            </label>
            <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void start()}>
              Start
            </Button>
          </>
        )}
        {status}
      </div>
      {brainstorm && round && (
        <BrainstormDialog
          key={brainstorm.id}
          question={brainstorm}
          known={answersText({ ...round, questions: round.questions.filter((q) => round.answers[q.id]?.trim()) })}
          onUse={(a) => setRound({ ...round, answers: { ...round.answers, [brainstorm.id]: a } })}
          onClose={() => setBrainstorm(undefined)}
        />
      )}
    </Dialog>
  );
}

const DEFAULT_BULK: BulkItemSettings = {
  what: "",
  count: 5,
  price: "average",
  quality: "average",
  rarity: "common",
  service: false,
  shop: "",
  notes: "",
};

/** Makes a batch of items or services to the user's settings, to pick from. */
export function BulkItems({
  record,
  existing,
  shops,
  onClose,
  onAdd,
  onPark,
}: {
  record: CardRecord;
  existing: string[];
  shops: string[];
  onClose: () => void;
  onAdd: (items: Record<string, string>[]) => void;
  /** Keeps the picked items in the inbox to decide later. */
  onPark: (items: Record<string, string>[]) => void;
}) {
  const [o, setO] = useState<BulkItemSettings>(DEFAULT_BULK);
  const [items, setItems] = useState<Record<string, string>[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { busy, run, status } = useRun();
  const set = (patch: Partial<BulkItemSettings>) => setO({ ...o, ...patch });

  const make = () =>
    run(`Making ${o.count} ${o.service ? "services" : "items"}…`, async (signal) => {
      const tool = pitchWorldTool("item");
      const parts = await gatherContext(record);
      const result = await complete("world", {
        system: systemPrompt("world"),
        messages: [{ role: "user", text: `${partsText(parts)}\n\n${bulkItemsRequest(o, existing)}` }],
        tools: [tool],
        signal,
      });
      const call = result.toolCalls.find((c) => c.name === tool.name);
      const next = call ? readWorldPitches(call, "item") : [];
      if (!next.length) throw new Error("The co-writer didn't make any items. Try again.");
      setItems(next);
      setPicked(new Set(next.map((_, i) => i)));
    });

  const choice = <T extends string>(label: string, value: T, values: readonly T[], onChange: (v: T) => void) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {capital(v)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog open title="Make items in bulk" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          What to make
          <TextInput value={o.what} placeholder="e.g. healing items" onChange={(e) => set({ what: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            How many
            <TextInput
              type="number"
              min={1}
              max={20}
              inputMode="numeric"
              value={o.count}
              onChange={(e) => set({ count: Math.min(20, Math.max(1, Math.round(Number(e.target.value)) || 1)) })}
            />
          </label>
          {choice("Price", o.price, ITEM_PRICES, (price) => set({ price }))}
          {choice("Quality", o.quality, ITEM_QUALITIES, (quality) => set({ quality }))}
          {choice("Rarity", o.rarity, ITEM_RARITIES, (rarity) => set({ rarity }))}
          <label className="flex flex-col gap-1 text-sm">
            Item or service
            <select
              className={selectClass}
              value={o.service ? "service" : "item"}
              onChange={(e) => set({ service: e.target.value === "service" })}
            >
              <option value="item">Items</option>
              <option value="service">Services</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Sold at
            <TextInput
              list="bulk-shops"
              value={o.shop}
              placeholder="Any"
              onChange={(e) => set({ shop: e.target.value })}
            />
            <datalist id="bulk-shops">
              {shops.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Anything else
          <TextInput
            value={o.notes}
            placeholder="Optional, e.g. herbal, no magic"
            onChange={(e) => set({ notes: e.target.value })}
          />
        </label>
        <Button variant="primary" className="self-start" disabled={!!busy} onClick={() => void make()}>
          {items.length ? "✦ Make another batch" : `✦ Make ${o.count}`}
        </Button>
        {status}
        {items.length > 0 && (
          <>
            <ul className="flex flex-col gap-2">
              {items.map((it, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2 rounded-lg bg-surface-sunken p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={picked.has(i)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setPicked(next);
                      }}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span>
                        <span className="font-medium">{it.name}</span>
                        {it.price && <span className="text-ink-muted"> · {it.price}</span>}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {[it.quality, it.rarity, it.category, it.type === "service" && "service"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {it.effect && <span className="text-ink-muted">{it.effect}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={picked.size === 0} onClick={() => onPark(items.filter((_, i) => picked.has(i)))}>
                Decide later
              </Button>
              <Button variant="primary" disabled={picked.size === 0} onClick={() => onAdd(items.filter((_, i) => picked.has(i)))}>
                Add {picked.size} to the page
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
