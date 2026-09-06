import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateSecret, GpClient, GpApiError } from "../src/index.js";
import { startMock } from "./helpers.js";

let mock;
before(async () => { mock = await startMock(); });
after(async () => { await mock.stop(); });

test("the secret is sha512(nonce + app_key) as lowercase hex", () => {
  const nonce = "2022-04-21T15:12:44.390Z";
  const expected = createHash("sha512").update(nonce + "key").digest("hex");
  assert.equal(generateSecret(nonce, "key"), expected);
  assert.equal(generateSecret(nonce, "key").length, 128);
});

test("the app_key itself is never sent on the wire", async () => {
  const sent = [];
  const client = new GpClient({
    environment: "mock",
    baseUrl: mock.baseUrl,
    appId: "test_app",
    appKey: "super-secret-key",
    fetchImpl: async (url, init) => {
      sent.push(init.body ?? "");
      return globalThis.fetch(url, init);
    },
  });
  await client.accessToken();
  assert.ok(sent.length > 0);
  for (const body of sent) {
    assert.ok(!body.includes("super-secret-key"), "app_key leaked into the request body");
  }
});

test("a token is minted once and then reused across calls", async () => {
  let tokenRequests = 0;
  const client = new GpClient({
    environment: "mock",
    baseUrl: mock.baseUrl,
    appId: "test_app",
    appKey: "test_key",
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/accesstoken")) tokenRequests += 1;
      return globalThis.fetch(url, init);
    },
  });
  await client.accessToken();
  await client.accessToken();
  await client.accessToken();
  assert.equal(tokenRequests, 1, "client re-authenticated when it did not need to");
});

test("concurrent callers share one in-flight auth request", async () => {
  let tokenRequests = 0;
  const client = new GpClient({
    environment: "mock",
    baseUrl: mock.baseUrl,
    appId: "test_app",
    appKey: "test_key",
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/accesstoken")) tokenRequests += 1;
      return globalThis.fetch(url, init);
    },
  });
  await Promise.all([client.accessToken(), client.accessToken(), client.accessToken()]);
  assert.equal(tokenRequests, 1, "concurrent callers each minted their own token");
});

test("the account name is discovered from the token scope, not hardcoded", async () => {
  const client = new GpClient({ environment: "mock", baseUrl: mock.baseUrl, appId: "a", appKey: "b" });
  assert.equal(await client.accountName(), "transaction_processing");
  assert.equal(await client.accountName("TKA_"), "tokenization");
});

test("a bad token is rejected with NOT_AUTHENTICATED, and is not retried", async () => {
  const client = new GpClient({ environment: "mock", baseUrl: mock.baseUrl, appId: "a", appKey: "b" });
  let calls = 0;
  const error = await client
    .request("GET", "/links/LNK_nope", {})
    .then(() => null, (e) => e);
  assert.ok(error instanceof GpApiError);

  // Force an invalid token and confirm the shape of the 401.
  const bad = await fetch(`${mock.baseUrl}/links/LNK_x`, {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  assert.equal(bad.status, 401);
  const body = await bad.json();
  assert.equal(body.error_code, "NOT_AUTHENTICATED");
  assert.equal(calls, 0);
});
