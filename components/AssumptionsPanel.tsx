"use client";

/**
 * §6: "The AssumptionsPanel is not an afterthought pane." It is the differentiator —
 * an actionable checklist directly under the copy. Filling one in substitutes the
 * placeholder client-side, with no second model call.
 */
import { useState } from "react";
import type { Assumption } from "@/lib/schema";

/** Pull the attribute name out of the assumption so the fill-in knows what to replace. */
function attributeOf(a: Assumption, placeholders: string[]): string | null {
  const hay = `${a.assumption} ${a.question} ${a.field}`.toLowerCase();
  return placeholders.find((p) => hay.includes(p.toLowerCase())) ?? null;
}

export function AssumptionsPanel({
  assumptions,
  placeholders,
  onFill,
  onDismiss,
}: {
  assumptions: Assumption[];
  /** Attribute names currently present as [SPECIFY: x] anywhere in the copy. */
  placeholders: string[];
  onFill: (attribute: string, value: string) => void;
  onDismiss: (index: number) => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  if (assumptions.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
        Nothing left to confirm. Every claim in this copy is either visible in the photo or already filled in.
      </div>
    );
  }

  const blocking = assumptions.filter((a) => a.severity === "blocking").length;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--warn-bg)", borderColor: "var(--warn-line)", color: "var(--warn-fg)" }}
    >
      <h2 className="text-sm font-semibold" aria-live="polite">
        ⚠ {assumptions.length} thing{assumptions.length === 1 ? "" : "s"} to confirm before publishing
        {blocking > 0 && <span className="font-normal"> · {blocking} blocking</span>}
      </h2>

      <ul className="mt-3 space-y-2.5">
        {assumptions.map((a, i) => {
          const attr = attributeOf(a, placeholders);
          const open = openIdx === i;
          return (
            <li key={`${a.field}-${i}`} className="rounded-lg border border-[var(--warn-line)] bg-[var(--panel)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    <span
                      className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        background: a.severity === "blocking" ? "var(--danger-bg)" : "var(--warn-bg)",
                        color: a.severity === "blocking" ? "var(--danger-fg)" : "var(--warn-fg)",
                      }}
                    >
                      {a.severity}
                    </span>
                    {a.assumption}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {a.question} <span className="opacity-70">· affects {a.field}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (attr) {
                      setOpenIdx(open ? null : i);
                      setDraft("");
                    } else {
                      onDismiss(i);
                    }
                  }}
                  className="shrink-0 rounded-md border border-[var(--line)] px-2 py-1 text-xs font-medium text-[var(--foreground)] hover:border-[var(--foreground)]"
                >
                  {attr ? (open ? "Cancel" : "Fill in ▸") : "Confirm ▸"}
                </button>
              </div>

              {open && attr && (
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!draft.trim()) return;
                    onFill(attr, draft.trim());
                    setOpenIdx(null);
                    setDraft("");
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Actual ${attr}`}
                    aria-label={`Value for ${attr}`}
                    className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)]"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-[var(--foreground)] px-3 py-1.5 text-xs font-semibold text-[var(--background)]"
                  >
                    Replace
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
