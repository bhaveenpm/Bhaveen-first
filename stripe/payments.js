import { applicationFeeAmount, idempotencyKey } from "./client.js";

/**
 * Flow A: a buyer pays one of your sellers, and you keep a cut.
 *
 * This uses *destination charges*: the PaymentIntent is created on the platform
 * account and the funds are transferred onward to the seller. The platform owns
 * the buyer relationship, the descriptor and the dispute -- which is what you
 * want if there is one checkout and one support inbox.
 *
 * See notes/07-stripe-integration-plan.md section 3 for why not direct charges
 * or separate charge-and-transfer.
 */
export function payments({ stripe, config }) {
  return {
    /**
     * `on_behalf_of` is the parameter to not skip. It sets the settlement
     * merchant of record, which decides the acquiring country, the statement
     * descriptor, and -- the one that surprises people -- *whose tax
     * registrations Stripe Tax reads*. Setting `transfer_data.destination`
     * without it is legal, and quietly taxes the wrong entity.
     */
    async createSellerCharge({
      amountMinor,
      currency,
      sellerAccountId,
      customer = null,
      applicationFeeBps = config.applicationFeeBps,
      /** Your own order id. Used for the idempotency key, so a retried
       *  request after a timeout returns the original charge rather than a
       *  second one. */
      reference,
      metadata = {},
      description,
    }) {
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw new TypeError(
          `amountMinor must be a positive integer in minor units, got ${amountMinor}. ` +
            "Use src/money.js toMinorUnits() -- not amount * 100, which is wrong for JPY and KWD.",
        );
      }
      if (!sellerAccountId) throw new TypeError("sellerAccountId is required for a destination charge.");

      const fee = applicationFeeAmount(amountMinor, applicationFeeBps);

      return stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency: String(currency).toLowerCase(),
          ...(customer ? { customer } : {}),
          ...(description ? { description } : {}),
          automatic_payment_methods: { enabled: true },
          on_behalf_of: sellerAccountId,
          transfer_data: { destination: sellerAccountId },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          metadata: { ...metadata, ...(reference ? { reference } : {}) },
        },
        { idempotencyKey: idempotencyKey(reference ? `pi:${reference}` : null) },
      );
    },

    async retrieve(paymentIntentId) {
      return stripe.paymentIntents.retrieve(paymentIntentId);
    },

    /**
     * Refunding a destination charge: `reverse_transfer` claws the money back
     * out of the seller's balance, and `refund_application_fee` gives back your
     * cut too. Both default to false, which means a naive refund refunds the
     * buyer out of *your* balance and leaves the seller paid -- a slow leak
     * that only shows up at reconciliation.
     *
     * Whether you give back your fee is a policy choice; reversing the transfer
     * almost never isn't.
     */
    async refund({
      paymentIntentId,
      amountMinor = null,
      reverseTransfer = true,
      refundApplicationFee = true,
      reference,
      reason,
    }) {
      return stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          ...(amountMinor != null ? { amount: amountMinor } : {}),
          ...(reason ? { reason } : {}),
          reverse_transfer: reverseTransfer,
          refund_application_fee: refundApplicationFee,
        },
        { idempotencyKey: idempotencyKey(reference ? `refund:${reference}` : null) },
      );
    },
  };
}
