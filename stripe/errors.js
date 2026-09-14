/**
 * Stripe's error classes already separate the cases that matter; the mistake
 * integrations make is collapsing them into one "payment failed" branch. Three
 * questions have three different answers:
 *
 *   Is this the customer's problem?   -> StripeCardError (a decline)
 *   Is this my problem?               -> StripeInvalidRequestError (a bug)
 *   Is this nobody's problem yet?     -> ConnectionError / RateLimitError
 *
 * Only the third is retryable. Retrying a decline re-presents the same card to
 * the same issuer, which looks like card testing and gets you rate-limited by
 * the network -- a decline is a business outcome, not a transient failure.
 */
export function classifyStripeError(error) {
  const type = error?.type || error?.constructor?.name;

  const base = {
    type,
    code: error?.code ?? null,
    declineCode: error?.decline_code ?? null,
    requestId: error?.requestId ?? null,
    statusCode: error?.statusCode ?? null,
    message: error?.message ?? String(error),
  };

  switch (type) {
    case "StripeCardError":
      return { ...base, category: "declined", retryable: false, customerFacing: true };

    case "StripeInvalidRequestError":
      // Your request is wrong. Retrying is a slower failure.
      return { ...base, category: "bad_request", retryable: false, customerFacing: false };

    case "StripeAuthenticationError":
      return { ...base, category: "auth", retryable: false, customerFacing: false };

    case "StripePermissionError":
      // Usually a restricted key missing a scope, or a Connect account you
      // don't control. Both are configuration, not load.
      return { ...base, category: "permission", retryable: false, customerFacing: false };

    case "StripeIdempotencyError":
      // The same idempotency key was reused with a *different* body. Almost
      // always a key derived from something not unique enough.
      return { ...base, category: "idempotency", retryable: false, customerFacing: false };

    case "StripeRateLimitError":
    case "RateLimitError":
      return { ...base, category: "rate_limit", retryable: true, customerFacing: false };

    case "StripeConnectionError":
    case "StripeAPIError":
      return { ...base, category: "transient", retryable: true, customerFacing: false };

    default:
      // Unknown: treat as non-retryable. Guessing "retry" on an unrecognised
      // error is how a bug becomes a stampede.
      return { ...base, category: "unknown", retryable: false, customerFacing: false };
  }
}

/**
 * A decline reason a customer can act on. Stripe's raw messages are written for
 * developers; `decline_code` is the field that actually distinguishes
 * "use a different card" from "call your bank".
 */
export function customerMessageFor(error) {
  const { category, declineCode } = classifyStripeError(error);
  if (category !== "declined") return "We couldn't process that payment. Please try again.";

  switch (declineCode) {
    case "insufficient_funds":
      return "That card was declined for insufficient funds. Try another card.";
    case "expired_card":
      return "That card has expired. Please use a different card.";
    case "incorrect_cvc":
      return "The security code didn't match. Please check it and try again.";
    case "card_not_supported":
      return "That card doesn't support this type of purchase. Try another card.";
    case "lost_card":
    case "stolen_card":
      // Never tell the customer why. Stripe deliberately reports these
      // generically to the cardholder; echoing the real reason tips off fraud.
      return "That card was declined. Please use a different card.";
    case "do_not_honor":
    case "generic_decline":
    default:
      return "That card was declined by the issuer. Please use a different card or contact your bank.";
  }
}
