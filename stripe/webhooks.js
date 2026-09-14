import Stripe from "stripe";

/**
 * Webhook handling, which is where an integration's correctness actually lives.
 *
 * The reason it matters this much: almost nothing in Stripe is final when your
 * API call returns. A PaymentIntent can succeed minutes later, a subscription
 * renews without you, a Connect account's capabilities change while nobody is
 * looking. The API call starts the story; the webhook tells you how it ended.
 *
 * Four rules, each of which exists because breaking it causes a specific bug:
 *
 *   1. Verify the signature over the RAW BYTES.
 *   2. Be idempotent on event.id -- Stripe redelivers.
 *   3. Don't trust ordering -- re-fetch when it matters.
 *   4. Return 2xx fast, then work.
 */

/**
 * An in-memory seen-set so the reference implementation is honest about needing
 * one. In production this must be your database, with a unique constraint on
 * the event id -- the constraint is what makes concurrent redeliveries safe,
 * which a read-then-write check is not.
 */
export class InMemoryEventLog {
  #seen = new Set();

  /** Returns true if this is the first time we've seen the id. */
  async claim(eventId) {
    if (this.#seen.has(eventId)) return false;
    this.#seen.add(eventId);
    return true;
  }

  get size() {
    return this.#seen.size;
  }
}

/**
 * `rawBody` must be the exact bytes Stripe sent -- a Buffer or string, never a
 * parsed object and never re-serialised JSON. `JSON.parse` then
 * `JSON.stringify` reorders keys and changes whitespace, and the signature no
 * longer matches.
 *
 * This is the single most common webhook bug, and it is usually caused by a
 * body-parsing middleware mounted globally. Express needs
 * `express.raw({type: 'application/json'})` on this route specifically.
 */
export function verifyEvent({ rawBody, signatureHeader, webhookSecret }) {
  if (!webhookSecret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Get it from `stripe listen` or the dashboard endpoint, " +
        "and note it is per-endpoint -- the test and live endpoints have different secrets.",
    );
  }
  if (rawBody == null) throw new Error("rawBody is required.");
  if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) {
    throw new TypeError(
      "rawBody must be a string or Buffer of the original request body. " +
        "A parsed object cannot be verified -- the signature is over the bytes.",
    );
  }
  // constructEvent throws StripeSignatureVerificationError on a bad signature
  // or a timestamp outside the tolerance (replay protection). Let it throw:
  // an unverifiable event must never reach your business logic.
  return Stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

/**
 * Dispatches verified events to handlers, enforcing idempotency.
 *
 * Handlers receive `{ event, object, accountId }`. `accountId` is
 * `event.account` -- present when the event concerns a *connected* account
 * rather than your platform. Connect events for all your sellers arrive at your
 * platform endpoint, so routing on this field is what stops you applying a
 * seller's event to your own records.
 */
export function createWebhookRouter({ handlers = {}, eventLog = new InMemoryEventLog() } = {}) {
  return {
    async dispatch(event) {
      const first = await eventLog.claim(event.id);
      if (!first) {
        // Not an error. Stripe retries until it gets a 2xx, and it can deliver
        // twice even after one. Silently succeeding is the correct response --
        // the work is already done.
        return { status: "duplicate", eventId: event.id, type: event.type };
      }

      const handler = handlers[event.type];
      if (!handler) {
        // Unhandled is fine and must still be a 2xx, or Stripe retries it
        // forever. Only handle what you have a reason to handle.
        return { status: "unhandled", eventId: event.id, type: event.type };
      }

      const result = await handler({
        event,
        object: event.data?.object,
        accountId: event.account ?? null,
      });
      return { status: "handled", eventId: event.id, type: event.type, result };
    },
  };
}

/**
 * The events worth wiring, annotated with why. This is a starting set, not a
 * complete one -- but every entry here has a consequence if you drop it.
 */
export const RECOMMENDED_EVENTS = {
  // --- Connect ---
  "account.updated":
    "Capabilities changed. This is how you learn a seller became able (or unable) to take money.",
  "capability.updated": "Finer-grained than account.updated; use if you gate per-capability.",
  "account.application.deauthorized": "The seller disconnected. Stop routing charges to them.",

  // --- Flow A: marketplace payments ---
  "payment_intent.succeeded":
    "Record the Stripe Tax transaction here (tax.js record()). NOT at charge creation.",
  "payment_intent.payment_failed": "Surface an actionable decline reason to the buyer.",
  "charge.dispute.created":
    "Your liability when controller.losses.payments is 'application'. Respond in time or lose by default.",
  "charge.refunded": "Reverse the tax transaction (tax.js reverseFull()).",

  // --- Flow B: platform billing ---
  "invoice.paid": "Grant or extend the seller's entitlement.",
  "invoice.payment_failed": "Dunning. This is churn; it needs a real flow, not a log line.",
  "customer.subscription.updated":
    "Plan changes, cancel_at_period_end, trial ending. Re-read state rather than diffing.",
  "customer.subscription.deleted": "Revoke entitlement.",
};
