/**
 * The generation pipeline: gate → generate → validate → lint → (retry once).
 *
 * Deliberately transport-free. The route handler wraps it in SSE; the eval harness
 * calls it directly. One code path means `npm run eval` measures the thing that
 * actually ships — a harness that re-implements the pipeline measures a fiction.
 */
import {
  AutoWriteError,
  NOT_A_PRODUCT,
  StrictGenerationSchema,
  type Generation,
  type Tone,
} from "./schema";
import type { ValidatedImage } from "./image";
import { getProvider, type Provider, type Usage } from "./anthropic";
import { groundingLint, logLint, type LintViolation } from "./groundingLint";
import type { PathDelta } from "./partialJson";

export const MAX_LINT_RETRIES = 1; // §6: "reject, retry once"

export type PipelineArgs = {
  image: ValidatedImage;
  tone: Tone;
  productName?: string;
  category?: string;
  regenerateField?: string;
  previous?: Generation;
  mockId?: string;
  signal?: AbortSignal;
  provider?: Provider;
  /**
   * A gate result already obtained via runGate(). The route runs the gate BEFORE
   * opening the SSE stream so a non-product can answer with a real HTTP 422 (§5)
   * rather than a 200 carrying an error frame; passing it back in avoids paying for
   * the gate twice.
   */
  gate?: GateOutcome;
};

export type GateOutcome = Awaited<ReturnType<Provider["gate"]>>;

/**
 * The cheap pass. Separated from runPipeline so callers can act on the verdict before
 * committing to a response shape.
 */
export async function runGate(args: {
  image: ValidatedImage;
  mockId?: string;
  provider?: Provider;
}): Promise<GateOutcome> {
  const provider = args.provider ?? getProvider();
  return provider.gate(args.image, args.mockId);
}

export type PipelineHooks = {
  onGate?: (info: { productType: string; category: string; ms: number; costUsd: number }) => void;
  /** Called only for the first attempt — a correction pass is buffered, not streamed. */
  onDeltas?: (deltas: PathDelta[]) => void;
};

export type PipelineResult = {
  generation: Generation;
  gateMs: number;
  attempts: number;
  /** Violations remaining after the retry budget is spent. Empty on a clean run. */
  unresolvedViolations: LintViolation[];
  /** Every violation seen across attempts — this is the lint hit-rate metric (§6). */
  allViolations: LintViolation[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
};

export async function runPipeline(args: PipelineArgs, hooks: PipelineHooks = {}): Promise<PipelineResult> {
  const provider = args.provider ?? getProvider();

  // ---- gate ------------------------------------------------------------------
  const gate = args.gate ?? (await provider.gate(args.image, args.mockId));
  hooks.onGate?.({
    productType: gate.result.productType,
    category: gate.result.category,
    ms: gate.ms,
    costUsd: gate.usage.costUsd,
  });

  if (!gate.result.isProduct) {
    console.log(JSON.stringify({ evt: "gate_reject", reason: gate.result.reason, gateMs: gate.ms }));
    throw new AutoWriteError(
      "NOT_A_PRODUCT",
      "I can't tell what product this is — try a clear shot on a plain background.",
      gate.result.reason,
    );
  }

  // ---- generate + validate + lint --------------------------------------------
  const totals = { inputTokens: gate.usage.inputTokens, outputTokens: gate.usage.outputTokens, costUsd: gate.usage.costUsd };
  const allViolations: LintViolation[] = [];
  let corrections: LintViolation[] | undefined;
  let generation: Generation | null = null;
  let attempt = 0;

  for (;;) {
    const isRetry = attempt > 0;
    const result = await provider.streamListing(
      {
        image: args.image,
        tone: args.tone,
        productName: args.productName,
        category: args.category,
        regenerateField: args.regenerateField,
        previous: corrections ? (generation ?? args.previous) : args.previous,
        corrections,
        mockId: args.mockId,
      },
      (deltas) => {
        if (!isRetry) hooks.onDeltas?.(deltas);
      },
      args.signal,
    );

    accumulate(totals, result.usage);

    const parsed = StrictGenerationSchema.safeParse(result.raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      console.warn(JSON.stringify({ evt: "schema_invalid", attempt, issues }));
      if (attempt < MAX_LINT_RETRIES) {
        corrections = parsed.error.issues.map((i) => ({
          rule: "L5" as const,
          severity: "reject" as const,
          field: i.path.join("."),
          message: i.message,
          offending: i.path.join("."),
        }));
        allViolations.push(...corrections);
        attempt++;
        continue;
      }
      throw new AutoWriteError("SCHEMA_INVALID", "The generated listing did not match the schema.", issues);
    }

    generation = parsed.data;

    // Rule 7 can still fire here when the gate has failed open.
    if (generation.productType === NOT_A_PRODUCT) {
      throw new AutoWriteError(
        "NOT_A_PRODUCT",
        "I can't tell what product this is — try a clear shot on a plain background.",
      );
    }

    const lint = groundingLint(generation);
    logLint(lint, { attempt, productType: generation.productType });
    allViolations.push(...lint.violations);

    if (lint.ok) {
      return { generation, gateMs: gate.ms, attempts: attempt, unresolvedViolations: [], allViolations, usage: totals };
    }

    if (attempt >= MAX_LINT_RETRIES) {
      const unresolved = lint.violations.filter((v) => v.severity === "reject");
      // Out of retries. Return it, but loudly — silently shipping the violation would
      // defeat the one thing this system exists to prevent.
      console.error(
        JSON.stringify({ evt: "lint_unresolved", violations: unresolved.map((v) => `${v.rule}:${v.offending}`) }),
      );
      return { generation, gateMs: gate.ms, attempts: attempt, unresolvedViolations: unresolved, allViolations, usage: totals };
    }

    corrections = lint.violations.filter((v) => v.severity === "reject");
    attempt++;
  }
}

function accumulate(t: { inputTokens: number; outputTokens: number; costUsd: number }, u: Usage) {
  t.inputTokens += u.inputTokens;
  t.outputTokens += u.outputTokens;
  t.costUsd += u.costUsd;
}
