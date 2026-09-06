/**
 * The order layer the GP API doesn't have.
 *
 * WHY THIS EXISTS
 *
 * The API models money moving. A seller's job is bigger than that:
 *
 *   agree price → collect → know it's paid → SHIP → handle returns
 *                 └──── the API covers this ────┘
 *
 * Between "the money arrived" and "the seller ships" there is nothing. The only
 * thing connecting a GP link, a GP transaction and a webhook back to the
 * seller's own order is `reference` -- a FREE-TEXT, OPTIONAL string. The single
 * most load-bearing field for reconciliation is the one the API cares least
 * about.
 *
 * So every integrator writes this file. They all write it slightly differently,
 * they all get the exception states wrong, and the ones who skip it end up
 * reconciling in a spreadsheet. This is that layer, written once, to show what
 * it would look like as a first-class API concept.
 *
 * THREE THINGS IT ADDS
 *
 * 1. A STRUCTURED reference ("IG-2291") instead of free text, so the join key
 *    is parseable and validated rather than whatever someone typed.
 * 2. ONE call for "everything about order X" -- link, transactions, webhooks,
 *    joined. Today that is several paged searches and a client-side join, which
 *    this class performs, deliberately visible in the wire log.
 * 3. FULFILMENT state, which GP has no concept of, and therefore the EXCEPTION
 *    states that only exist once you hold payment and fulfilment together.
 *    Those exceptions are the entire argument: they are invisible today because
 *    nothing owns both halves.
 */

import { toMinorUnits } from "../money.js";

/** Where the sale was agreed. Social commerce is multi-channel by nature. */
export const CHANNELS = Object.freeze({
  IG: "Instagram",
  WA: "WhatsApp",
  TT: "TikTok",
  FB: "Facebook",
  EM: "Email",
  WEB: "Website",
});

const REFERENCE_PATTERN = /^([A-Z]{2,3})-(\d{1,10})$/;

export function encodeReference({ channel, orderId }) {
  const code = String(channel || "").toUpperCase();
  if (!CHANNELS[code]) {
    throw new TypeError(`Unknown channel "${channel}". Expected one of: ${Object.keys(CHANNELS).join(", ")}`);
  }
  if (!/^\d{1,10}$/.test(String(orderId))) {
    throw new TypeError(`orderId must be 1-10 digits, got "${orderId}"`);
  }
  return `${code}-${orderId}`;
}

/**
 * Free-text references are why reconciliation is hard: "order 12", "Order#12"
 * and "12" are the same order to a human and three different orders to a
 * machine. Parsing returns `valid:false` rather than throwing, because you will
 * meet unstructured references in real data and still have to display them.
 */
export function parseReference(reference) {
  const match = REFERENCE_PATTERN.exec(String(reference || ""));
  if (!match) return { valid: false, reference, channel: null, channelName: null, orderId: null };
  const [, channel, orderId] = match;
  return {
    valid: Boolean(CHANNELS[channel]),
    reference,
    channel,
    channelName: CHANNELS[channel] ?? null,
    orderId,
  };
}

export const PAYMENT_STATE = Object.freeze({
  AWAITING: "AWAITING_PAYMENT",
  PAID: "PAID",
  REFUNDED: "REFUNDED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

export const FULFILMENT_STATE = Object.freeze({
  UNFULFILLED: "UNFULFILLED",
  SHIPPED: "SHIPPED",
});

/**
 * The states nobody can see today, because payment lives at GP and fulfilment
 * lives in the seller's head. Each one is money or goods at risk.
 */
export const EXCEPTION = Object.freeze({
  // Paid a while ago, still not shipped. The buyer is waiting and doesn't know why.
  PAID_NOT_SHIPPED: "PAID_NOT_SHIPPED",
  // Shipped against an order that was never paid. Goods gone, no money.
  SHIPPED_NOT_PAID: "SHIPPED_NOT_PAID",
  // Refunded after shipping. Neither goods nor money.
  REFUNDED_AFTER_SHIPPING: "REFUNDED_AFTER_SHIPPING",
  // A live link nobody has paid, long past the point one normally would.
  STALE_LINK: "STALE_LINK",
});

const STALE_AFTER_MS = 1000 * 60 * 60 * 48;

export class Orders {
  /**
   * @param {object} deps
   * @param {import("./links.js").Links} deps.links
   * @param {import("./transactions.js").Transactions} deps.transactions
   * @param {{get(ref):object, set(ref,value):void, all():object}} deps.store
   *        Fulfilment state. Local, because GP has nowhere to put it -- which
   *        is the point being made, not an implementation shortcut.
   */
  constructor({ links, transactions, store, webhooks = () => [] }) {
    this.links = links;
    this.transactions = transactions;
    this.store = store;
    this.webhooks = webhooks;
  }

  async create({ channel, orderId, amount, currency, name, description, statusUrl, usageMode, usageLimit }) {
    const reference = encodeReference({ channel, orderId });
    toMinorUnits(amount, currency); // fail here, not three calls later

    const link = await this.links.create({
      amount, currency, reference, name, description, statusUrl, usageMode, usageLimit,
    });

    this.store.set(reference, {
      reference, channel, orderId, name,
      fulfilment: FULFILMENT_STATE.UNFULFILLED,
      createdAt: new Date().toISOString(),
    });

    return this.get(reference, { link });
  }

  /**
   * Everything about one order, joined.
   *
   * Note what this costs: a link search and a transaction search, then a join
   * in memory. Two round trips and bespoke code, per order, for a question
   * every merchant asks constantly. That is the case for making it one call.
   */
  async get(reference, { link: known } = {}) {
    const [linkPage, txnPage] = await Promise.all([
      known ? Promise.resolve({ links: [known] }) : this.links.search({ pageSize: 50 }),
      this.transactions.search({ pageSize: 50 }),
    ]);

    const link = known ?? (linkPage.links ?? []).find((l) => l.reference === reference) ?? null;
    const txns = (txnPage.transactions ?? []).filter((t) => t.reference === reference);
    const hooks = this.webhooks().filter((w) => w.body?.reference === reference);
    const local = this.store.get(reference) ?? {};

    return this.#assemble({ reference, link, transactions: txns, webhooks: hooks, local });
  }

  /** The seller's whole book, joined the same way. */
  async list() {
    const [linkPage, txnPage] = await Promise.all([
      this.links.search({ pageSize: 100 }),
      this.transactions.search({ pageSize: 100 }),
    ]);

    const links = linkPage.links ?? [];
    const txns = txnPage.transactions ?? [];
    const hooks = this.webhooks();

    const references = new Set([
      ...links.map((l) => l.reference),
      ...txns.map((t) => t.reference).filter(Boolean),
      ...Object.keys(this.store.all()),
    ]);

    return [...references]
      .map((reference) =>
        this.#assemble({
          reference,
          link: links.find((l) => l.reference === reference) ?? null,
          transactions: txns.filter((t) => t.reference === reference),
          webhooks: hooks.filter((w) => w.body?.reference === reference),
          local: this.store.get(reference) ?? {},
        }),
      )
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }

  markShipped(reference) {
    const existing = this.store.get(reference) ?? { reference };
    this.store.set(reference, {
      ...existing,
      fulfilment: FULFILMENT_STATE.SHIPPED,
      shippedAt: new Date().toISOString(),
    });
    return this.get(reference);
  }

  markUnshipped(reference) {
    const existing = this.store.get(reference) ?? { reference };
    this.store.set(reference, { ...existing, fulfilment: FULFILMENT_STATE.UNFULFILLED, shippedAt: null });
    return this.get(reference);
  }

  #assemble({ reference, link, transactions, webhooks, local }) {
    const parsed = parseReference(reference);

    const captured = transactions.filter((t) => t.status === "CAPTURED");
    const refunded = transactions.filter((t) => t.status === "REFUNDED");

    let payment = PAYMENT_STATE.AWAITING;
    if (refunded.length) payment = PAYMENT_STATE.REFUNDED;
    else if (captured.length || link?.status === "PAID") payment = PAYMENT_STATE.PAID;
    else if (link?.status === "EXPIRED") payment = PAYMENT_STATE.EXPIRED;
    else if (link?.status === "INACTIVE" || link?.status === "CLOSED") payment = PAYMENT_STATE.CANCELLED;

    const fulfilment = local.fulfilment ?? FULFILMENT_STATE.UNFULFILLED;
    const createdAt = local.createdAt ?? link?.time_created ?? transactions[0]?.time_created ?? null;

    const exceptions = [];
    const paid = payment === PAYMENT_STATE.PAID;
    const shipped = fulfilment === FULFILMENT_STATE.SHIPPED;
    const age = createdAt ? Date.now() - Date.parse(createdAt) : 0;

    if (paid && !shipped) exceptions.push(EXCEPTION.PAID_NOT_SHIPPED);
    if (shipped && payment === PAYMENT_STATE.AWAITING) exceptions.push(EXCEPTION.SHIPPED_NOT_PAID);
    if (shipped && payment === PAYMENT_STATE.REFUNDED) exceptions.push(EXCEPTION.REFUNDED_AFTER_SHIPPING);
    if (payment === PAYMENT_STATE.AWAITING && link?.status === "ACTIVE" && age > STALE_AFTER_MS) {
      exceptions.push(EXCEPTION.STALE_LINK);
    }

    return {
      reference,
      structured: parsed.valid,
      channel: parsed.channel,
      channelName: parsed.channelName,
      orderId: parsed.orderId,
      name: local.name ?? link?.name ?? null,
      amount: link?.transactions?.amount ?? captured[0]?.amount ?? null,
      currency: link?.transactions?.currency ?? captured[0]?.currency ?? null,
      payment,
      fulfilment,
      exceptions,
      createdAt,
      shippedAt: local.shippedAt ?? null,
      link: link ? { id: link.id, status: link.status, url: link.url, usage: `${link.usage_count}/${link.usage_limit}` } : null,
      transactions: transactions.map((t) => ({ id: t.id, status: t.status, amount: t.amount, currency: t.currency })),
      webhookCount: webhooks.length,
    };
  }
}

/** A fulfilment store. In a real system this is your own database. */
export function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (ref) => data[ref],
    set: (ref, value) => { data[ref] = value; },
    all: () => ({ ...data }),
  };
}
