import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDotEnv } from "../src/config.js";

/**
 * Resolve .env from the repo root rather than process.cwd(). A config that
 * only loads when you happen to run from the right directory is a config that
 * works on your machine and fails in a cron job.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pinned deliberately. Inheriting the account's default API version means a
 * dashboard-side upgrade changes your integration's behaviour without a deploy;
 * pinning turns that into a code change you can test and roll back.
 *
 * This is the version the installed SDK is generated against. Bumping it is a
 * task, not a formality: read the changelog first.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export class StripeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "StripeConfigError";
  }
}

/**
 * Stripe keys are self-describing, and the prefix is worth checking before the
 * first API call rather than after: the difference between sk_test and sk_live
 * is the difference between a rehearsal and real money, and the API will
 * happily accept either.
 *
 *   sk_  secret          server-side only
 *   rk_  restricted      server-side only, scoped -- prefer these
 *   pk_  publishable     the only key that may reach a browser
 */
export function describeKey(key) {
  const text = String(key || "").trim();
  if (!text) throw new StripeConfigError("No Stripe key provided.");

  const match = /^(sk|rk|pk)_(test|live)_/.exec(text);
  if (!match) {
    throw new StripeConfigError(
      "Not a recognisable Stripe key. Expected a sk_/rk_/pk_ prefix followed by test_ or live_.",
    );
  }
  const [, kind, mode] = match;

  if (kind === "pk") {
    throw new StripeConfigError(
      "That is a publishable key (pk_). It belongs in your frontend; server calls need sk_ or rk_.",
    );
  }

  return {
    kind,
    mode,
    livemode: mode === "live",
    restricted: kind === "rk",
    /** Safe to log. The tail is enough to tell two keys apart in a support thread. */
    redacted: `${kind}_${mode}_...${text.slice(-4)}`,
  };
}

export function resolveStripeConfig(overrides = {}) {
  const file = loadDotEnv(join(REPO_ROOT, ".env"));
  const env = { ...file, ...process.env };

  const secretKey = overrides.secretKey || env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY is not set. Copy .env.example to .env and fill it in.",
    );
  }
  const key = describeKey(secretKey);

  const feeBps = Number(overrides.applicationFeeBps ?? env.STRIPE_APPLICATION_FEE_BPS ?? 0);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new StripeConfigError(
      `STRIPE_APPLICATION_FEE_BPS must be an integer in 0..10000 basis points, got ${feeBps}.`,
    );
  }

  return {
    secretKey,
    publishableKey: overrides.publishableKey || env.STRIPE_PUBLISHABLE_KEY || null,
    webhookSecret: overrides.webhookSecret || env.STRIPE_WEBHOOK_SECRET || null,
    apiVersion: overrides.apiVersion || STRIPE_API_VERSION,
    applicationFeeBps: feeBps,
    livemode: key.livemode,
    keyDescription: key,
  };
}
