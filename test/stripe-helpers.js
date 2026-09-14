import Stripe from "stripe";
import { createStripeIntegration } from "../stripe/index.js";

/**
 * A stub transport so the Stripe modules can be tested without a network or a
 * live key. Records every request and replies with canned JSON, which lets us
 * assert on the exact parameters that would go over the wire -- the thing that
 * actually breaks when an API version moves under you.
 */
export function stubStripe({ reply = () => ({}), secretKey = "sk_test_stub" } = {}) {
  const requests = [];

  const fakeFetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? init.body : "";
    const params = new URLSearchParams(body);
    const record = {
      url,
      method: init.method,
      path: new URL(url).pathname,
      params,
      /** Form-encoded params flattened to a plain object for easy assertions. */
      body: Object.fromEntries(params.entries()),
      // The fetch client passes headers as an array of [name, value] pairs.
      // Normalise to a lowercase-keyed object so assertions don't depend on
      // the SDK's internal representation or on header casing.
      headers: Object.fromEntries(
        (Array.isArray(init.headers)
          ? init.headers
          : Object.entries(init.headers || {})
        ).map(([k, v]) => [String(k).toLowerCase(), v]),
      ),
    };
    requests.push(record);

    const payload = reply(record) ?? {};
    return new Response(JSON.stringify({ id: "obj_stub", ...payload }), {
      status: payload.__status ?? 200,
      headers: { "Content-Type": "application/json", "Request-Id": "req_stub" },
    });
  };

  const integration = createStripeIntegration({
    secretKey,
    httpClient: Stripe.createFetchHttpClient(fakeFetch),
    maxNetworkRetries: 0,
    applicationFeeBps: 250,
  });

  return {
    ...integration,
    requests,
    /** The most recent request, which is what a single-call test wants. */
    get last() {
      return requests[requests.length - 1];
    },
    find(path) {
      return requests.find((r) => r.path === path);
    },
  };
}
