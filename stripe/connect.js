/**
 * Connect onboarding.
 *
 * The shape of an account is set by `controller` properties, not the older
 * `type: 'express' | 'standard'` parameter. The three controller decisions map
 * onto three business questions, and they are much harder to change later than
 * to choose now -- see notes/07-stripe-integration-plan.md section 2.
 */

/** Express-equivalent: Stripe hosts onboarding and the seller dashboard. */
export const EXPRESS_CONTROLLER = {
  fees: { payer: "application" },
  losses: { payments: "application" },
  stripe_dashboard: { type: "express" },
};

/**
 * Same onboarding, but loss liability sits with the connected account rather
 * than the platform. Lower liability for you, more friction for the seller.
 */
export const EXPRESS_SELLER_BEARS_LOSSES = {
  fees: { payer: "application" },
  losses: { payments: "stripe" },
  stripe_dashboard: { type: "express" },
};

export function connect({ stripe }) {
  return {
    /**
     * Requesting `card_payments` and `transfers` at creation starts the
     * verification clock immediately. Requesting them later means the seller
     * finishes onboarding, looks ready, and still cannot take money.
     */
    async createSellerAccount({
      email,
      country = "US",
      businessType,
      controller = EXPRESS_CONTROLLER,
      metadata = {},
    } = {}) {
      return stripe.accounts.create({
        country,
        email,
        controller,
        ...(businessType ? { business_type: businessType } : {}),
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata,
      });
    },

    /**
     * Account links expire in minutes and are single-use. Generate one per
     * click and redirect straight away -- never store one, never put one in an
     * email. `refresh_url` is where Stripe sends the seller when the link has
     * expired, so that endpoint must mint a fresh link and redirect again.
     *
     * `fields: 'eventually_due'` asks for everything now rather than
     * interrupting the seller for more documents mid-selling later.
     */
    async onboardingLink({ account, refreshUrl, returnUrl, fields = "eventually_due" }) {
      return stripe.accountLinks.create({
        account,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
        collection_options: { fields },
      });
    },

    /**
     * Send an already-onboarded seller back to fix or update their details --
     * a new bank account, a re-verification. This is an account *link*, so the
     * same expiry and single-use rules apply.
     */
    async updateDetailsLink({ account, refreshUrl, returnUrl }) {
      return stripe.accountLinks.create({
        account,
        refresh_url: refreshUrl ?? returnUrl,
        return_url: returnUrl,
        type: "account_update",
      });
    },

    /**
     * A one-time login to the Stripe-hosted Express dashboard, where the seller
     * sees their own payouts and balance.
     *
     * This is a different endpoint from account links, and only works for
     * accounts with `controller.stripe_dashboard.type: 'express'` -- an account
     * whose dashboard Stripe does not host has nothing to log in to.
     */
    async loginLink(account) {
      return stripe.accounts.createLoginLink(account);
    },

    /**
     * The gate to check before letting a seller transact -- and the reason to
     * check it is that "the account exists" and "the account can take money"
     * are days apart, routinely.
     *
     * Returns the blocking requirements too, because "you can't sell yet" is a
     * useless message without "because we still need your bank details".
     */
    async readiness(accountId) {
      const account = await stripe.accounts.retrieve(accountId);
      const requirements = account.requirements ?? {};
      return {
        accountId: account.id,
        chargesEnabled: account.charges_enabled === true,
        payoutsEnabled: account.payouts_enabled === true,
        detailsSubmitted: account.details_submitted === true,
        cardPayments: account.capabilities?.card_payments ?? "inactive",
        transfers: account.capabilities?.transfers ?? "inactive",
        /** Both must be true before this account may be a charge destination. */
        canAcceptPayments:
          account.charges_enabled === true &&
          account.capabilities?.card_payments === "active",
        disabledReason: requirements.disabled_reason ?? null,
        currentlyDue: requirements.currently_due ?? [],
        eventuallyDue: requirements.eventually_due ?? [],
        pastDue: requirements.past_due ?? [],
      };
    },
  };
}
