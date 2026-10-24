import { modelKey, resolveModel, useAiSettings } from "../../ai/settings";
import type { ModelChoice } from "../../ai/types";

/**
 * Picks the chat's model from the models saved on each provider. It changes the default model,
 * or the chat's own model when one is set in Settings.
 */
export function ModelSwitcher() {
  const { settings, update } = useAiSettings();
  const resolved = resolveModel(settings, "refine");
  if (!resolved) return null;
  const current = modelKey(resolved.choice);
  const groups = settings.providers.map((p) => {
    const models = [...(p.models ?? [])];
    if (p.id === resolved.choice.providerId && !models.includes(resolved.choice.model)) models.unshift(resolved.choice.model);
    return { provider: p, models };
  });

  function choose(key: string) {
    const [providerId, ...rest] = key.split("/");
    const choice: ModelChoice = { providerId, model: rest.join("/") };
    if (settings.modeModels.refine?.model) void update({ modeModels: { ...settings.modeModels, refine: choice } });
    else void update({ defaultModel: choice });
  }

  return (
    <select
      aria-label="Model"
      className="max-w-full truncate rounded-md bg-transparent py-0.5 text-xs text-ink-muted hover:text-ink"
      value={current}
      onChange={(e) => choose(e.target.value)}
    >
      {groups
        .filter((g) => g.models.length)
        .map(({ provider, models }) => (
          <optgroup key={provider.id} label={provider.name}>
            {models.map((m) => (
              <option key={m} value={modelKey({ providerId: provider.id, model: m })}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}
