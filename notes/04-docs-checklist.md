# Verification checklist for the docs portal

`developer.globalpayments.com` is blocked from the environment this repo was
built in, so a handful of details are reconstructed rather than read (see
`00-sources-and-confidence.md`, Grade C). **You can open the portal. I can't.**

Work down this list while reading. Each item says where to look, what this repo
currently assumes, and what to change if the docs disagree. Paste anything back
and I'll fix the code.

Ordered by how much damage a wrong assumption does.

---

### 1. Is a decline an HTTP 400, or an HTTP 200 with a declined status? ⚠️ highest stakes
**Look in:** the transactions reference, and *API responses* / error-codes page.
**This repo assumes:** HTTP 400 with `error_code: "DECLINED"`, surfaced as
`GpApiError.declined === true`.
**If it's actually 200-with-status:** `src/client.js` only throws on `!response.ok`,
so a decline would return as a *success* and code would fulfil an unpaid order.
That's the one wrong assumption here that could cost real money.
**Fix:** add a status check in `Transactions.#authorize` after the response
returns. Tell me and I'll write it.

### 2. Exact shape of the create-link body
**Look in:** Pay by Link → API reference, the `POST /links` request schema.
**This repo assumes:**
```json
{ "transactions": { "amount": "2499", "currency": "GBP",
                    "allowed_payment_methods": ["CARD"] } }
```
**The alternative:** `amount` and `currency` at the top level of the body.
**Symptom if wrong:** `MANDATORY_DATA_MISSING` or `INVALID_REQUEST_DATA` on your
first create call.
**Fix:** two lines in `src/resources/links.js` (`create`, and the same in `edit`).

### 3. The idempotency header spelling
**Look in:** *API basics* / *Headers*, or the getting-started overview.
**This repo assumes:** `x-gp-idempotency`.
**Also check:** how long a key is honoured, and whether replaying a key with a
*different* body is an error or a silent replay of the original. The second
behaviour matters more than the header name.
**Fix:** one line in `src/client.js`.

### 4. Is `usage_limit` a string or an integer?
**Look in:** the `POST /links` schema.
**This repo assumes:** string (`"1"`), matching how GP treats amounts.
**Fix:** one line in `src/resources/links.js`.

### 5. Webhook authentication
**Look in:** the webhooks / notifications page.
**This repo assumes:** nothing real — the mock signs with a plain SHA-256 of the
body purely as a placeholder. **Do not describe GP's webhook security from this
repo.** Find out what the real scheme is (signature header? shared secret? mTLS?
IP allowlist?), because "how do I verify this webhook is really from you" is a
question you may well get asked *by* them, and it's a good one to ask *of* them.

### 6. Token lifetime and rate limits
**Look in:** *Access Tokens*, and any rate-limit page.
**This repo assumes:** trust `seconds_to_expire` from the response; refresh 60s
early. That's safe regardless. What I'd like confirmed is the **rate limit on
token creation** — it's the number that justifies the caching argument in
`01-api-teardown.md` §1, and quoting it precisely is more persuasive than "it's
rate-limited."

### 7. Does the sandbox actually gate currencies per account?
**Look in:** account provisioning / supported currencies.
**This repo assumes:** yes — the mock rejects a currency the account isn't set up
for, as `INVALID_REQUEST_DATA`. I believe the *behaviour* is real; I'm unsure of
the exact `error_code`.
**Why it matters:** it's the cleanest example of "the request is fine, the
account provisioning isn't," which is the §10 argument in the teardown.

### 8. Does Pay by Link exist in the Node SDK now?
**Look in:** the SDK / libraries page, and the changelog for `globalpayments-api`.
**What I found:** v3.11.04 defines `PAYBYLINK_ENDPOINT = "/links"` and ships no
service to call it, while PHP/Java/.NET do have one. That gap is a load-bearing
observation in `02-product-teardown.md`.
**If it's since been added:** soften that point to "was missing as of 3.11.04" —
still a fair observation about parity lag, but don't state it as current.

### 9. The Truust question
**Look for:** any mention of Truust in the Social Commerce docs or T&Cs.
**Status:** unverified. Your welcome email issued `truust_platform_<uuid>`
references, which suggests Social Commerce is built on Truust, but I could not
confirm any relationship. **Don't assert it.** It's a strong question to ask
instead — see `03-interview-brief.md`.

---

## Fastest way to close 1–7 at once

Once you're on a network that can reach the sandbox, with real credentials in
`.env`:

```bash
npm run gp -- whoami --debug
npm run gp -- link:create --debug --amount 1.00 --currency GBP --reference VERIFY-1
npm run gp -- sale --debug --amount 1.00 --currency GBP \
  --card 4263982640269299 --exp 12/2027 --cvv 123
```

`--debug` prints the exact request and the exact response, secrets redacted.
Diff that against what the docs say and against what this repo sends, and items
1–7 all resolve. Then run `npm test` — if the sandbox disagrees with an
assumption, the test that encodes it is the one to change first.
