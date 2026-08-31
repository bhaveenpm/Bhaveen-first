/**
 * The LLM layer. Two passes (spec §4 model routing), behind one interface so the whole
 * app can run against a deterministic mock with no API key and no spend.
 *
 *   gate()          cheap tier, non-streaming, forced `classify_image` tool call
 *   streamListing() frontier tier, streaming, forced `emit_listing` tool call
 *
 * Structured output is a FORCED TOOL CALL, not parsed prose: `tool_choice` pins the
 * model to `emit_listing`, `strict: true` pins the arguments to the JSON Schema
 * generated from lib/schema.ts, and `eager_input_streaming` starts the argument JSON
 * flowing before the block is finished — which is what buys TTFT < 2s (§3/S2) on a
 * single-object payload.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import {
  CLASSIFY_IMAGE_TOOL,
  EMIT_LISTING_TOOL,
  GATE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildGenerateUserText,
  buildLintRetryText,
} from "./prompts";
import { GATE_MODEL, GENERATE_MODEL, estimateCostUsd } from "./models";
import { AutoWriteError, GateSchema, NOT_A_PRODUCT, type Generation, type GateResult, type Tone } from "./schema";
import { PartialJsonStream, type PathDelta } from "./partialJson";
import type { ValidatedImage } from "./image";
import type { LintViolation } from "./groundingLint";
import { MOCK_FIXTURES, mockFixtureFor } from "./mockFixtures";

export type Usage = { inputTokens: number; outputTokens: number; costUsd: number; model: string };

export type GenerateArgs = {
  image: ValidatedImage;
  tone: Tone;
  productName?: string;
  category?: string;
  regenerateField?: string;
  previous?: Generation;
  /** Lint violations from a prior attempt — triggers the correction turn (§6). */
  corrections?: LintViolation[];
  /** Mock-only routing hint. Ignored entirely by the real provider. */
  mockId?: string;
};

export interface Provider {
  readonly name: "anthropic" | "mock";
  gate(image: ValidatedImage, mockId?: string): Promise<{ result: GateResult; usage: Usage; ms: number }>;
  streamListing(
    args: GenerateArgs,
    onDeltas: (deltas: PathDelta[]) => void,
    signal?: AbortSignal,
  ): Promise<{ raw: unknown; usage: Usage }>;
}

// ---------------------------------------------------------------------------
// Provider status — drives the §8 "degradation" banner instead of a blank screen.
// ---------------------------------------------------------------------------

export type ProviderStatus = { provider: "anthropic" | "mock"; ready: boolean; reason?: string };

export function providerStatus(): ProviderStatus {
  const mode = (process.env.AUTO_WRITE_PROVIDER ?? "").toLowerCase();
  if (mode === "mock") return { provider: "mock", ready: true };
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      ready: false,
      reason:
        "ANTHROPIC_API_KEY is not set. Add it to .env.local, or set AUTO_WRITE_PROVIDER=mock to run the prototype without a key.",
    };
  }
  return { provider: "anthropic", ready: true };
}

// ---------------------------------------------------------------------------
// Real provider
// ---------------------------------------------------------------------------

/** Thinking is off by default: S2 caps TTFT at 2.0s p90 and this is a structured
 *  extraction under a forced tool call, not open-ended reasoning. Flip to `adaptive`
 *  to measure the grounding-vs-latency trade in the eval harness. */
const THINKING_MODE = (process.env.AUTO_WRITE_THINKING ?? "disabled").toLowerCase();

class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  private client = new Anthropic({ maxRetries: 1 });

  private imageBlock(image: ValidatedImage): Anthropic.ImageBlockParam {
    return {
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    };
  }

  async gate(image: ValidatedImage) {
    const started = Date.now();
    try {
      const res = await this.client.messages.create({
        model: GATE_MODEL,
        max_tokens: 512,
        system: GATE_SYSTEM_PROMPT,
        tools: [CLASSIFY_IMAGE_TOOL as unknown as Anthropic.Tool],
        tool_choice: { type: "tool", name: "classify_image" },
        messages: [
          { role: "user", content: [this.imageBlock(image), { type: "text", text: "Classify this image." }] },
        ],
      });

      const block = res.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new AutoWriteError("MODEL_UNAVAILABLE", "The image gate returned no classification.");
      }
      const parsed = GateSchema.safeParse(block.input);
      if (!parsed.success) {
        // A malformed gate must not block a real product — fail open and let the
        // generate pass apply grounding rule 7 instead.
        return {
          result: { isProduct: true, productType: "", category: "", reason: "gate parse failed; falling through" },
          usage: usageOf(res, GATE_MODEL),
          ms: Date.now() - started,
        };
      }
      return { result: parsed.data, usage: usageOf(res, GATE_MODEL), ms: Date.now() - started };
    } catch (err) {
      throw mapApiError(err);
    }
  }

  async streamListing(args: GenerateArgs, onDeltas: (d: PathDelta[]) => void, signal?: AbortSignal) {
    const userText = buildGenerateUserText(args);

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: [this.imageBlock(args.image), { type: "text", text: userText }] },
    ];

    // Correction turn (§6): quote the violation back rather than restating the rule.
    if (args.corrections?.length) {
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_prev",
            name: EMIT_LISTING_TOOL.name,
            input: (args.previous ?? {}) as Record<string, unknown>,
          },
        ],
      });
      messages.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_prev", content: "Listing received. Validating." },
          { type: "text", text: buildLintRetryText(args.corrections.map((v) => ({ rule: v.rule, message: v.message, offending: v.offending }))) },
        ],
      });
    }

    try {
      const stream = this.client.messages.stream(
        {
          model: GENERATE_MODEL,
          max_tokens: 4096,
          // Frozen prefix, cached: the grounding contract never varies per request.
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: [EMIT_LISTING_TOOL as unknown as Anthropic.Tool],
          tool_choice: { type: "tool", name: "emit_listing" },
          ...(THINKING_MODE === "adaptive" ? { thinking: { type: "adaptive" as const } } : {}),
          messages,
        },
        { signal },
      );

      const acc = new PartialJsonStream();
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          const deltas = acc.push(event.delta.partial_json);
          if (deltas.length) onDeltas(deltas);
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        // Safety decline. From the merchant's side the actionable message is the same
        // as an unusable image, so reuse that UI state rather than a raw 5xx.
        throw new AutoWriteError("NOT_A_PRODUCT", "I can't write a listing for this image.");
      }

      const toolUse = final.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new AutoWriteError("SCHEMA_INVALID", "The model did not call emit_listing.");
      }
      return { raw: toolUse.input, usage: usageOf(final, GENERATE_MODEL) };
    } catch (err) {
      throw mapApiError(err);
    }
  }
}

function usageOf(msg: { usage: Anthropic.Usage }, model: string): Usage {
  const inputTokens =
    msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = msg.usage.output_tokens;
  return { inputTokens, outputTokens, model, costUsd: estimateCostUsd(model, inputTokens, outputTokens) };
}

function mapApiError(err: unknown): AutoWriteError {
  if (err instanceof AutoWriteError) return err;
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 429) return new AutoWriteError("RATE_LIMITED", "Upstream rate limit reached. Try again shortly.");
    if (status >= 500 || status === 0) {
      return new AutoWriteError("MODEL_UNAVAILABLE", "Auto Write is temporarily unavailable.", err.message);
    }
    if (status === 401 || status === 403) {
      return new AutoWriteError("MODEL_UNAVAILABLE", "Auto Write is not configured correctly (API key rejected).");
    }
    return new AutoWriteError("MODEL_UNAVAILABLE", "Upstream request failed.", err.message);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new AutoWriteError("MODEL_UNAVAILABLE", "Generation stopped.");
  }
  return new AutoWriteError("MODEL_UNAVAILABLE", "Auto Write is temporarily unavailable.", String(err));
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic, offline, free.
//
// This is not decoration: it is what makes `npm run eval` runnable in CI without
// spend, what lets the UI be developed against every error state on demand, and what
// makes the P4 lint-retry path testable (fixture `lint-violation-01` deliberately
// emits a violation on the first call and the corrected copy on the retry).
// ---------------------------------------------------------------------------

const MOCK_CHUNK_MS = Number(process.env.AUTO_WRITE_MOCK_CHUNK_MS ?? 6);

class MockProvider implements Provider {
  readonly name = "mock" as const;

  async gate(image: ValidatedImage, mockId?: string) {
    const started = Date.now();
    await sleep(120);
    const fixture = mockFixtureFor(mockId, image.base64);
    const isProduct = fixture.productType !== NOT_A_PRODUCT;
    return {
      result: {
        isProduct,
        productType: isProduct ? fixture.productType : NOT_A_PRODUCT,
        category: fixture.category,
        reason: isProduct
          ? `Single ${fixture.productType} on a plain background.`
          : "No sellable product is identifiable in this image.",
      },
      usage: { inputTokens: 900, outputTokens: 60, model: "mock-gate", costUsd: 0.0012 },
      ms: Date.now() - started,
    };
  }

  async streamListing(args: GenerateArgs, onDeltas: (d: PathDelta[]) => void, signal?: AbortSignal) {
    const fixture = mockFixtureFor(args.mockId, args.image.base64);
    // Second attempt (the route retries after a lint failure) yields the clean copy.
    const attempt = args.corrections?.length ? "corrected" : "first";
    const generation = fixture.build({ tone: args.tone, productName: args.productName, attempt });

    const json = JSON.stringify(generation);
    const acc = new PartialJsonStream();
    // Chunk sizes mimic real token deltas so the UI's progressive fill is honest.
    for (let i = 0; i < json.length; ) {
      if (signal?.aborted) throw new AutoWriteError("MODEL_UNAVAILABLE", "Generation stopped.");
      const n = 8 + (i % 17);
      const deltas = acc.push(json.slice(i, i + n));
      if (deltas.length) onDeltas(deltas);
      i += n;
      if (MOCK_CHUNK_MS > 0) await sleep(MOCK_CHUNK_MS);
    }

    const inputTokens = 1250;
    const outputTokens = Math.ceil(json.length / 3.6);
    return {
      raw: generation,
      usage: {
        inputTokens,
        outputTokens,
        model: "mock-generate",
        costUsd: estimateCostUsd(GENERATE_MODEL, inputTokens, outputTokens),
      },
    };
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Stable seed from the image bytes, so an unregistered image still mocks consistently. */
export function imageSeed(base64: string): string {
  return createHash("sha256").update(base64).digest("hex").slice(0, 12);
}

let cached: Provider | null = null;

export function getProvider(): Provider {
  if (cached) return cached;
  const status = providerStatus();
  if (status.provider === "mock") {
    console.warn(
      JSON.stringify({ evt: "provider", provider: "mock", note: "deterministic fixtures; no API calls, no spend" }),
    );
    cached = new MockProvider();
  } else {
    if (!status.ready) {
      // §8: fail loudly. The route still answers with a MODEL_UNAVAILABLE banner
      // rather than a blank screen, so the demo degrades instead of breaking.
      console.error(JSON.stringify({ evt: "provider_unconfigured", reason: status.reason }));
    }
    cached = new AnthropicProvider();
  }
  return cached;
}

export function resetProvider(): void {
  cached = null;
}

export { MOCK_FIXTURES };
