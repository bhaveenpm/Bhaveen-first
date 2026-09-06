export { GpClient, newIdempotencyKey, generateNonce, generateSecret } from "./client.js";
export { GpApiError, GpConfigError } from "./errors.js";
export { Links, LINK_STATUS, USAGE_MODE } from "./resources/links.js";
export { Transactions } from "./resources/transactions.js";
export {
  Orders, memoryStore, encodeReference, parseReference,
  CHANNELS, PAYMENT_STATE, FULFILMENT_STATE, EXCEPTION,
} from "./resources/orders.js";
export { toMinorUnits, toMajorUnits, formatAmount, currencyExponent } from "./money.js";
export { ENVIRONMENTS, GP_API_VERSION, resolveConfig } from "./config.js";

import { GpClient } from "./client.js";
import { Links } from "./resources/links.js";
import { Transactions } from "./resources/transactions.js";
import { Orders, memoryStore } from "./resources/orders.js";

/** Convenience factory: a client with the resources already attached. */
export function createGp(overrides = {}) {
  const client = new GpClient(overrides);
  const links = new Links(client);
  const transactions = new Transactions(client);
  const orders = new Orders({
    links,
    transactions,
    store: overrides.orderStore ?? memoryStore(),
    webhooks: overrides.webhooks ?? (() => []),
  });
  return { client, links, transactions, orders };
}
