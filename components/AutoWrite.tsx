"use client";

/**
 * The single screen (§7). Three-and-a-bit states, no routing, no nav.
 * The image and the settings survive every error — the form is never reset.
 */
import { useCallback, useState } from "react";
import Image from "next/image";
import { UploadDropzone } from "./UploadDropzone";
import { ControlsBar } from "./ControlsBar";
import { ResultPanel } from "./ResultPanel";
import { useGeneration, type LoadedImage } from "@/lib/useGeneration";
import type { ErrorCode, Tone } from "@/lib/schema";
import type { ProviderStatus } from "@/lib/anthropic";

/** §5: the UI must render a distinct state for each error code. */
const ERROR_UI: Record<ErrorCode, { title: string; hint: string }> = {
  IMAGE_TOO_LARGE: { title: "That image is too big", hint: "Resize it to 4096px or under and try again." },
  UNSUPPORTED_TYPE: { title: "Unsupported file", hint: "Auto Write reads JPEG, PNG and WebP." },
  NOT_A_PRODUCT: {
    title: "I can't tell what product this is",
    hint: "Try a clear shot of a single item on a plain background.",
  },
  RATE_LIMITED: { title: "Rate limit reached", hint: "You have used this hour's generations." },
  MODEL_UNAVAILABLE: { title: "Auto Write is temporarily unavailable", hint: "Nothing was generated. Try again shortly." },
  SCHEMA_INVALID: { title: "The listing came back malformed", hint: "This was retried once already. Try regenerating." },
  BAD_REQUEST: { title: "That request could not be read", hint: "Reload the page and try again." },
};

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export function AutoWrite({ provider }: { provider: ProviderStatus }) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");

  const g = useGeneration();
  const streaming = g.state === "streaming";
  const disabled = !provider.ready;

  const generate = useCallback(
    (opts?: { regenerateField?: string; tone?: Tone }) => {
      if (!image) return;
      const t = opts?.tone ?? tone;
      void g.run({
        image,
        tone: t,
        productName,
        category,
        regenerateField: opts?.regenerateField,
        // Carry the current object (merchant edits included) so a regenerate or tone
        // switch preserves structure instead of starting over.
        previous:
          opts?.regenerateField || opts?.tone ? (g.generation.title ? g.generation : undefined) : undefined,
      });
    },
    [image, tone, productName, category, g],
  );

  const onRegenerateField = useCallback(
    (path: string) => {
      const allowed = g.regenerateAllowed(path);
      if (!allowed.ok) return;
      generate({ regenerateField: path });
    },
    [g, generate],
  );

  const onToneChange = useCallback(
    (t: Tone) => {
      setTone(t);
      // §7: switching tone on a completed generation re-runs it with `previous`.
      if (g.state === "complete" && g.generation.title) generate({ tone: t });
    },
    [g.state, g.generation.title, generate],
  );

  const showResult = g.state === "streaming" || g.state === "complete";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Auto Write</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Upload a product photo, get listing copy you could publish in a minute — with every claim the photo
          can&rsquo;t prove quarantined instead of invented.
        </p>
      </header>

      {!provider.ready && (
        <div
          role="alert"
          className="mb-6 rounded-xl border p-4 text-sm"
          style={{ background: "var(--danger-bg)", borderColor: "var(--danger-line)", color: "var(--danger-fg)" }}
        >
          <strong className="font-semibold">Auto Write is temporarily unavailable.</strong>
          <p className="mt-1">{provider.reason}</p>
        </div>
      )}

      {provider.provider === "mock" && (
        <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
          Running on the <strong className="text-[var(--foreground)]">deterministic mock provider</strong> — no API calls,
          no spend. Set <code>AUTO_WRITE_PROVIDER=anthropic</code> with an <code>ANTHROPIC_API_KEY</code> for live
          generation.
        </div>
      )}

      {!image ? (
        <div className="py-10">
          <UploadDropzone onImage={setImage} disabled={disabled} />
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
              <Image
                src={image.dataUrl}
                alt={`Uploaded product photo: ${image.name}`}
                width={image.width}
                height={image.height}
                unoptimized
                className="h-auto w-full object-contain"
              />
            </div>
            <p className="text-xs text-[var(--muted)]">
              {image.width}×{image.height} · {formatBytes(image.bytes)}
              {image.originalBytes > image.bytes * 1.1 && (
                <> · resized in your browser from {formatBytes(image.originalBytes)}</>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setImage(null);
                g.reset();
              }}
              className="text-xs underline underline-offset-2 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Use a different photo
            </button>

            <ControlsBar
              productName={productName}
              category={category}
              tone={tone}
              onProductName={setProductName}
              onCategory={setCategory}
              onTone={onToneChange}
              disabled={disabled || streaming}
            />

            {streaming ? (
              <button
                type="button"
                onClick={g.stop}
                className="w-full rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold hover:border-[var(--foreground)]"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => generate()}
                disabled={disabled}
                className="w-full rounded-lg bg-[var(--foreground)] px-4 py-2.5 text-sm font-semibold text-[var(--background)] disabled:opacity-40"
              >
                {g.state === "complete" ? "Regenerate everything" : "Generate listing"}
              </button>
            )}

            {g.productType && (
              <p className="text-xs text-[var(--muted)]" aria-live="polite">
                Detected: <strong className="text-[var(--foreground)]">{g.productType}</strong>
              </p>
            )}
          </div>

          <div>
            {g.error && (
              <div
                role="alert"
                className="mb-5 rounded-xl border p-4"
                style={{ background: "var(--danger-bg)", borderColor: "var(--danger-line)", color: "var(--danger-fg)" }}
              >
                <p className="text-sm font-semibold">{ERROR_UI[g.error.code].title}</p>
                <p className="mt-1 text-sm">{g.error.message}</p>
                <p className="mt-1 text-xs opacity-80">
                  {ERROR_UI[g.error.code].hint}
                  {g.error.retryAfter ? ` Try again in ${g.error.retryAfter}s.` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    g.setError(null);
                    g.setState(g.generation.title ? "complete" : "configuring");
                  }}
                  className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-medium"
                >
                  Dismiss
                </button>
              </div>
            )}

            {showResult ? (
              <ResultPanel
                generation={g.generation}
                filled={g.filled}
                streaming={streaming}
                metrics={g.metrics}
                regenCounts={g.regenCounts}
                onEdit={g.editField}
                onRegenerateField={onRegenerateField}
                onFillPlaceholder={g.fillPlaceholder}
                onDismissAssumption={g.dismissAssumption}
              />
            ) : (
              !g.error && (
                <div className="rounded-xl border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--muted)]">
                  Set the tone, then generate. Copy streams in field by field.
                </div>
              )
            )}
          </div>
        </div>
      )}

      <footer className="mt-14 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
        Your image is held in memory for the length of the request only. It is never written to disk and never logged.
      </footer>
    </main>
  );
}
