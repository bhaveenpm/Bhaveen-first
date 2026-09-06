# GP API teardown: the nuances that actually bite

Every claim here is something this repo demonstrates in code, with a test that
fails if it stops being true. Grade your confidence with
`00-sources-and-confidence.md` before quoting any of it.

---

## 1. Auth is a proof-of-possession handshake, not a password

You never send `app_key`. You send a nonce and `sha512(nonce + app_key)`:

```js
const nonce  = new Date().toISOString();
const secret = sha512(nonce + appKey);       // 128 hex chars
POST /accesstoken { app_id, nonce, secret, grant_type: "client_credentials" }
```

**Why it's designed that way.** Anyone who captures the request gets a hash bound
to one nonce. They cannot mint a second token with it. Compare with an API that
sends a bearer secret on every call, where one leaked log line is total
compromise.

**Where teams get it wrong.** The token is long-lived and token *creation* is
rate-limited. Minting a fresh token per transaction is the classic way to turn a
working integration into 429s the day a merchant gets busy. `src/client.js`
caches the token, refreshes 60s before expiry, and collapses concurrent callers
onto one in-flight request — there is a test that fails if three parallel calls
mint three tokens.

**The bit worth noticing as a PM.** The token response carries a `scope` listing
the merchant and the accounts it can reach. So the correct `account_name` is
*discoverable at runtime*. A platform onboarding thousands of sub-merchants
never has to store per-merchant account names — it reads them from the token.
That is a genuine platform-friendly design choice, and most integrators miss it
and hardcode the value anyway.

## 2. Amounts are minor units, as strings, and the API cannot catch your mistake

`"1000"` is £10.00 in GBP, ¥1000 in JPY, and 1.000 dinar in KWD. The exponent is
a property of the currency, not of the request, so if you send `"10"` meaning
£10 the API cheerfully takes 10 pence and every downstream system agrees with
it. There is no validation that can save you.

`src/money.js` makes the conversion explicit and **refuses excess precision
rather than rounding it** — `10.005 GBP` throws, because a silently rounded
amount is a wrong amount that reconciles cleanly and is therefore invisible.

Zero-decimal (JPY, KRW, VND…) and three-decimal (KWD, BHD, TND…) currencies are
handled. If a business is GBP-only today this looks like over-engineering; the
day it isn't, it is the difference between a launch and an incident.

## 3. Versioning is by header, and omitting it is the bug

`X-GP-Version: 2021-03-22`. Not a URL path segment, not a query param.

The consequence: **forget the header and you silently get the API's default
version**, which is not necessarily what you built against. Path-versioned APIs
fail loudly when you get this wrong; header-versioned ones fail quietly, months
later, when the default moves. The client always sends it.

The date is also the more interesting artefact: a payments API whose contract
version has held since 2021 is telling you something true about its
stability commitments.

## 4. `capture_mode` is a business decision wearing a technical costume

| Value | Behaviour | When you want it |
|---|---|---|
| `AUTO` | Authorise and capture at once | Digital goods, instant fulfilment |
| `LATER` | Authorise now, capture on `POST /transactions/{id}/capture` | Physical goods — take the money when you ship |
| `MULTIPLE` | Authorise once, capture in parts | Split shipments, marketplaces |

One enum decides when you take a customer's money relative to when you deliver
it. That's a policy question — cash flow, chargeback exposure, consumer-law
obligations in some markets — encoded as a single field. Worth flagging in an
interview: the API surfaces the choice cleanly, but nothing in the developer
experience *teaches* an integrator that they're making it.

## 5. Reversal and refund are not synonyms

- **Reversal** voids an authorisation that hasn't settled. The customer often
  never sees it. Cheap.
- **Refund** moves money back after settlement. Shows on the statement as a
  second entry. Costs an interchange cycle and generates "why do I see two
  charges" support tickets.

Same merchant intent — "undo it" — with different cost and different customer
experience. This repo enforces the distinction: refunding an uncaptured auth is
refused with `INVALID_TRANSACTION_ACTION` and told to reverse instead, and
there's a test for it.

**An API-product observation.** The API models the *processing* reality
correctly. It does not offer the *merchant's* concept ("undo this, pick the
right mechanism yourself"). Whether that's rigour or a missing convenience layer
is a real design argument, and a good thing to have an opinion on.

## 6. A decline is not an error, and both arrive as HTTP 400

This is the single highest-value nuance in the whole surface.

```
HTTP 400  error_code DECLINED              <- the shopper's issuer said no
HTTP 400  error_code INVALID_REQUEST_DATA  <- your integration is wrong
```

Code that treats every non-2xx as "integration broken" pages an engineer at 3am
because someone's card had no money on it. Code that treats every 400 as a
decline hides real bugs behind "payment failed, try another card".

`GpApiError` exposes `.declined` and `.retryable` as separate properties, and
`.retryable` is **false** for declines — retrying re-presents a card the issuer
refused, which looks like card testing and can get a merchant's traffic scored
down.

Three pieces of information, three different jobs:

| Field | Use it for |
|---|---|
| `error_code` | Branching. Coarse and stable. |
| `detailed_error_code` | Support tickets and analytics. |
| `detailed_error_description` | Your logs. **Never** your customer, never a switch. |

## 7. Idempotency is opt-in, and the dangerous case is the one you can't see

`x-gp-idempotency` is a header you choose to send. Without it, a retried POST
can create a second charge.

The failure that matters isn't the obvious one. It's: **the request reached the
server and succeeded, and the response died on the way back.** Your client sees
a socket hang-up and retries. The money has already moved.
`test/idempotency.test.js` reproduces exactly that — a `fetch` that lets the
call through, then throws — and asserts that one link exists afterwards, not two.

Opt-in idempotency is a defensible choice (it's the integrator's call what counts
as "the same" request), but it means **the safe path is the one you have to know
to ask for**. An integrator who doesn't know the header exists gets the unsafe
default, and finds out during their first incident.

## 8. Pay by Link is the only flow with no merchant front end

Create server-side, payer completes on a GP-hosted page, outcome arrives by
webhook. The merchant needs no website, no card fields, no PCI scope beyond
SAQ-A. That's why it's the primitive underneath "social commerce" — a link goes
wherever a message goes.

The trade: **a link is a durable, publicly reachable payment instruction.** Not a
one-shot API call. It has a lifecycle you own:

```
ACTIVE ──pay──> PAID
   │
   ├──edit(INACTIVE)──> INACTIVE
   ├──expiration_date──> EXPIRED
   └──────────────────> CLOSED
```

Every constraining field — `usage_mode`, `usage_limit`, `expiration_date` — is a
control against a link outliving the intent that created it. A `MULTIPLE` link
with a high limit and no expiry, forwarded into a group chat, is a payment page
anyone can hit forever.

And links stay **editable while ACTIVE**. You can reprice one after sending it.
Powerful for a seller negotiating in DMs; also means whoever holds the link sees
whatever it says *now*, not what it said when you sent it. I'd want to know
whether the payer-facing page shows the change, and whether repricing is audited.

## 9. `return_url` is not proof of payment. The webhook is.

Two independent things happen when a payer pays:

1. Their browser is redirected to your `return_url`.
2. GP POSTs the outcome to your `status_url`.

These race. The webhook can land first. The redirect might never happen — the
buyer closes the tab, loses signal, force-quits the app — **and the money still
moved.** Fulfilling on the redirect means shipping goods you weren't paid for
(the buyer forged a return) or never shipping goods you were.

`npm run demo` shows the race with real timings. `npm run gp -- listen` gives you
a webhook sink that prints callbacks as they arrive.

Corollaries the docs tend to under-sell:

- **Answer 200 fast.** A slow endpoint gets retried, and a retry you process
  twice is a double-fulfilled order.
- **Make your handler idempotent by `reference`.** You will receive duplicates.
- `reference` is the only join key back to your own order. A webhook without one
  is an orphan you cannot action. This repo makes `reference` mandatory
  client-side for exactly that reason.

## 10. Currency support is an account property, not an API property

The request is well-formed, `ZZZ` is three uppercase letters, and it still
fails — because that merchant account was never provisioned to settle in it. The
mock reproduces this (`SUPPORTED_CURRENCIES`) because it's a category of error
integrators find genuinely confusing: nothing about the *request* is wrong.

Same class of thing as account names in the token scope: a lot of GP API
behaviour is determined by **how the acquirer provisioned the account**, not by
what you send. That's the part of payments that doesn't look like software, and
it's usually where "the API is broken" tickets actually come from.
