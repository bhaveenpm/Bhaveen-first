"use client";

/**
 * Client-side generation state machine + SSE consumer.
 *
 * EventSource cannot POST, so the stream is read off `fetch().body` and the SSE frames
 * are parsed by hand. Deltas are applied to a dotted path so each field fills
 * independently, which is what makes the progressive UI in §7 possible from a single
 * tool-call payload.
 */
import { useCallback, useRef, useState } from "react";
import {
  emptyGeneration,
  type ErrorCode,
  type Generation,
  type StreamEvent,
  type Tone,
} from "./schema";

export type UiState = "empty" | "configuring" | "streaming" | "complete" | "error";

export type UiError = { code: ErrorCode; message: string; retryAfter?: number };

export type Metrics = { ttftMs?: number; totalMs?: number; costUsd?: number; lintRetries?: number };

export type LoadedImage = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  name: string;
  /** Set only by the bundled sample buttons, so mock mode returns matching copy. */
  mockId?: string;
};

/** Regenerate budget from §7: 5 per session per field, debounced at 3s. */
export const REGEN_LIMIT = 5;
const REGEN_DEBOUNCE_MS = 3000;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Set a value at a dotted path (`bullets.2`, `seoMeta.metaDescription`). */
export function setAtPath(obj: Record<string, unknown>, path: string, apply: (prev: unknown) => unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[key] === undefined || cur[key] === null) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  cur[last] = apply(cur[last]);
}

export function getAtPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), obj);
}

export type GenerateOptions = {
  image: LoadedImage;
  tone: Tone;
  productName?: string;
  category?: string;
  /** Per-field regenerate: only this field is taken from the response. */
  regenerateField?: string;
  previous?: Generation;
};

export function useGeneration() {
  const [state, setState] = useState<UiState>("empty");
  const [generation, setGeneration] = useState<Generation>(() => emptyGeneration("neutral"));
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<UiError | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({});
  const [productType, setProductType] = useState<string>("");
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({});

  const abortRef = useRef<AbortController | null>(null);
  const lastRegenAt = useRef<Record<string, number>>({});

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => (s === "streaming" ? "complete" : s));
  }, []);

  /** §7: regenerate is debounced at 3s and capped per field. */
  const regenerateAllowed = useCallback(
    (field: string): { ok: boolean; reason?: string } => {
      const used = regenCounts[field] ?? 0;
      if (used >= REGEN_LIMIT) return { ok: false, reason: `No regenerations left for this field.` };
      const since = Date.now() - (lastRegenAt.current[field] ?? 0);
      if (since < REGEN_DEBOUNCE_MS) {
        return { ok: false, reason: `Wait ${Math.ceil((REGEN_DEBOUNCE_MS - since) / 1000)}s.` };
      }
      return { ok: true };
    },
    [regenCounts],
  );

  const run = useCallback(async (opts: GenerateOptions) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const scoped = opts.regenerateField;
    const startedAt = performance.now();
    let ttft: number | undefined;

    setError(null);
    setState("streaming");
    if (scoped) {
      lastRegenAt.current[scoped] = Date.now();
      setRegenCounts((c) => ({ ...c, [scoped]: (c[scoped] ?? 0) + 1 }));
      // Clear only the field being regenerated; every other edit survives.
      setGeneration((g) => {
        const next = clone(g);
        setAtPath(next as unknown as Record<string, unknown>, scoped, (prev) =>
          Array.isArray(prev) ? prev.map(() => "") : "",
        );
        return next;
      });
      setFilled((f) => {
        const n = new Set(f);
        for (const k of n) if (k === scoped || k.startsWith(scoped + ".")) n.delete(k);
        return n;
      });
    } else {
      setGeneration(emptyGeneration(opts.tone));
      setFilled(new Set());
      setProductType("");
      setMetrics({});
    }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          image: opts.image.dataUrl,
          tone: opts.tone,
          productName: opts.productName || undefined,
          category: opts.category || undefined,
          regenerateField: opts.regenerateField,
          previous: opts.previous,
          mockId: opts.image.mockId,
        }),
      });

      if (!res.ok || !res.body) {
        let payload: { code?: ErrorCode; message?: string } = {};
        try {
          payload = await res.json();
        } catch {
          /* non-JSON upstream failure */
        }
        setError({
          code: payload.code ?? "MODEL_UNAVAILABLE",
          message: payload.message ?? "Auto Write is temporarily unavailable.",
          retryAfter: Number(res.headers.get("retry-after")) || undefined,
        });
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          let evt: StreamEvent;
          try {
            evt = JSON.parse(dataLine.slice(6)) as StreamEvent;
          } catch {
            continue;
          }

          if (evt.type === "meta") {
            setProductType(evt.productType);
          } else if (evt.type === "delta") {
            // Per-field regenerate: ignore every path except the one asked for, so a
            // drifting model cannot silently overwrite the merchant's own edits.
            if (scoped && !(evt.path === scoped || evt.path.startsWith(scoped + "."))) continue;
            if (ttft === undefined) {
              ttft = performance.now() - startedAt;
              setMetrics((m) => ({ ...m, ttftMs: ttft }));
            }
            setGeneration((g) => {
              const next = clone(g);
              setAtPath(next as unknown as Record<string, unknown>, evt.path, (prev) =>
                evt.replace ? evt.chunk : String(prev ?? "") + evt.chunk,
              );
              return next;
            });
            setFilled((f) => new Set(f).add(evt.path));
          } else if (evt.type === "done") {
            setGeneration((g) => {
              if (!scoped) return evt.generation;
              // Merge only the regenerated branch.
              const next = clone(g);
              setAtPath(next as unknown as Record<string, unknown>, scoped, () =>
                getAtPath(evt.generation, scoped),
              );
              return next;
            });
            setMetrics({
              ttftMs: ttft,
              totalMs: performance.now() - startedAt,
              costUsd: evt.usage.costUsd,
              lintRetries: evt.usage.lintRetries,
            });
            setState("complete");
            void fetch("/api/metrics", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ttftMs: ttft, totalMs: performance.now() - startedAt, scoped: scoped ?? null }),
            }).catch(() => {});
          } else if (evt.type === "error") {
            setError({ code: evt.code, message: evt.message });
            setState("error");
          }
        }
      }
      setState((s) => (s === "streaming" ? "complete" : s));
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setState("complete");
        return;
      }
      setError({ code: "MODEL_UNAVAILABLE", message: "Lost connection to Auto Write." });
      setState("error");
    } finally {
      abortRef.current = null;
    }
  }, []);

  /**
   * §6: filling a placeholder is a client-side substitution across every copy field.
   * No second model call — a straight replacement cannot hallucinate.
   */
  const fillPlaceholder = useCallback((attribute: string, value: string) => {
    setGeneration((g) => {
      const re = new RegExp(`\\[SPECIFY:\\s*${attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`, "gi");
      const sub = (s: string) => s.replace(re, value);
      return {
        ...g,
        title: sub(g.title),
        shortDescription: sub(g.shortDescription),
        longDescription: sub(g.longDescription),
        bullets: g.bullets.map(sub),
        seoMeta: {
          ...g.seoMeta,
          metaDescription: sub(g.seoMeta.metaDescription),
          altText: sub(g.seoMeta.altText),
        },
        assumptions: g.assumptions.filter(
          (a) => !(a.severity === "blocking" && (a.assumption + a.question).toLowerCase().includes(attribute.toLowerCase())),
        ),
      };
    });
  }, []);

  const editField = useCallback((path: string, value: string) => {
    setGeneration((g) => {
      const next = clone(g);
      setAtPath(next as unknown as Record<string, unknown>, path, () => value);
      return next;
    });
  }, []);

  const dismissAssumption = useCallback((index: number) => {
    setGeneration((g) => ({ ...g, assumptions: g.assumptions.filter((_, i) => i !== index) }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState("empty");
    setGeneration(emptyGeneration("neutral"));
    setFilled(new Set());
    setError(null);
    setMetrics({});
    setProductType("");
    setRegenCounts({});
  }, []);

  return {
    state,
    setState,
    generation,
    filled,
    error,
    setError,
    metrics,
    productType,
    regenCounts,
    regenerateAllowed,
    run,
    stop,
    reset,
    fillPlaceholder,
    editField,
    dismissAssumption,
  };
}
