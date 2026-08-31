"use client";

/**
 * One editable output field with per-field copy and regenerate (§7).
 *
 * Uses a textarea rather than contentEditable: [SPECIFY: ...] placeholders must
 * survive editing byte-for-byte for the assumptions checklist to substitute them, and
 * contentEditable mangles text nodes. The highlighted read-only view is shown while
 * streaming; it flips to a textarea on focus.
 */
import { useEffect, useRef, useState } from "react";

const SPECIFY_RE = /(\[SPECIFY:\s*[^\]]+\])/g;

export function highlightSpecify(text: string) {
  return text.split(SPECIFY_RE).map((part, i) =>
    SPECIFY_RE.test(part) ? (
      <mark className="aw-specify" key={i}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function EditableField({
  label,
  value,
  onChange,
  onRegenerate,
  regenRemaining,
  streaming,
  filled,
  multiline,
  limit,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRegenerate?: () => void;
  regenRemaining?: number;
  streaming: boolean;
  filled: boolean;
  multiline?: boolean;
  limit?: number;
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [editing]);

  const over = limit !== undefined && value.length > limit;
  const empty = value.trim() === "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — nothing useful to say */
    }
  };

  return (
    <section className="border-b border-[var(--line)] py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</h3>
        <div className="flex items-center gap-2 text-xs">
          {limit !== undefined && !empty && (
            <span className={over ? "font-medium text-[var(--danger-fg)]" : "text-[var(--muted)]"}>
              {value.length}/{limit}
            </span>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={empty}
            className="rounded border border-[var(--line)] px-1.5 py-0.5 hover:border-[var(--foreground)] disabled:opacity-40"
            aria-label={`Copy ${label}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={streaming || (regenRemaining ?? 0) <= 0}
              title={`${regenRemaining ?? 0} regenerations left for this field`}
              className="rounded border border-[var(--line)] px-1.5 py-0.5 hover:border-[var(--foreground)] disabled:opacity-40"
              aria-label={`Regenerate ${label}, ${regenRemaining ?? 0} left`}
            >
              ↻ {regenRemaining ?? 0}
            </button>
          )}
        </div>
      </div>

      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}

      <div className="mt-1.5">
        {editing ? (
          <textarea
            ref={ref}
            value={value}
            rows={multiline ? 6 : 2}
            onChange={(e) => {
              onChange(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={() => setEditing(false)}
            className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2 text-sm leading-relaxed"
            aria-label={label}
          />
        ) : empty && streaming ? (
          <div className="space-y-1.5" aria-hidden="true">
            <div className="aw-shimmer h-4 w-full" />
            {multiline && <div className="aw-shimmer h-4 w-11/12" />}
            {multiline && <div className="aw-shimmer h-4 w-4/5" />}
          </div>
        ) : (
          <div
            role="textbox"
            tabIndex={0}
            aria-label={`${label}. Click to edit.`}
            onClick={() => setEditing(true)}
            onFocus={() => setEditing(true)}
            className="cursor-text whitespace-pre-wrap rounded-lg border border-transparent p-2 text-sm leading-relaxed hover:border-[var(--line)]"
            data-filled={filled}
          >
            {empty ? <span className="text-[var(--muted)]">—</span> : highlightSpecify(value)}
          </div>
        )}
      </div>
    </section>
  );
}
