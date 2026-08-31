/**
 * THE BACKEND. Spec §4 puts it here deliberately — see ARCHITECTURE.md for why a
 * Next.js Route Handler is the entire server tier for v0.1, and what that costs.
 *
 * This file owns only the things that are genuinely about the HTTP edge:
 *   1. validateUpload()  size, MIME sniff, dimension clamp
 *   2. rateLimit()       in-memory token bucket per IP
 *   7. SSE framing       meta -> delta* -> done | error
 *
 * Steps 3-6 (gate, prompt, model call, validate + lint retry) live in lib/pipeline.ts
 * so the eval harness exercises the same code path this route does.
 */
import { NextRequest } from "next/server";
import { AutoWriteError, GenerateRequestSchema, type StreamEvent } from "@/lib/schema";
import { validateUpload } from "@/lib/image";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { getProvider, providerStatus } from "@/lib/anthropic";
import { runGate, runPipeline } from "@/lib/pipeline";
import { COST_CEILING_USD, GENERATE_MODEL } from "@/lib/models";

/** Node, not Edge: Buffer for the MIME sniff, and the Anthropic SDK. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: AutoWriteError) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (err.code === "RATE_LIMITED" && typeof err.detail === "number") {
    headers["retry-after"] = String(err.detail);
  }
  return new Response(
    JSON.stringify({ type: "error", code: err.code, message: err.message, detail: err.detail }),
    { status: err.status, headers },
  );
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(new AutoWriteError("BAD_REQUEST", "Expected a JSON body."));
  }
  const parsedReq = GenerateRequestSchema.safeParse(body);
  if (!parsedReq.success) {
    return errorResponse(
      new AutoWriteError("BAD_REQUEST", "Invalid request.", parsedReq.error.issues.map((i) => i.path.join("."))),
    );
  }
  const input = parsedReq.data;

  // ---- provider health (§8 degradation: a banner, never a blank panel) ----------
  const status = providerStatus();
  if (!status.ready) {
    return errorResponse(
      new AutoWriteError("MODEL_UNAVAILABLE", "Auto Write is temporarily unavailable.", status.reason),
    );
  }

  // ---- 1. validate the upload ---------------------------------------------------
  let image;
  try {
    image = validateUpload(input.image);
  } catch (err) {
    return errorResponse(
      err instanceof AutoWriteError ? err : new AutoWriteError("UNSUPPORTED_TYPE", "Unreadable image."),
    );
  }

  // ---- 2. rate limit -------------------------------------------------------------
  const rl = rateLimit(clientKey(req.headers));
  if (!rl.allowed) {
    return errorResponse(
      new AutoWriteError("RATE_LIMITED", `Rate limit reached. Try again in ${rl.retryAfter}s.`, rl.retryAfter),
    );
  }

  const provider = getProvider();
  // Mock-only fixture hint. The real provider never receives it.
  const mockId =
    provider.name === "mock"
      ? (req.headers.get("x-auto-write-mock-id") ?? input.mockId ?? undefined)
      : undefined;

  // ---- 3. the gate, BEFORE the stream opens ---------------------------------------
  // Once an SSE response starts the status code is already 200, so the §5 taxonomy's
  // 422 for a non-product has to be decided here.
  let gate;
  try {
    gate = await runGate({ image, mockId, provider });
  } catch (err) {
    return errorResponse(
      err instanceof AutoWriteError ? err : new AutoWriteError("MODEL_UNAVAILABLE", "The image gate failed."),
    );
  }
  if (!gate.result.isProduct) {
    console.log(JSON.stringify({ evt: "gate_reject", reason: gate.result.reason, gateMs: gate.ms }));
    return errorResponse(
      new AutoWriteError(
        "NOT_A_PRODUCT",
        "I can't tell what product this is — try a clear shot on a plain background.",
        gate.result.reason,
      ),
    );
  }

  // ---- 7. stream ------------------------------------------------------------------
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await runPipeline(
          {
            image,
            tone: input.tone,
            productName: input.productName,
            category: input.category,
            regenerateField: input.regenerateField,
            previous: input.previous,
            mockId,
            signal: req.signal,
            provider,
            gate,
          },
          {
            onGate: (g) =>
              send({
                type: "meta",
                productType: g.productType,
                category: g.category || input.category,
                gateMs: g.ms,
                model: provider.name === "mock" ? "mock" : GENERATE_MODEL,
              }),
            onDeltas: (deltas) => {
              for (const d of deltas) send({ type: "delta", path: d.path, chunk: d.chunk, replace: d.replace });
            },
          },
        );

        // A correction pass produced a different object than the one already streamed.
        // Replace every leaf wholesale so corrected and stale copy can never coexist.
        if (result.attempts > 0) {
          for (const [path, value] of flatten(result.generation)) {
            send({ type: "delta", path, chunk: value, replace: true });
          }
        }

        const totalMs = Date.now() - startedAt;
        if (result.usage.costUsd > COST_CEILING_USD) {
          console.warn(
            JSON.stringify({ evt: "cost_ceiling_exceeded", costUsd: result.usage.costUsd, ceiling: COST_CEILING_USD }),
          );
        }
        console.log(
          JSON.stringify({
            evt: "generation",
            provider: provider.name,
            productType: result.generation.productType,
            totalMs,
            gateMs: result.gateMs,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            costUsd: Number(result.usage.costUsd.toFixed(5)),
            lintRetries: result.attempts,
            lintViolations: result.allViolations.length,
            unresolved: result.unresolvedViolations.length,
          }),
        );

        send({
          type: "done",
          generation: result.generation,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            costUsd: result.usage.costUsd,
            totalMs,
            lintRetries: result.attempts,
          },
        });
      } catch (err) {
        const e =
          err instanceof AutoWriteError
            ? err
            : new AutoWriteError("MODEL_UNAVAILABLE", "Auto Write is temporarily unavailable.", String(err));
        send({ type: "error", code: e.code, message: e.message, detail: e.detail });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-ratelimit-remaining": String(rl.remaining),
    },
  });
}

/** Flatten a Generation into dotted-path string leaves for wholesale replacement. */
function flatten(value: unknown, base = ""): [string, string][] {
  if (typeof value === "string") return [[base, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => flatten(v, base ? `${base}.${i}` : String(i)));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => flatten(v, base ? `${base}.${k}` : k));
  }
  return value === undefined ? [] : [[base, String(value)]];
}
