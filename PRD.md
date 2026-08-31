# Auto Write — Build Spec (v0.1 prototype)

**Owner:** Miqdad · **Status:** Ready to build · **Consumer:** Claude Code
**One line:** Upload a product photo → get a merchant-ready, SEO-shaped product description, with every unverifiable claim quarantined instead of hallucinated.

> **How to use this document.** This is an executable spec, not a strategy narrative. Sections 1–5 define *what correct looks like*. Section 6 is the highest-value section — the grounding contract is the actual product. Sections 7–11 are implementation. Build in the phase order in §11 and do not start a phase until the prior phase's acceptance tests pass.

---

## 1. Scope

The original Auto Write took a product **title + a few attributes** as input. This prototype takes a **product image** as the primary input. That single change moves the core risk from *"is the copy good?"* to *"is the copy true?"* — a vision model will confidently assert 100% cotton, 500ml capacity, and stainless steel from a photograph that shows none of those things. Everything below is organised around that risk.

| | In scope (v0.1) | Out of scope (v0.1) |
|---|---|---|
| **Input** | 1 product image (JPEG/PNG/WebP, ≤8MB), optional product name, optional category, optional brand-voice preset | Multi-image, video, 3D, URL scrape, CSV bulk |
| **Output** | Title, short description, long description, 5 bullet features, SEO meta description, keyword set, `assumptions[]` | Full SEO audit, competitor copy analysis, translations |
| **Editing** | Regenerate, tone switch, inline edit of any field, per-field regenerate | Version history, collaborative editing, A/B copy testing |
| **Trust** | Grounding contract (§6), confidence per claim, "needs confirmation" queue | Provenance watermarking, fact-check against a product DB |
| **Persistence** | Ephemeral session state only | Accounts, saved drafts, database |
| **Integration** | Copy to clipboard, export JSON | Shopify/Woo/BigCommerce write-back |

**Non-goal, stated explicitly:** this is not a general image captioner. If the image is not a product on a plausible commerce background, the app should say so and stop, not improvise.

---

## 2. The one job

> *"I have a photo of the thing I'm selling. I need listing copy that is good enough to publish in under 60 seconds, and I need to know which parts I have to check before I publish."*

Persona: solo or small merchant, 10–200 SKUs, no copywriter, photographs products themselves. Success is measured by **time-to-publishable**, not by output volume.

| Failure mode we are designing against | Why it kills the product |
|---|---|
| Fabricated specs (material, dimensions, capacity, certifications) | One false claim on a live listing = returns, chargebacks, consumer-law exposure. Kills trust permanently. |
| Generic copy ("elevate your everyday") | Merchant rewrites everything → zero time saved → churn. |
| Slow first token | Perceived as broken. Merchant tabs away. |
| Output that doesn't fit the merchant's fields | Copy/paste friction cancels the saving. |

---

## 3. Prototype success criteria

These are the demo's pass/fail gates, not business OKRs.

| # | Criterion | Target | How measured |
|---|---|---|---|
| S1 | Grounding: zero fabricated hard attributes on the golden set | 0 violations across 20 images | §10 eval harness, `grounding` rubric |
| S2 | Time to first streamed token | < 2.0s p90 | Client-side timer, logged |
| S3 | Time to complete output | < 12s p90 | Client-side timer, logged |
| S4 | Publishable-without-edit rate (human judged) | ≥ 60% of long descriptions | Manual scoring, §10 |
| S5 | Assumption surfacing | ≥ 1 `assumptions[]` entry on every generation where a spec-like claim is implied | Automated check in eval |
| S6 | Graceful refusal on non-product images | 5/5 rejected with a useful message | §10 negative set |
| S7 | Cost per generation | < $0.03 | Token accounting logged per request |

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router, React Server + Client)         │
│                                                              │
│  UploadDropzone ──► ImagePreview ──► ControlsBar             │
│        │                                (tone, category)     │
│        │                                                     │
│        └──► POST /api/generate  (multipart or base64 JSON)   │
│                     │                                        │
│             ◄── text/event-stream ──                         │
│                     │                                        │
│             ResultPanel (streams into typed fields)          │
│               ├─ TitleField        ├─ BulletsField           │
│               ├─ ShortDescField    ├─ SeoMetaField           │
│               ├─ LongDescField     └─ AssumptionsPanel  ◄─── the differentiator
└──────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│  Route handler  app/api/generate/route.ts  (Node runtime)    │
│                                                              │
│  1. validateUpload()   size, MIME sniff, dimension clamp     │
│  2. rateLimit()        in-memory token bucket per IP         │
│  3. classifyImage()    cheap pass: is this a product? ──► 422│
│  4. buildPrompt()      system + grounding contract + schema  │
│  5. anthropic.messages.stream()  vision + tool-use schema    │
│  6. validateOutput()   zod parse + grounding lint            │
│  7. stream SSE deltas to client                              │
└──────────────────────────────────────────────────────────────┘
                      │
                      ▼
              Anthropic Messages API (vision)
```

**Stack, fixed:** Next.js 15 (App Router) · TypeScript strict · Tailwind · `@anthropic-ai/sdk` · `zod` for output validation · no database · deploys to Vercel.

**Model routing:**

| Pass | Purpose | Model | Why |
|---|---|---|---|
| Gate | Is this a product image? Category guess. | Fast/cheap tier (Haiku-class) | Sub-second, kills bad input before spending on the main call |
| Generate | The listing copy | Frontier tier (Sonnet-class) | Quality and instruction-following on the grounding contract |

Put the model IDs in `lib/models.ts` as named constants, never inline. Read the current model IDs from the Anthropic docs at build time — do not hardcode a guessed model string.

---

## 5. Data contracts

`lib/schema.ts` — this is the single source of truth. The API returns exactly this; the UI renders exactly this; the eval asserts exactly this.

```ts
import { z } from "zod";

export const ToneEnum = z.enum([
  "neutral",      // factual, spec-forward
  "warm",         // friendly DTC
  "premium",      // restrained, luxury
  "playful",      // energetic, casual
]);

export const ConfidenceEnum = z.enum(["observed", "inferred", "unknown"]);

/** A single factual claim the copy makes, with its evidential basis. */
export const ClaimSchema = z.object({
  attribute: z.string(),            // "material", "capacity", "colour"
  value: z.string(),                // "brushed stainless steel"
  confidence: ConfidenceEnum,
  evidence: z.string(),             // what in the image supports this
});

export const AssumptionSchema = z.object({
  field: z.string(),                // which output field depends on it
  assumption: z.string(),           // "assumed 350ml based on hand-scale"
  question: z.string(),             // what to ask the merchant
  severity: z.enum(["blocking", "advisory"]),
});

export const GenerationSchema = z.object({
  productType: z.string(),
  title: z.string().max(70),
  shortDescription: z.string().max(160),
  longDescription: z.string(),
  bullets: z.array(z.string()).length(5),
  seoMeta: z.object({
    metaDescription: z.string().max(155),
    keywords: z.array(z.string()).min(4).max(8),
    altText: z.string().max(125),
  }),
  observedClaims: z.array(ClaimSchema),
  assumptions: z.array(AssumptionSchema),
  tone: ToneEnum,
});

export type Generation = z.infer<typeof GenerationSchema>;
```

**Request:**

```ts
type GenerateRequest = {
  image: string;              // base64 data URL, server re-validates
  productName?: string;
  category?: string;
  tone: z.infer<typeof ToneEnum>;
  regenerateField?: keyof Generation;  // per-field regenerate
  previous?: Generation;               // context for regenerate
};
```

**Response:** `text/event-stream`, events `meta` → `delta` (repeated) → `done` | `error`. Each `delta` carries a JSON-patch-ish `{ path, chunk }` so fields fill independently.

**Error taxonomy** — the UI must render a distinct state for each:

| Code | HTTP | Meaning | UI |
|---|---|---|---|
| `IMAGE_TOO_LARGE` | 413 | >8MB or >4096px | Inline dropzone error + resize hint |
| `UNSUPPORTED_TYPE` | 415 | Not JPEG/PNG/WebP | Inline dropzone error |
| `NOT_A_PRODUCT` | 422 | Gate pass rejected | Friendly panel: "I can't tell what product this is — try a clear shot on a plain background" |
| `RATE_LIMITED` | 429 | Bucket empty | Countdown, disable button |
| `MODEL_UNAVAILABLE` | 503 | Upstream failure | Disabled state + retry; never a blank screen (see §8) |
| `SCHEMA_INVALID` | 500 | Output failed zod | Auto-retry once, then surface |

---

## 6. The grounding contract — *spend most of your effort here*

This is what separates the prototype from a wrapper around a vision call. Everything the model writes must be classifiable into one of three buckets, and the buckets have different licence to appear in copy.

| Bucket | Definition | May appear in copy? |
|---|---|---|
| **observed** | Directly visible in the image: shape, colour, visible text/logos, form factor, count, visible finish | Yes, freely |
| **inferred** | Reasonably deducible but not certain: rough size from context, likely use case, probable category | Yes, but hedged ("looks like", "appears") **and** must emit an `assumptions[]` entry |
| **unknown** | Not derivable from an image at all: exact dimensions, weight, material composition, capacity in ml, thread count, battery life, warranty, certifications, country of origin, price, care instructions | **Never.** Must become a `[SPECIFY: …]` placeholder in the copy plus a `blocking` assumption |

### System prompt (`lib/prompts.ts`)

```
You are a product-listing copywriter for an e-commerce platform. You are given ONE
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

Return your answer by calling the emit_listing tool. Do not write prose outside it.
```

### Enforcement (do not rely on the prompt alone)

`lib/groundingLint.ts` runs after zod parse and before the response is finalised:

| Check | Rule | On failure |
|---|---|---|
| `L1` Forbidden-unit scan | Regex for `\d+\s?(ml\|l\|kg\|g\|oz\|lb\|cm\|mm\|inch\|"\|thread count\|mAh\|W)\b` in any copy field | If not present in `observedClaims` with confidence `observed`, or wrapped in `[SPECIFY:]` → reject, retry once with the violation quoted back |
| `L2` Banned-superlative scan | Word list: best, #1, award-winning, clinically, organic, eco-friendly, sustainable, hypoallergenic, FDA, CE-certified, waterproof | Same as L1 |
| `L3` Placeholder/assumption parity | Every `[SPECIFY: x]` has a matching blocking assumption and vice versa | Reject, retry once |
| `L4` Bullet distinctness | Cosine similarity of bullet embeddings, or fallback: no two bullets share ≥60% of their content words | Regenerate bullets only |
| `L5` Length bounds | Enforced by zod `.max()` | Regenerate that field only |

Log every lint failure with the offending text. **The lint hit-rate is itself a product metric** — a rising L1/L2 rate on new images means the prompt has drifted or the model changed under you.

### UI consequence

The `AssumptionsPanel` is not an afterthought pane. It renders as an actionable checklist directly under the copy:

```
⚠ 2 things to confirm before publishing
  ☐ Capacity — I couldn't tell the size. [SPECIFY: capacity] appears in
     paragraph 2.                                          [ Fill in ▸ ]
  ☐ Material — looks like ceramic, hedged as "appears to be".
                                                           [ Confirm ▸ ]
```

Filling one in should re-render the copy client-side with the placeholder replaced — no second model call needed for a straight substitution.

---

## 7. UX spec

**Single screen, three states.** No routing, no nav.

| State | What's on screen |
|---|---|
| `empty` | Centred dropzone, three sample images ("try one"), one-line explainer |
| `configuring` | Image preview left, right rail: product name (optional), category select (optional), tone segmented control, **Generate** primary button |
| `streaming` | Same layout; right rail replaced by the result panel; fields fill progressively with a subtle shimmer on not-yet-filled fields; Generate becomes Stop |
| `complete` | Result panel with per-field copy buttons, per-field regenerate icons, global Regenerate, tone switcher (re-runs), assumptions checklist, Export JSON |
| `error` | Per §5 error taxonomy; the image and settings survive every error — never reset the form |

**Interaction rules that matter:**

- Every text field is `contentEditable` / a textarea. The merchant edits inline; edits persist across a per-field regenerate of *other* fields.
- Regenerate is debounced at 3s and rate-limited to 5 per session per field. Show the remaining count.
- Tone switch on a completed generation re-runs the generation with `previous` passed in, so structure is preserved and only voice moves.
- Copy-to-clipboard on each field, plus "Copy all as Shopify fields" which formats title / description / meta into the three fields a merchant actually pastes into.
- Sample images ship in `public/samples/` so the demo works with no upload and no camera.

---

## 8. Non-functional requirements

| Attribute | Requirement | Verification |
|---|---|---|
| Latency | TTFT < 2.0s p90; full output < 12s p90 | Timer instrumented client-side, logged to console + `/api/metrics` no-op sink |
| Streaming | Output must stream. A 10s spinner is a failed build. | Manual + eval harness records TTFT |
| Payload | Images downscaled client-side to max 1568px long edge before upload | Unit test on the resize util |
| Rate limiting | 10 generations / IP / hour, in-memory bucket, `Retry-After` header | Integration test |
| Degradation | On upstream 5xx or missing API key: disabled Generate button with an explicit banner ("Auto Write is temporarily unavailable"). Never a blank panel, never a fabricated fallback description. | Force with a bad key |
| Secrets | `ANTHROPIC_API_KEY` server-side only. Fail loudly at boot if absent. No key ever reaches the client bundle. | Grep the built bundle in CI |
| Privacy | Images held in memory for the request only, never written to disk, never logged. State this in a footer line. | Code review |
| Accessibility | Dropzone keyboard-operable, all state changes announced via `aria-live`, contrast AA | axe pass |
| Cost | Log input/output tokens per request and print an estimated cost in dev mode | Console assertion |

---

## 9. Repo layout & setup

```
auto-write/
├── app/
│   ├── page.tsx                  # single screen
│   ├── layout.tsx
│   └── api/generate/route.ts     # SSE handler, Node runtime
├── components/
│   ├── UploadDropzone.tsx
│   ├── ControlsBar.tsx
│   ├── ResultPanel.tsx
│   ├── EditableField.tsx
│   └── AssumptionsPanel.tsx
├── lib/
│   ├── schema.ts                 # zod contracts (§5)
│   ├── prompts.ts                # system prompt + tool definition (§6)
│   ├── groundingLint.ts          # L1-L5 (§6)
│   ├── models.ts                 # model ID constants
│   ├── rateLimit.ts
│   ├── image.ts                  # validate, sniff MIME, downscale
│   └── anthropic.ts              # client + streaming wrapper
├── evals/
│   ├── golden/                   # 20 product images + expected-attribute YAML
│   ├── negative/                 # 5 non-product images
│   ├── rubric.md
│   └── run.ts                    # §10 harness
├── public/samples/               # 3 demo images
└── .env.example                  # ANTHROPIC_API_KEY=
```

```bash
npx create-next-app@latest auto-write --typescript --tailwind --app --eslint
cd auto-write && npm i @anthropic-ai/sdk zod
cp .env.example .env.local   # add your key
npm run dev
```

---

## 10. Eval plan — *the second place to spend effort*

A prototype without an eval is a demo you cannot change safely. Build `evals/run.ts` in Phase 3, before you start tuning the prompt.

**Golden set:** 20 images across 5 categories (apparel, homeware, electronics accessory, food/beverage, handmade). For each, a YAML file listing:

```yaml
id: ceramic-mug-01
visible_attributes: [ceramic-look, matte white, cylindrical, handle, ~mug scale]
unknowable_attributes: [capacity_ml, dishwasher_safe, material_certainty, weight]
category: homeware
```

**Negative set:** 5 images — a person, a screenshot, a receipt, a landscape, a blurry unidentifiable object.

**Automated assertions per run:**

| Assertion | Pass condition |
|---|---|
| A1 Schema | zod parse succeeds first try |
| A2 No fabrication | No `unknowable_attributes` asserted as fact anywhere in copy (string + unit regex scan) |
| A3 Assumption coverage | Every `unknowable_attribute` referenced in copy has a blocking assumption |
| A4 Lint clean | Zero L1/L2/L3 violations after retry |
| A5 Negative set | All 5 return `NOT_A_PRODUCT` |
| A6 Latency | TTFT and total recorded, p90 within §3 targets |
| A7 Determinism of structure | 3 runs of the same image produce the same `productType` and the same set of `assumptions[].field` |

**Human rubric** (`evals/rubric.md`), 1–5 per output, 3 raters or 1 rater on 3 passes:

| Dimension | 1 | 5 |
|---|---|---|
| Truthfulness | Contains a claim I'd have to remove | Everything is either true or flagged |
| Publishability | I'd rewrite it | I'd publish after filling placeholders |
| Distinctiveness | Could describe any product | Specific to this object |
| Voice fit | Ignores the tone preset | Clearly the selected tone |

Ship gate: A1–A6 green, mean truthfulness ≥ 4.5, mean publishability ≥ 3.5.

---

## 11. Build phases

Each phase ends with a runnable state and an acceptance test. Do not proceed on a red phase.

| Phase | Deliverable | Acceptance test |
|---|---|---|
| **P0 — Skeleton** | Next.js app, single page, dropzone that previews an image client-side, downscale util | Drop a 12MB photo → preview renders, downscaled to ≤1568px, no network call |
| **P1 — Contracts** | `lib/schema.ts`, `lib/prompts.ts`, `lib/models.ts`; route returns a hardcoded valid `Generation` | `curl` the route → response parses against `GenerationSchema` |
| **P2 — Live generation** | Real Anthropic vision call with tool-use output, non-streaming | Real image → valid `Generation` with populated `assumptions[]` |
| **P3 — Eval harness** | `evals/run.ts`, golden + negative sets, A1–A6 | `npm run eval` prints a pass/fail table; failures are informative |
| **P4 — Grounding lint** | `groundingLint.ts` L1–L5 with single retry | Force a violation via a doctored prompt → lint catches, retries, passes |
| **P5 — Streaming** | SSE, progressive field fill, Stop button | TTFT < 2s on a warm route |
| **P6 — Editing loop** | Inline edit, per-field regenerate, tone switch, assumptions checklist with fill-in substitution | Fill a `[SPECIFY: capacity]` → copy updates with no model call |
| **P7 — Hardening** | Rate limit, error taxonomy, disabled state, a11y pass, privacy footer | Bad key → banner not blank screen; 11th request → 429 with countdown |

**Where to concentrate vs. hedge:**

- **Concentrate:** §6 grounding contract + lint (P4), and the eval harness (P3). These are the parts a generic "build me an AI product description app" prompt will not produce, and they are what makes the prototype defensible in a portfolio review.
- **Adequate is fine:** visual polish, tone presets, SEO keyword sophistication. Tailwind defaults, four hardcoded tones, keywords straight from the model.
- **Deliberately hedge:** persistence, auth, bulk, integrations. Zero of it in v0.1 — every hour there is an hour not spent on truthfulness.

---

## 12. Open questions to resolve during the build

| # | Question | Cheapest way to answer |
|---|---|---|
| Q1 | Does a merchant actually fill in `[SPECIFY:]` placeholders, or delete them and publish? | Watch 3 people use the prototype for 5 minutes each |
| Q2 | Does the gate pass earn its cost, or does the main model reject bad images just as well? | Run the negative set with and without the gate; compare cost and accuracy |
| Q3 | Is per-field regenerate used, or do people just regenerate everything? | Instrument both; if per-field is <10% of regenerates, cut it |
| Q4 | Does tone preset change anything a merchant notices? | Blind A/B two tones on the same image with 5 people |
| Q5 | Does image quality (phone snap vs studio) change the assumption count materially? | Same product, two photos, compare `assumptions[]` length |

---

## 13. v2 candidates (do not build now)

Multi-image synthesis · merchant brand-voice learning from existing listings · category-specific attribute schemas (apparel needs fabric/fit, electronics needs specs) · write-back to Shopify/Woo via API · bulk CSV → descriptions · A/B test copy variants against conversion · translation with locale-aware SEO.
