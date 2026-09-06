import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { GpApiError, LINK_STATUS } from "../src/index.js";
import { startMock } from "./helpers.js";

let mock;
before(async () => { mock = await startMock(); });
after(async () => { await mock.stop(); });

const base = (over = {}) => ({
  amount: "24.99",
  currency: "GBP",
  reference: `ORDER-${Math.random().toString(36).slice(2, 8)}`,
  name: "Test item",
  ...over,
});

test("a created link is ACTIVE, carries a payer URL, and stores minor units", async () => {
  const link = await mock.gp.links.create(base());
  assert.match(link.id, /^LNK_/);
  assert.equal(link.status, LINK_STATUS.ACTIVE);
  assert.equal(link.transactions.amount, "2499");
  assert.equal(link.transactions.currency, "GBP");
  assert.ok(link.url.startsWith("http"), "no payer-facing URL returned");
});

test("the merchant's own reference survives the round trip", async () => {
  const reference = "ORDER-JOIN-KEY-1";
  const created = await mock.gp.links.create(base({ reference }));
  const fetched = await mock.gp.links.get(created.id);
  assert.equal(fetched.reference, reference);
});

test("reference is mandatory client-side -- a link you cannot join to an order is useless", async () => {
  await assert.rejects(() => mock.gp.links.create(base({ reference: undefined })), TypeError);
});

test("SINGLE usage mode with a limit above 1 is caught before the network call", async () => {
  await assert.rejects(
    () => mock.gp.links.create(base({ usageMode: "SINGLE", usageLimit: 5 })),
    RangeError,
  );
});

test("a currency the account is not provisioned for is rejected by the API", async () => {
  const error = await mock.gp.links.create(base({ currency: "ZZZ" })).then(() => null, (e) => e);
  assert.ok(error instanceof GpApiError, "expected a GpApiError");
  assert.equal(error.status, 400);
  assert.equal(error.errorCode, "INVALID_REQUEST_DATA");
  assert.equal(error.retryable, false);
});

test("a link can be repriced and deactivated while ACTIVE", async () => {
  const link = await mock.gp.links.create(base());
  const repriced = await mock.gp.links.edit(link.id, { amount: "31.50", currency: "GBP" });
  assert.equal(repriced.transactions.amount, "3150");

  const off = await mock.gp.links.deactivate(link.id);
  assert.equal(off.status, LINK_STATUS.INACTIVE);
});

test("paying a SINGLE-use link moves it to PAID and blocks a second payment", async () => {
  const link = await mock.gp.links.create(base());

  const first = await fetch(link.url, { method: "POST", redirect: "manual" });
  assert.equal(first.status, 200);

  const after = await mock.gp.links.get(link.id);
  assert.equal(after.status, LINK_STATUS.PAID);
  assert.equal(after.usage_count, "1");

  const second = await fetch(link.url, { method: "POST", redirect: "manual" });
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error_code, "INVALID_TRANSACTION_ACTION");
});

test("a PAID link cannot be edited", async () => {
  const link = await mock.gp.links.create(base());
  await fetch(link.url, { method: "POST", redirect: "manual" });
  const error = await mock.gp.links
    .edit(link.id, { name: "too late" })
    .then(() => null, (e) => e);
  assert.ok(error instanceof GpApiError);
  assert.equal(error.errorCode, "INVALID_TRANSACTION_ACTION");
});

test("a MULTIPLE-use link stays ACTIVE until its limit is reached", async () => {
  const link = await mock.gp.links.create(base({ usageMode: "MULTIPLE", usageLimit: 3 }));

  await fetch(link.url, { method: "POST", redirect: "manual" });
  let state = await mock.gp.links.get(link.id);
  assert.equal(state.status, LINK_STATUS.ACTIVE, "closed too early");
  assert.equal(state.usage_count, "1");

  await fetch(link.url, { method: "POST", redirect: "manual" });
  await fetch(link.url, { method: "POST", redirect: "manual" });
  state = await mock.gp.links.get(link.id);
  assert.equal(state.status, LINK_STATUS.PAID);
  assert.equal(state.usage_count, "3");
});

test("the status webhook carries the merchant reference and the transaction", async () => {
  const received = [];
  const sink = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      received.push(JSON.parse(raw));
      res.writeHead(200);
      res.end("{}");
    });
  });
  await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const statusUrl = `http://127.0.0.1:${sink.address().port}/webhook`;

  const link = await mock.gp.links.create(base({ reference: "ORDER-HOOK-1", statusUrl }));
  await fetch(link.url, { method: "POST", redirect: "manual" });

  const deadline = Date.now() + 3000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((resolve) => sink.close(resolve));

  assert.equal(received.length, 1, "no webhook delivered");
  const [event] = received;
  assert.equal(event.reference, "ORDER-HOOK-1");
  assert.equal(event.status, LINK_STATUS.PAID);
  assert.equal(event.transactions[0].amount, "2499");
  assert.match(event.transactions[0].id, /^TRN_/);
});

test("search is paged and filterable by status", async () => {
  const page = await mock.gp.links.search({ status: LINK_STATUS.PAID, pageSize: 5 });
  assert.equal(page.page_size, "5");
  assert.ok(Array.isArray(page.links));
  for (const link of page.links) assert.equal(link.status, LINK_STATUS.PAID);
});
