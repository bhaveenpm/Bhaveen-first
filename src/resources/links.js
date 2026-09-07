import { toMinorUnits } from "../money.js";
import { newIdempotencyKey } from "../client.js";

/**
 * Pay by Link (POST /links).
 *
 * The interesting product property: this is the one GP API flow with no
 * merchant front end at all. The merchant creates a link server-side, the payer
 * completes on a GP-hosted page, and the merchant learns the outcome from a
 * webhook. That makes it the lowest-integration-cost way to take a payment --
 * which is exactly why it is the primitive under "social commerce": a link is
 * shareable anywhere a message can go.
 *
 * The corollary is that a link is a *durable, publicly reachable* payment
 * instruction. Unlike a transaction, it has a lifecycle you have to manage:
 * ACTIVE -> PAID | EXPIRED | INACTIVE | CLOSED. Every field below that
 * constrains that lifecycle (usage_mode, usage_limit, expiration_date) is a
 * control against a link outliving the intent that created it.
 */

export const LINK_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED",
  CLOSED: "CLOSED",
  PAID: "PAID",
});

export const USAGE_MODE = Object.freeze({ SINGLE: "SINGLE", MULTIPLE: "MULTIPLE" });

export class Links {
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {object} input
   * @param {string|number} input.amount   Major units, e.g. "24.99". Converted here.
   * @param {string} input.currency        ISO 4217, e.g. "GBP".
   * @param {string} input.reference       YOUR order id. This is the join key
   *                                       between GP's records and yours; a
   *                                       webhook without it is an orphan.
   */
  async create(input) {
    const {
      amount,
      currency,
      reference,
      name,
      description,
      expirationDate,
      usageMode = USAGE_MODE.SINGLE,
      usageLimit = 1,
      shippable = false,
      shippingAmount,
      returnUrl,
      statusUrl,
      cancelUrl,
      allowedPaymentMethods = ["CARD"],
      images,
      country,
      accountName,
      idempotencyKey = newIdempotencyKey(),
    } = input;

    if (!amount) throw new TypeError("amount is required");
    if (!currency) throw new TypeError("currency is required");
    if (!reference) throw new TypeError("reference is required (your own order id)");

    // A MULTIPLE-use link with a limit of 1 is a contradiction the API will
    // accept and that will then behave as single-use. Catch it here instead.
    if (usageMode === USAGE_MODE.SINGLE && Number(usageLimit) !== 1) {
      throw new RangeError("usage_mode SINGLE requires usage_limit 1");
    }

    // Shape verified against Global Payments' own MCP server
    // (github.com/globalpayments/mcp-server, src/clients/client.ts). Three
    // things that are easy to get wrong and are wrong in most reconstructions:
    // `country` and `channel` belong INSIDE `transactions`, `usage_limit` is a
    // number sent only for MULTIPLE, and `status` is not sent on create.
    const body = {
      account_name: accountName ?? (await this.client.accountName()),
      type: "PAYMENT",
      usage_mode: usageMode,
      reference,
      name: name ?? reference,
      description,
      shippable: shippable ? "YES" : "NO",
      transactions: {
        allowed_payment_methods: allowedPaymentMethods,
        amount: toMinorUnits(amount, currency),
        channel: this.client.config.channel,
        currency: String(currency).toUpperCase(),
        country: country ?? this.client.config.country,
      },
    };

    if (usageMode === USAGE_MODE.MULTIPLE) {
      body.usage_limit = Number(usageLimit);
    }

    if (shippable && shippingAmount !== undefined) {
      body.shipping_amount = toMinorUnits(shippingAmount, currency);
    }
    if (expirationDate) body.expiration_date = expirationDate;
    if (images) body.images = images;

    if (returnUrl || statusUrl || cancelUrl) {
      body.notifications = {};
      // Where the payer's browser lands. Cosmetic -- never treat as proof of payment.
      if (returnUrl) body.notifications.return_url = returnUrl;
      // Where GP POSTs the outcome. THIS is the source of truth.
      if (statusUrl) body.notifications.status_url = statusUrl;
      if (cancelUrl) body.notifications.cancel_url = cancelUrl;
    }

    return this.client.post("/links", { body, idempotencyKey });
  }

  async get(id) {
    return this.client.get(`/links/${encodeURIComponent(id)}`);
  }

  /**
   * Links are mutable while ACTIVE -- you can reprice or deactivate one after
   * sharing it. Powerful, and worth thinking about: whoever holds the link sees
   * whatever it says now, not what it said when you sent it.
   */
  async edit(id, changes = {}) {
    const body = {};
    if (changes.status) body.status = changes.status;
    if (changes.name) body.name = changes.name;
    if (changes.description) body.description = changes.description;
    if (changes.expirationDate) body.expiration_date = changes.expirationDate;
    if (changes.usageMode) body.usage_mode = changes.usageMode;
    if (changes.usageLimit !== undefined) body.usage_limit = String(changes.usageLimit);
    if (changes.amount !== undefined) {
      if (!changes.currency) throw new TypeError("currency is required to change amount");
      body.transactions = { amount: toMinorUnits(changes.amount, changes.currency) };
    }
    return this.client.patch(`/links/${encodeURIComponent(id)}`, {
      body,
      idempotencyKey: changes.idempotencyKey,
    });
  }

  async deactivate(id) {
    return this.edit(id, { status: LINK_STATUS.INACTIVE });
  }

  /** Reporting is paged. `page` is 1-based. */
  async search({ page = 1, pageSize = 20, status, usageMode, from, to, name } = {}) {
    return this.client.get("/links", {
      query: {
        page,
        page_size: pageSize,
        status,
        usage_mode: usageMode,
        from_time_created: from,
        to_time_created: to,
        name,
      },
    });
  }
}
