import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GpClient, newIdempotencyKey } from "../src/index.js";
import { Links } from "../src/resources/links.js";
import { startMock } from "./helpers.js";

let mock;
before(async () => { mock = await startMock(); });
after(async () => { await mock.stop(); });

test("the same idempotency key returns the original resource, not a second one", async () => {
  const key = newIdempotencyKey();
  const input = {
    amount: "24.99", currency: "GBP", reference: "ORDER-IDEM-1", idempotencyKey: key,
  };

  const first = await mock.gp.links.create(input);
  const second = await mock.gp.links.create(input);

  assert.equal(second.id, first.id, "a retry created a duplicate link");
});

test("without a key, an identical request creates a second resource", async () => {
  const input = { amount: "24.99", currency: "GBP", reference: "ORDER-IDEM-2" };
  const first = await mock.gp.links.create(input);
  const second = await mock.gp.links.create(input);
  assert.notEqual(second.id, first.id);
});

test("a network failure is retried, and the key stops the retry double-charging", async () => {
  let attempts = 0;
  const client = new GpClient({
    environment: "mock",
    baseUrl: mock.baseUrl,
    appId: "a",
    appKey: "b",
    maxRetries: 3,
    fetchImpl: async (url, init) => {
      // Fail the FIRST create attempt after the server has already seen it,
      // which is the dangerous case: the resource exists but the client
      // believes the call failed.
      if (String(url).endsWith("/links")) {
        attempts += 1;
        if (attempts === 1) {
          await globalThis.fetch(url, init);
          const error = new Error("socket hang up");
          error.isNetworkError = true;
          throw error;
        }
      }
      return globalThis.fetch(url, init);
    },
  });

  const links = new Links(client);
  const key = newIdempotencyKey();
  const link = await links.create({
    amount: "10.00", currency: "GBP", reference: "ORDER-IDEM-3", idempotencyKey: key,
  });

  assert.equal(attempts, 2, "the failed request was not retried");

  // Exactly one link should carry this reference, despite two POSTs reaching
  // the server.
  const page = await links.search({ pageSize: 100 });
  const matching = page.links.filter((l) => l.reference === "ORDER-IDEM-3");
  assert.equal(matching.length, 1, `idempotency key did not deduplicate: got ${matching.length} links`);
  assert.equal(matching[0].id, link.id);
});

test("a 4xx is not retried", async () => {
  let attempts = 0;
  const client = new GpClient({
    environment: "mock",
    baseUrl: mock.baseUrl,
    appId: "a",
    appKey: "b",
    maxRetries: 3,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/links")) attempts += 1;
      return globalThis.fetch(url, init);
    },
  });
  const links = new Links(client);
  await links
    .create({ amount: "1.00", currency: "ZZZ", reference: "ORDER-IDEM-4" })
    .then(() => null, (e) => e);

  assert.equal(attempts, 1, "a rejected request was pointlessly retried");
});
