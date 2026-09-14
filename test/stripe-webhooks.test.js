import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { verifyEvent, createWebhookRouter, InMemoryEventLog } from "../stripe/webhooks.js";

const SECRET = "whsec_testsecret";

/** Sign a payload the way Stripe would, so verification is exercised for real. */
function signed(payload) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { body, header };
}

test("a correctly signed event verifies", () => {
  const { body, header } = signed({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
  const event = verifyEvent({ rawBody: body, signatureHeader: header, webhookSecret: SECRET });
  assert.equal(event.id, "evt_1");
  assert.equal(event.type, "invoice.paid");
});

test("a tampered payload fails verification", () => {
  const { header } = signed({ id: "evt_1", type: "invoice.paid" });
  assert.throws(
    () =>
      verifyEvent({
        rawBody: JSON.stringify({ id: "evt_1", type: "invoice.paid", tampered: true }),
        signatureHeader: header,
        webhookSecret: SECRET,
      }),
    /signature/i,
  );
});

test("the wrong signing secret fails verification", () => {
  const { body, header } = signed({ id: "evt_1", type: "invoice.paid" });
  assert.throws(
    () => verifyEvent({ rawBody: body, signatureHeader: header, webhookSecret: "whsec_other" }),
    /signature/i,
  );
});

test("a parsed body is refused with an explanation, not a confusing signature error", () => {
  // This is the most common webhook bug: a global JSON body parser has already
  // destroyed the bytes the signature covers.
  const { header } = signed({ id: "evt_1", type: "invoice.paid" });
  assert.throws(
    () =>
      verifyEvent({
        rawBody: { id: "evt_1", type: "invoice.paid" },
        signatureHeader: header,
        webhookSecret: SECRET,
      }),
    /must be a string or Buffer/,
  );
});

test("re-serialising a parsed body breaks the signature, which is why raw bytes matter", () => {
  const original = '{"id":"evt_1","type":"invoice.paid","data":{"object":{}}}';
  const header = Stripe.webhooks.generateTestHeaderString({ payload: original, secret: SECRET });
  // Same data, different bytes: key order and whitespace changed.
  const reserialised = JSON.stringify({ data: { object: {} }, type: "invoice.paid", id: "evt_1" });
  assert.throws(
    () => verifyEvent({ rawBody: reserialised, signatureHeader: header, webhookSecret: SECRET }),
    /signature/i,
  );
});

test("a missing webhook secret is a clear configuration error", () => {
  assert.throws(
    () => verifyEvent({ rawBody: "{}", signatureHeader: "t=1,v1=x", webhookSecret: null }),
    /STRIPE_WEBHOOK_SECRET is not set/,
  );
});

test("a redelivered event is not processed twice", async () => {
  let calls = 0;
  const router = createWebhookRouter({
    handlers: { "invoice.paid": async () => { calls += 1; return "granted"; } },
  });
  const event = { id: "evt_dup", type: "invoice.paid", data: { object: {} } };

  const first = await router.dispatch(event);
  const second = await router.dispatch(event);

  assert.equal(first.status, "handled");
  assert.equal(second.status, "duplicate");
  assert.equal(calls, 1, "handler must run exactly once for a redelivered event");
});

test("an unhandled event type succeeds rather than erroring, so Stripe stops retrying", async () => {
  const router = createWebhookRouter({ handlers: {} });
  const result = await router.dispatch({ id: "evt_2", type: "radar.early_fraud_warning.created" });
  assert.equal(result.status, "unhandled");
});

test("connected-account events expose event.account so they aren't applied to the platform", async () => {
  let seen = null;
  const router = createWebhookRouter({
    handlers: { "account.updated": async (ctx) => { seen = ctx.accountId; } },
  });
  await router.dispatch({
    id: "evt_3",
    type: "account.updated",
    account: "acct_seller",
    data: { object: { id: "acct_seller" } },
  });
  assert.equal(seen, "acct_seller");
});

test("platform events carry a null accountId", async () => {
  let seen = "unset";
  const router = createWebhookRouter({
    handlers: { "invoice.paid": async (ctx) => { seen = ctx.accountId; } },
  });
  await router.dispatch({ id: "evt_4", type: "invoice.paid", data: { object: {} } });
  assert.equal(seen, null);
});

test("a handler throwing propagates, so the endpoint can return non-2xx and get a retry", async () => {
  const router = createWebhookRouter({
    handlers: { "invoice.paid": async () => { throw new Error("db down"); } },
  });
  await assert.rejects(
    () => router.dispatch({ id: "evt_5", type: "invoice.paid", data: { object: {} } }),
    /db down/,
  );
});

test("the event log claims an id exactly once", async () => {
  const log = new InMemoryEventLog();
  assert.equal(await log.claim("evt_a"), true);
  assert.equal(await log.claim("evt_a"), false);
  assert.equal(log.size, 1);
});
