import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GpApiError } from "../src/index.js";
import { startMock } from "./helpers.js";

let mock;
before(async () => { mock = await startMock(); });
after(async () => { await mock.stop(); });

const APPROVED = { number: "4263982640269299", expiryMonth: "12", expiryYear: "2027", cvv: "123" };
const DECLINED = { number: "4000120000001154", expiryMonth: "12", expiryYear: "2027", cvv: "123" };

test("a sale authorises and captures in one call", async () => {
  const txn = await mock.gp.transactions.sale({
    amount: "10.00", currency: "GBP", reference: "SALE-1", card: APPROVED,
  });
  assert.match(txn.id, /^TRN_/);
  assert.equal(txn.status, "CAPTURED");
  assert.equal(txn.capture_mode, "AUTO");
  assert.equal(txn.amount, "1000");
  assert.equal(txn.payment_method.result, "00");
});

test("the card number never comes back -- only a masked tail and a brand", async () => {
  const txn = await mock.gp.transactions.sale({
    amount: "10.00", currency: "GBP", card: APPROVED,
  });
  const serialised = JSON.stringify(txn);
  assert.ok(!serialised.includes(APPROVED.number), "full PAN echoed in the response");
  assert.equal(txn.payment_method.card.masked_number_last4, "****9299");
  assert.equal(txn.payment_method.card.brand, "VISA");
});

test("an authorisation is PREAUTHORIZED until captured", async () => {
  const auth = await mock.gp.transactions.authorize({
    amount: "30.00", currency: "GBP", card: APPROVED,
  });
  assert.equal(auth.status, "PREAUTHORIZED");
  assert.equal(auth.capture_mode, "LATER");

  const captured = await mock.gp.transactions.capture(auth.id);
  assert.equal(captured.status, "CAPTURED");
});

test("a partial capture takes less than was authorised", async () => {
  const auth = await mock.gp.transactions.authorize({
    amount: "30.00", currency: "GBP", card: APPROVED,
  });
  const captured = await mock.gp.transactions.capture(auth.id, { amount: "12.50", currency: "GBP" });
  assert.equal(captured.amount, "1250");
});

test("a decline is reported as DECLINED and is not retryable", async () => {
  const error = await mock.gp.transactions
    .sale({ amount: "10.00", currency: "GBP", card: DECLINED })
    .then(() => null, (e) => e);

  assert.ok(error instanceof GpApiError);
  assert.equal(error.status, 400);
  assert.equal(error.errorCode, "DECLINED");
  assert.equal(error.declined, true);
  assert.equal(error.retryable, false, "retrying a decline re-presents a card the issuer refused");
});

test("a validation failure is distinguishable from a decline", async () => {
  const error = await mock.gp.transactions
    .sale({ amount: "10.00", currency: "GBP", card: { ...APPROVED, number: "4263982640269290" } })
    .then(() => null, (e) => e);

  assert.ok(error instanceof GpApiError);
  assert.equal(error.errorCode, "INVALID_REQUEST_DATA");
  assert.equal(error.declined, false, "a bad request must not look like a decline");
});

test("an uncaptured authorisation must be reversed, not refunded", async () => {
  const auth = await mock.gp.transactions.authorize({
    amount: "20.00", currency: "GBP", card: APPROVED,
  });

  const error = await mock.gp.transactions.refund(auth.id).then(() => null, (e) => e);
  assert.ok(error instanceof GpApiError);
  assert.equal(error.errorCode, "INVALID_TRANSACTION_ACTION");

  const reversed = await mock.gp.transactions.reverse(auth.id);
  assert.equal(reversed.status, "REVERSED");
});

test("a captured sale is refunded", async () => {
  const sale = await mock.gp.transactions.sale({
    amount: "15.00", currency: "GBP", card: APPROVED,
  });
  const refunded = await mock.gp.transactions.refund(sale.id, { amount: "5.00", currency: "GBP" });
  assert.equal(refunded.status, "REFUNDED");
  assert.equal(refunded.amount, "500");
});

test("capturing an already-captured sale is refused", async () => {
  const sale = await mock.gp.transactions.sale({
    amount: "15.00", currency: "GBP", card: APPROVED,
  });
  const error = await mock.gp.transactions.capture(sale.id).then(() => null, (e) => e);
  assert.ok(error instanceof GpApiError);
  assert.equal(error.errorCode, "INVALID_TRANSACTION_ACTION");
});

test("a partial refund without a currency is refused client-side", async () => {
  const sale = await mock.gp.transactions.sale({
    amount: "15.00", currency: "GBP", card: APPROVED,
  });
  await assert.rejects(() => mock.gp.transactions.refund(sale.id, { amount: "5.00" }), TypeError);
});

test("a sale needs either a card or a stored payment method", async () => {
  await assert.rejects(
    () => mock.gp.transactions.sale({ amount: "1.00", currency: "GBP" }),
    TypeError,
  );
});
