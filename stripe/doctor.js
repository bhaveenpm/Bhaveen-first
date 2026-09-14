/**
 * Preflight, in the spirit of scripts/doctor.js: say what is set up, what is
 * missing, and what to do about it -- before you spend an afternoon debugging
 * an integration that was never going to work.
 *
 * Runs the offline checks always, and the online ones only if it can reach
 * Stripe, so it stays useful on a plane or behind a restrictive egress policy.
 */
import { resolveStripeConfig, StripeConfigError } from "./config.js";
import { createStripe } from "./client.js";
import { classifyStripeError } from "./errors.js";

const ok = (m) => ({ level: "ok", message: m });
const warn = (m, fix) => ({ level: "warn", message: m, fix });
const fail = (m, fix) => ({ level: "fail", message: m, fix });

export async function runDoctor({ skipNetwork = false } = {}) {
  const checks = [];
  let config;

  // ---- offline ----
  try {
    config = resolveStripeConfig();
    const k = config.keyDescription;
    checks.push(ok(`Secret key parses: ${k.redacted}`));
    checks.push(
      k.livemode
        ? warn(
            "This is a LIVE key. Real money will move.",
            "Use a sk_test_/rk_test_ key until you are deliberately testing live.",
          )
        : ok("Test mode -- no real money can move."),
    );
    checks.push(
      k.restricted
        ? ok("Restricted key (rk_) -- blast radius is limited to its scopes.")
        : warn(
            "Full-access secret key (sk_).",
            "Prefer a restricted key (rk_) scoped to the resources this service needs: " +
              "https://dashboard.stripe.com/apikeys",
          ),
    );
    checks.push(ok(`API version pinned: ${config.apiVersion}`));
    checks.push(
      config.webhookSecret
        ? ok("Webhook signing secret is set.")
        : warn(
            "STRIPE_WEBHOOK_SECRET is empty -- webhook verification will refuse to run.",
            "Run `stripe listen --forward-to localhost:3000/webhook` and copy the whsec_ it prints.",
          ),
    );
    checks.push(
      config.applicationFeeBps > 0
        ? ok(`Platform fee: ${config.applicationFeeBps} bps (${config.applicationFeeBps / 100}%)`)
        : warn(
            "STRIPE_APPLICATION_FEE_BPS is 0 -- destination charges will take no platform fee.",
            "Set it in .env if this platform is meant to earn on seller sales.",
          ),
    );
  } catch (error) {
    if (error instanceof StripeConfigError) {
      checks.push(fail(error.message, "Copy .env.example to .env and fill in STRIPE_SECRET_KEY."));
      return { checks, reachedStripe: false };
    }
    throw error;
  }

  if (skipNetwork) return { checks, reachedStripe: false };

  // ---- online ----
  const { stripe } = createStripe();
  let reachedStripe = false;
  try {
    const account = await stripe.accounts.retrieve();
    reachedStripe = true;
    checks.push(
      ok(
        `Reached Stripe as account ${account.id}` +
          (account.settings?.dashboard?.display_name
            ? ` (${account.settings.dashboard.display_name})`
            : ""),
      ),
    );
    checks.push(
      account.charges_enabled
        ? ok("Platform account can create charges.")
        : warn(
            "Platform account cannot create charges yet.",
            "Complete your own account's onboarding in the dashboard.",
          ),
    );

    // Stripe Tax computes zero tax where there is no registration -- silently.
    // Worth surfacing here rather than discovering it in a tax report.
    try {
      const regs = await stripe.tax.registrations.list({ status: "active", limit: 1 });
      checks.push(
        regs.data.length
          ? ok("At least one active Stripe Tax registration exists.")
          : warn(
              "No active Stripe Tax registrations -- Tax will compute ZERO tax everywhere, silently.",
              "Add registrations: https://dashboard.stripe.com/tax/registrations",
            ),
      );
    } catch (error) {
      const c = classifyStripeError(error);
      checks.push(
        warn(
          `Could not read Tax registrations (${c.category}: ${c.message})`,
          c.category === "permission"
            ? "The restricted key needs the Tax resource. Widen its scope or use a fuller key."
            : "Check that Stripe Tax is enabled on this account.",
        ),
      );
    }
  } catch (error) {
    const c = classifyStripeError(error);
    if (c.category === "auth") {
      checks.push(fail(`Stripe rejected the key: ${c.message}`, "Check STRIPE_SECRET_KEY in .env."));
    } else if (c.category === "transient") {
      // A non-JSON body from "Stripe" is almost never Stripe. It is a proxy or
      // captive portal answering on its behalf -- worth naming, because it
      // looks like an API fault and is not one.
      const intercepted = /Invalid JSON/i.test(c.message);
      checks.push(
        fail(
          `Could not reach Stripe: ${c.message}`,
          intercepted
            ? "A non-JSON response usually means a proxy answered instead of Stripe. " +
              "Check egress policy allows api.stripe.com:443."
            : "Network or egress policy. api.stripe.com must be reachable on 443.",
        ),
      );
    } else {
      checks.push(fail(`${c.category}: ${c.message}`, null));
    }
  }

  return { checks, reachedStripe };
}

const ICON = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };

export function formatReport({ checks }) {
  const lines = ["", "Stripe preflight", "----------------"];
  for (const c of checks) {
    lines.push(`[${ICON[c.level]}] ${c.message}`);
    if (c.fix) lines.push(`           -> ${c.fix}`);
  }
  const failed = checks.filter((c) => c.level === "fail").length;
  const warned = checks.filter((c) => c.level === "warn").length;
  lines.push("", failed ? `${failed} blocking problem(s), ${warned} warning(s).` : warned ? `Ready, with ${warned} warning(s).` : "All good.");
  return lines.join("\n");
}

// Run directly: node stripe/doctor.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runDoctor({ skipNetwork: process.argv.includes("--offline") });
  console.log(formatReport(report));
  process.exit(report.checks.some((c) => c.level === "fail") ? 1 : 0);
}
