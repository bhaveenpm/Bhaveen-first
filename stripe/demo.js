/**
 * The whole story, offline, in the spirit of scripts/demo.js.
 *
 * Runs both money flows against a stub transport, so it needs no credentials
 * and no network. What it demonstrates is the *sequencing* -- particularly the
 * two orderings that are easy to get wrong and expensive to get wrong:
 *
 *   Flow A: calculate tax -> charge -> record tax   (record AFTER success)
 *   Flow B: items -> invoice -> finalize -> send    (finalize freezes it)
 *
 * Run against real Stripe instead by setting STRIPE_SECRET_KEY and passing
 * --live-ish (still test mode; it just uses the real transport).
 */
import Stripe from "stripe";
import { createStripeIntegration } from "./index.js";
import { createWebhookRouter } from "./webhooks.js";
import { toMinorUnits, formatAmount } from "../src/money.js";

const real = process.argv.includes("--live-ish");

/** Canned responses good enough to show the shape of each step. */
function stubTransport() {
  const state = { calc: "taxcalc_demo", pi: "pi_demo", inv: "in_demo" };
  const fakeFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = Object.fromEntries(new URLSearchParams(init.body || ""));
    let payload = { id: "obj_demo" };

    if (path === "/v1/accounts") payload = { id: "acct_demo", charges_enabled: false, capabilities: {} };
    else if (path.startsWith("/v1/accounts/")) {
      payload = {
        id: "acct_demo", charges_enabled: true, payouts_enabled: true, details_submitted: true,
        capabilities: { card_payments: "active", transfers: "active" }, requirements: {},
      };
    } else if (path === "/v1/account_links") payload = { url: "https://connect.stripe.com/setup/e/demo" };
    else if (path === "/v1/tax/calculations") {
      payload = { id: state.calc, amount_total: Number(body["line_items[0][amount]"]) + 219, tax_amount_exclusive: 219 };
    } else if (path === "/v1/payment_intents") payload = { id: state.pi, status: "requires_payment_method", amount: Number(body.amount) };
    else if (path === "/v1/tax/transactions/create_from_calculation") payload = { id: "tax_demo", reference: body.reference };
    else if (path === "/v1/products") payload = { id: "prod_demo" };
    else if (path === "/v1/prices") payload = { id: "price_demo" };
    else if (path === "/v1/customers") payload = { id: "cus_demo" };
    else if (path === "/v1/subscriptions") {
      payload = { id: "sub_demo", status: "incomplete", latest_invoice: { id: "in_sub", confirmation_secret: { client_secret: "pi_demo_secret_xyz" } } };
    } else if (path === "/v1/invoiceitems") payload = { id: "ii_demo" };
    else if (path === "/v1/invoices") payload = { id: state.inv, status: "draft" };
    else if (path.endsWith("/finalize")) payload = { id: state.inv, status: "open", total: 150_00 };
    else if (path.endsWith("/send")) payload = { id: state.inv, status: "open", hosted_invoice_page: "https://invoice.stripe.com/i/demo" };
    else if (path === "/v1/billing_portal/sessions") payload = { id: "bps_demo", url: "https://billing.stripe.com/p/session/demo" };

    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return Stripe.createFetchHttpClient(fakeFetch);
}

const say = (s) => console.log(s);
const step = (n, s) => console.log(`\n${n}. ${s}`);

const s = createStripeIntegration(
  real
    ? {}
    : { secretKey: "sk_test_demo_stub", httpClient: stubTransport(), maxNetworkRetries: 0, applicationFeeBps: 250 },
);

say("=".repeat(70));
say(`Stripe integration walkthrough  (${real ? "real transport" : "offline stub"})`);
say(`API version ${s.config.apiVersion} | platform fee ${s.config.applicationFeeBps} bps`);
say("=".repeat(70));

// ---------------------------------------------------------------- Flow A
say("\n\nFLOW A -- a buyer pays a seller, and the platform keeps a cut.\n" + "-".repeat(70));

step(1, "Create a connected account (Express via controller properties)");
const seller = await s.connect.createSellerAccount({ email: "seller@example.com", country: "US" });
say(`   account: ${seller.id}`);

step(2, "Generate a single-use onboarding link (expires in minutes -- never store it)");
const link = await s.connect.onboardingLink({
  account: seller.id,
  refreshUrl: "https://platform.test/connect/refresh",
  returnUrl: "https://platform.test/connect/done",
});
say(`   redirect to: ${link.url}`);

step(3, "Gate on capability, not on the account existing");
const ready = await s.connect.readiness(seller.id);
say(`   charges_enabled=${ready.chargesEnabled} card_payments=${ready.cardPayments}`);
say(`   canAcceptPayments=${ready.canAcceptPayments}`);
if (!ready.canAcceptPayments) {
  say("   -> would show 'account under review' and stop here");
}

const amount = Number(toMinorUnits("24.99", "USD"));
step(4, `Calculate tax BEFORE charging (${formatAmount(amount, "USD")} basket)`);
const calc = await s.tax.calculate({
  currency: "USD",
  lineItems: [{ amountMinor: amount, reference: "sku-widget", taxCode: "txcd_99999999" }],
  customerDetails: {
    address: { country: "US", state: "CA", postal_code: "94103", city: "San Francisco", line1: "1 Market St" },
    address_source: "billing",
  },
});
say(`   calculation ${calc.id}: tax ${formatAmount(calc.tax_amount_exclusive, "USD")}`);
say(`   total to charge: ${formatAmount(calc.amount_total, "USD")}`);
say("   (a calculation records nothing and expires -- it is a quote)");

step(5, "Create the destination charge for the tax-inclusive total");
const intent = await s.payments.createSellerCharge({
  amountMinor: calc.amount_total,
  currency: "USD",
  sellerAccountId: seller.id,
  reference: "ORDER-1001",
});
say(`   ${intent.id} status=${intent.status}`);
say(`   on_behalf_of + transfer_data -> ${seller.id}`);
say(`   platform fee: ${formatAmount(Math.floor((calc.amount_total * 250) / 10000), "USD")}`);

step(6, "AFTER payment succeeds (via webhook), record the tax transaction");
const router = createWebhookRouter({
  handlers: {
    "payment_intent.succeeded": async ({ object }) => {
      const txn = await s.tax.record({ calculationId: calc.id, reference: object.metadata.reference });
      return txn.id;
    },
  },
});
const dispatched = await router.dispatch({
  id: "evt_demo_1",
  type: "payment_intent.succeeded",
  data: { object: { id: intent.id, metadata: { reference: "ORDER-1001" } } },
});
say(`   ${dispatched.status}: tax transaction ${dispatched.result}`);
say("   (this is the filing record. Skip it and you have collected unfileable tax.)");

step(7, "A redelivery of the same event must not record it twice");
const again = await router.dispatch({
  id: "evt_demo_1",
  type: "payment_intent.succeeded",
  data: { object: { id: intent.id, metadata: { reference: "ORDER-1001" } } },
});
say(`   ${again.status} -- handler did not run again`);

// ---------------------------------------------------------------- Flow B
say("\n\nFLOW B -- the platform bills the seller. Different merchant, different money.\n" + "-".repeat(70));

step(1, "Create a product and a recurring price with an explicit tax_behavior");
const { price } = await s.billing.createPlan({
  productName: "Platform Pro",
  amountMinor: 4900,
  currency: "usd",
  interval: "month",
  taxBehavior: "exclusive",
});
say(`   price ${price.id} (tax_behavior is immutable once set)`);

step(2, "Create the seller as a Customer on the PLATFORM account, with an address");
const customer = await s.billing.createSellerCustomer({
  email: "seller@example.com",
  name: "Seller Co",
  address: { country: "US", state: "CA", postal_code: "94103", city: "San Francisco", line1: "1 Market St" },
});
say(`   customer ${customer.id} (no address -> Stripe Tax computes nothing, silently)`);

step(3, "Subscribe with payment_behavior=default_incomplete so 3DS can complete");
const sub = await s.billing.subscribe({ customer: customer.id, priceId: price.id, reference: "SUB-1" });
say(`   ${sub.id} status=${sub.status}`);
say(`   confirm on the client with: ${s.billing.clientSecretFor(sub)}`);
say("   (from latest_invoice.confirmation_secret -- NOT .payment_intent)");

step(4, "Hand subscription management to the Customer Portal, don't build it");
const portal = await s.billing.portalSession({ customer: customer.id, returnUrl: "https://platform.test/account" });
say(`   ${portal.url}`);

step(5, "Issue a standalone invoice: items -> invoice -> finalize -> send");
const invoice = await s.invoicing.issue({
  customer: customer.id,
  reference: "INV-2001",
  items: [{ amountMinor: 15000, currency: "usd", description: "One-off onboarding fee" }],
});
say(`   ${invoice.id} status=${invoice.status}`);
say(`   hosted page: ${invoice.hosted_invoice_page}`);
say("   (tax was computed at finalize; the invoice is immutable from then on)");

say("\n" + "=".repeat(70));
say("Both flows complete. Next: notes/07-stripe-integration-plan.md section 9");
say("=".repeat(70) + "\n");
