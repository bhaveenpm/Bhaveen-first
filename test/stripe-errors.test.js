import test from "node:test";
import assert from "node:assert/strict";
import { classifyStripeError, customerMessageFor } from "../stripe/errors.js";

test("a card decline is the customer's problem and is never retryable", () => {
  const c = classifyStripeError({ type: "StripeCardError", decline_code: "insufficient_funds" });
  assert.equal(c.category, "declined");
  assert.equal(c.retryable, false, "retrying a decline looks like card testing to the issuer");
  assert.equal(c.customerFacing, true);
});

test("an invalid request is your bug and is not retryable", () => {
  const c = classifyStripeError({ type: "StripeInvalidRequestError", message: "no such price" });
  assert.equal(c.category, "bad_request");
  assert.equal(c.retryable, false);
  assert.equal(c.customerFacing, false);
});

test("rate limits and connection errors are the retryable cases", () => {
  assert.equal(classifyStripeError({ type: "StripeRateLimitError" }).retryable, true);
  assert.equal(classifyStripeError({ type: "StripeConnectionError" }).retryable, true);
  assert.equal(classifyStripeError({ type: "StripeAPIError" }).retryable, true);
});

test("auth and permission errors are configuration, not load", () => {
  assert.equal(classifyStripeError({ type: "StripeAuthenticationError" }).category, "auth");
  assert.equal(classifyStripeError({ type: "StripePermissionError" }).category, "permission");
  assert.equal(classifyStripeError({ type: "StripePermissionError" }).retryable, false);
});

test("an unrecognised error defaults to not retryable", () => {
  const c = classifyStripeError({ type: "SomethingNew" });
  assert.equal(c.category, "unknown");
  assert.equal(c.retryable, false, "guessing retry on an unknown error turns a bug into a stampede");
});

test("classification preserves the request id for support threads", () => {
  const c = classifyStripeError({ type: "StripeInvalidRequestError", requestId: "req_123" });
  assert.equal(c.requestId, "req_123");
});

test("decline messages are actionable and differ by decline_code", () => {
  const funds = customerMessageFor({ type: "StripeCardError", decline_code: "insufficient_funds" });
  const expired = customerMessageFor({ type: "StripeCardError", decline_code: "expired_card" });
  assert.match(funds, /insufficient funds/i);
  assert.match(expired, /expired/i);
  assert.notEqual(funds, expired);
});

test("lost and stolen cards get a generic message, so we don't tip off fraud", () => {
  const stolen = customerMessageFor({ type: "StripeCardError", decline_code: "stolen_card" });
  assert.doesNotMatch(stolen, /stolen|lost/i);
});

test("a non-decline error never leaks internals to the customer", () => {
  const msg = customerMessageFor({
    type: "StripeInvalidRequestError",
    message: "No such price: price_typo",
  });
  assert.doesNotMatch(msg, /price_typo/);
});
