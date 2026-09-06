# What you're actually holding, and what you can play with

Written after the second onboarding email ("Global Payments API - PRE", from
`globalpayments@truust.io`).

## Inventory: what the signup gave you

| Thing | What it is | Can you use it yet? |
|---|---|---|
| The Social Commerce app | No-code product: create products, share payment links | **Yes, now** |
| 3 x `truust_platform_<uuid>` | Tenant/platform references on Truust's side | Yes, as identifiers — no API key came with them |
| "PRE" environment | Almost certainly pre-production | Unclear — no credentials in the email |
| Full activation | Gated behind a manual step ("click here") | **No** — blocks live payments |

The critical gap: **no `app_id` / `app_key` arrived.** So nothing in that email
lets you make an authenticated API call yet. That is the thing to go get.

---

## Four things you can play with, easiest first

### 1. The app itself — and this is the most interview-valuable (0 blockers)

Go create a product and share a payment link. Not because it's technically
interesting, but because **you are the user of a payments onboarding funnel right
now**, and that experience expires the moment you get used to it. Write down,
today, while it's still strange:

- How many steps from download to a shareable link?
- When did it first ask for something you couldn't answer without a merchant account?
- What did "your business name for reference is: truust_platform_..." mean to you
  on first read? (Nothing. That's the finding.)
- Where does the app hand off to Global Payments branding vs. Truust plumbing,
  and is the seam visible to a normal seller?

That's a first-hand onboarding teardown. For a PM interview it beats a docs
summary, because nobody else in the loop has done it.

### 2. This repo against the real GP API sandbox (~15 min, and the real unlock)

The Social Commerce signup is **not** the same thing as GP API developer
credentials. Sign up separately at <https://developer.globalpayments.com>, get an
`app_id` / `app_key`, then:

```bash
cp .env.example .env      # paste the two values
npm run gp -- whoami --debug
npm run gp -- link:create --debug --amount 1.00 --currency GBP --reference VERIFY-1
```

That resolves items 1–7 in `04-docs-checklist.md` — including the one that
matters, whether a decline is HTTP 400 or 200 — and turns everything in
`01-api-teardown.md` from "reconstructed" into "I ran it."

### 3. Ask for PRE / Truust API credentials (one email, might pay off big)

The "PRE" in the subject line implies a pre-production API tier exists for this
product. Nothing in the email says how to get keys for it. So ask — reply to
`globalpayments@truust.io`, or use the `0345 702 3344` line:

> I've signed up for Social Commerce and received platform references. I'd like
> to explore the API in the PRE environment — how do I get credentials, and is
> there API documentation for the Social Commerce platform specifically?

Two good outcomes and no bad ones: you either get API access nobody interviewing
you has, or you get a support-response-time data point and a documentation gap
you can name in the room.

### 4. Compare the two link products (30 min, sharp analysis)

You'll have seen both **GP API Pay by Link** (developer-facing, `POST /links`)
and **Social Commerce links** (seller-facing, no code). Same underlying job,
two very different products. Worth writing half a page on:

- Do they produce the same kind of link, or different rails entirely?
- Who is each one *for*, and where's the handover when a seller outgrows the app?
- If they're separate stacks (GP API vs. Truust platform), that's a portfolio
  question: two ways to do one job, and someone owns whether that's deliberate
  segmentation or accumulated overlap.

That last question is the kind of thing an API proposition role exists to answer.

---

## The onboarding teardown (free material, already earned)

Observations from the two emails alone, before you even open the app:

**1. Identifiers accumulate and are never explained.**
The first email listed two `truust_platform_` references; the second listed
three, repeating the earlier two verbatim. So each signup mints a new platform,
nothing is deduplicated, and the merchant is shown the growing list with the
label "your business name for reference." It is not a business name. A seller
cannot act on it and has no idea which one matters.

*Why it's a real finding:* the identifier a merchant is told to quote in support
conversations is the join key between them and their money. Three of them, with
no guidance, means the first support call starts with disambiguation.

**2. The email is branded Global Payments and sent from `truust.io`.**
For a seller, one of those names is the reason they signed up and the other is
unexplained. Deliverability aside, it's a trust seam in a product whose entire
proposition is taking strangers' money.

**3. "PRE" leaks into a customer-facing subject line.**
An internal environment name reached a merchant's inbox. Small, but it's the
tell that this onboarding path is closer to internal tooling than to a finished
self-serve funnel — which is itself useful context for what the role might
actually involve.

**4. The activation gate arrives after the win, not before.**
You're told you're "one step closer" and can "easily create products and share
payment links" — and then, in the fourth paragraph, that you can't take any
money until a manual activation completes. The order is backwards for anyone who
signed up intending to sell something this week.

Use one or two of these, not all four. Delivered as *"I signed up as a customer
and here's what I noticed"* it reads as product instinct. Delivered as a list of
four complaints it reads as someone auditing their interviewer.

---

## What I'd do before Tuesday

1. **Get GP API sandbox credentials and run this repo against them.** Highest
   value per minute. Everything else is optional.
2. **Spend 20 minutes in the Social Commerce app** and write the onboarding
   notes while it's still unfamiliar.
3. **Send the credentials email** (item 3) — the answer, or the absence of one,
   is useful either way.
4. **Re-read `03-interview-brief.md`** and pick your two lead points. Don't try
   to land all of them.
