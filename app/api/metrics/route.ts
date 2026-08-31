/**
 * §8 requires a `/api/metrics` sink for the client-side latency timers. It is a no-op
 * by design in v0.1 — the numbers land in the server log, which is where the eval
 * harness and a `vercel logs` tail can both read them.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(JSON.stringify({ evt: "client_metric", ...body }));
  } catch {
    // A metrics sink must never be the reason a request fails.
  }
  return new Response(null, { status: 204 });
}
