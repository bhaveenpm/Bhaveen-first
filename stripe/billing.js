import { idempotencyKey } from "./client.js";

/**
 * Flow B: you bill your sellers for being on your platform.
 *
 * Here you are the merchant, the seller is your Customer, and the revenue is
 * yours. Everything in this file lives on the platform account -- none of it
 * takes a Connect account id, which is the clearest signal that Flow A and
 * Flow B are genuinely separate systems that happen to share an SDK.
 */
export function billing({ stripe }) {
  return {
    /**
     * `tax_behavior` is required for Stripe Tax to work on this price, and it
     * is IMMUTABLE once set. Choosing wrong means creating a new Price and
     * migrating subscriptions onto it -- so this is a decision, not a default:
     *
     *   exclusive  the listed amount is pre-tax, tax is added  (typical B2B/US)
     *   inclusive  the listed amount already contains the tax  (typical EU retail)
     */
    async createPlan({
      productName,
      amountMinor,
      currency,
      interval = "month",
      taxBehavior = "exclusive",
      taxCode,
      metadata = {},
    }) {
      const product = await stripe.products.create({
        name: productName,
        ...(taxCode ? { tax_code: taxCode } : {}),
        metadata,
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: amountMinor,
        currency: String(currency).toLowerCase(),
        recurring: { interval },
        tax_behavior: taxBehavior,
      });
      return { product, price };
    },

    async createSellerCustomer({ email, name, address = null, metadata = {} }) {
      // Stripe Tax needs an address to derive a jurisdiction from. A Customer
      // with no address gets no tax computed -- silently.
      return stripe.customers.create({
        email,
        ...(name ? { name } : {}),
        ...(address ? { address } : {}),
        metadata,
      });
    },

    /**
     * `payment_behavior: 'default_incomplete'` is the correct default and the
     * one to understand:
     *
     *   default_incomplete    subscription starts `incomplete`, you get a secret
     *                         to confirm on the client. 3DS works. <-- use this
     *   error_if_incomplete   throws if the card needs authentication
     *   allow_incomplete      leaves you a live subscription with an unpaid
     *                         invoice, which is the worst of both
     *
     * Confirm on the client with `latest_invoice.confirmation_secret`.
     * NOT `latest_invoice.payment_intent` -- that is the pre-2025 pattern and
     * most sample code online still shows it. In this API version the field on
     * Invoice is `confirmation_secret`.
     */
    async subscribe({
      customer,
      priceId,
      trialDays = null,
      automaticTax = true,
      reference,
      metadata = {},
    }) {
      return stripe.subscriptions.create(
        {
          customer,
          items: [{ price: priceId }],
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          automatic_tax: { enabled: automaticTax },
          ...(trialDays ? { trial_period_days: trialDays } : {}),
          expand: ["latest_invoice.confirmation_secret"],
          metadata: { ...metadata, ...(reference ? { reference } : {}) },
        },
        { idempotencyKey: idempotencyKey(reference ? `sub:${reference}` : null) },
      );
    },

    /**
     * Pull the client secret out of a freshly created subscription, tolerating
     * both field shapes so this keeps working across an API version bump.
     */
    clientSecretFor(subscription) {
      const invoice = subscription?.latest_invoice;
      if (!invoice || typeof invoice === "string") return null;
      return (
        invoice.confirmation_secret?.client_secret ??
        // Older API versions exposed the secret via the invoice's PaymentIntent.
        invoice.payment_intent?.client_secret ??
        null
      );
    },

    /**
     * Cancelling at period end is almost always what "cancel" should mean:
     * the seller keeps what they paid for until it runs out. Immediate
     * cancellation without a refund is a support ticket.
     */
    async cancelAtPeriodEnd(subscriptionId) {
      return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    },

    /**
     * Do not build plan-switching, payment-method updates, invoice history and
     * dunning yourself. This is one call and Stripe maintains it.
     */
    async portalSession({ customer, returnUrl }) {
      return stripe.billingPortal.sessions.create({ customer, return_url: returnUrl });
    },

    /**
     * Usage-based billing uses Billing Meters, the current mechanism. Send an
     * `identifier` with every event: it makes your retries idempotent, and you
     * will retry.
     */
    async createMeter({ displayName, eventName, aggregation = "sum" }) {
      return stripe.billing.meters.create({
        display_name: displayName,
        event_name: eventName,
        default_aggregation: { formula: aggregation },
        value_settings: { event_payload_key: "value" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      });
    },

    async recordUsage({ eventName, customer, value, identifier }) {
      return stripe.billing.meterEvents.create({
        event_name: eventName,
        payload: { stripe_customer_id: customer, value: String(value) },
        ...(identifier ? { identifier } : {}),
      });
    },
  };
}
