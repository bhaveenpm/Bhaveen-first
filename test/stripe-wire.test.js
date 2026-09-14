import test from "node:test";
import assert from "node:assert/strict";
import { stubStripe } from "./stripe-helpers.js";

/**
 * These tests assert the exact parameters sent to Stripe. They exist because
 * parameter shapes drift between API versions, and a drifted parameter fails at
 * runtime in production rather than at build time here.
 */

test("destination charge sets on_behalf_of as well as transfer_data", async () => {
  const s = stubStripe();
  await s.payments.createSellerCharge({
    amountMinor: 2500,
    currency: "USD",
    sellerAccountId: "acct_seller",
    reference: "ORDER-1",
  });

  const { body, path } = s.last;
  assert.equal(path, "/v1/payment_intents");
  assert.equal(body.amount, "2500");
  assert.equal(body.currency, "usd");
  assert.equal(body["transfer_data[destination]"], "acct_seller");
  // The one people omit. Without it, Stripe Tax reads the wrong entity's
  // registrations and the statement descriptor is wrong.
  assert.equal(body.on_behalf_of, "acct_seller");
  assert.equal(body.application_fee_amount, "62"); // floor(2500 * 250/10000)
});

test("destination charge carries an idempotency key derived from the order reference", async () => {
  const s = stubStripe();
  await s.payments.createSellerCharge({
    amountMinor: 1000,
    currency: "usd",
    sellerAccountId: "acct_x",
    reference: "ORDER-42",
  });
  assert.match(s.last.headers["idempotency-key"], /ORDER-42/);
});

test("charge rejects a major-unit amount instead of silently charging 100x too little", async () => {
  const s = stubStripe();
  await assert.rejects(
    () =>
      s.payments.createSellerCharge({
        amountMinor: 24.99,
        currency: "USD",
        sellerAccountId: "acct_x",
      }),
    /positive integer in minor units/,
  );
});

test("refund reverses the transfer by default, so the seller isn't left paid", async () => {
  const s = stubStripe();
  await s.payments.refund({ paymentIntentId: "pi_1", reference: "R-1" });
  assert.equal(s.last.body.reverse_transfer, "true");
  assert.equal(s.last.body.refund_application_fee, "true");
});

test("invoice items use pricing[price], not the removed bare price parameter", async () => {
  const s = stubStripe();
  await s.invoicing.addItem({ customer: "cus_1", priceId: "price_1", quantity: 2 });

  const { body, path } = s.last;
  assert.equal(path, "/v1/invoiceitems");
  // Verified against the SDK types for 2026-08-26.dahlia: InvoiceItemCreateParams
  // exposes `pricing`, not `price`.
  assert.equal(body["pricing[price]"], "price_1");
  assert.equal(body.price, undefined);
  assert.equal(body.quantity, "2");
});

test("subscription is created incomplete so 3DS can be completed on the client", async () => {
  const s = stubStripe();
  await s.billing.subscribe({ customer: "cus_1", priceId: "price_1", reference: "SUB-1" });

  const { body } = s.last;
  assert.equal(body.payment_behavior, "default_incomplete");
  assert.equal(body["payment_settings[save_default_payment_method]"], "on_subscription");
  assert.equal(body["automatic_tax[enabled]"], "true");
  // The current field. `latest_invoice.payment_intent` is the pre-2025 pattern.
  assert.equal(body["expand[0]"], "latest_invoice.confirmation_secret");
});

test("clientSecretFor reads confirmation_secret, and still tolerates the older shape", () => {
  const s = stubStripe();
  assert.equal(
    s.billing.clientSecretFor({ latest_invoice: { confirmation_secret: { client_secret: "cs_new" } } }),
    "cs_new",
  );
  assert.equal(
    s.billing.clientSecretFor({ latest_invoice: { payment_intent: { client_secret: "cs_old" } } }),
    "cs_old",
  );
  assert.equal(s.billing.clientSecretFor({ latest_invoice: "in_unexpanded" }), null);
});

test("recurring prices always carry a tax_behavior, without which Tax computes nothing", async () => {
  const s = stubStripe();
  await s.billing.createPlan({
    productName: "Pro",
    amountMinor: 4900,
    currency: "usd",
    interval: "month",
  });
  const price = s.find("/v1/prices");
  assert.equal(price.body.tax_behavior, "exclusive");
  assert.equal(price.body["recurring[interval]"], "month");
});

test("standalone invoices default to send_invoice with a due date", async () => {
  const s = stubStripe();
  await s.invoicing.createInvoice({ customer: "cus_1", reference: "INV-1" });
  const { body } = s.last;
  assert.equal(body.collection_method, "send_invoice");
  assert.equal(body.days_until_due, "30");
  assert.equal(body.pending_invoice_items_behavior, "include");
});

test("charge_automatically invoices omit days_until_due, which Stripe rejects together", async () => {
  const s = stubStripe();
  await s.invoicing.createInvoice({ customer: "cus_1", collectionMethod: "charge_automatically" });
  assert.equal(s.last.body.days_until_due, undefined);
});

test("issue() runs items -> create -> finalize -> send, in that order", async () => {
  const s = stubStripe({ reply: () => ({ id: "in_1" }) });
  await s.invoicing.issue({
    customer: "cus_1",
    reference: "INV-9",
    items: [{ priceId: "price_1", quantity: 1 }],
  });
  const paths = s.requests.map((r) => r.path);
  assert.deepEqual(paths, [
    "/v1/invoiceitems",
    "/v1/invoices",
    "/v1/invoices/in_1/finalize",
    "/v1/invoices/in_1/send",
  ]);
});

test("tax calculation sends line items with an explicit tax_behavior", async () => {
  const s = stubStripe();
  await s.tax.calculate({
    currency: "USD",
    lineItems: [{ amountMinor: 2500, reference: "sku-1", taxCode: "txcd_99999999" }],
    customerDetails: { address: { country: "US", postal_code: "94103", state: "CA" }, address_source: "billing" },
  });

  const { body, path } = s.last;
  assert.equal(path, "/v1/tax/calculations");
  assert.equal(body["line_items[0][amount]"], "2500");
  assert.equal(body["line_items[0][reference]"], "sku-1");
  assert.equal(body["line_items[0][tax_behavior]"], "exclusive");
  assert.equal(body["customer_details[address][country]"], "US");
});

test("recording a tax transaction requires a reference, since it is the filing join key", async () => {
  const s = stubStripe();
  await assert.rejects(
    () => s.tax.record({ calculationId: "taxcalc_1" }),
    /reference is required/,
  );
});

test("tax transaction is recorded from the calculation, idempotently", async () => {
  const s = stubStripe();
  await s.tax.record({ calculationId: "taxcalc_1", reference: "ORDER-7" });
  assert.equal(s.last.path, "/v1/tax/transactions/create_from_calculation");
  assert.equal(s.last.body.calculation, "taxcalc_1");
  assert.equal(s.last.body.reference, "ORDER-7");
  assert.match(s.last.headers["idempotency-key"], /ORDER-7/);
});

test("connected accounts are created with controller properties, not a legacy type", async () => {
  const s = stubStripe();
  await s.connect.createSellerAccount({ email: "seller@example.com", country: "GB" });

  const { body, path } = s.last;
  assert.equal(path, "/v1/accounts");
  assert.equal(body["controller[stripe_dashboard][type]"], "express");
  assert.equal(body["controller[fees][payer]"], "application");
  assert.equal(body["controller[losses][payments]"], "application");
  assert.equal(body.type, undefined); // the deprecated parameter
  // Requested up front so verification starts now, not after onboarding.
  assert.equal(body["capabilities[card_payments][requested]"], "true");
  assert.equal(body["capabilities[transfers][requested]"], "true");
});

test("onboarding links collect eventually_due so sellers aren't interrupted later", async () => {
  const s = stubStripe();
  await s.connect.onboardingLink({
    account: "acct_1",
    refreshUrl: "https://x.test/refresh",
    returnUrl: "https://x.test/done",
  });
  assert.equal(s.last.body.type, "account_onboarding");
  assert.equal(s.last.body["collection_options[fields]"], "eventually_due");
});

test("readiness gates on capability, not on the account merely existing", async () => {
  const s = stubStripe({
    reply: () => ({
      id: "acct_1",
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      capabilities: { card_payments: "active", transfers: "pending" },
      requirements: { currently_due: ["external_account"], disabled_reason: null },
    }),
  });
  const r = await s.connect.readiness("acct_1");
  assert.equal(r.canAcceptPayments, true);
  assert.equal(r.payoutsEnabled, false); // can sell, cannot be paid out yet
  assert.deepEqual(r.currentlyDue, ["external_account"]);
});

test("an account that exists but has no active card_payments cannot accept payments", async () => {
  const s = stubStripe({
    reply: () => ({
      id: "acct_2",
      charges_enabled: false,
      capabilities: { card_payments: "pending" },
      requirements: { disabled_reason: "requirements.past_due", past_due: ["individual.id_number"] },
    }),
  });
  const r = await s.connect.readiness("acct_2");
  assert.equal(r.canAcceptPayments, false);
  assert.equal(r.disabledReason, "requirements.past_due");
});

test("updateDetailsLink and loginLink hit different endpoints, as they must", async () => {
  const s = stubStripe();
  await s.connect.updateDetailsLink({ account: "acct_1", returnUrl: "https://x.test/done" });
  assert.equal(s.last.path, "/v1/account_links");
  assert.equal(s.last.body.type, "account_update");

  await s.connect.loginLink("acct_1");
  // Express dashboard login is its own endpoint, not an account link.
  assert.equal(s.last.path, "/v1/accounts/acct_1/login_links");
});
