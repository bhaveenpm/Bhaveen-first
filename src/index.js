export { GpClient, newIdempotencyKey, generateNonce, generateSecret } from "./client.js";
export { GpApiError, GpConfigError } from "./errors.js";
export { Links, LINK_STATUS, USAGE_MODE } from "./resources/links.js";
export { Transactions } from "./resources/transactions.js";
export { toMinorUnits, toMajorUnits, formatAmount, currencyExponent } from "./money.js";
export { ENVIRONMENTS, GP_API_VERSION, resolveConfig } from "./config.js";

import { GpClient } from "./client.js";
import { Links } from "./resources/links.js";
import { Transactions } from "./resources/transactions.js";

/** Convenience factory: a client with the resources already attached. */
export function createGp(overrides = {}) {
  const client = new GpClient(overrides);
  return {
    client,
    links: new Links(client),
    transactions: new Transactions(client),
  };
}
