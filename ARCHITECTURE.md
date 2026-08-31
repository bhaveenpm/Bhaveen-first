# Architecture decisions

The build spec left two things unresolved. This document answers both, says what each
choice costs, and names the point at which the answer should change.

Everything else follows the spec (`PRD.md`).

---

## Q1 — Where does the backend sit?

**Answer: inside the Next.js app, as a Route Handler (`app/api/generate/route.ts`) on
the Node runtime. There is no second service.**

One repo, one deploy, one process. `next start` runs it locally; on Vercel the same
file becomes a serverless function with no code change.

### Why that is the right call for v0.1

The server tier only has to do five things, and every one of them is request-scoped:

| Responsibility | Why it must be server-side |
|---|---|
| Hold `ANTHROPIC_API_KEY` | A browser-side key is a public key |
| Validate the upload | MIME sniffed from magic bytes; the client's declared type is attacker-controlled |
| Rate limit | A client-enforced limit is a suggestion |
| Call Anthropic and lint the result | The grounding contract is the product; it cannot live somewhere the merchant can edit |
| Frame SSE | — |

There is no database, no queue, no cron, no auth, no background work. §1 of the spec
puts persistence out of scope entirely. A separate Express or FastAPI service would add
a deploy target, a CORS surface, a second set of env vars and a network hop between two
things that are always released together — and buy nothing, because there is no state
for it to own.

**Node runtime, not Edge**, for two concrete reasons: `Buffer` for base64 decoding and
the MIME sniff, and the `@anthropic-ai/sdk` streaming client.

### What this costs — read this part

**The in-memory rate limiter is per-instance.** `lib/rateLimit.ts` holds a `Map` in
process memory. On a serverless deploy, N warm instances means the real ceiling is
`10 × N` per IP per hour, not 10. Instances also recycle, which resets buckets early.

This is fine for a prototype behind a demo link and it is **not** fine the moment the
URL is public. The fix is a two-line swap to Upstash Redis behind the same
`rateLimit(key)` signature — the interface was written for that substitution. It is
called out here rather than buried because "we have rate limiting" is exactly the kind
of claim that is true in dev and false in production.

Two smaller consequences of the same choice:

- **Streaming needs a runtime that supports it.** Vercel Node functions do; a static
  export or a CDN with response buffering does not. `cache-control: no-transform` is
  set to stop an intermediary buffering the SSE body.
- **Function timeout is the ceiling on generation.** Default Vercel Node timeouts are
  comfortably above the 12s p90 target, but a `maxDuration` bump is the first thing to
  reach for if the p99 ever gets close.

### When to move the backend out

Extract a standalone service when any of these arrive — not before:

- Bulk CSV → descriptions (needs a job queue and durable state)
- Write-back to Shopify/Woo (needs OAuth tokens at rest, webhooks, retries)
- Accounts and saved drafts (needs a database and a migration story)
- The eval harness as a service (needs scheduling and result storage)

All four are explicitly v2 in the spec. Until one lands, a separate backend is a cost
with no matching benefit.

---

## Q2 — How does the LLM part actually work?

**Answer: two passes to the Anthropic Messages API, both server-side, both behind a
forced tool call, with a deterministic mock provider sitting behind the same interface.**

```
image ──► GATE  (claude-haiku-4-5, non-streaming)
          forced tool: classify_image  ──► isProduct=false ──► HTTP 422, stop
                    │
                    ▼ isProduct=true
          GENERATE (claude-sonnet-5, streaming)
          system = the grounding contract (cached prefix)
          forced tool: emit_listing, strict, eager_input_streaming
                    │
          input_json_delta fragments
                    │
          PartialJsonStream ──► {path, chunk} ──► SSE ──► fields fill independently
                    │
          StrictGenerationSchema (zod) ──► groundingLint L1–L5
                    │
          violations? ──► ONE retry, quoting the offending text back
                    │
                  done
```

### The five decisions that matter

**1. Structured output is a forced tool call, not parsed prose.**
`tool_choice: {type: "tool", name: "emit_listing"}` plus `strict: true`. The model
cannot write prose outside the schema, so there is no brittle "extract the JSON from
the markdown fence" step and no class of failure where the copy is fine but unparseable.

**2. The tool's JSON Schema is generated from the zod contract.**
`z.toJSONSchema(GenerationSchema)` in `lib/prompts.ts`. The shape the model is asked
for and the shape we validate are the same object by construction. They cannot drift.

**3. One JSON payload still streams field by field.**
The listing is a single tool call, which arrives as `input_json_delta` fragments of one
JSON document — useless for progressive UI on its own. `lib/partialJson.ts` tolerantly
parses the prefix on every fragment, diffs it against the previous snapshot, and emits
`{path, chunk}` deltas. That is what makes TTFT < 2s achievable (§3/S2) on a payload
that is only complete at the very end. `eager_input_streaming: true` on the tool
definition starts the argument JSON flowing before the block closes.

The parser deliberately withholds two things until they are certain: a number touching
the end of the buffer (`35` may become `350`) and a half-written object key. Emitting
either would put a value on screen that is about to change.

**4. The prompt is not the enforcement.**
`groundingLint.ts` re-checks the output mechanically (L1–L5) and, on a reject, retries
once with the **offending text quoted back**. Naming the rule alone tends to produce a
different violation; quoting the span fixes the specific one. Lint hit-rate is logged
per rule because, as the spec says, a rising L1/L2 rate is the early warning that the
prompt drifted or the model changed underneath you.

**5. Thinking is off by default on the generate pass.**
`AUTO_WRITE_THINKING=disabled`. S2 caps TTFT at 2.0s p90, and this is structured
extraction under a forced tool call, not open-ended reasoning. Set
`AUTO_WRITE_THINKING=adaptive` and re-run `npm run eval` to measure the grounding-vs-
latency trade directly — that is precisely the kind of question the harness exists to
settle, and it should be settled with numbers rather than in this document.

### The mock provider

`AUTO_WRITE_PROVIDER=mock` swaps in deterministic fixtures behind the same `Provider`
interface. It is not decoration:

- the prototype demos with **no API key and no spend**
- `npm run eval` runs in CI for free, and deterministically
- every error state in the §5 taxonomy can be triggered on demand
- fixture `lint-violation-01` deliberately emits `500ml` and `eco-friendly` on the
  first attempt and clean copy on the retry, which is what makes P4's acceptance test
  a real test rather than an assertion that nothing happened

`npm run test:fixtures` puts every fixture through zod **and** the grounding lint, so
the mock cannot quietly start emitting copy the real pipeline would reject.

### Model routing and cost

`lib/models.ts`, env-overridable, never inlined (spec §4):

| Pass | Model | Why |
|---|---|---|
| Gate | `claude-haiku-4-5` | Sub-second, kills bad input before the expensive call |
| Generate | `claude-sonnet-5` | Spec §4 specifies a frontier/Sonnet-class tier for instruction-following on the grounding contract |

Both are overridable (`AUTO_WRITE_GATE_MODEL`, `AUTO_WRITE_GENERATE_MODEL`), which is
how §12/Q2 — "does the gate pass earn its cost?" — gets answered rather than argued.
Gate cost and latency are logged separately from generate cost for exactly that
comparison. Token usage is priced per request and checked against the S7 ceiling of
$0.03; exceeding it logs `cost_ceiling_exceeded`.

### Deviation from the spec, and why

**`seoMeta.keywords` is `.max(8)` in the schema, not `.min(4).max(8)`.**

The spec's §5 schema requires at least 4 keywords, and grounding rule 7 requires a
non-product to return `NOT_A_PRODUCT` with **every copy field empty**. Those two
constraints contradict each other: a compliant refusal is unrepresentable, and under
strict tool use the model would be forced to either invent keywords for a photo of a
landscape or fail schema validation.

The floor is enforced conditionally instead, in `StrictGenerationSchema`: real listings
still owe 4–8 keywords; a `NOT_A_PRODUCT` response must have empty copy or it fails
validation. Same guarantee, expressible. This was caught by `npm run test:fixtures`,
which is the argument for building the fixtures before the UI.

---

## Trust boundaries

| Input | Treated as |
|---|---|
| Uploaded image bytes | Untrusted. MIME sniffed from magic bytes; dimensions read from container headers; 8MB / 4096px clamps enforced server-side regardless of what the client did |
| `productName`, `category` | Untrusted merchant text. Passed as *identity* context only — the prompt states explicitly that it licenses no spec claim |
| `previous` (regenerate/tone-switch) | Client-supplied and therefore untrusted, but it only ever becomes prompt context, and every response goes back through zod + lint before it reaches the UI |
| `mockId` | Honoured **only** when the mock provider is active. The real provider takes no such input, so it cannot become a way to steer production output |
| Model output | Untrusted until it has passed zod **and** L1–L5 |

`ANTHROPIC_API_KEY` is read server-side only. `npm run check:bundle` greps the built
client bundle for key values, env reads, the system prompt and the tool definitions —
§8's "grep the built bundle in CI", as an actual command.

Images are held in memory for the request and never written to disk or logged.
