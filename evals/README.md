# Eval set

## Layout

```
evals/
├── golden/     20 expectation files, 4 per category × 5 categories
├── negative/   5 non-product expectations
├── rubric.md   the human scoring rubric
└── run.ts      the harness (A1–A7)
```

## Images are not committed

Each expectation file is `<id>.yaml`. The harness looks for a matching image at
`evals/golden/<id>.{png,jpg,jpeg,webp}`.

**Where no image is present it substitutes a bundled sample render and marks the row
`*` (STAND-IN).** The summary prints how many rows were stand-ins.

This matters: A2 (no fabrication) and A3 (assumption coverage) are only a real
grounding test against real product photographs. A green run on stand-ins proves the
pipeline, the lint and the harness work — it does not prove the model is grounded. The
harness says so at the end of every such run, on purpose.

## Making the eval real

1. Shoot or source 20 product photos — 4 each in apparel, homeware, electronics
   accessory, food/beverage, handmade. Phone snaps are fine and arguably better
   (§12/Q5 asks whether photo quality changes the assumption count).
2. Save each as `evals/golden/<id>.jpg`, matching an existing id.
3. Check the YAML: `visible_attributes` is what the photo genuinely shows;
   `unknowable_attributes` is what it genuinely cannot.
4. Add the 5 negative images: a person, a screenshot, a receipt, a landscape, a blurry
   unidentifiable object.
5. `AUTO_WRITE_PROVIDER=anthropic npm run eval`

## Running

```bash
npm run eval                                     # mock: free, deterministic, CI-safe
AUTO_WRITE_PROVIDER=anthropic npm run eval       # real models, real spend
npm run eval -- --only ceramic-mug-01            # one golden
npm run eval -- --tone premium                   # a different tone preset
npm run eval -- --determinism 5 --determinism-sample 4
```

## What each assertion means

| | Checks | Fails when |
|---|---|---|
| A1 | zod parses first try | the schema needed a retry |
| A2 | no unknowable asserted as fact | an attribute is paired with a concrete value, outside a placeholder, unhedged, and not an observed claim |
| A3 | assumption coverage | a `[SPECIFY: x]` has no matching blocking assumption, or nothing is flagged at all |
| A4 | lint clean after retry | L1–L5 violations survive the retry budget |
| A5 | negative set | any non-product produced a listing |
| A6 | latency | TTFT p90 ≥ 2s, or total p90 ≥ 12s |
| A7 | structural determinism | repeat runs disagree on `productType` or the set of `assumptions[].field` |

A2 counts a *mention* of an unknowable as fine — naming an attribute while
placeholdering it ("Capacity is [SPECIFY: capacity]") is the desired shape. It only
fails when a concrete value appears. The summary reports how many checks actually had
something to assert on, so a green A2 on thin data cannot be over-read.
