# GP API Lab

A hands-on lab for the **Global Payments GP API** (Unified Commerce Platform):
a zero-dependency client, a CLI for poking the API by hand, an offline emulator
of the API so the whole thing runs and tests without network access, and notes
on the nuances that only show up once you've built against it.

Built to learn the API properly rather than read about it.

```bash
npm run ui        # a clickable web UI at http://127.0.0.1:3000 — start here
npm run doctor    # checks whether you're set up, and says what to fix
npm run demo      # the whole Pay by Link story, end to end, offline, ~2s
npm test          # 96 tests (GP + Stripe), no network needed
```

**No credentials yet?** `npm run demo` and `npm test` work offline, right now.
When you're ready for the real thing, `npm run doctor` tells you what's missing.

## The UI

```bash
npm run ui                            # offline emulator, no credentials
GP_ENVIRONMENT=sandbox npm run ui     # the real sandbox, using your .env
```

Create links, open the hosted page, pay them, watch the webhook land, charge
test cards, and see **every HTTP call this server makes to GP** — method, path,
request body, response, status, timing — in a live wire log you can click open.
That log is the point: it is the API teardown in `notes/01-api-teardown.md`,
happening in front of you.

**The Orders panel** is the argument from `notes/02-product-teardown.md`, built.
GP models money moving; a seller's job runs from "agree price" to "shipped", and
the API stops in the middle. So orders here carry a structured reference
(`IG-2291`, not free text), join their link and transactions and webhooks into
one view, and hold the fulfilment state GP has nowhere to put. That's what makes
the exception states visible: **paid but not shipped**, **shipped but not
paid**, **refunded after shipping**. Invisible today because nothing owns both
halves.

Built in to be discovered by clicking:

- **JPY** — zero-decimal, so `24.99` is rejected before it leaves your machine.
- **ZZZ** — a well-formed code the account isn't provisioned for. The request is
  fine; the account isn't.
- **The declining card vs. the Luhn-failing card** — both HTTP 400, one is the
  issuer's answer and one is your bug. The UI labels them differently on purpose.

Your `app_key` never reaches the browser: this server holds the credentials and
does the handshake, which is also the only correct way to build against a
server-to-server API. Secrets are redacted from the wire log — the auth request
shows `"secret": "***"`, and card numbers never appear.

## Why an emulator

`mock/server.js` is a faithful emulation of the API *contract* — the auth
handshake, required fields, the error envelope, idempotent replay, the link
lifecycle, and the outbound status webhook. It exists because an integration you
can only exercise against someone else's uptime is one you can't write tests
for, and because credentials and network access are not always available when
you want to learn something.

It is not a payment processor. No card is validated beyond Luhn and no money
moves.

## Layout

```
src/
  client.js              auth handshake, token cache, retries, idempotency
  money.js               minor units -- the conversion the API cannot validate for you
  errors.js              GpApiError: separates a decline from a broken request
  resources/links.js     Pay by Link
  resources/orders.js    the order layer GP doesn't have: structured references,
                         one joined view, fulfilment state, exception states
  resources/transactions.js  sale / auth / capture / refund / reverse
  cli.js                 the CLI
mock/server.js           offline emulator, incl. a stand-in hosted payment page
ui/server.js             local web UI: proxies to GP, streams the wire to the page
ui/index.html            the page itself, no build step, no framework
scripts/demo.js          narrated end-to-end walkthrough
scripts/doctor.js        preflight: what's set up, what's missing, how to fix it
test/                    tests: the GP suite against the emulator, plus
                         the Stripe suite against a stub transport
notes/                   what I actually learned -- start here
```

## Stripe

A second, separate integration lives in `stripe/` — Billing, Connect, Payments,
Invoicing and Tax — built the same way as the GP side: opinionated, commented
where the API surprises you, and runnable without credentials.

```bash
npm run stripe:doctor     # what's configured, what's missing, how to fix it
npm run stripe:demo       # both money flows end to end, offline, no credentials
npm run test:stripe       # 48 tests, no network needed
```

**Start with [`notes/07-stripe-integration-plan.md`](notes/07-stripe-integration-plan.md).**
It is the plan the code implements, and it explains the decisions that are hard
to reverse later.

### The one idea worth taking away

Those five products describe **two different money flows with two different
merchants**, and most expensive mistakes come from modelling them as one:

| | Buyer pays seller | Seller pays you |
|---|---|---|
| merchant of record | the connected account | you |
| revenue | not yours (you keep a fee) | yours |
| products | Connect, Payments, Tax | Billing, Invoicing, Tax |
| code | `connect.js` `payments.js` `tax.js` | `billing.js` `invoicing.js` |

Keep two `Customer` namespaces. Reuse one and you will eventually bill a seller
with a buyer's card.

### Things this repo encodes because they are verified, not remembered

Every parameter shape was checked against the installed SDK's own type
definitions (`stripe@22.6.2`, API `2026-08-26.dahlia`) rather than recalled:

- **PaymentIntents have no `automatic_tax`.** It exists on Invoices,
  Subscriptions and Checkout Sessions — not on raw PaymentIntents. So a
  marketplace charge must drive Stripe Tax by hand: calculate → charge →
  *record after success*. Skipping the record step leaves you having collected
  tax you cannot file, with empty Tax reports.
- **`invoiceItems.create` takes `pricing: { price }`, not `price`.** The bare
  `price` field is gone. Most tutorials online still show it.
- **Confirm subscriptions via `latest_invoice.confirmation_secret`**, not
  `latest_invoice.payment_intent`. The latter is the pre-2025 pattern.
- **Connected accounts are shaped by `controller` properties**, not
  `type: 'express'`. And `controller.losses.payments: 'application'` means
  *you* eat the chargebacks — a business decision, not a default.
- **`on_behalf_of` is not decoration.** It sets the merchant of record, which
  decides the statement descriptor, the acquiring country, and whose tax
  registrations Stripe Tax reads. Setting `transfer_data.destination` without it
  is legal and quietly taxes the wrong entity.
- **Stripe Tax computes zero tax where you have no registration** — silently.
  It looks exactly like a correctly untaxed sale. `stripe:doctor` warns you.
- **Webhook signatures are over the raw bytes.** A global JSON body parser
  destroys your ability to verify, which is the most common webhook bug;
  `verifyEvent` refuses a parsed object with an explanation rather than a
  confusing signature error.

### Layout

```
stripe/
  config.js      key parsing (test vs live vs restricted), pinned API version
  client.js      SDK setup, idempotency keys, basis-point fee arithmetic
  errors.js      decline vs. your-bug vs. transient -- only one is retryable
  connect.js     controller properties, onboarding links, capability gating
  payments.js    destination charges, application fees, transfer-reversing refunds
  tax.js         the calculate -> charge -> record dance, and its reversal
  billing.js     plans, SCA-safe subscriptions, portal, usage meters
  invoicing.js   items -> invoice -> finalize -> send, in that order
  webhooks.js    signature verification, idempotent dispatch, Connect routing
  doctor.js      preflight
  demo.js        both flows, offline
```

### Status

The code is unverified against live Stripe: this repo was built in an
environment whose egress policy blocks `api.stripe.com`, so nothing here has
made a real API call. Parameter shapes are verified against the SDK's generated
types; sequencing and logic are covered by tests against a stub transport. Run
`npm run stripe:doctor` from a machine that can reach Stripe to confirm
end to end.

## Notes (the point of the repo)

| | |
|---|---|
| [`00-sources-and-confidence.md`](notes/00-sources-and-confidence.md) | **Read first.** What's verified from GP's own SDK source vs. reconstructed. |
| [`01-api-teardown.md`](notes/01-api-teardown.md) | Ten nuances that bite, each demonstrated in code. |
| [`02-product-teardown.md`](notes/02-product-teardown.md) | The API as a product: users, gaps, what I'd build. |
| [`03-interview-brief.md`](notes/03-interview-brief.md) | Talking points and questions. |
| [`04-docs-checklist.md`](notes/04-docs-checklist.md) | Open items to confirm against the docs portal. |
| [`06-mcp-server.md`](notes/06-mcp-server.md) | GP's own MCP server: what it corrected here, and a host bug in it. |

## Running it

Offline, against the emulator — no credentials needed:

```bash
npm run mock                       # terminal 1
GP_ENVIRONMENT=mock npm run gp -- whoami          # terminal 2
GP_ENVIRONMENT=mock npm run gp -- link:create --amount 24.99 --currency GBP --reference ORDER-1
```

Against the real sandbox — get `app_id` / `app_key` from
<https://developer.globalpayments.com>, then:

```bash
cp .env.example .env               # fill in GP_APP_ID and GP_APP_KEY
npm run doctor                     # confirms credentials, network and auth
npm run gp -- whoami --debug       # proves auth and prints your accounts
npm run gp -- link:create --debug --amount 1.00 --currency GBP --reference VERIFY-1
```

`--debug` prints the exact request and response with secrets redacted. That is
the fastest way to check this repo's assumptions against the real contract —
see [`04-docs-checklist.md`](notes/04-docs-checklist.md).

Watch webhooks arrive:

```bash
npm run gp -- listen --port 9999
npm run gp -- link:create --amount 5.00 --currency GBP --reference W-1 \
  --status-url http://127.0.0.1:9999/webhook
```

## CLI

```
whoami                     create a token, print the merchant and accounts it reaches
link:create                --amount --currency --reference [--name --description
                           --expires --usage-mode --usage-limit --status-url
                           --return-url --cancel-url --shippable --shipping-amount]
link:get <LNK_id>
link:list                  [--status --page --page-size]
link:deactivate <LNK_id>
sale | auth                --amount --currency --card --exp [--cvv --reference]
txn:get|capture|refund|reverse <TRN_id>
listen                     [--port] receive and pretty-print webhooks

--env sandbox|production|sandbox-eu|production-eu|mock   --debug   --json
```

## Sandbox test cards

| Card | Behaviour |
|---|---|
| `4263982640269299` | Visa, approves |
| `5425233424241200` | Mastercard, approves |
| `4000120000001154` | Declines (emulator; confirm against the real sandbox) |

Any future expiry date.

## Requirements

Node 20+. No dependencies, by design — the raw HTTP is the thing worth seeing.
