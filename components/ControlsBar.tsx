"use client";

import { ToneEnum, type Tone } from "@/lib/schema";

const TONE_LABELS: Record<Tone, string> = {
  neutral: "Neutral",
  warm: "Warm",
  premium: "Premium",
  playful: "Playful",
};

const CATEGORIES = [
  "",
  "apparel",
  "homeware",
  "electronics accessory",
  "food and beverage",
  "handmade",
  "beauty",
  "pet",
];

export function ControlsBar({
  productName,
  category,
  tone,
  onProductName,
  onCategory,
  onTone,
  disabled,
}: {
  productName: string;
  category: string;
  tone: Tone;
  onProductName: (v: string) => void;
  onCategory: (v: string) => void;
  onTone: (v: Tone) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="aw-name" className="block text-sm font-medium">
          Product name <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <input
          id="aw-name"
          type="text"
          value={productName}
          disabled={disabled}
          placeholder="e.g. Kiln Matte Mug"
          onChange={(e) => onProductName(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="aw-category" className="block text-sm font-medium">
          Category <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <select
          id="aw-category"
          value={category}
          disabled={disabled}
          onChange={(e) => onCategory(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm disabled:opacity-50"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === "" ? "Let Auto Write decide" : c}
            </option>
          ))}
        </select>
      </div>

      <fieldset disabled={disabled} className="disabled:opacity-50">
        <legend className="text-sm font-medium">Tone</legend>
        <div role="radiogroup" aria-label="Tone" className="mt-1.5 grid grid-cols-4 gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-1">
          {(ToneEnum.options as Tone[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tone === t}
              onClick={() => onTone(t)}
              className={[
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                tone === t
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              {TONE_LABELS[t]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted)]">Tone changes voice only. It never relaxes the grounding rules.</p>
      </fieldset>
    </div>
  );
}
