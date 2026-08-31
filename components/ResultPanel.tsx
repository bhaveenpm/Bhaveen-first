"use client";

import { useMemo, useState } from "react";
import type { Generation } from "@/lib/schema";
import { EditableField } from "./EditableField";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { REGEN_LIMIT, type Metrics } from "@/lib/useGeneration";

function placeholdersIn(g: Generation): string[] {
  const all = [g.title, g.shortDescription, g.longDescription, ...g.bullets, g.seoMeta.metaDescription, g.seoMeta.altText]
    .join(" ")
    .matchAll(/\[SPECIFY:\s*([^\]]+)\]/gi);
  return [...new Set([...all].map((m) => m[1].trim()))];
}

export function ResultPanel({
  generation,
  filled,
  streaming,
  metrics,
  regenCounts,
  onEdit,
  onRegenerateField,
  onFillPlaceholder,
  onDismissAssumption,
}: {
  generation: Generation;
  filled: Set<string>;
  streaming: boolean;
  metrics: Metrics;
  regenCounts: Record<string, number>;
  onEdit: (path: string, value: string) => void;
  onRegenerateField: (path: string) => void;
  onFillPlaceholder: (attr: string, value: string) => void;
  onDismissAssumption: (i: number) => void;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const placeholders = useMemo(() => placeholdersIn(generation), [generation]);
  const left = (path: string) => REGEN_LIMIT - (regenCounts[path] ?? 0);

  const copyShopify = async () => {
    const text = [
      `Title:\n${generation.title}`,
      `Description:\n${generation.longDescription}`,
      `Meta description:\n${generation.seoMeta.metaDescription}`,
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1600);
    } catch {
      /* clipboard denied */
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(generation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auto-write-${generation.productType || "listing"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <AssumptionsPanel
        assumptions={generation.assumptions}
        placeholders={placeholders}
        onFill={onFillPlaceholder}
        onDismiss={onDismissAssumption}
      />

      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4">
        <EditableField
          label="Title"
          value={generation.title}
          limit={70}
          streaming={streaming}
          filled={filled.has("title")}
          onChange={(v) => onEdit("title", v)}
          onRegenerate={() => onRegenerateField("title")}
          regenRemaining={left("title")}
        />
        <EditableField
          label="Short description"
          value={generation.shortDescription}
          limit={160}
          streaming={streaming}
          filled={filled.has("shortDescription")}
          onChange={(v) => onEdit("shortDescription", v)}
          onRegenerate={() => onRegenerateField("shortDescription")}
          regenRemaining={left("shortDescription")}
        />
        <EditableField
          label="Long description"
          value={generation.longDescription}
          multiline
          streaming={streaming}
          filled={filled.has("longDescription")}
          onChange={(v) => onEdit("longDescription", v)}
          onRegenerate={() => onRegenerateField("longDescription")}
          regenRemaining={left("longDescription")}
        />

        <section className="border-b border-[var(--line)] py-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Bullet features</h3>
            <button
              type="button"
              onClick={() => onRegenerateField("bullets")}
              disabled={streaming || left("bullets") <= 0}
              className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs hover:border-[var(--foreground)] disabled:opacity-40"
              aria-label={`Regenerate bullets, ${left("bullets")} left`}
            >
              ↻ {left("bullets")}
            </button>
          </div>
          <ul className="mt-1">
            {generation.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="pt-4 text-[var(--muted)]">
                  •
                </span>
                <div className="min-w-0 flex-1">
                  <EditableField
                    label={`Bullet ${i + 1}`}
                    value={b}
                    limit={90}
                    streaming={streaming}
                    filled={filled.has(`bullets.${i}`)}
                    onChange={(v) => onEdit(`bullets.${i}`, v)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <EditableField
          label="SEO meta description"
          value={generation.seoMeta.metaDescription}
          limit={155}
          streaming={streaming}
          filled={filled.has("seoMeta.metaDescription")}
          onChange={(v) => onEdit("seoMeta.metaDescription", v)}
          onRegenerate={() => onRegenerateField("seoMeta")}
          regenRemaining={left("seoMeta")}
        />
        <EditableField
          label="Image alt text"
          value={generation.seoMeta.altText}
          limit={125}
          streaming={streaming}
          filled={filled.has("seoMeta.altText")}
          onChange={(v) => onEdit("seoMeta.altText", v)}
        />

        <section className="border-b border-[var(--line)] py-4 last:border-b-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Keywords</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {generation.seoMeta.keywords.length === 0 && streaming && <div className="aw-shimmer h-6 w-56" />}
            {generation.seoMeta.keywords.map((k, i) => (
              <span key={i} className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs">
                {k}
              </span>
            ))}
          </div>
        </section>
      </div>

      <details className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Evidence — {generation.observedClaims.length} classified claim
          {generation.observedClaims.length === 1 ? "" : "s"}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {generation.observedClaims.map((c, i) => (
            <li key={i} className="text-xs">
              <span className="rounded bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] px-1.5 py-0.5 font-medium">
                {c.confidence}
              </span>{" "}
              <strong>{c.attribute}:</strong> {c.value}{" "}
              <span className="text-[var(--muted)]">— {c.evidence}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyShopify}
          className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-semibold text-[var(--background)]"
        >
          {copiedAll ? "Copied" : "Copy all as Shopify fields"}
        </button>
        <button
          type="button"
          onClick={exportJson}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium hover:border-[var(--foreground)]"
        >
          Export JSON
        </button>
        {(metrics.ttftMs || metrics.totalMs) && (
          <span className="ml-auto text-xs text-[var(--muted)]" aria-live="polite">
            {metrics.ttftMs !== undefined && `first token ${Math.round(metrics.ttftMs)}ms`}
            {metrics.totalMs !== undefined && ` · total ${(metrics.totalMs / 1000).toFixed(1)}s`}
            {metrics.costUsd !== undefined && ` · ~$${metrics.costUsd.toFixed(4)}`}
            {metrics.lintRetries ? ` · ${metrics.lintRetries} lint retry` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
