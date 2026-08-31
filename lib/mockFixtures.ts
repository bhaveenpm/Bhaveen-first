/**
 * Deterministic fixtures for the mock provider.
 *
 * These are written to satisfy the grounding contract for real — every fixture goes
 * through zod + groundingLint in `npm run test:fixtures`. A mock that emitted
 * lint-dirty copy would make the eval harness meaningless.
 *
 * Routing:
 *   - an explicit `mockId` (the eval harness passes one) wins
 *   - `neg-*` ids resolve to the NOT_A_PRODUCT fixture
 *   - `lint-violation-01` emits a deliberate L1+L2 violation on the FIRST attempt and
 *     clean copy on the retry, so P4's retry path has something to catch
 *   - anything else is chosen by a hash of the image bytes, so an unregistered upload
 *     still behaves consistently across runs
 */
import { createHash } from "node:crypto";
import { NOT_A_PRODUCT, type Generation, type Tone } from "./schema";

type BuildOpts = { tone: Tone; productName?: string; attempt: "first" | "corrected" };

export type Fixture = {
  id: string;
  productType: string;
  category: string;
  build(opts: BuildOpts): Generation;
};

type Archetype = {
  id: string;
  productType: string;
  category: string;
  /** Noun used in prose. */
  noun: string;
  /** Three distinct, visually-grounded bullet claims (each <= 80 chars). */
  visuals: [string, string, string];
  /** Short visual summary used mid-paragraph. */
  summary: string;
  /** Hedged material guess — always "appears to be". */
  material: string;
  /** The unknowable attribute that becomes the [SPECIFY: ...] placeholder. */
  unknown: { attr: string; label: string; why: string };
  keywords: string[];
  altText: string;
  observed: { attribute: string; value: string; evidence: string }[];
};

const TONE_OPENERS: Record<Tone, (noun: string) => string> = {
  neutral: (n) => `A plain ${n}, photographed head-on against a light background.`,
  warm: (n) => `Here is a ${n} that does its job without asking for attention.`,
  premium: (n) => `A restrained ${n}. Clean lines, no ornament, nothing to distract.`,
  playful: (n) => `Meet the ${n} that quietly gets on with it while everything else shouts.`,
};

const TONE_SHORT: Record<Tone, (n: string, s: string) => string> = {
  neutral: (n, s) => `A ${n} with ${s}, suitable for a straightforward listing.`,
  warm: (n, s) => `A friendly everyday ${n} with ${s} — easy to live with, easy to sell.`,
  premium: (n, s) => `A considered ${n} with ${s}, made to sit quietly in a curated range.`,
  playful: (n, s) => `A cheerful little ${n} with ${s} that punches above its shelf space.`,
};

const ARCHETYPES: Archetype[] = [
  {
    id: "ceramic-mug",
    productType: "mug",
    category: "homeware",
    noun: "mug",
    visuals: [
      "Matte white finish that hides fingerprints and light smudges",
      "Curved handle shaped for a relaxed, full grip",
      "Straight cylindrical body stacks neatly on a shelf",
    ],
    summary: "a matte white body and a curved handle",
    material: "glazed ceramic",
    unknown: { attr: "capacity", label: "Capacity", why: "shoppers filter drinkware by size before anything else" },
    keywords: ["ceramic mug", "matte white mug", "coffee mug", "minimalist drinkware", "everyday kitchen cup"],
    altText: "A matte white cylindrical mug with a curved handle on a plain light background.",
    observed: [
      { attribute: "colour", value: "matte white", evidence: "uniform white body with no gloss highlights" },
      { attribute: "form", value: "straight cylinder", evidence: "parallel sides from base to rim" },
      { attribute: "handle", value: "curved loop handle", evidence: "single closed loop on the right side" },
    ],
  },
  {
    id: "canvas-tote",
    productType: "tote bag",
    category: "apparel",
    noun: "tote bag",
    visuals: [
      "Flat woven face with a visible cross-hatch weave",
      "Twin shoulder straps stitched at four reinforced points",
      "Unlined open top with no zip or clasp",
    ],
    summary: "a woven face and twin shoulder straps",
    material: "cotton canvas",
    unknown: { attr: "dimensions", label: "Dimensions", why: "bag buyers compare width and drop height directly" },
    keywords: ["canvas tote", "shoulder tote bag", "reusable shopper", "everyday carry bag", "plain tote"],
    altText: "A plain woven tote bag with two shoulder straps, photographed flat.",
    observed: [
      { attribute: "colour", value: "natural off-white", evidence: "undyed fabric tone across the whole panel" },
      { attribute: "closure", value: "open top", evidence: "no zip, button or clasp is visible" },
      { attribute: "straps", value: "two shoulder straps", evidence: "symmetrical straps stitched to the top edge" },
    ],
  },
  {
    id: "earbud-case",
    productType: "earbud charging case",
    category: "electronics accessory",
    noun: "charging case",
    visuals: [
      "Rounded pebble shell that closes flush along the seam",
      "Single indicator light set into the front face",
      "Recessed port centred on the underside",
    ],
    summary: "a rounded shell and a single indicator light",
    material: "moulded plastic with a soft-touch coating",
    unknown: { attr: "battery life", label: "Battery life", why: "it is the first spec a shopper checks on audio accessories" },
    keywords: ["earbud case", "wireless charging case", "audio accessory", "compact earphone case", "travel earbud holder"],
    altText: "A small rounded earbud charging case, closed, on a plain surface.",
    observed: [
      { attribute: "form", value: "rounded pebble shell", evidence: "continuous curve with no hard corners" },
      { attribute: "indicator", value: "single front light", evidence: "one small circular lens on the front face" },
      { attribute: "port", value: "underside port", evidence: "recessed opening centred on the base" },
    ],
  },
  {
    id: "sauce-bottle",
    productType: "sauce bottle",
    category: "food and beverage",
    noun: "sauce bottle",
    visuals: [
      "Tall clear glass body with a narrow neck and shoulder",
      "Front label printed in two flat colours",
      "Ribbed screw cap sitting flush with the neck",
    ],
    summary: "a clear glass body and a printed front label",
    material: "glass with a paper label",
    unknown: { attr: "ingredients", label: "The ingredient list", why: "food listings cannot go live without it" },
    keywords: ["hot sauce bottle", "table sauce", "condiment bottle", "glass sauce jar", "pantry condiment"],
    altText: "A tall clear glass sauce bottle with a printed front label and a screw cap.",
    observed: [
      { attribute: "container", value: "clear glass bottle", evidence: "contents visible through the body" },
      { attribute: "closure", value: "ribbed screw cap", evidence: "vertical ribbing around the cap edge" },
      { attribute: "label", value: "printed front label", evidence: "rectangular label across the middle of the bottle" },
    ],
  },
  {
    id: "macrame-hanger",
    productType: "plant hanger",
    category: "handmade",
    noun: "plant hanger",
    visuals: [
      "Hand-knotted cords fanning out from a single top loop",
      "Four support arms meeting in a gathered lower knot",
      "Loose fringe hanging free below the cradle",
    ],
    summary: "hand-knotted cords and a gathered lower knot",
    material: "twisted cotton cord",
    unknown: { attr: "length", label: "Hanging length", why: "buyers need it to know if it clears their window" },
    keywords: ["macrame plant hanger", "hanging planter holder", "handmade home decor", "knotted plant sling", "boho plant hanger"],
    altText: "A hand-knotted cord plant hanger with a top loop and a loose fringe.",
    observed: [
      { attribute: "construction", value: "hand-knotted cord", evidence: "visible individual knots along each arm" },
      { attribute: "arms", value: "four support arms", evidence: "four cord groups meeting below the cradle" },
      { attribute: "finish", value: "loose fringe", evidence: "unbound cord ends below the lower knot" },
    ],
  },
];

function buildFrom(a: Archetype, opts: BuildOpts): Generation {
  const noun = opts.productName?.trim() ? opts.productName.trim() : a.noun;
  const title = truncate(`${capitalise(a.noun)} — ${a.summary}`, 70);

  const longDescription = [
    TONE_OPENERS[opts.tone](noun),
    "",
    `The ${a.noun} shows ${a.summary}. Nothing on the visible surface names a brand, ` +
      `so it sits easily beside the rest of a ${a.category} range without clashing.`,
    "",
    `The surface appears to be ${a.material}, which is worth confirming with your ` +
      `supplier before you publish. ${a.unknown.label} is [SPECIFY: ${a.unknown.attr}] — ` +
      `fill that in first, because ${a.unknown.why}.`,
    "",
    `Shot against a plain background, it reads cleanly at listing-thumbnail size and ` +
      `still holds up when a shopper zooms in.`,
  ].join("\n");

  return {
    productType: a.productType,
    title,
    shortDescription: truncate(TONE_SHORT[opts.tone](noun, a.summary), 160),
    longDescription,
    bullets: [
      a.visuals[0],
      a.visuals[1],
      a.visuals[2],
      `Appears to be ${a.material}; confirm with your supplier`,
      "Photographs cleanly against a plain listing background",
    ].map((b) => truncate(b, 90)),
    seoMeta: {
      metaDescription: truncate(
        `${capitalise(a.noun)} with ${a.summary}. Simple ${a.category} listing copy, with the unverified details flagged for you.`,
        155,
      ),
      keywords: a.keywords,
      altText: truncate(a.altText, 125),
    },
    observedClaims: a.observed.map((o) => ({ ...o, confidence: "observed" as const })),
    assumptions: [
      {
        field: "longDescription",
        assumption: `${a.unknown.label} (${a.unknown.attr}) cannot be established from one photograph.`,
        question: `What is the ${a.unknown.attr}?`,
        severity: "blocking" as const,
      },
      {
        field: "bullets",
        assumption: `Material looks like ${a.material}, hedged in the copy as "appears to be".`,
        question: `Is the material ${a.material}?`,
        severity: "advisory" as const,
      },
    ],
    tone: opts.tone,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** Rule 7: a non-product returns the sentinel with every copy field empty. */
const NOT_A_PRODUCT_FIXTURE: Fixture = {
  id: "not-a-product",
  productType: NOT_A_PRODUCT,
  category: "",
  build: ({ tone }) => ({
    productType: NOT_A_PRODUCT,
    title: "",
    shortDescription: "",
    longDescription: "",
    bullets: ["", "", "", "", ""],
    seoMeta: { metaDescription: "", keywords: [], altText: "" },
    observedClaims: [],
    assumptions: [],
    tone,
  }),
};

/**
 * Deliberately dirty: an L1 unit claim ("500ml") and an L2 superlative
 * ("eco-friendly") on the first attempt. The route's lint retry should catch both and
 * the corrected build should come back clean — that is P4's acceptance test.
 */
const LINT_VIOLATION_FIXTURE: Fixture = {
  id: "lint-violation-01",
  productType: "water bottle",
  category: "homeware",
  build: (opts) => {
    const base = buildFrom(ARCHETYPES[0], opts);
    if (opts.attempt === "corrected") return base;
    return {
      ...base,
      productType: "water bottle",
      longDescription:
        "This eco-friendly bottle holds 500ml and is made from 100% recycled stainless steel. " +
        "It keeps drinks cold all day and is the best bottle in its class for commuters who " +
        "want something durable, light and genuinely sustainable for daily use on the move.",
      bullets: [
        "Holds 500ml, enough for a full working morning",
        "Eco-friendly recycled stainless steel body",
        "Curved handle shaped for a relaxed, full grip",
        "Straight cylindrical body stacks neatly on a shelf",
        "Photographs cleanly against a plain listing background",
      ],
      assumptions: [],
    };
  },
};

export const MOCK_FIXTURES: Record<string, Fixture> = {
  ...Object.fromEntries(
    ARCHETYPES.map((a) => [
      a.id,
      { id: a.id, productType: a.productType, category: a.category, build: (o: BuildOpts) => buildFrom(a, o) } as Fixture,
    ]),
  ),
  "not-a-product": NOT_A_PRODUCT_FIXTURE,
  "lint-violation-01": LINT_VIOLATION_FIXTURE,
};

export function mockFixtureFor(mockId: string | undefined, imageBase64: string): Fixture {
  if (mockId) {
    if (MOCK_FIXTURES[mockId]) return MOCK_FIXTURES[mockId];
    if (mockId.startsWith("neg-")) return NOT_A_PRODUCT_FIXTURE;
    // Golden ids are named `<archetype>-NN`; fall back to the archetype prefix.
    const prefix = Object.keys(MOCK_FIXTURES).find((k) => mockId.startsWith(k));
    if (prefix) return MOCK_FIXTURES[prefix];
  }
  const seed = parseInt(createHash("sha256").update(imageBase64).digest("hex").slice(0, 8), 16);
  return MOCK_FIXTURES[ARCHETYPES[seed % ARCHETYPES.length].id];
}
