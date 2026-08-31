/**
 * Model IDs. Spec §4: "Put the model IDs in `lib/models.ts` as named constants,
 * never inline."
 *
 * Two-pass routing:
 *   GATE     — cheap/fast tier. Answers "is this a sellable product?" and guesses a
 *              category. Runs before we spend anything on the expensive call.
 *   GENERATE — frontier tier. Writes the listing copy under the grounding contract
 *              (lib/prompts.ts), where instruction-following is the whole ballgame.
 *
 * Both are overridable by env so you can A/B a tier without a code change — that is
 * how §12/Q2 ("does the gate pass earn its cost?") gets answered.
 */

/** Fast/cheap tier — the product gate. */
export const GATE_MODEL = process.env.AUTO_WRITE_GATE_MODEL ?? "claude-haiku-4-5";

/** Frontier tier — the copy generation. Spec §4 calls for a Sonnet-class model. */
export const GENERATE_MODEL =
  process.env.AUTO_WRITE_GENERATE_MODEL ?? "claude-sonnet-5";

/**
 * USD per million tokens, used only for the dev-mode cost line and the S7 assertion
 * (< $0.03 / generation). Prices drift; this is an estimate for instrumentation, not
 * billing. Keyed by model ID.
 */
export const PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-sonnet-5": { inputPerMTok: 2.0, outputPerMTok: 10.0 },
  "claude-opus-5": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
};

/** Spec §3/S7: hard cost ceiling per generation, in USD. */
export const COST_CEILING_USD = 0.03;

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (inputTokens / 1_000_000) * p.inputPerMTok +
    (outputTokens / 1_000_000) * p.outputPerMTok
  );
}
