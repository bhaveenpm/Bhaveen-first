import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  encodeReference, parseReference, EXCEPTION, PAYMENT_STATE, FULFILMENT_STATE,
} from "../src/index.js";
import { startMock } from "./helpers.js";

let mock;
let n = 0;
const nextId = () => String(9000 + n++);

before(async () => { mock = await startMock(); });
after(async () => { await mock.stop(); });

test("a structured reference is parseable; free text is not", () => {
  assert.equal(encodeReference({ channel: "IG", orderId: "2291" }), "IG-2291");

  const good = parseReference("IG-2291");
  assert.equal(good.valid, true);
  assert.equal(good.channelName, "Instagram");
  assert.equal(good.orderId, "2291");

  // The three ways a human writes the same order, none of them joinable.
  for (const messy of ["order 12", "Order#12", "12"]) {
    assert.equal(parseReference(messy).valid, false, `${messy} should not parse`);
  }
});

test("an unknown channel or a non-numeric order id is refused at encode time", () => {
  assert.throws(() => encodeReference({ channel: "XX", orderId: "1" }), TypeError);
  assert.throws(() => encodeReference({ channel: "IG", orderId: "abc" }), TypeError);
});

test("a new order is AWAITING_PAYMENT and UNFULFILLED, with no exceptions", async () => {
  const order = await mock.gp.orders.create({
    channel: "IG", orderId: nextId(), amount: "24.99", currency: "GBP", name: "Candle",
  });
  assert.equal(order.payment, PAYMENT_STATE.AWAITING);
  assert.equal(order.fulfilment, FULFILMENT_STATE.UNFULFILLED);
  assert.deepEqual(order.exceptions, []);
  assert.equal(order.channelName, "Instagram");
  assert.ok(order.link.url);
});

test("paying the link flips the order to PAID and raises PAID_NOT_SHIPPED", async () => {
  const created = await mock.gp.orders.create({
    channel: "WA", orderId: nextId(), amount: "10.00", currency: "GBP", name: "Soap",
  });
  await fetch(created.link.url, { method: "POST", redirect: "manual" });

  const order = await mock.gp.orders.get(created.reference);
  assert.equal(order.payment, PAYMENT_STATE.PAID);
  assert.ok(
    order.exceptions.includes(EXCEPTION.PAID_NOT_SHIPPED),
    "money taken and nothing shipped is the state a seller most needs to see",
  );
});

test("marking it shipped clears the exception", async () => {
  const created = await mock.gp.orders.create({
    channel: "TT", orderId: nextId(), amount: "10.00", currency: "GBP", name: "Mug",
  });
  await fetch(created.link.url, { method: "POST", redirect: "manual" });

  const shipped = await mock.gp.orders.markShipped(created.reference);
  assert.equal(shipped.fulfilment, FULFILMENT_STATE.SHIPPED);
  assert.deepEqual(shipped.exceptions, []);
  assert.ok(shipped.shippedAt);
});

test("shipping before payment raises SHIPPED_NOT_PAID -- goods gone, no money", async () => {
  const created = await mock.gp.orders.create({
    channel: "FB", orderId: nextId(), amount: "50.00", currency: "GBP", name: "Print",
  });
  const order = await mock.gp.orders.markShipped(created.reference);
  assert.equal(order.payment, PAYMENT_STATE.AWAITING);
  assert.ok(order.exceptions.includes(EXCEPTION.SHIPPED_NOT_PAID));
});

test("a refund after shipping raises REFUNDED_AFTER_SHIPPING", async () => {
  const created = await mock.gp.orders.create({
    channel: "EM", orderId: nextId(), amount: "15.00", currency: "GBP", name: "Card",
  });
  await fetch(created.link.url, { method: "POST", redirect: "manual" });
  await mock.gp.orders.markShipped(created.reference);

  const paid = await mock.gp.orders.get(created.reference);
  await mock.gp.transactions.refund(paid.transactions[0].id);

  const order = await mock.gp.orders.get(created.reference);
  assert.equal(order.payment, PAYMENT_STATE.REFUNDED);
  assert.ok(order.exceptions.includes(EXCEPTION.REFUNDED_AFTER_SHIPPING));
});

test("the order joins the link and its transactions under one reference", async () => {
  const created = await mock.gp.orders.create({
    channel: "IG", orderId: nextId(), amount: "24.99", currency: "GBP", name: "Candle",
  });
  await fetch(created.link.url, { method: "POST", redirect: "manual" });

  const order = await mock.gp.orders.get(created.reference);
  assert.equal(order.link.status, "PAID");
  assert.equal(order.transactions.length, 1);
  assert.equal(order.transactions[0].amount, "2499");
  assert.equal(order.amount, "2499");
  assert.equal(order.currency, "GBP");
});

test("list() returns every order, and surfaces the ones needing attention", async () => {
  const all = await mock.gp.orders.list();
  assert.ok(all.length >= 5);

  const needsAttention = all.filter((o) => o.exceptions.length > 0);
  assert.ok(needsAttention.length > 0, "no exceptions surfaced across the whole book");
  for (const order of all) assert.ok(order.reference);
});

test("an order created outside this layer still appears, flagged as unstructured", async () => {
  await mock.gp.links.create({
    amount: "5.00", currency: "GBP", reference: "legacy free text 42", name: "Legacy",
  });
  const all = await mock.gp.orders.list();
  const legacy = all.find((o) => o.reference === "legacy free text 42");
  assert.ok(legacy, "a link created without the order layer vanished from the book");
  assert.equal(legacy.structured, false, "should be flagged as un-joinable");
});
