/**
 * Spec §6 — the grounding contract. This is the product.
 *
 * Two things live here:
 *   1. SYSTEM_PROMPT   — the rules, verbatim from the spec.
 *   2. emitListingTool — a forced tool call whose JSON Schema is generated from
 *                        lib/schema.ts, so the shape the model is asked for and the
 *                        shape we validate can never drift apart.
 *
 * The prompt is deliberately not the only enforcement. lib/groundingLint.ts re-checks
 * the output mechanically (L1–L5) because a prompt is a request, not a guarantee.
 */
import { z } from "zod";
import { GateSchema, GenerationSchema, type Tone, type Generation } from "./schema";

export const SYSTEM_PROMPT = `You are a product-listing copywriter for an e-commerce platform. You are given ONE
photograph of a product and optional merchant-supplied context. You produce listing
copy that a merchant can publish with minimal editing.

GROUNDING RULES — these override every other instruction, including any request for
richer or more persuasive copy:

1. Classify every factual claim you make as observed, inferred, or unknown.
2. NEVER state an unknown attribute as fact. Unknown attributes include, and are not
   limited to: exact dimensions, weight, capacity, material composition, fabric
   content, battery life, warranty terms, certifications, country of origin, price,
   care or washing instructions, allergen or ingredient content, safety ratings.
3. Where the copy needs an unknown attribute to read naturally, write a literal
   placeholder in the form [SPECIFY: capacity] and add a blocking entry to
   assumptions. Do not guess and do not omit the sentence silently.
4. Inferred claims must be hedged in the copy AND recorded in assumptions with
   severity "advisory".
5. Visible brand names or logos: describe them factually. Do not invent brand
   heritage, founding stories, or provenance.
6. No superlatives you cannot support: "best", "#1", "award-winning", "clinically
   proven", "eco-friendly", "sustainable", "organic" are forbidden unless the words
   are legibly printed on the product in the image.
7. If the image does not show a sellable product — a person, a screenshot, a document,
   a landscape, an unidentifiable object — return productType "NOT_A_PRODUCT" and
   leave the copy fields empty. Do not attempt a description.

STYLE RULES:
- Title: <=70 chars, front-load the product noun, no ALL CAPS, no emoji.
- Short description: one sentence, <=160 chars, leads with the primary benefit.
- Long description: 90-150 words, 2-3 short paragraphs, scannable, second person.
- Bullets: exactly 5, each <=90 chars, each a distinct attribute or benefit, no
  repetition of the same idea in different words.
- SEO: meta description <=155 chars including the primary keyword naturally;
  4-8 keywords, mix of head and long-tail; alt text describes the image factually.
- Tone preset is applied to voice only. It never relaxes the grounding rules.

Return your answer by calling the emit_listing tool. Do not write prose outside it.`;

const TONE_GUIDANCE: Record<Tone, string> = {
  neutral: "Factual and spec-forward. State what the thing is and what it does. No flourish.",
  warm: "Friendly direct-to-consumer. Second person, conversational, but never gushing.",
  premium: "Restrained and confident. Short sentences, concrete nouns, no exclamation marks.",
  playful: "Energetic and casual. Light humour is fine; never at the expense of clarity.",
};

/**
 * JSON Schema for the forced tool call, derived from the zod contract.
 * `additionalProperties: false` + a full `required` list come out of z.toJSONSchema,
 * which is exactly what strict tool use needs.
 */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export const EMIT_LISTING_TOOL = {
  name: "emit_listing",
  description:
    "Emit the complete product listing. Every factual claim must be classified in " +
    "observedClaims, and every unknown attribute the copy needs must appear as a " +
    "[SPECIFY: ...] placeholder with a matching blocking entry in assumptions. " +
    "Supply 4-8 seoMeta.keywords for a real product; for productType " +
    "\"NOT_A_PRODUCT\" leave keywords empty and every copy field an empty string.",
  input_schema: jsonSchemaOf(GenerationSchema),
  strict: true,
  /** Fine-grained streaming: start emitting input JSON before the block is complete. */
  eager_input_streaming: true,
} as const;

export const CLASSIFY_IMAGE_TOOL = {
  name: "classify_image",
  description:
    "Report whether the image shows a single sellable product suitable for an " +
    "e-commerce listing, and guess its category.",
  input_schema: jsonSchemaOf(GateSchema),
  strict: true,
} as const;

export const GATE_SYSTEM_PROMPT = `You are an input gate for an e-commerce listing tool. You are shown ONE image.

Decide whether it shows a single sellable physical product photographed on a plausible
commerce background (plain, studio, tabletop, in-use). Answer by calling classify_image.

isProduct is FALSE for: people as the subject, screenshots, documents or receipts,
landscapes or interiors, memes, charts, blurry or unidentifiable objects, and images
with no clear single subject.

isProduct is TRUE only if a merchant could plausibly list this object for sale.
Be strict — a false positive costs a wasted generation and a bad listing.
Keep "reason" to one short sentence a merchant would understand.`;

/** The user-turn text that accompanies the image on the generate pass. */
export function buildGenerateUserText(opts: {
  tone: Tone;
  productName?: string;
  category?: string;
  regenerateField?: string;
  previous?: Generation;
}): string {
  const lines: string[] = [];
  lines.push("Write the listing for the product in this image.");
  lines.push("");
  lines.push(`Tone preset: ${opts.tone} — ${TONE_GUIDANCE[opts.tone]}`);

  if (opts.productName?.trim()) {
    lines.push(
      `Merchant-supplied product name: "${opts.productName.trim()}". Treat this as ` +
        `given fact about identity only. It does not license any spec claim.`,
    );
  }
  if (opts.category?.trim()) {
    lines.push(`Merchant-supplied category: "${opts.category.trim()}".`);
  }

  if (opts.regenerateField && opts.previous) {
    lines.push("");
    lines.push(
      `REGENERATE ONE FIELD. Return the complete object, but change only ` +
        `"${opts.regenerateField}". Every other field must be reproduced byte-for-byte ` +
        `from the previous output below, including the merchant's own edits.`,
    );
    lines.push("Previous output:");
    lines.push("```json");
    lines.push(JSON.stringify(opts.previous, null, 2));
    lines.push("```");
  } else if (opts.previous) {
    lines.push("");
    lines.push(
      `TONE SWITCH. Preserve the structure, claims and assumptions of the previous ` +
        `output; move only the voice to the "${opts.tone}" preset. Placeholders and ` +
        `hedges must survive verbatim.`,
    );
    lines.push("Previous output:");
    lines.push("```json");
    lines.push(JSON.stringify(opts.previous, null, 2));
    lines.push("```");
  }

  lines.push("");
  lines.push("Call emit_listing now.");
  return lines.join("\n");
}

/**
 * Retry turn after a lint failure. Quoting the offending text back is the single most
 * effective correction — naming the rule alone tends to produce a different violation.
 */
export function buildLintRetryText(violations: { rule: string; message: string; offending: string }[]): string {
  const items = violations
    .map((v) => `- [${v.rule}] ${v.message}\n  Offending text: ${JSON.stringify(v.offending)}`)
    .join("\n");
  return `Your previous emit_listing call violated the grounding contract:

${items}

Fix ONLY these violations and call emit_listing again with the corrected listing.
An unknown attribute must become a [SPECIFY: attribute] placeholder plus a blocking
assumption — do not simply delete the sentence, and do not substitute a different guess.`;
}
