/**
 * Spec §5: the single source of truth. The API returns exactly this, the UI renders
 * exactly this, the eval asserts exactly this — and `emit_listing`'s JSON Schema is
 * generated from it (lib/prompts.ts) so the tool contract cannot drift from the
 * validator.
 */
import { z } from "zod";

export const ToneEnum = z.enum([
  "neutral", // factual, spec-forward
  "warm", // friendly DTC
  "premium", // restrained, luxury
  "playful", // energetic, casual
]);
export type Tone = z.infer<typeof ToneEnum>;

export const ConfidenceEnum = z.enum(["observed", "inferred", "unknown"]);
export type Confidence = z.infer<typeof ConfidenceEnum>;

/** A single factual claim the copy makes, with its evidential basis. */
export const ClaimSchema = z.object({
  attribute: z.string(), // "material", "capacity", "colour"
  value: z.string(), // "brushed stainless steel"
  confidence: ConfidenceEnum,
  evidence: z.string(), // what in the image supports this
});
export type Claim = z.infer<typeof ClaimSchema>;

export const AssumptionSchema = z.object({
  field: z.string(), // which output field depends on it
  assumption: z.string(), // "assumed 350ml based on hand-scale"
  question: z.string(), // what to ask the merchant
  severity: z.enum(["blocking", "advisory"]),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

export const GenerationSchema = z.object({
  productType: z.string(),
  title: z.string().max(70),
  shortDescription: z.string().max(160),
  longDescription: z.string(),
  bullets: z.array(z.string()).length(5),
  seoMeta: z.object({
    metaDescription: z.string().max(155),
    // NOTE (deviation from spec §5): the spec has `.min(4)` here, but grounding rule 7
    // requires a non-product to come back with EVERY copy field empty. Those two
    // constraints cannot both hold — a compliant refusal would be unrepresentable, and
    // strict tool use would reject it. The floor is enforced conditionally instead, in
    // StrictGenerationSchema below, so real listings still owe 4–8 keywords.
    keywords: z.array(z.string()).max(8),
    altText: z.string().max(125),
  }),
  observedClaims: z.array(ClaimSchema),
  assumptions: z.array(AssumptionSchema),
  tone: ToneEnum,
});
export type Generation = z.infer<typeof GenerationSchema>;

/**
 * Sentinel productType. Grounding rule 7: a non-product image must come back as this
 * with empty copy fields, never as an improvised description.
 */
export const NOT_A_PRODUCT = "NOT_A_PRODUCT";

/**
 * What the API actually validates against. Same shape as GenerationSchema — which is
 * what `emit_listing`'s JSON Schema is generated from — plus the constraints that only
 * apply once we have agreed the image really is a product.
 */
export const StrictGenerationSchema = GenerationSchema.superRefine((g, ctx) => {
  if (g.productType === NOT_A_PRODUCT) {
    const copy = [g.title, g.shortDescription, g.longDescription, ...g.bullets, g.seoMeta.metaDescription];
    if (copy.some((c) => c.trim() !== "")) {
      ctx.addIssue({
        code: "custom",
        path: ["productType"],
        message: "NOT_A_PRODUCT must leave every copy field empty (grounding rule 7).",
      });
    }
    return;
  }
  if (g.seoMeta.keywords.length < 4) {
    ctx.addIssue({
      code: "custom",
      path: ["seoMeta", "keywords"],
      message: `Expected 4–8 keywords, received ${g.seoMeta.keywords.length}.`,
    });
  }
  if (g.title.trim() === "") {
    ctx.addIssue({ code: "custom", path: ["title"], message: "A product listing needs a title." });
  }
});

/** Gate pass (§4 model routing) — cheap "is this sellable?" classification. */
export const GateSchema = z.object({
  isProduct: z.boolean(),
  productType: z.string(),
  category: z.string(),
  reason: z.string(),
});
export type GateResult = z.infer<typeof GateSchema>;

export const GenerateRequestSchema = z.object({
  image: z.string(), // base64 data URL, server re-validates
  productName: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  tone: ToneEnum,
  /** Per-field regenerate: only this field is rewritten, the rest is carried over. */
  regenerateField: z.string().optional(),
  previous: GenerationSchema.optional(),
  /**
   * Mock-only fixture hint (sample buttons, eval harness). The server honours it ONLY
   * when the mock provider is active — the real provider has no such input, so it
   * cannot become a way to steer production output.
   */
  mockId: z.string().max(64).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

/** Spec §5 error taxonomy. The UI renders a distinct state for each. */
export const ERROR_CODES = {
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  NOT_A_PRODUCT: 422,
  RATE_LIMITED: 429,
  MODEL_UNAVAILABLE: 503,
  SCHEMA_INVALID: 500,
  BAD_REQUEST: 400,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export class AutoWriteError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AutoWriteError";
  }
  get status(): number {
    return ERROR_CODES[this.code];
  }
}

/** SSE frames (§5): `meta` → `delta`* → `done` | `error`. */
export type MetaEvent = {
  type: "meta";
  productType: string;
  category?: string;
  gateMs: number;
  model: string;
};
export type DeltaEvent = {
  type: "delta";
  /** Dotted path into Generation, e.g. `bullets.2` or `seoMeta.metaDescription`. */
  path: string;
  chunk: string;
  /** true → replace the value at `path` rather than appending `chunk`. */
  replace?: boolean;
};
export type DoneEvent = {
  type: "done";
  generation: Generation;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    totalMs: number;
    lintRetries: number;
  };
};
export type ErrorEvent = {
  type: "error";
  code: ErrorCode;
  message: string;
  detail?: unknown;
};
export type StreamEvent = MetaEvent | DeltaEvent | DoneEvent | ErrorEvent;

/** Empty shell the UI renders before the first delta lands. */
export function emptyGeneration(tone: Tone): Generation {
  return {
    productType: "",
    title: "",
    shortDescription: "",
    longDescription: "",
    bullets: ["", "", "", "", ""],
    seoMeta: { metaDescription: "", keywords: [], altText: "" },
    observedClaims: [],
    assumptions: [],
    tone,
  };
}
