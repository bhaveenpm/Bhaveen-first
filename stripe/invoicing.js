import { idempotencyKey } from "./client.js";

/**
 * Standalone invoicing -- one-off or negotiated charges, as opposed to the
 * invoices a subscription generates for you.
 *
 * The ordering below is strict and is the thing to internalise:
 *
 *   1. create the items      (they sit "pending" against the customer)
 *   2. create the invoice     (it sweeps up pending items)
 *   3. FINALIZE               (<- tax is computed here; invoice becomes immutable)
 *   4. send                   (if you're collecting by emailed payment page)
 *
 * An invoice is mutable until step 3 and frozen after. People reach for step 3
 * too early, then cannot fix a wrong line.
 */
export function invoicing({ stripe }) {
  return {
    /**
     * NOTE the parameter name: `pricing: { price }`, not `price`.
     *
     * Verified against the SDK types for this API version --
     * InvoiceItemCreateParams exposes `pricing`, `price_data` and `amount`, and
     * there is no bare `price` field. Practically every tutorial online still
     * writes `price`, which now fails as an unknown parameter.
     */
    async addItem({ customer, priceId, quantity = 1, description, metadata = {} }) {
      return stripe.invoiceItems.create({
        customer,
        pricing: { price: priceId },
        quantity,
        ...(description ? { description } : {}),
        metadata,
      });
    },

    /** An ad-hoc amount with no pre-existing Price object. */
    async addAdHocItem({
      customer,
      amountMinor,
      currency,
      description,
      taxBehavior = "exclusive",
      taxCode,
    }) {
      return stripe.invoiceItems.create({
        customer,
        amount: amountMinor,
        currency: String(currency).toLowerCase(),
        ...(description ? { description } : {}),
        tax_behavior: taxBehavior,
        ...(taxCode ? { tax_code: taxCode } : {}),
      });
    },

    /**
     * `collection_method` is the choice that decides whether this invoice will
     * ever be paid:
     *
     *   charge_automatically   charges the customer's stored payment method
     *   send_invoice           emails a hosted payment page; needs days_until_due
     *
     * Picking `send_invoice` with no payment method on file is correct.
     * Picking `charge_automatically` with no payment method on file produces an
     * invoice that silently never collects.
     */
    async createInvoice({
      customer,
      collectionMethod = "send_invoice",
      daysUntilDue = 30,
      automaticTax = true,
      description,
      metadata = {},
      reference,
    }) {
      return stripe.invoices.create(
        {
          customer,
          collection_method: collectionMethod,
          ...(collectionMethod === "send_invoice" ? { days_until_due: daysUntilDue } : {}),
          automatic_tax: { enabled: automaticTax },
          // Sweep up the pending items created above. This is the default, but
          // being explicit documents the dependency on step 1.
          pending_invoice_items_behavior: "include",
          ...(description ? { description } : {}),
          metadata: { ...metadata, ...(reference ? { reference } : {}) },
        },
        { idempotencyKey: idempotencyKey(reference ? `inv:${reference}` : null) },
      );
    },

    /** Step 3. Tax is computed here. After this the invoice cannot be edited. */
    async finalize(invoiceId) {
      return stripe.invoices.finalizeInvoice(invoiceId);
    },

    /** Step 4. Returns the invoice carrying `hosted_invoice_page`. */
    async send(invoiceId) {
      return stripe.invoices.sendInvoice(invoiceId);
    },

    /**
     * The whole sequence, in the right order, for the common case.
     * Returns the finalized (and optionally sent) invoice.
     */
    async issue({ customer, items, reference, collectionMethod = "send_invoice", send = true }) {
      for (const item of items) {
        if (item.priceId) {
          await this.addItem({ customer, ...item });
        } else {
          await this.addAdHocItem({ customer, ...item });
        }
      }
      const draft = await this.createInvoice({ customer, collectionMethod, reference });
      const finalized = await this.finalize(draft.id);
      if (!send || collectionMethod !== "send_invoice") return finalized;
      return this.send(finalized.id);
    },

    /** Voiding preserves the record; deleting is only possible while draft. */
    async voidInvoice(invoiceId) {
      return stripe.invoices.voidInvoice(invoiceId);
    },
  };
}
