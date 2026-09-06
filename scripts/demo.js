/**
 * The whole social-commerce story in one command, start to finish, offline.
 *
 *   npm run demo
 *
 * It boots the mock API in-process, stands up a webhook receiver, sells
 * something over a link, and then refunds it -- narrating what each step
 * teaches about the API. Nothing here touches the network.
 */

import { createServer } from "node:http";
import { server as mockApi } from "../mock/server.js";
import { createGp, formatAmount, GpApiError } from "../src/index.js";

const step = (n, title) => console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`);
const note = (text) => console.log(`   \x1b[2m${text}\x1b[0m`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const received = [];

async function main() {
  await new Promise((r) => mockApi.listen(0, "127.0.0.1", r));
  const apiPort = mockApi.address().port;

  const sink = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      received.push({ at: Date.now(), body: JSON.parse(raw) });
      res.writeHead(200);
      res.end("{}");
    });
  });
  await new Promise((r) => sink.listen(0, "127.0.0.1", r));
  const statusUrl = `http://127.0.0.1:${sink.address().port}/webhook`;

  const gp = createGp({
    environment: "mock",
    baseUrl: `http://127.0.0.1:${apiPort}/ucp`,
    appId: "demo_app",
    appKey: "demo_key",
  });

  console.log("\x1b[1mGP API Lab -- Pay by Link, end to end, offline\x1b[0m");
  note(`mock API on :${apiPort}, webhook sink on :${sink.address().port}`);

  // ---------------------------------------------------------------------
  step(1, "Authenticate");
  await gp.client.accessToken();
  const scope = gp.client.scope;
  console.log(`   merchant ${scope.merchant_name} (${scope.merchant_id})`);
  for (const account of scope.accounts) console.log(`   account  ${account.id}  ${account.name}`);
  note("The app_key never left this process -- only sha512(nonce + app_key) did.");
  note("The token names the accounts it can reach, so account_name is discoverable.");

  // ---------------------------------------------------------------------
  step(2, "Create a payment link (the social-commerce primitive)");
  const link = await gp.links.create({
    amount: "24.99",
    currency: "GBP",
    reference: "IG-DM-2291",
    name: "Hand-poured candle",
    description: "Sold over an Instagram DM",
    statusUrl,
    returnUrl: "https://example.test/thanks",
  });
  console.log(`   ${link.id}  ${link.status}  ${formatAmount(link.transactions.amount, link.transactions.currency)}`);
  console.log(`   share: ${link.url}`);
  note(`We sent "24.99"; the API stores "${link.transactions.amount}" -- minor units, as a string.`);
  note(`reference "${link.reference}" is the only join key back to the seller's own order.`);

  // ---------------------------------------------------------------------
  step(3, "The buyer opens the link");
  const page = await fetch(link.url);
  console.log(`   GET ${new URL(link.url).pathname} -> ${page.status} ${page.headers.get("content-type")}`);
  note("A GP-hosted page. The seller has no website, no front end, and never touches a card number.");

  // ---------------------------------------------------------------------
  step(4, "The buyer pays");
  const before = Date.now();
  const paid = await fetch(link.url, { method: "POST", redirect: "manual" });
  console.log(`   POST -> ${paid.status}, browser redirected to ${paid.headers.get("location")}`);

  await wait(300);
  const event = received[0];
  console.log(`   webhook arrived ${event.at - before}ms later:`);
  console.log(`     link ${event.body.id} -> ${event.body.status}`);
  console.log(`     txn  ${event.body.transactions[0].id} ${event.body.transactions[0].status} ` +
    `${formatAmount(event.body.transactions[0].amount, event.body.transactions[0].currency)}`);
  note("The redirect and the webhook are two independent races. Only the webhook is proof of payment:");
  note("the buyer can close the tab before the redirect, and the money still moved.");

  // ---------------------------------------------------------------------
  step(5, "The link is now spent");
  const after = await gp.links.get(link.id);
  console.log(`   status ${after.status}, used ${after.usage_count}/${after.usage_limit}`);
  const replay = await fetch(link.url, { method: "POST", redirect: "manual" });
  console.log(`   paying it again -> ${replay.status} ${(await replay.json()).error_code}`);
  note("usage_mode SINGLE is what stops a link that gets forwarded from being paid twice.");

  // ---------------------------------------------------------------------
  step(6, "Refund the resulting transaction");
  const txnId = event.body.transactions[0].id;
  const refunded = await gp.transactions.refund(txnId, { amount: "24.99", currency: "GBP" });
  console.log(`   ${refunded.id} -> ${refunded.status}`);
  note("Refund, not reversal: this one had already captured. Reversing a captured txn is refused.");

  // ---------------------------------------------------------------------
  step(7, "What failure looks like");
  const declined = await gp.transactions
    .sale({
      amount: "10.00",
      currency: "GBP",
      card: { number: "4000120000001154", expiryMonth: "12", expiryYear: "2027", cvv: "123" },
    })
    .then(() => null, (e) => e);
  console.log(`   HTTP ${declined.status}  error_code ${declined.errorCode}  declined=${declined.declined}  retryable=${declined.retryable}`);

  const malformed = await gp.links
    .create({ amount: "5.00", currency: "ZZZ", reference: "BAD-1" })
    .then(() => null, (e) => e);
  console.log(`   HTTP ${malformed.status}  error_code ${malformed.errorCode}  declined=${malformed.declined}  retryable=${malformed.retryable}`);
  note("Both are HTTP 400. One is a shopper's issuer saying no; one is your integration being wrong.");
  note("Code that cannot tell them apart will page an engineer over an empty bank account.");

  console.log("\nDone. Read notes/01-api-teardown.md for the nuances behind each step.\n");

  await new Promise((r) => sink.close(r));
  await new Promise((r) => mockApi.close(r));
}

main().catch((error) => {
  if (error instanceof GpApiError) console.error(error.toString());
  else console.error(error);
  process.exit(1);
});
