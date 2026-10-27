import { useAiSettings } from "../../ai/settings";
import { defaultSampling, DEFAULT_WRITING_EFFORT, EQ_BENCH_URL, MODEL_TIPS, type Sampling } from "../../ai/sampling";
import type { Effort, ModeId } from "../../ai/types";
import { TextInput } from "../../components/ui";

const KEYS: { key: keyof Sampling; label: string; max: number; step: number }[] = [
  { key: "temperature", label: "Temperature", max: 2, step: 0.05 },
  { key: "topP", label: "Top-p", max: 1, step: 0.01 },
  { key: "minP", label: "Min-p", max: 1, step: 0.01 },
];

const EFFORTS: { value: Effort | "off"; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** Sampling per task, thinking for writing, and per-model tips. */
export function SamplingSettings({ modes }: { modes: { mode: ModeId; label: string }[] }) {
  const { settings, update } = useAiSettings();
  const sampling = settings.sampling ?? {};
  const saved = settings.providers.flatMap((p) => p.models ?? []);
  const tips = MODEL_TIPS.filter((t) => saved.some((m) => t.match.test(m)));

  const setValue = (mode: ModeId, key: keyof Sampling, raw: string) => {
    const mine = { ...sampling.modes?.[mode] };
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) delete mine[key];
    else mine[key] = n;
    const next = { ...sampling.modes, [mode]: mine };
    if (!Object.keys(mine).length) delete next[mode];
    void update({ sampling: { ...sampling, modes: next } });
  };

  return (
    <details className="flex flex-col gap-3">
      <summary className="cursor-pointer font-medium">Sampling and thinking (optional)</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Writing tasks run warmer and checks run cooler. Endpoints that don't support a setting get asked again with their own
          defaults. To compare models' prose and slop, see the{" "}
          <a className="text-accent underline" href={EQ_BENCH_URL} target="_blank" rel="noreferrer">
            EQ-Bench creative writing leaderboard
          </a>
          .
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={!sampling.off}
            onChange={(e) => void update({ sampling: { ...sampling, off: e.target.checked ? undefined : true } })}
          />
          Send sampling settings
        </label>
        {!sampling.off && (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="pr-2 font-normal">Task</th>
                  {KEYS.map((k) => (
                    <th key={k.key} className="px-1 font-normal">
                      {k.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modes.map(({ mode, label }) => (
                  <tr key={mode}>
                    <td className="pr-2">{label}</td>
                    {KEYS.map((k) => (
                      <td key={k.key} className="px-1 py-0.5">
                        <TextInput
                          type="number"
                          min={0}
                          max={k.max}
                          step={k.step}
                          className="w-20"
                          aria-label={`${label} ${k.label.toLowerCase()}`}
                          placeholder={String(defaultSampling(mode)[k.key] ?? "–")}
                          value={sampling.modes?.[mode]?.[k.key] ?? ""}
                          onChange={(e) => setValue(mode, k.key, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-ink-muted">Empty uses the default shown. A dash sends nothing for it. Claude takes no min-p.</p>
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Thinking for writing tasks
          <span className="text-xs text-ink-muted">Models that can think first usually write better prose. It costs more tokens.</span>
          <select
            aria-label="Thinking for writing tasks"
            className="min-h-10 max-w-40 rounded-lg border border-border bg-surface-sunken px-2 text-sm"
            value={settings.writingEffort ?? DEFAULT_WRITING_EFFORT}
            onChange={(e) => void update({ writingEffort: e.target.value as Effort | "off" })}
          >
            {EFFORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={settings.modelTips !== false}
            onChange={(e) => void update({ modelTips: e.target.checked ? undefined : false })}
          />
          <span>
            Add a tip about the model's habits to writing prompts
            <span className="block text-xs text-ink-muted">From the StoryScope study of AI fiction, for Claude, GPT, Gemini and DeepSeek models.</span>
          </span>
        </label>
        {tips.length > 0 && settings.modelTips !== false && (
          <ul className="flex flex-col gap-1 text-xs text-ink-muted">
            {tips.map((t) => (
              <li key={t.family}>
                <span className="font-medium text-ink">{t.family}:</span> {t.tip}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
