# The API as a product

An API proposition role is judged on whether you can look at a developer surface
and see the product decisions in it. This is that read, from three days of
building against it. Observations are things I can point at; everything after
"so what" is an argument, not a fact.

---

## Who the actual users are

"Developers" is not a segment. At least four distinct buyers show up in this
surface, and they want opposite things:

| User | What they want | What the current surface gives them |
|---|---|---|
| **Direct merchant dev** — one shop, one integration, ships once | Copy-paste that works, then never think again | Six-language samples. Good fit. |
| **ISV / platform** — embeds payments for many sub-merchants | Multi-tenancy, per-merchant scoping, programmatic onboarding | Account-scoped tokens. Genuinely strong, and under-marketed. |
| **Enterprise / omnichannel** — CP and CNP, many countries | One contract across channels; reconciliation | `channel` on the transaction; the CP/CNP split is first-class. |
| **Non-developer seller** — the Instagram seller | To never see an API at all | Pay by Link, and productised apps on top of it. |

The interesting tension: **the account-scoped token design is the most
platform-friendly thing in the API, and nothing in the developer surface says
so.** The docs read as "here's how one merchant takes one payment." The ISV
story has to be inferred from the shape of a token response. If I owned this
proposition, that's the first thing I'd fix, because ISVs are the segment where
one integration produces thousands of merchants.

## Observations from the developer surface

**1. SDK parity is uneven, and the gap is in the flow that matters most.**
The Node SDK (`globalpayments-api@3.11.04`) defines
`PAYBYLINK_ENDPOINT = "/links"` and ships **no service to call it**. No builder,
no request class. PHP, Java and .NET have Pay by Link services. So the flow
being marketed to the least technical sellers is unavailable in the SDK for the
language most likely to be used by the small, modern shops selling on social.
That's why this repo talks to `/links` over raw HTTP — I had no choice.

*So what:* SDK parity is usually treated as an engineering backlog item. It's a
positioning problem. A feature that isn't in your SDK isn't in your product for
the developers who only read SDKs.

**2. There are at least three documentation domains.**
`developer.globalpay.com`, `developer.globalpayments.com`, and
`docs.globalpayments.es` all serve GP API content, with overlapping and
differently-organised material. A developer searching for "GP API pay by link"
lands somewhere semi-random.

*So what:* time-to-first-successful-call is the metric that predicts integration
completion, and docs fragmentation attacks it before a developer writes a line.
Cheap to fix relative to its effect.

**3. Auth is more secure than the market default and costs more to start.**
Stripe: paste `sk_test_...` into a header, done. GP: generate a nonce, SHA-512 a
concatenation, exchange it, cache the result, handle expiry. GP's design is
genuinely better — the key never crosses the wire — but it puts a crypto step
between a developer and their first 200 response.

*So what:* this is a real trade, not a mistake, and the mitigation is not to
weaken auth. It's to make the first call free: a one-command sandbox playground
that mints a token and shows a working request. (`npm run gp -- whoami` in this
repo is that, in about 30 lines.)

**4. Idempotency is opt-in and under-taught.**
The safe path requires knowing a header exists. Stripe made `Idempotency-Key`
loud enough that integrators feel wrong omitting it.

*So what:* defaults and documentation prominence are product decisions with
direct incident-rate consequences. "Which of our merchants have ever sent an
idempotency key" is a question worth being able to answer.

**5. The credential-issuing funnel fails, and it fails at the worst point.**
Creating a Unified Payments App in the developer portal returned
`Internal Server Error` on submit — a 500, not a validation message. Reproduced
on two attempts with different app names, different merchant names and
different regions (Ireland, then United States), so it is not input validation
and not a name collision. Nothing the developer could change would fix it.

*So what:* everything else in this document is downstream of getting an
`app_id`. This is step one of the funnel, it's the step with no workaround, and
a 500 gives the developer nothing to act on — no error id to quote to support,
no indication whether to retry or wait. Compare with the competitor benchmark:
Stripe issues a working test key on the signup screen, before any form.

Two design details make it worse. The region selector on that same form is
**irreversible** ("Once selected, you cannot change this region") and determines
which API host the resulting credentials work against — and a region mismatch
later surfaces as *rejected credentials*, not as a wrong host. So an
irreversible, consequential choice is made on the form that is 500ing, with the
consequence deferred and mislabelled.

*If I owned this:* time-to-first-successful-call is the metric, and the funnel
step that gates it has no instrumentation a PM would see. I'd want the 500 rate
on app creation on a dashboard, and I'd want to know how many accounts have an
`app_id` but have never successfully minted a token.

**6. GP invests in samples over abstraction.**
`globalpayments-samples/pay-by-link` implements the same ~200-line flow six
times. That's a deliberate strategy: meet developers in their language rather
than teach a framework.

*So what:* it works for time-to-first-call and scales badly for maintenance —
six copies drift. Worth knowing whether that's a considered bet or an accident.

## Where I'd look for the product gap

Pay by Link solves *collecting money*. The social-commerce seller's actual job
is bigger, and the API stops well short of it:

```
 the seller's job:  agree price in DMs → collect → know it's paid → ship → handle returns
 the API covers:                         ^^^^^^^^^^^^^^^^^^^^^^^^
```

The unserved edges are where I'd dig:

- **Between "paid" and "know it's paid."** A webhook is a technical answer to
  "did I get the money." A seller running a shop out of Instagram DMs is not
  running a webhook listener. Something has to close that loop — which is
  presumably what the Social Commerce app exists to do.
- **Between "know it's paid" and "ship."** `reference` is the only join key back
  to the seller's own order, and it is a free-text field the integrator has to
  remember to populate. The single most valuable piece of reconciliation data in
  the whole flow is optional and unstructured.
- **Repeat buyers.** A link is stateless and anonymous by design. The second sale
  to the same customer knows nothing about the first. Tokenisation exists in the
  API (`TKA_` accounts), but nothing connects it to the link flow.

## Three things I'd prototype

Ordered by what I'd actually argue for, with the honest objection to each.

**1. An idempotency-and-reconciliation layer as a first-class API concept.**
Make `reference` mandatory and structured, and expose "show me every link,
transaction, refund and webhook for reference X" as one call. Today that's
several paged searches and a join the integrator writes themselves.
*Objection:* mandatory fields break existing integrations; would need to be
opt-in per account and default-on for new ones.

**Built, in `src/resources/orders.js` and the Orders panel of `npm run ui`.**
It does three things the API doesn't:

- A **structured reference** (`IG-2291`) instead of free text, validated at
  encode time. "order 12", "Order#12" and "12" are one order to a human and
  three to a machine; there's a test asserting none of them parse.
- **One call for everything about an order** — link, transactions, webhooks,
  joined. The wire log shows what that costs today: two paged searches and an
  in-memory join, per refresh.
- **Fulfilment state**, which GP has nowhere to put — and therefore the
  **exception states** that only exist once something holds both halves:
  `PAID_NOT_SHIPPED` (buyer waiting, seller hasn't noticed),
  `SHIPPED_NOT_PAID` (goods gone, no money), `REFUNDED_AFTER_SHIPPING`
  (neither), `STALE_LINK`.

That last group is the whole argument. Those states are invisible today not
because they're rare but because **nothing owns both halves** — payment sits at
GP, fulfilment sits in the seller's head, and no system holds them together
long enough to notice the contradiction. Ten tests cover the transitions.

**2. Close the Node/Pay-by-Link SDK gap, and make the sandbox playground the
front door.** Least glamorous, highest certainty. The thing standing between a
developer and GP's most differentiated flow is that it isn't in their SDK.
*Objection:* it's engineering cost with no new revenue line — it defends
conversion rather than creating it, which is a harder sell internally and the
reason gaps like this persist.

**3. An agent-callable interface to the API.**
Increasingly, the thing integrating a payments API is a coding agent or an
assistant acting for a merchant. That reader wants machine-readable capability
descriptions, strict typing, and idempotency that's on by default — because an
agent retries. GP's account-scoped, permission-carrying token is an unusually
good primitive for scoping what an agent is allowed to do: you can mint a token
that can create links and nothing else.
*Objection:* speculative, and the compliance questions (who authorised this
agent, what's the audit trail) are harder than the engineering.

## What I'd want to measure

If I owned this, these are the numbers I'd ask for on day one — and the fact
that this repo can be built without any of them is the point:

- Time from account creation to first successful sandbox call. Then to first
  live transaction.
- Where integrations die. My hypothesis from building this: the auth handshake
  and the first `MANDATORY_DATA_MISSING` on a create call.
- Share of live traffic sending an idempotency key.
- Share of Pay by Link integrations that fulfil on `return_url` instead of the
  webhook. That's a measurable correctness bug in customer code, and it is
  GP's problem the moment it causes a chargeback.
- SDK usage by language vs. feature coverage by language. That intersection is
  where the Node/Pay-by-Link gap shows up as lost integrations.
