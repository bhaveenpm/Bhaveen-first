import test from "node:test";
import assert from "node:assert/strict";
import { describeKey } from "../stripe/config.js";
import { applicationFeeAmount } from "../stripe/client.js";

test("describeKey distinguishes test from live, because the difference is real money", () => {
  assert.equal(describeKey("sk_test_abcd1234").livemode, false);
  assert.equal(describeKey("sk_live_abcd1234").livemode, true);
});

test("describeKey flags restricted keys, which are the ones you should be using", () => {
  assert.equal(describeKey("rk_test_abcd1234").restricted, true);
  assert.equal(describeKey("sk_test_abcd1234").restricted, false);
});

test("describeKey refuses a publishable key with an actionable message", () => {
  assert.throws(() => describeKey("pk_test_abcd1234"), /belongs in your frontend/);
});

test("describeKey refuses anything that isn't a Stripe key", () => {
  assert.throws(() => describeKey("hunter2"), /Not a recognisable Stripe key/);
  assert.throws(() => describeKey(""), /No Stripe key/);
});

test("redacted form is safe to log but still identifies the key", () => {
  const d = describeKey("sk_test_abcdefgh9999");
  assert.equal(d.redacted, "sk_test_...9999");
  assert.ok(!d.redacted.includes("abcdefgh"));
});

test("application fee floors rather than rounding up, so the platform never overcharges", () => {
  // 2.5% of 1999 is 49.975. Rounding up would take more than the stated rate.
  assert.equal(applicationFeeAmount(1999, 250), 49);
});

test("application fee is capped at the charge amount, which Stripe would reject", () => {
  assert.equal(applicationFeeAmount(1000, 10_000), 1000);
});

test("application fee rejects non-integer minor amounts rather than sending a float", () => {
  assert.throws(() => applicationFeeAmount(19.99, 250), /non-negative integer/);
  assert.throws(() => applicationFeeAmount(1000, 250.5), /integer in 0\.\.10000/);
});
