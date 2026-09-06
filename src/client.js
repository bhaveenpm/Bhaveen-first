import { createHash, randomUUID } from "node:crypto";
import { GP_API_VERSION } from "./config.js";
import { resolveConfig } from "./config.js";
import { GpApiError } from "./errors.js";

/**
 * GP API authentication is a two-step, deliberately stateless design:
 *
 *   1. POST /accesstoken proving you hold app_key, WITHOUT sending app_key.
 *      You send a nonce and sha512(nonce + app_key). The key never crosses
 *      the wire, so a captured request cannot be replayed into a new token.
 *   2. Every other call carries `Authorization: Bearer <token>`.
 *
 * The practical consequence -- and the thing integrations get wrong -- is that
 * the token is long-lived (a token can be valid for days) and rate limits apply
 * to token creation. Minting a fresh token per transaction is the single most
 * common way to turn a working integration into a 429 under load. This client
 * caches and reuses one.
 */

const TOKEN_REFRESH_MARGIN_SECONDS = 60;

export function generateNonce() {
  return new Date().toISOString();
}

export function generateSecret(nonce, appKey) {
  return createHash("sha512").update(nonce + appKey).digest("hex").toLowerCase();
}

export class GpClient {
  #config;
  #token = null;
  #tokenExpiresAt = 0;
  #scope = null;
  #inFlightAuth = null;

  constructor(overrides = {}) {
    this.#config = resolveConfig(overrides);
    this.debug = overrides.debug ?? process.env.GP_DEBUG === "1";
    this.maxRetries = overrides.maxRetries ?? 2;
    this.fetchImpl = overrides.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = overrides.timeoutMs ?? 20_000;
  }

  get config() {
    return { ...this.#config, appKey: "***redacted***" };
  }

  get scope() {
    return this.#scope;
  }

  /**
   * Returns a valid bearer token, minting one only when the cached one is gone
   * or close to expiry. Concurrent callers share a single in-flight request
   * rather than each racing to create their own token.
   */
  async accessToken() {
    if (this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;
    if (this.#inFlightAuth) return this.#inFlightAuth;

    this.#inFlightAuth = this.#authenticate().finally(() => {
      this.#inFlightAuth = null;
    });
    return this.#inFlightAuth;
  }

  async #authenticate() {
    const nonce = generateNonce();
    const body = {
      app_id: this.#config.appId,
      nonce,
      secret: generateSecret(nonce, this.#config.appKey),
      grant_type: "client_credentials",
    };

    const response = await this.#send("POST", "/accesstoken", {
      body,
      authenticated: false,
    });

    this.#token = response.token;
    this.#scope = response.scope ?? null;

    // `seconds_to_expire` is what the API actually granted, which may be less
    // than what you asked for. Trust the response, not your own assumption.
    const ttl = Number(response.seconds_to_expire ?? 0);
    this.#tokenExpiresAt =
      ttl > 0
        ? Date.now() + Math.max(ttl - TOKEN_REFRESH_MARGIN_SECONDS, 1) * 1000
        : Date.now() + 60_000;

    return this.#token;
  }

  /**
   * Most resources are scoped to a merchant *account*, not just a merchant.
   * The account list arrives inside the token's scope, so the correct account
   * name is discoverable at runtime -- no need to hardcode it per merchant.
   * Account id prefixes: TRA_ transaction processing, TKA_ tokenization,
   * DIA_ dispute management, RAA_ risk assessment, MMA_ merchant management.
   */
  async accountName(prefix = "TRA_") {
    if (this.#config.accountName) return this.#config.accountName;
    await this.accessToken();
    const accounts = this.#scope?.accounts ?? [];
    const match =
      accounts.find((a) => String(a.id || "").startsWith(prefix)) ?? accounts[0];
    return match?.name ?? "";
  }

  async request(method, path, options = {}) {
    return this.#withRetries(() =>
      this.#send(method, path, { ...options, authenticated: true }),
    );
  }

  get(path, options) { return this.request("GET", path, options); }
  post(path, options) { return this.request("POST", path, options); }
  patch(path, options) { return this.request("PATCH", path, options); }
  del(path, options) { return this.request("DELETE", path, options); }

  async #withRetries(operation) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const isLast = attempt === this.maxRetries;
        const retryable = error instanceof GpApiError ? error.retryable : isNetworkError(error);
        if (isLast || !retryable) throw error;

        // Full jitter: without it, every client that failed together retries
        // together and re-creates the spike that caused the failure.
        const backoff = Math.random() * Math.min(2 ** attempt * 250, 4000);
        const wait = error.retryAfterMs ?? backoff;
        if (this.debug) console.error(`  ~ retry ${attempt + 1} in ${Math.round(wait)}ms`);
        await sleep(wait);
      }
    }
    throw lastError;
  }

  async #send(method, path, { body, query, idempotencyKey, authenticated = true } = {}) {
    const url = new URL(this.#config.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Versioning is by header. Omit it and you get the API's default
      // version, which is not necessarily the one you built against.
      "X-GP-Version": GP_API_VERSION,
    };

    if (authenticated) {
      headers.Authorization = `Bearer ${await this.accessToken()}`;
    }

    // Idempotency is opt-in and per-request. A retried POST without a key can
    // create a second charge; with a key, the API returns the original result.
    if (idempotencyKey) headers["x-gp-idempotency"] = idempotencyKey;

    const payload = body === undefined ? undefined : JSON.stringify(body);

    if (this.debug) {
      console.error(`\n> ${method} ${url.pathname}${url.search}`);
      console.error(`  ${JSON.stringify(redactHeaders(headers))}`);
      if (payload) console.error(`  ${redactBody(payload)}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      error.isNetworkError = true;
      throw error;
    }
    clearTimeout(timer);

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (this.debug) {
      console.error(`< ${response.status} ${redactBody(JSON.stringify(parsed))}`);
    }

    if (!response.ok) {
      const error = new GpApiError({
        status: response.status,
        errorCode: parsed.error_code,
        detailedErrorCode: parsed.detailed_error_code,
        description: parsed.detailed_error_description ?? parsed.error_description,
        requestId: response.headers.get("x-gp-request-id") ?? undefined,
        path,
        body: parsed,
      });
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        error.retryAfterMs = retryAfter * 1000;
      }
      throw error;
    }

    return parsed;
  }
}

function isNetworkError(error) {
  return Boolean(error?.isNetworkError) || error?.name === "AbortError";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SENSITIVE_KEYS = /"(secret|app_key|token|number|cvv|cvn)"\s*:\s*"[^"]*"/gi;

function redactBody(json) {
  return String(json).replace(SENSITIVE_KEYS, (_, key) => `"${key}":"***"`);
}

function redactHeaders(headers) {
  const copy = { ...headers };
  if (copy.Authorization) copy.Authorization = "Bearer ***";
  return copy;
}

export function newIdempotencyKey() {
  return randomUUID();
}
