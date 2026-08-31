# Auto Write

Upload a product photo → get merchant-ready, SEO-shaped listing copy, with every
unverifiable claim quarantined instead of hallucinated.

A prototype build of [`PRD.md`](./PRD.md). The two questions the spec left open —
where the backend lives and how the LLM part actually works — are answered in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

**It works with no API key.** `.env.example` ships with `AUTO_WRITE_PROVIDER=mock`, a
deterministic fixture provider — the full pipeline, streaming, lint and eval run
offline with no spend. Three sample images are in the dropzone.

For live generation, put a key in `.env.local` and switch the provider:

```bash
ANTHROPIC_API_KEY=sk-ant-...
AUTO_WRITE_PROVIDER=anthropic
```

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | unit tests + fixture contract tests |
| `npm run eval` | the §10 harness, A1–A7 (mock: free and deterministic) |
| `npm run test:e2e` | browser smoke test — drives the real UI and the fill-in loop |
| `AUTO_WRITE_PROVIDER=anthropic npm run eval` | the harness against real models |
| `npm run check:bundle` | §8 secret check — greps the built client bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run gen:samples` | regenerate the sample images |

## The idea in one paragraph

A vision model will confidently tell you a photograph shows 100% cotton, 500ml capacity
and stainless steel when it shows none of those things. One false claim on a live
listing means returns, chargebacks and consumer-law exposure, so the interesting problem
is not "is the copy good?" but "is the copy true?". Auto Write sorts every claim into
**observed** (visible in the photo — say it freely), **inferred** (deducible but not
certain — hedge it and log an advisory assumption) or **unknown** (not derivable from a
photograph at all — never state it; write `[SPECIFY: capacity]` and raise a blocking
assumption). The merchant gets a checklist of what to confirm, and filling one in
substitutes the placeholder client-side with no second model call.

## How it fits together

```
components/          the single screen (§7): empty → configuring → streaming → complete → error
  UploadDropzone       client-side downscale to a 1568px long edge before upload
  ControlsBar          name, category, tone
  ResultPanel          per-field copy, per-field regenerate, export
  EditableField        inline edit; [SPECIFY: …] rendered as a highlight
  AssumptionsPanel     the differentiator — an actionable checklist, not a footnote

lib/
  schema.ts            zod contracts (§5). Single source of truth
  prompts.ts           the grounding contract (§6) + tool defs generated from schema.ts
  groundingLint.ts     L1–L5 mechanical enforcement, with one correction retry
  partialJson.ts       tolerant streaming JSON parse → per-field {path, chunk} deltas
  pipeline.ts          gate → generate → validate → lint → retry (shared by route + eval)
  anthropic.ts         Anthropic provider + deterministic mock behind one interface
  image.ts             MIME sniff, dimension read, 8MB/4096px clamps, browser downscale
  rateLimit.ts         in-memory token bucket (see ARCHITECTURE.md for the caveat)
  models.ts            model IDs and pricing, env-overridable

app/api/generate/      the HTTP edge: validate, rate limit, SSE framing
evals/                 the §10 harness, golden + negative sets, rubric
```

The route handler and the eval harness call the **same** `runPipeline`. A harness that
re-implements the pipeline measures a fiction.

## Build phase status

| Phase | | Notes |
|---|---|---|
| P0 Skeleton | done | dropzone, preview, client downscale |
| P1 Contracts | done | `schema.ts`, `prompts.ts`, `models.ts` |
| P2 Live generation | done | vision + forced tool call; mock provider alongside |
| P3 Eval harness | done | A1–A7; **runs on stand-in images** — see `evals/README.md` |
| P4 Grounding lint | done | L1–L5 with one retry; acceptance test in `tests/unit.test.mts` |
| P5 Streaming | done | SSE, progressive per-field fill, Stop |
| P6 Editing loop | done | inline edit, per-field regenerate, tone switch, fill-in substitution |
| P7 Hardening | done | rate limit, full error taxonomy, degraded banner, a11y, privacy footer |

## Known gaps

Stated plainly, because a prototype that hides these is worse than one that doesn't.

1. **The golden set has no photographs.** 20 expectation files are committed; the images
   are not. The harness substitutes sample renders and marks every such row `*`. A2/A3
   are only a real grounding test against real photos. This is the single highest-value
   next hour of work — see `evals/README.md`.
2. **Rate limiting is per-instance.** In-memory buckets mean the real ceiling on
   serverless is `10 × instances`. Fine behind a demo link, not fine public.
   `ARCHITECTURE.md` has the swap.
3. **L4 bullet distinctness uses word overlap, not embeddings.** The spec allows this
   fallback. It catches restatement, not paraphrase.
4. **No human rubric scores yet.** S4 (publishable-without-edit ≥ 60%) and the
   truthfulness/publishability gates need raters. `evals/rubric.md` is ready for them.
5. **The sample and stand-in images are synthetic renders**, generated by
   `scripts/gen-samples.ts`. They exercise the pipeline; they are not photographs.

## Open questions the build is instrumented for

§12 of the spec asks five questions. Three can now be answered with data rather than
opinion:

- **Q2 — does the gate earn its cost?** Gate latency and cost are logged separately per
  request; both models are env-overridable. Run the negative set with the gate model
  set to the generate model and compare.
- **Q3 — is per-field regenerate used?** Every regenerate logs its scope to
  `/api/metrics`.
- **Q5 — does photo quality change the assumption count?** `assumptions[].length` is in
  every `generation` log line.

Q1 (do merchants fill in placeholders?) and Q4 (does tone matter?) need people, not
instrumentation.
