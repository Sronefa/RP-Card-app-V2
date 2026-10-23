import { useState } from "react";
import { isRegexKey, parseKeys, regexError } from "../../editor/lorebook";

/**
 * Keys as removable chips plus a text box. A key is added on Enter, on a comma, or when the box
 * loses focus. A /regex/ key may contain commas, so it is only added on Enter or blur.
 */
export function KeysInput({
  label,
  keys,
  onChange,
  placeholder = "Type a key, then Enter or a comma",
}: {
  label: string;
  keys: string[];
  onChange: (keys: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(text: string) {
    const added = parseKeys(text).filter((k) => !keys.includes(k));
    if (added.length > 0) onChange([...keys, ...added]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface-sunken p-1.5 focus-within:border-accent">
        {keys.map((key) => {
          const bad = isRegexKey(key) && regexError(key);
          return (
            <span
              key={key}
              title={bad || undefined}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm ${
                bad ? "bg-red-500/15 text-red-300" : "bg-surface-raised"
              }`}
            >
              <span className={isRegexKey(key) ? "font-mono" : undefined}>{key}</span>
              <button
                type="button"
                aria-label={`Remove key ${key}`}
                className="text-ink-muted hover:text-ink"
                onClick={() => onChange(keys.filter((k) => k !== key))}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          aria-label={label}
          value={draft}
          enterKeyHint="done"
          placeholder={keys.length === 0 ? placeholder : undefined}
          className="min-h-8 min-w-32 flex-1 bg-transparent px-1 text-ink outline-none placeholder:text-ink-muted/60"
          onChange={(e) => {
            const value = e.target.value;
            // Android keyboards often don't report Enter, so a typed comma also adds the key.
            if (value.includes(",") && !value.trimStart().startsWith("/")) {
              const parts = value.split(",");
              commit(parts.slice(0, -1).join(","));
              setDraft(parts[parts.length - 1]);
            } else setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft === "" && keys.length > 0) {
              onChange(keys.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>
    </div>
  );
}
