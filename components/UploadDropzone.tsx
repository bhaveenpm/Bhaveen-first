"use client";

import { useCallback, useId, useRef, useState } from "react";
import { downscaleFile, MAX_BYTES } from "@/lib/image";
import { AutoWriteError } from "@/lib/schema";
import type { LoadedImage } from "@/lib/useGeneration";

const SAMPLES = [
  { file: "/samples/ceramic-mug.png", label: "Ceramic mug", mockId: "ceramic-mug" },
  { file: "/samples/canvas-tote.png", label: "Canvas tote", mockId: "canvas-tote" },
  { file: "/samples/sauce-bottle.png", label: "Sauce bottle", mockId: "sauce-bottle" },
];

export function UploadDropzone({
  onImage,
  disabled,
}: {
  onImage: (img: LoadedImage) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File) => {
      setLocalError(null);
      setBusy(true);
      try {
        const r = await downscaleFile(file);
        onImage({ ...r, name: file.name });
      } catch (err) {
        setLocalError(
          err instanceof AutoWriteError
            ? err.message
            : "That image could not be opened. Try a JPEG, PNG or WebP.",
        );
      } finally {
        setBusy(false);
      }
    },
    [onImage],
  );

  const loadSample = useCallback(
    async (path: string, label: string, mockId: string) => {
      setLocalError(null);
      setBusy(true);
      try {
        const res = await fetch(path);
        const blob = await res.blob();
        const file = new File([blob], path.split("/").pop() ?? "sample.png", { type: blob.type || "image/png" });
        const r = await downscaleFile(file);
        onImage({ ...r, name: label, mockId });
      } catch {
        setLocalError("Could not load that sample.");
      } finally {
        setBusy(false);
      }
    },
    [onImage],
  );

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload a product photo. JPEG, PNG or WebP, up to 8 megabytes."
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const f = e.dataTransfer.files?.[0];
          if (f) void accept(f);
        }}
        className={[
          "rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-[var(--foreground)]",
          dragging ? "border-[var(--foreground)] bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]" : "border-[var(--line)]",
        ].join(" ")}
      >
        <p className="text-base font-medium">{busy ? "Preparing image…" : "Drop a product photo, or click to choose"}</p>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          JPEG, PNG or WebP · up to {Math.round(MAX_BYTES / 1024 / 1024)}MB · resized in your browser before upload
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void accept(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-[var(--muted)]">or try one:</span>
        {SAMPLES.map((s) => (
          <button
            key={s.file}
            type="button"
            disabled={disabled || busy}
            onClick={() => void loadSample(s.file, s.label, s.mockId)}
            className="rounded-full border border-[var(--line)] px-3 py-1 hover:border-[var(--foreground)] disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-center text-sm text-[var(--danger-fg)]">
        {localError}
      </p>
    </div>
  );
}
