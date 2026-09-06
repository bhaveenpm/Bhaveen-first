# Interview brief — Global Payments, Tuesday

Prep, not a script. The goal is that you can talk about their API like someone
who has used it, because you have.

---

## The 60-second version, if they ask what you did

> I wanted to understand the API rather than read about it, so I built a small
> toolkit against it: a zero-dependency client, a CLI, and an offline emulator of
> the API so I could test the integration without depending on the sandbox being
> up. Then I wrote down every place the API forces a decision I didn't expect.
> Three of those turned out to be the interesting ones — that a decline and a
> malformed request are both HTTP 400 and need completely different handling,
> that `return_url` isn't proof of payment and integrators fulfil on it anyway,
> and that amounts are minor units where no validation can catch your mistake.

Then stop. Let them pick which thread to pull.

## Have a real demo ready

`npm run demo` runs the whole story offline in about two seconds — auth, create
link, buyer pays, webhook races the redirect, link goes PAID, refund, then both
failure modes side by side. No network, no credentials, no "let me just find the
sandbox." If there's a screen, run it.

If you get credentials before Tuesday, run the same flow against the real
sandbox with `--debug` so you can say "here's the actual wire format."

## Three points worth landing

Pick based on the room. Each is defensible because it's in code with a test.

**1. A decline is not an error.** (`01-api-teardown.md` §6)
Both are HTTP 400. Code that conflates them either pages an engineer because a
shopper's card was empty, or hides real bugs behind "try another card." This is
the one I'd lead with — it's concrete, it's about customer experience *and*
engineering hygiene, and it shows you've thought about what the integrator does
next rather than just what the endpoint returns.

**2. `return_url` isn't proof of payment.** (§9)
The redirect and the webhook race. The buyer can close the tab and the money
still moved. Then the product point: the share of live integrations fulfilling
on the redirect is a *measurable correctness bug in customer code*, and it
becomes GP's problem the moment it causes a chargeback. That's the move — turn a
technical nuance into something you'd put on a dashboard.

**3. The platform story is in the API and not in the marketing.** (`02` §"who")
Access tokens carry a scope listing the accounts they can reach, so a platform
onboarding thousands of sub-merchants discovers account names at runtime instead
of storing them. That's a real ISV advantage, and you have to infer it from the
shape of a token response. If they ask "what would you change first," this is a
better answer than any feature request, because it costs documentation rather
than engineering.

## Questions to ask them

Good questions here are ones where you've clearly already formed a view.

1. **The Node SDK defines the `/links` endpoint but ships no Pay by Link service,
   while PHP, Java and .NET have one. How do you decide SDK parity?** Sharp, easy
   to verify, and asks about prioritisation rather than complaining. Check
   item 8 in `04-docs-checklist.md` first in case it's been fixed.

2. **What's your time-to-first-successful-call, and where do integrations die?**
   The question an API PM lives on. Have your hypothesis ready: the auth
   handshake, and the first `MANDATORY_DATA_MISSING` on a create call.

   You now have first-hand evidence for this one: creating a Unified Payments
   App in the portal returned `Internal Server Error`. **Use it carefully.**
   Delivered as *"I hit a 500 trying to generate credentials, which made me
   wonder how you measure the top of that funnel"* it's an observation with a
   question attached. Delivered as *"your portal is broken"* it's a complaint,
   and the person across the table may well have built it. Lead with the metric,
   mention the 500 as the reason you thought about it.

3. **How do you think about the Truust relationship?** This is now evidenced,
   not speculative: the Social Commerce onboarding mail arrives from
   **`globalpayments@truust.io`** and issues `truust_platform_<uuid>`
   identifiers. So you can ask it directly — *"I signed up for Social Commerce
   and the onboarding comes from truust.io with platform references — how do you
   think about build vs. buy vs. partner for the self-serve end of the
   portfolio?"* That is a strategy question with evidence behind it, and it
   shows you actually used the product.
   **Still don't assert the corporate structure** (acquisition? white-label?
   reseller?) — you don't know it, and guessing wrong in the room is expensive.

   The follow-on, if it lands well: *"where does the GP API stop and the Truust
   platform start?"* That's the seam an API proposition role would own.

4. **How do you think about idempotency being opt-in?** It's a real design trade,
   not a gotcha. Ask what share of live traffic sends the header — if they don't
   know, that's a useful thing to have surfaced.

5. **Who owns the seam between "payment succeeded" and "the seller knows to
   ship"?** The API stops at the webhook; the seller's job doesn't. That's the
   gap the Social Commerce app presumably fills, and it's where API product and
   applications product meet — which is probably the actual shape of this role.

## Don't overclaim

You have not run a transaction through their production system, and you built
this against a partly-reconstructed contract because the docs portal was blocked.

That's fine, and honesty about it is an asset — *"I built this against the SDK
source and my own emulator because I couldn't reach the docs; here's the list of
things I'd verify first"* is a better signal than false certainty. It's how
someone competent behaves under incomplete information.

Before Tuesday, read `00-sources-and-confidence.md` so you know which specific
claims are Grade A (read from GP's own SDK source) and which are Grade C
(reconstructed). If you're unsure mid-conversation, say "I'd want to check that
against the docs" — that sentence costs you nothing and protects everything else
you said.

## If it goes technical

- `src/client.js` — auth, token caching, retry with full jitter, idempotency.
- `src/money.js` — minor units, and why excess precision throws instead of rounding.
- `mock/server.js` — the contract, including the lifecycle rules the real API enforces.
- `test/idempotency.test.js` — the retry-after-the-server-already-succeeded case.

The mock is the part worth explaining if they ask how you'd work: an integration
you can only exercise against someone else's uptime is one you can't write tests
for. Building the emulator is what let the test suite catch a real bug — the
first version generated payer URLs from a hardcoded port instead of the address
it was listening on, and the link lifecycle tests caught it immediately.
