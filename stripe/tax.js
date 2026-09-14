import { idempotencyKey } from "./client.js";

/**
 * Stripe Tax, and the asymmetry that defines how you use it:
 *
 *   Invoices, Subscriptions, Checkout Sessions   -> `automatic_tax: {enabled: true}`
 *   raw PaymentIntents                           -> no such parameter exists
 *
 * That second line is verified against the SDK's own type definitions:
 * PaymentIntentCreateParams has no `automatic_tax` field at all. So a
 * marketplace charge built on PaymentIntents (Flow A) must drive Tax by hand,
 * in three steps that must happen in this order:
 *
 *   1. calculate  -- a quote. Records nothing. Expires.
 *   2. charge     -- your PaymentIntent, for the calculated total.
 *   3. record     -- createFromCalculation, AFTER the payment succeeds.
 *
 * Step 3 is the tax record. Skipping it -- the common bug -- leaves you having
 * collected tax you cannot file, with empty Stripe Tax reports. Doing it before
 * step 2 leaves you filing tax on revenue you never collected.
 */
export function tax({ stripe }) {
  return {
    /**
     * Step 1. Returns the tax owed for a basket without recording anything.
     *
     * `tax_behavior` per line item says whether `amount` already includes tax.
     * Get it wrong and you are either absorbing the tax or overcharging by it.
     */
    async calculate({
      currency,
      lineItems,
      customer = null,
      customerDetails = null,
      shippingCost = null,
    }) {
      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        throw new TypeError("lineItems must be a non-empty array.");
      }
      return stripe.tax.calculations.create({
        currency: String(currency).toLowerCase(),
        line_items: lineItems.map((item) => ({
          amount: item.amountMinor,
          reference: item.reference,
          quantity: item.quantity ?? 1,
          tax_behavior: item.taxBehavior ?? "exclusive",
          ...(item.taxCode ? { tax_code: item.taxCode } : {}),
        })),
        ...(customer ? { customer } : {}),
        ...(customerDetails ? { customer_details: customerDetails } : {}),
        ...(shippingCost ? { shipping_cost: shippingCost } : {}),
        expand: ["line_items"],
      });
    },

    /**
     * Step 3. Call this from the `payment_intent.succeeded` webhook, not from
     * the request that created the PaymentIntent -- the payment may not be
     * final when that request returns.
     *
     * `reference` must be unique and should be your order id: it is the join
     * key between your ledger and Stripe's tax reports, and it is what makes
     * this call idempotent under webhook redelivery.
     */
    async record({ calculationId, reference }) {
      if (!reference) {
        throw new TypeError(
          "reference is required -- it is the idempotency key and the join key into tax reports.",
        );
      }
      return stripe.tax.transactions.createFromCalculation(
        { calculation: calculationId, reference, expand: ["line_items"] },
        { idempotencyKey: idempotencyKey(`tax:${reference}`) },
      );
    },

    /**
     * The mirror of `record`, for a refund. A refund without a reversal leaves
     * your filed liability overstated -- you will pay tax on money you gave back.
     */
    async reverseFull({ originalTransactionId, reference }) {
      return stripe.tax.transactions.createReversal(
        {
          mode: "full",
          original_transaction: originalTransactionId,
          reference,
        },
        { idempotencyKey: idempotencyKey(`tax-rev:${reference}`) },
      );
    },

    /**
     * Registrations gate everything. In a jurisdiction where you have no
     * registration Stripe Tax computes *zero tax*, silently -- it is not an
     * error, and it looks exactly like a correctly untaxed sale.
     *
     * On a Connect platform with `on_behalf_of` set, the registrations that
     * matter are the connected account's, not yours.
     */
    async listRegistrations({ status = "active", limit = 100 } = {}) {
      return stripe.tax.registrations.list({ status, limit });
    },

    async addRegistration({ country, countryOptions, activeFrom = "now" }) {
      return stripe.tax.registrations.create({
        country,
        country_options: countryOptions,
        active_from: activeFrom,
      });
    },
  };
}
