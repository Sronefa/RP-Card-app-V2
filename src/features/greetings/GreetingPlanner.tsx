import { readEngine } from "../../engine/sheet";
import { useEffect, useRef, useState } from "react";
import { readGreetingTags, SORT_GREETINGS } from "../../ai/interviewTools";
import { greetingFillRequest, greetingSortRequest, systemPrompt } from "../../ai/prompts";
import { Button, Dialog, TextInput } from "../../components/ui";
import { FromLibrary, SaveToLibrary } from "../library/LibraryButtons";
import { askCowriter } from "../../cowriter/ask";
import { complete, isAbort } from "../../cowriter/engine";
import {
  allGreetings,
  applyTags,
  gaps,
  inCell,
  loadPlan,
  placeGreetings,
  savePlan,
  type GreetingPlan,
} from "../../cowriter/greetingPlan";
import { useEditor } from "../../editor/store";

/** How many empty cells "Fill gaps" asks for at once. */
const FILL_AT_ONCE = 3;

/** A mood × relationship stage grid of the card's greetings, by place, with the gaps to fill. */
export function GreetingPlanner({ onClose }: { onClose: () => void }) {
  const record = useEditor((s) => s.record)!;
  const [plan, setPlan] = useState<GreetingPlan>();
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController>(undefined);

  useEffect(() => {
    void loadPlan(record.id).then(setPlan);
    return () => controller.current?.abort();
  }, [record.id]);

  if (!plan) return null;

  const update = (next: GreetingPlan) => {
    setPlan(next);
    void savePlan(record.id, next);
  };
  const data = record.card.data;
  const placed = placeGreetings(data, plan);
  const unsorted = placed.filter((p) => !p.tag).length;
  const open = gaps(placed, plan, place || undefined);

  async function sort() {
    const greetings = allGreetings(data);
    if (!greetings.length) return;
    setBusy(true);
    setError(undefined);
    controller.current = new AbortController();
    try {
      const result = await complete("planner", {
        system: systemPrompt("planner"),
        messages: [{ role: "user", text: greetingSortRequest(greetings, plan!) }],
        tools: [SORT_GREETINGS],
        signal: controller.current.signal,
      });
      const call = result.toolCalls.find((c) => c.name === SORT_GREETINGS.name);
      if (!call) throw new Error("The co-writer didn't sort the greetings. Try again.");
      update(applyTags(plan!, greetings, readGreetingTags(call)));
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function fill(cells: { mood: string; stage: string; place?: string }[]) {
    onClose();
    const engine = !!readEngine(useEditor.getState().record!.card.data);
    void askCowriter({ send: greetingFillRequest(cells, engine) });
  }

  /** Spreads the picks over the grid instead of taking one row. */
  const spread = <T,>(list: T[], n: number) =>
    list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);

  return (
    <Dialog open title="Greeting planner" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Which openings the card has, by mood and where {"{{char}}"} and {"{{user}}"} stand, and which are missing.
          Sorting is saved in CardForge only.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || placed.length === 0} onClick={() => void sort()}>
            {unsorted < placed.length ? "Sort again" : "Sort my greetings"}
          </Button>
          {busy && (
            <Button variant="ghost" onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          )}
          <span className="text-sm text-ink-muted" aria-live="polite">
            {busy
              ? "Sorting…"
              : placed.length === 0
                ? "The card has no greetings yet."
                : unsorted
                  ? `${unsorted} of ${placed.length} greetings not sorted yet.`
                  : `All ${placed.length} greetings sorted.`}
          </span>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-red-500/40 p-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <SaveToLibrary
            kind="greetings"
            name={`${data.name || "Card"} grid`}
            label="Save the grid"
            payload={() => ({ moods: plan.moods, places: plan.places, stages: plan.stages })}
          />
          <FromLibrary
            kind="greetings"
            label="Use a saved grid"
            onUse={(item) => {
              update({ ...plan, moods: item.payload.moods, places: item.payload.places, stages: item.payload.stages });
              setPlace("");
            }}
          />
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Place
          <select
            className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2 text-sm"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          >
            <option value="">Any place</option>
            {plan.places.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th className="sr-only">Mood</th>
                {plan.stages.map((s) => (
                  <th key={s} scope="col" className="px-1 font-medium text-ink-muted">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.moods.map((mood) => (
                <tr key={mood}>
                  <th scope="row" className="pr-1 text-left font-medium text-ink-muted">
                    {mood}
                  </th>
                  {plan.stages.map((stage) => {
                    const here = inCell(placed, mood, stage, place || undefined);
                    return (
                      <td key={stage} className="h-10 min-w-12 rounded-md bg-surface-sunken text-center">
                        {here.length ? (
                          <span
                            className="text-accent"
                            title={here.map((p) => p.text.slice(0, 80)).join("\n\n")}
                            aria-label={`${mood}, ${stage}: ${here.map(label).join(", ")}`}
                          >
                            {here.map((p) => (p.number === 0 ? "1st" : `#${p.number}`)).join(" ")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="size-full rounded-md text-ink-muted hover:bg-accent/10 hover:text-accent"
                            aria-label={`Write a greeting: ${mood}, ${stage}${place ? `, ${place}` : ""}`}
                            onClick={() => fill([{ mood, stage, place: place || undefined }])}
                          >
                            +
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">
          1st is the first message, #2 the second alternate greeting. Tap + to write the missing opening.
        </p>
        {open.length > 0 && (
          <Button className="self-start" onClick={() => fill(spread(open, FILL_AT_ONCE))}>
            ✦ Fill {Math.min(open.length, FILL_AT_ONCE)} gaps
          </Button>
        )}
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Edit moods, stages and places</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Axis label="Moods" values={plan.moods} onChange={(moods) => update({ ...plan, moods })} />
            <Axis label="Relationship stages" values={plan.stages} onChange={(stages) => update({ ...plan, stages })} />
            <Axis label="Places" values={plan.places} onChange={(places) => update({ ...plan, places })} />
          </div>
        </details>
      </div>
    </Dialog>
  );
}

const label = (p: { number: number }) => (p.number === 0 ? "first message" : `alternate greeting ${p.number}`);

/** An editable list of values on one axis of the grid. */
function Axis({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [adding, setAdding] = useState("");
  const add = () => {
    const v = adding.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setAdding("");
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3 text-sm">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="flex size-6 items-center justify-center rounded-full text-ink-muted hover:text-ink"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        <form
          className="flex w-32"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <TextInput
            aria-label={`Add to ${label.toLowerCase()}`}
            value={adding}
            placeholder="Add…"
            className="h-8 w-28 min-h-0 py-0 text-sm"
            onChange={(e) => setAdding(e.target.value)}
            onBlur={add}
          />
        </form>
      </div>
    </fieldset>
  );
}
