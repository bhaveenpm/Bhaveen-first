# Stripe integration plan — Billing, Connect, Payments, Invoicing, Tax

**Provenance, so you can weight this correctly.** This plan was *not* produced by
Stripe's `stripe_implementation_planner`. That tool was unreachable from this
environment — see [Why not the planner](#why-not-the-planner) at the bottom.
What follows is a plan written against Stripe's documented API surface, with
every parameter shape **verified against the `stripe@22.6.2` SDK's own
TypeScript definitions** (API version `2026-08-26.dahlia`) rather than recalled.
Where something is genuinely version-sensitive or I could not verify it, it is
flagged inline as **[verify]**.

---

## 1. What these five products imply about your architecture

You named Billing, Connect, Payments, Invoicing and Tax. That combination is not
five independent choices — it describes a **platform that has two different
customers and therefore two different money flows**:

| Flow | Who pays | Who is the merchant | Products involved |
|---|---|---|---|
| **A. Marketplace flow** | your seller's buyer | your connected account | Payments, Connect, Tax |
| **B. Platform flow** | your seller | you | Billing, Invoicing, Tax |

Nearly every expensive mistake in this kind of integration comes from
accidentally modelling these two as one. Flow A revenue is *not* yours (you keep
only an application fee); Flow B revenue *is* yours. They settle differently,
they are taxed differently, in different jurisdictions, and they reconcile
against different balances.

**Decision: keep two separate `Customer` namespaces.** A seller is a
`Customer` on *your* platform account (Flow B, so they can hold a subscription
and a payment method). A buyer is a `Customer` on the *connected* account, or on
your platform with the charge routed onward. Do not reuse one `Customer` object
for both roles; you will eventually bill a seller with a buyer's card.

---

## 2. Connect: account type and controller properties

Use **`controller` properties**, not the legacy `type: 'express' | 'standard'`
parameter. Verified: `accounts.create` accepts
`controller: { fees, losses, requirement_collection, stripe_dashboard }`.

The recommendation for a platform that wants to own pricing and the buyer
relationship, while letting Stripe carry onboarding and identity risk:

```js
controller: {
  fees:             { payer: 'application' },      // you pay Stripe fees, you charge your own
  losses:           { payments: 'application' },   // you absorb disputes  <-- read §2.1
  stripe_dashboard: { type: 'express' },           // Stripe-hosted seller dashboard
}
```

### 2.1 The one decision to make deliberately: `losses.payments`

`losses: { payments: 'application' }` means **you, the platform, eat chargebacks
and negative balances** on your sellers' sales. That is what makes the Express
experience smooth, and it is a real, uncapped liability. The alternative,
`'stripe'`, pushes loss liability to the connected account, but then Stripe
requires more from the account holder and the onboarding conversion drops.

This is a business decision, not a technical one. Pick it consciously, and if
you pick `'application'`, build the dispute webhook handling in §7 on day one,
not later.

### 2.2 Onboarding

`accountLinks.create` with `type: 'account_onboarding'`. Two things people get
wrong:

- **Account links are single-use and short-lived** (a few minutes). Never store
  one, never email one. Generate on click, redirect immediately. `refresh_url`
  exists precisely because the link expires — it must regenerate a new link.
- **`collection_options: { fields: 'eventually_due' }`** collects everything up
  front. The default, `currently_due`, gets the seller live faster but means
  they get interrupted for more documents later, mid-selling. For a platform
  where sellers transact regularly, `eventually_due` is usually the better
  trade.

### 2.3 Never gate on account creation — gate on capabilities

An account existing means nothing. Before you let a seller take money, check:

```js
account.charges_enabled === true && account.payouts_enabled === true
```

and inspect `account.capabilities.card_payments === 'active'`. Accounts sit in
`pending` or `restricted` for hours or days. Build the "your account is still
under review" state into your UI now; it is not an edge case, it is a normal
weekday.

---

## 3. Payments: how to route a marketplace charge

Three routing options exist. For your case:

**Use destination charges.** The charge is created on your platform account and
the funds are transferred onward:

```js
paymentIntents.create({
  amount, currency,
  automatic_payment_methods: { enabled: true },
  on_behalf_of:           sellerAccountId,   // <-- see §3.1, this matters a lot
  transfer_data:          { destination: sellerAccountId },
  application_fee_amount: yourCut,
})
```

Verified present on `PaymentIntentCreateParams`: `on_behalf_of`,
`transfer_data`, `application_fee_amount`.

Why destination over the alternatives:
- **Direct charges** (`stripeAccount` header) put the charge on the seller's
  account. The seller's name appears on the statement and *they* own the buyer
  relationship and the dispute. Good for a Shopify-like model, wrong if you want
  one checkout and one support surface.
- **Separate charge and transfer** decouples the two, which you need only if one
  payment splits across several sellers, or you transfer later than you charge.
  It costs you automatic dispute/refund linkage. Don't start here.

### 3.1 `on_behalf_of` is not decoration

`on_behalf_of` sets the **settlement merchant of record**. It determines:
- which country's acquiring is used, and therefore available payment methods
  and interchange;
- whose descriptor the buyer sees on their statement;
- **which account's tax registrations Stripe Tax uses.**

Omitting it while setting `transfer_data.destination` is legal and is one of the
subtlest ways to end up with correct-looking money and wrong tax.

### 3.2 Application fee arithmetic

`application_fee_amount` is an **integer in minor units**, and it must be
`<= amount`. Compute it from basis points against the minor-unit amount and
round once, explicitly — never let a float reach the API. This repo already has
`src/money.js` handling ISO 4217 exponents (JPY has none, KWD has three); reuse
it rather than assuming `* 100`.

---

## 4. Tax: the asymmetry nobody warns you about

**Verified, and it is the single most important finding in this document:
`PaymentIntentCreateParams` has no `automatic_tax` field.** (Grep of the SDK
definitions: zero occurrences.) `automatic_tax` exists on Checkout Sessions,
Invoices and Subscriptions — but *not* on raw PaymentIntents.

So tax splits down your two flows:

### 4.1 Flow B (you bill your sellers) — the easy path
Set `automatic_tax: { enabled: true }` on the Subscription or Invoice and
Stripe computes, applies and records the tax itself. Requirements: the
`Customer` must have an address Stripe can source a jurisdiction from, and each
`Price` needs a `tax_behavior` of `inclusive` or `exclusive`. **`tax_behavior`
is immutable once set on a Price** — get it right at creation or you are
creating new Prices.

### 4.2 Flow A (buyer pays seller, via a PaymentIntent) — the manual path
You must drive Stripe Tax yourself, as a three-step dance:

1. `tax.calculations.create({ currency, line_items, customer_details })` →
   returns the tax amount **and does not record anything**. A calculation is a
   quote; it expires.
2. Create and confirm the PaymentIntent for the calculated total.
3. **Only after the payment succeeds**,
   `tax.transactions.createFromCalculation({ calculation, reference })` to
   record the transaction for filing.

Verified: `tax.calculations.create` takes `{ currency, line_items[], customer,
customer_details, ship_from_details, shipping_cost, tax_date }`;
`tax.transactions` exposes `createFromCalculation`, `createReversal`,
`listLineItems`.

**The failure mode this prevents:** if you record the tax transaction at step 1
and the payment then fails, you have filed tax on revenue you never collected.
If you skip step 3 entirely — the common bug — your Stripe Tax reports are
empty and you have collected tax you cannot file. Step 3 is not optional
bookkeeping; it *is* the tax record.

Refunds need the mirror: `tax.transactions.createReversal`. A refund without a
reversal overstates your liability.

### 4.3 Registrations gate everything
Stripe Tax computes **zero tax** in any jurisdiction where you have no
registration. That is not an error and it is silent. `tax.registrations.create`
per jurisdiction, and on a Connect platform the relevant registrations are
**the connected account's** when `on_behalf_of` is set (§3.1). Monitoring
threshold breaches is an operational task, not an integration task, but it
starts with knowing that an empty registration list means silently untaxed
sales.

---

## 5. Billing: subscribing your sellers

### 5.1 Create subscriptions SCA-safely
```js
subscriptions.create({
  customer,
  items: [{ price }],
  payment_behavior: 'default_incomplete',
  payment_settings: { save_default_payment_method: 'on_subscription' },
  automatic_tax: { enabled: true },
  expand: ['latest_invoice.confirmation_secret'],
})
```
`payment_behavior: 'default_incomplete'` is the correct default: it creates the
subscription in `incomplete` and hands you a secret to confirm on the client,
so a card needing 3DS is handled instead of silently failing. The alternatives
(`error_if_incomplete`, `allow_incomplete`) either throw or leave you with a
live subscription and an unpaid invoice.

**[Version-sensitive, verified]** Confirm the payment via
`latest_invoice.confirmation_secret`, **not** `latest_invoice.payment_intent`.
`Invoice.confirmation_secret` is present in this API version; expanding
`payment_intent` off an invoice is the older pattern and much online sample
code still shows it. This will bite you if you copy a 2023 tutorial.

### 5.2 Usage-based billing
If any of your seller pricing is metered, use **Billing Meters**
(`billing.meters`, `billing.meterEvents`) — verified present. This is the
current mechanism and replaces the older usage-record approach. Send meter
events with an `identifier` so retries are naturally deduplicated.

### 5.3 Do not build a subscription management UI
`billingPortal.sessions.create({ customer, return_url })` gives you
cancellation, plan switching, payment-method updates, invoice history and dunning
for one call. Building that yourself is weeks of work and you will get the
proration edge cases wrong. Configure it once in the dashboard.

---

## 6. Invoicing

Two distinct things share the word "invoice":

- **Subscription invoices** — generated for you. You mostly consume them via
  webhooks and never create them.
- **Standalone invoices** — for one-off or negotiated charges (setup fees,
  overages, an enterprise deal).

For standalone, the ordering is strict and people get it backwards:

1. `invoiceItems.create({ customer, pricing: { price }, quantity })` —
   **[version-sensitive, verified]** the parameter is **`pricing: { price }`**,
   *not* `price`. `InvoiceItemCreateParams` in this API version exposes
   `pricing`, `price_data`, `amount` — there is no bare `price` field. Almost
   every tutorial online still writes `price`.
2. `invoices.create({ customer, collection_method, automatic_tax: { enabled: true } })`
   — pending invoice items for that customer are pulled in.
3. `invoices.finalizeInvoice(id)` — **the invoice is mutable until this point
   and immutable after.** Tax is computed at finalization, not creation.
4. `invoices.sendInvoice(id)` if `collection_method: 'send_invoice'`.

`collection_method` choice: `'charge_automatically'` bills the stored payment
method (use for subscriptions); `'send_invoice'` with `days_until_due` emails a
hosted payment page (use for invoicing proper). Mixing these up produces
invoices that sit unpaid forever because nothing was ever going to charge them.

---

## 7. Webhooks: the part that is actually load-bearing

Your integration's correctness lives here, because **almost nothing in Stripe is
final at the moment your API call returns.** A PaymentIntent can succeed
asynchronously; a subscription renews without you; an account's capabilities
change while nobody is looking.

### 7.1 Non-negotiables
- **Verify the signature** with `webhooks.constructEvent(rawBody, sig, secret)`.
  It needs the **raw bytes**. Any body-parsing middleware that hands you a
  parsed object has already destroyed your ability to verify. This is the most
  common webhook bug.
- **Be idempotent.** Stripe retries, and will deliver the same event twice.
  Record `event.id` and no-op on a repeat. Without this, a retried
  `invoice.paid` grants the entitlement twice.
- **Do not trust event ordering.** `customer.subscription.updated` can arrive
  before the `created` you expected. Treat each event as a statement about
  current state, and where it matters, re-fetch the object rather than applying
  a delta.
- **Return 2xx fast, then work.** Heavy work inline causes timeouts, which
  causes retries, which causes duplicate processing.

### 7.2 The events that matter, by flow

| Event | Why you care |
|---|---|
| `account.updated` | Connect: capabilities changed — gate selling on this (§2.3) |
| `capability.updated` | Connect: finer-grained than the above |
| `payment_intent.succeeded` | **Flow A: record the tax transaction (§4.2 step 3)** |
| `payment_intent.payment_failed` | surface an actionable reason to the buyer |
| `charge.dispute.created` | your liability if `losses.payments: 'application'` |
| `invoice.paid` | Flow B: grant/extend the seller's entitlement |
| `invoice.payment_failed` | Flow B: dunning — this is churn, handle it |
| `customer.subscription.updated` | plan changes, `cancel_at_period_end`, trial end |
| `customer.subscription.deleted` | revoke entitlement |

Connect events for connected accounts arrive at your **platform** endpoint with
the account id in `event.account`. Route on that field, or you will apply a
seller's event to your platform records.

---

## 8. Keys and safety

- The secret key is server-side only, always. The publishable key is the only
  one that may reach a browser.
- **Use restricted keys** for anything that isn't a full-access admin path. A
  key scoped to the four resources a service needs limits the blast radius of a
  leak to those four resources.
- Pin the API version explicitly in code (`apiVersion: '2026-08-26.dahlia'`)
  rather than inheriting the account default. Upgrades then become a deliberate,
  testable change instead of something that happens to you.
- Always pass **idempotency keys** on writes that create money movement. A
  network timeout on `paymentIntents.create` without one is how you double-charge.

---

## 9. Suggested build order

Each step is independently verifiable, which matters because the later steps are
hard to debug if the earlier ones are shaky.

1. **Preflight** — key parses, mode detected, account reachable. (`stripe/doctor.js`)
2. **Webhook skeleton** — signature verification + idempotent dispatch, with no
   business logic. Prove delivery works before anything depends on it.
3. **Connect onboarding** — create account, account link, capability gating.
4. **Flow A payment** — destination charge with `on_behalf_of` + application fee.
5. **Flow A tax** — calculation before, transaction-from-calculation after.
6. **Flow B billing** — products/prices with `tax_behavior`, subscription with
   `default_incomplete`, portal session.
7. **Flow B invoicing** — standalone invoice, correct item ordering.
8. **Reconciliation** — only now, and it will be easy, because every step above
   recorded what it did.

---

## Why not the planner

The task specified Stripe's own tooling, in order. All three routes are blocked
in this execution environment:

1. `claude plugin install stripe@claude-plugins-official` — the
   `claude-plugins-official` marketplace is not configured here and could not be
   added (`anthropics/claude-plugins` clone → HTTPS auth failure). Adding
   `anthropics/claude-code` succeeded but its catalogue contains no `stripe`
   plugin. The account plugin catalogue has no standalone Stripe plugin either.
2. `https://mcp.stripe.com` as an MCP server — added to config successfully, but
   the connection is refused at the network layer: the egress proxy answers
   **403 to CONNECT** for `mcp.stripe.com:443`. OAuth would also require a
   browser this session does not have. `stripe_implementation_planner` is
   therefore unavailable.
3. `npx skills add https://docs.stripe.com` — fails, **HTTP 403**, same egress
   policy.

`api.stripe.com`, `mcp.stripe.com` and `docs.stripe.com` are all 403 at the
proxy. Consequences for this plan and the code alongside it:

- Nothing here has been executed against the live Stripe API. The code is
  unverified *end to end*, and the test suite exercises it against a stubbed
  transport, not Stripe.
- Parameter shapes are verified against the installed SDK's own type
  definitions, which are generated from Stripe's OpenAPI spec — a strong source,
  and the reason the `pricing` / `confirmation_secret` / no-`automatic_tax`-on-
  PaymentIntents findings above are assertions rather than guesses.
- To run against real Stripe, either re-run in an environment whose egress
  policy permits `*.stripe.com`, or run `npm run stripe:doctor` from a machine
  that can reach it.
