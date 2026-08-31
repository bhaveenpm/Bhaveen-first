/**
 * Spec §6 — "Enforcement (do not rely on the prompt alone)".
 *
 * Runs after zod parse, before the response is finalised. L1–L5 from the spec table.
 * Every failure is logged with the offending text: the lint hit-rate is itself a
 * product metric — a rising L1/L2 rate on new images means the prompt has drifted or
 * the model changed under you.
 */
import type { Generation } from "./schema";
import { NOT_A_PRODUCT } from "./schema";

export type LintRule = "L1" | "L2" | "L3" | "L4" | "L5";

export type LintViolation = {
  rule: LintRule;
  /** `reject` forces a retry; `warn` is recorded for the metric but ships. */
  severity: "reject" | "warn";
  field: string;
  message: string;
  offending: string;
};

export type LintResult = {
  ok: boolean;
  violations: LintViolation[];
  /** Fields to regenerate when the failure is local (L4 → bullets, L5 → one field). */
  scopedFields: string[];
};

/** L1: a number followed by a hard unit is a spec claim in disguise. */
const UNIT_RE =
  /\b\d+(?:\.\d+)?\s?(?:ml|millilitres?|milliliters?|litres?|liters?|l|kg|kilograms?|grams?|g|oz|ounces?|lbs?|pounds?|cm|centimetres?|centimeters?|mm|millimetres?|m|inch(?:es)?|in|"|thread\s?count|mah|wh|w|watts?|volts?|v)\b/gi;

/** L2: claims that need certification, provenance or testing we do not have. */
const BANNED_SUPERLATIVES: { label: string; re: RegExp }[] = [
  { label: "best", re: /\bbest(?!\s*(?:before|by))\b/gi },
  { label: "#1", re: /(?:#\s?1|\bnumber one\b)/gi },
  { label: "award-winning", re: /\baward[-\s]?winning\b/gi },
  { label: "clinically", re: /\bclinical(?:ly)?\b/gi },
  { label: "organic", re: /\borganic(?:ally)?\b/gi },
  { label: "eco-friendly", re: /\beco[-\s]?friendly\b/gi },
  { label: "sustainable", re: /\bsustainab(?:le|ly|ility)\b/gi },
  { label: "hypoallergenic", re: /\bhypo[-\s]?allergenic\b/gi },
  { label: "FDA", re: /\bFDA\b/g },
  { label: "CE-certified", re: /\bCE[-\s]?(?:certified|marked)\b/gi },
  { label: "waterproof", re: /\bwater[-\s]?proof\b/gi },
];

const PLACEHOLDER_RE = /\[SPECIFY:\s*([^\]]+)\]/gi;

/** The copy fields a merchant actually publishes — the only place claims can hide. */
function copyFields(g: Generation): { field: string; text: string }[] {
  return [
    { field: "title", text: g.title },
    { field: "shortDescription", text: g.shortDescription },
    { field: "longDescription", text: g.longDescription },
    ...g.bullets.map((b, i) => ({ field: `bullets.${i}`, text: b })),
    { field: "seoMeta.metaDescription", text: g.seoMeta.metaDescription },
    { field: "seoMeta.altText", text: g.seoMeta.altText },
  ];
}

/** Character spans covered by a [SPECIFY: ...] placeholder — exempt from L1/L2. */
function placeholderSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function insideSpan(index: number, spans: [number, number][]): boolean {
  return spans.some(([s, e]) => index >= s && index < e);
}

/**
 * A claim is licensed only if the model marked it `observed` — i.e. it says the value
 * is legible in the photograph. `inferred` and `unknown` never license a hard unit.
 */
function isObserved(g: Generation, needle: string): boolean {
  const n = needle.toLowerCase().replace(/\s+/g, "");
  return g.observedClaims.some(
    (c) =>
      c.confidence === "observed" &&
      (c.value.toLowerCase().replace(/\s+/g, "").includes(n) ||
        c.evidence.toLowerCase().replace(/\s+/g, "").includes(n)),
  );
}

const STOPWORDS = new Set([
  "with","that","this","your","from","into","have","also","which","when","they","them",
  "than","then","been","were","will","each","more","most","some","such","only","over",
  "just","like","made","keeps","keep","every","their","there","about","while","after",
]);

function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\[specify:[^\]]*\]/gi, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

export function groundingLint(g: Generation): LintResult {
  const violations: LintViolation[] = [];
  const scoped = new Set<string>();

  // Rule 7: a non-product short-circuits every other check.
  if (g.productType === NOT_A_PRODUCT) {
    return { ok: true, violations: [], scopedFields: [] };
  }

  const fields = copyFields(g);

  // ---- L1: forbidden-unit scan -------------------------------------------------
  for (const { field, text } of fields) {
    if (!text) continue;
    const spans = placeholderSpans(text);
    for (const m of text.matchAll(UNIT_RE)) {
      if (insideSpan(m.index, spans)) continue; // inside [SPECIFY: ...] — allowed
      if (isObserved(g, m[0])) continue; // legibly printed on the product
      violations.push({
        rule: "L1",
        severity: "reject",
        field,
        message:
          `"${m[0].trim()}" states a measurable attribute as fact. An image cannot ` +
          `establish it. Replace with a [SPECIFY: ...] placeholder and a blocking assumption, ` +
          `or record it in observedClaims as "observed" with the visible evidence.`,
        offending: m[0].trim(),
      });
      scoped.add(field);
    }
  }

  // ---- L2: banned-superlative scan ---------------------------------------------
  for (const { field, text } of fields) {
    if (!text) continue;
    const spans = placeholderSpans(text);
    for (const { label, re } of BANNED_SUPERLATIVES) {
      for (const m of text.matchAll(re)) {
        if (insideSpan(m.index, spans)) continue;
        if (isObserved(g, m[0])) continue; // the word is printed on the product
        violations.push({
          rule: "L2",
          severity: "reject",
          field,
          message:
            `"${m[0]}" is an unsupportable claim (${label}). It is permitted only when ` +
            `the word is legibly printed on the product in the image and recorded as an ` +
            `observed claim.`,
          offending: m[0],
        });
        scoped.add(field);
      }
    }
  }

  // ---- L3: placeholder / assumption parity -------------------------------------
  const placeholders = new Map<string, string>(); // normalised attr -> field
  for (const { field, text } of fields) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      placeholders.set(m[1].trim().toLowerCase(), field);
    }
  }
  const blocking = g.assumptions.filter((a) => a.severity === "blocking");

  for (const [attr, field] of placeholders) {
    const matched = blocking.some(
      (a) =>
        a.assumption.toLowerCase().includes(attr) ||
        a.question.toLowerCase().includes(attr) ||
        a.field.toLowerCase().includes(attr) ||
        attr.includes(a.field.toLowerCase()),
    );
    if (!matched) {
      violations.push({
        rule: "L3",
        severity: "reject",
        field,
        message: `[SPECIFY: ${attr}] has no matching blocking assumption.`,
        offending: `[SPECIFY: ${attr}]`,
      });
      scoped.add(field);
    }
  }
  for (const a of blocking) {
    const allCopy = fields.map((f) => f.text).join(" ").toLowerCase();
    const referenced = [...placeholders.keys()].some(
      (attr) => a.assumption.toLowerCase().includes(attr) || a.question.toLowerCase().includes(attr),
    );
    if (!referenced && !allCopy.includes("[specify:")) {
      violations.push({
        rule: "L3",
        severity: "reject",
        field: a.field,
        message:
          `Blocking assumption "${a.assumption}" has no [SPECIFY: ...] placeholder in the ` +
          `copy. A blocking gap the merchant cannot see in the text is not surfaced.`,
        offending: a.assumption,
      });
      scoped.add("longDescription");
    }
  }

  // ---- L4: bullet distinctness --------------------------------------------------
  // Fallback heuristic per spec: no two bullets share >=60% of their content words.
  for (let i = 0; i < g.bullets.length; i++) {
    for (let j = i + 1; j < g.bullets.length; j++) {
      const a = contentWords(g.bullets[i]);
      const b = contentWords(g.bullets[j]);
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap >= 0.6) {
        violations.push({
          rule: "L4",
          severity: "reject",
          field: "bullets",
          message: `Bullets ${i + 1} and ${j + 1} restate the same idea (${Math.round(overlap * 100)}% shared content words).`,
          offending: `${g.bullets[i]} || ${g.bullets[j]}`,
        });
        scoped.add("bullets");
      }
    }
  }

  // ---- L5: length bounds not covered by zod ------------------------------------
  g.bullets.forEach((b, i) => {
    if (b.length > 90) {
      violations.push({
        rule: "L5",
        severity: "reject",
        field: `bullets.${i}`,
        message: `Bullet ${i + 1} is ${b.length} chars; the limit is 90.`,
        offending: b,
      });
      scoped.add("bullets");
    }
  });
  const words = g.longDescription.trim().split(/\s+/).filter(Boolean).length;
  if (g.longDescription && (words < 90 || words > 150)) {
    violations.push({
      rule: "L5",
      // Warn, not reject: outside the style band but still publishable. Retrying here
      // would burn a call and a second of latency for a cosmetic miss.
      severity: "warn",
      field: "longDescription",
      message: `Long description is ${words} words; the style band is 90–150.`,
      offending: `${words} words`,
    });
  }

  return {
    ok: violations.every((v) => v.severity !== "reject"),
    violations,
    scopedFields: [...scoped],
  };
}

/** Structured log line. Spec §6: "Log every lint failure with the offending text." */
export function logLint(result: LintResult, context: Record<string, unknown> = {}): void {
  if (result.violations.length === 0) return;
  for (const v of result.violations) {
    console.warn(
      JSON.stringify({ evt: "grounding_lint", ...context, rule: v.rule, severity: v.severity, field: v.field, message: v.message, offending: v.offending }),
    );
  }
}
