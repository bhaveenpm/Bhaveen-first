/**
 * GP API failures carry three distinct pieces of information and integrators
 * routinely collapse them into one string, which is why "the payment failed"
 * support tickets are so hard to action:
 *
 *   status                  - HTTP status. Was the request accepted at all?
 *   error_code              - coarse, stable category (MANDATORY_DATA_MISSING,
 *                             INVALID_REQUEST_DATA, SYSTEM_ERROR ...)
 *   detailed_error_code     - the specific reason (40006, 50013 ...)
 *
 * Only `error_code` is safe to branch on. `detailed_error_description` is prose
 * meant for your logs, never for your customer and never for a switch statement.
 */
export class GpApiError extends Error {
  constructor({ status, errorCode, detailedErrorCode, description, requestId, path, body }) {
    super(description || errorCode || `GP API request failed with ${status}`);
    this.name = "GpApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.detailedErrorCode = detailedErrorCode;
    this.description = description;
    this.requestId = requestId;
    this.path = path;
    this.body = body;
  }

  /**
   * A decline is a business outcome, not a bug. It arrives over an HTTP error
   * status, so code that treats every non-2xx as "the integration is broken"
   * will page an engineer because a shopper's card had no money on it.
   * Branch on this before you branch on anything else.
   */
  get declined() {
    return this.errorCode === "DECLINED";
  }

  /**
   * Whether re-sending the identical request could plausibly succeed.
   * 4xx other than 429 means the request itself is wrong: retrying is just a
   * slower failure. A decline is emphatically not retryable -- the same card
   * will be declined again, and repeated attempts look like card testing to
   * the issuer.
   */
  get retryable() {
    if (this.declined) return false;
    return this.status === 429 || this.status >= 500;
  }

  toString() {
    const parts = [`${this.name}: ${this.status}`];
    if (this.errorCode) parts.push(this.errorCode);
    if (this.detailedErrorCode) parts.push(`#${this.detailedErrorCode}`);
    if (this.description) parts.push(`- ${this.description}`);
    return parts.join(" ");
  }
}

export class GpConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "GpConfigError";
  }
}
