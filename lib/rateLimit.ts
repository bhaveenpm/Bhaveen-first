/**
 * Spec §8: 10 generations / IP / hour, in-memory token bucket, `Retry-After` header.
 *
 * IN-MEMORY IS A DELIBERATE v0.1 CHOICE, AND IT HAS A CAVEAT — see ARCHITECTURE.md.
 * On a serverless deploy each warm instance keeps its own bucket, so the effective
 * ceiling is 10 × (live instances) per hour. Fine for a prototype behind a demo link;
 * swap the Map for Upstash Redis (same interface) the moment this is public.
 */

const WINDOW_MS = 60 * 60 * 1000;
const CAPACITY = Number(process.env.AUTO_WRITE_RATE_LIMIT ?? 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — the `Retry-After` value. */
  retryAfter: number;
};

export function rateLimit(key: string, now = Date.now()): RateLimitResult {
  // Opportunistic sweep so a long-lived process does not grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }

  const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
  if (b.count >= CAPACITY) {
    return { allowed: false, remaining: 0, retryAfter };
  }
  b.count++;
  return { allowed: true, remaining: CAPACITY - b.count, retryAfter };
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "local";
}

export function resetRateLimit(): void {
  buckets.clear();
}
