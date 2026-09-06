import { toMinorUnits } from "../money.js";
import { newIdempotencyKey } from "../client.js";

/**
 * Transactions (POST /transactions).
 *
 * The field that decides the whole downstream flow is `capture_mode`:
 *
 *   AUTO   - authorise and capture in one call. A "sale".
 *   LATER  - authorise only; money moves when you POST .../capture.
 *   MULTIPLE - authorise once, capture in parts (split shipments).
 *
 * Choosing LATER is a business decision about when you take the customer's
 * money relative to when you deliver, not a technical one -- and it is encoded
 * in a single enum on the request.
 */
export class Transactions {
  constructor(client) {
    this.client = client;
  }

  async sale(input) {
    return this.#authorize({ ...input, captureMode: "AUTO" });
  }

  async authorize(input) {
    return this.#authorize({ ...input, captureMode: input.captureMode ?? "LATER" });
  }

  async #authorize({
    amount,
    currency,
    reference,
    card,
    paymentMethodId,
    captureMode = "AUTO",
    country,
    accountName,
    idempotencyKey = newIdempotencyKey(),
  }) {
    if (!amount || !currency) throw new TypeError("amount and currency are required");
    if (!card && !paymentMethodId) {
      throw new TypeError("provide either `card` or a stored `paymentMethodId`");
    }

    const paymentMethod = paymentMethodId
      ? { id: paymentMethodId }
      : {
          entry_mode: "ECOM",
          card: {
            number: card.number,
            expiry_month: String(card.expiryMonth).padStart(2, "0"),
            expiry_year: String(card.expiryYear).slice(-2),
            cvv: card.cvv,
            cvv_indicator: card.cvv ? "PRESENT" : "NOT_PRESENT",
          },
        };

    const body = {
      account_name: accountName ?? (await this.client.accountName()),
      channel: this.client.config.channel,
      capture_mode: captureMode,
      type: "SALE",
      amount: toMinorUnits(amount, currency),
      currency: String(currency).toUpperCase(),
      country: country ?? this.client.config.country,
      reference,
      payment_method: paymentMethod,
    };

    return this.client.post("/transactions", { body, idempotencyKey });
  }

  async capture(id, { amount, currency, idempotencyKey = newIdempotencyKey() } = {}) {
    const body = {};
    if (amount !== undefined) {
      if (!currency) throw new TypeError("currency is required for a partial capture");
      body.amount = toMinorUnits(amount, currency);
    }
    return this.client.post(`/transactions/${encodeURIComponent(id)}/capture`, {
      body,
      idempotencyKey,
    });
  }

  async refund(id, { amount, currency, idempotencyKey = newIdempotencyKey() } = {}) {
    const body = {};
    if (amount !== undefined) {
      if (!currency) throw new TypeError("currency is required for a partial refund");
      body.amount = toMinorUnits(amount, currency);
    }
    return this.client.post(`/transactions/${encodeURIComponent(id)}/refund`, {
      body,
      idempotencyKey,
    });
  }

  /**
   * Reversal vs refund is a real distinction, not a synonym: a reversal voids
   * an authorisation that has not settled (the customer often never sees it);
   * a refund moves money back after settlement and shows as a second entry.
   * Same intent, different customer experience and different cost.
   */
  async reverse(id, { idempotencyKey = newIdempotencyKey() } = {}) {
    return this.client.post(`/transactions/${encodeURIComponent(id)}/reversal`, {
      body: {},
      idempotencyKey,
    });
  }

  async get(id) {
    return this.client.get(`/transactions/${encodeURIComponent(id)}`);
  }

  async search({ page = 1, pageSize = 20, from, to, status, reference } = {}) {
    return this.client.get("/transactions", {
      query: {
        page,
        page_size: pageSize,
        from_time_created: from,
        to_time_created: to,
        status,
        reference,
      },
    });
  }
}
