# What I verified, and how

I built this in an environment where `developer.globalpay.com` and
`apis.sandbox.globalpay.com` are both blocked by an egress proxy. So I could not
read the docs portal or call the sandbox. **Everything below is graded, because
you are about to repeat some of it out loud in an interview and a confidently
wrong detail is worse than a hedged one.**

## Grade A -- read from primary source

Taken directly from the source of Global Payments' own Node SDK,
`globalpayments-api@3.11.04`, installed from npm. This is GP's shipped code, so
it is as authoritative as the docs and occasionally more current.

| Fact | Where in the SDK |
|---|---|
| Auth secret is `sha512(nonce + app_key)`, lowercase hex | `Builders/RequestBuilder/GpApi/GpApiSessionInfo.js` |
| Nonce is an ISO-8601 timestamp; `grant_type: "client_credentials"` | same |
| `POST /accesstoken`, and the endpoint list incl. `/links`, `/transactions` | `Entities/GpApi/GpApiRequest.js` |
| API version pinned by the `X-GP-Version: 2021-03-22` header | `Gateways/GpApiConnector.js` |
| The five hosts (sandbox/prod x US/EU, plus EU QA) | `Entities/ServiceEndpoints.js` |
| Link statuses `ACTIVE INACTIVE CLOSED EXPIRED PAID` | `Entities/Enums.js` |
| Usage modes `SINGLE MULTIPLE` | same |
| Transaction body keys: `account_name`, `channel`, `capture_mode`, `type`, `amount`, `currency`, `country`, `reference`, `payment_method` | `Builders/RequestBuilder/GpApi/GpApiAuthorizationRequestBuilder.js` |

Notably, the Node SDK defines the `/links` endpoint constant but ships **no
Pay by Link service** -- there is no builder, no request class, nothing. The
PHP, Java and .NET SDKs do. That gap is itself a finding; see
`02-product-teardown.md`.

## Grade B -- read from GP's own public sample repo

From `globalpayments-samples/pay-by-link` (README, via raw.githubusercontent).

- Env var names `GP_API_APP_ID`, `GP_API_APP_KEY`, `GP_API_ENVIRONMENT`.
- Sandbox test cards: Visa `4263982640269299`, Mastercard `5425233424241200`.
- Sample supports EUR, USD, GBP.
- Six language implementations of the same ~200-line flow.

## Grade A2 -- RESOLVED against Global Payments' own MCP server

`github.com/globalpayments/mcp-server` (public, TypeScript) is a second GP-authored
client, and unlike the Node SDK it *does* call `/links`. Reading
`src/clients/client.ts` and `src/utils/constants.ts` closes most of what was
Grade C below.

| Now confirmed | Detail |
|---|---|
| The create-link body nests under `transactions` | `transactions: { allowed_payment_methods, amount, channel, currency, country }` |
| `country` and `channel` live INSIDE `transactions` | not at the top level, which is what this repo had wrong |
| `usage_limit` is a NUMBER, and only sent for `MULTIPLE` | this repo sent a string, always |
| `status` is NOT sent on create | this repo sent `status: "ACTIVE"` |
| Auth body | `app_id`, `secret`, `grant_type`, `nonce`, plus optional `interval_to_expire` and `permissions` -- matches this repo exactly |
| `X-GP-Version: 2021-03-22` | independently confirmed |
| Account may be given as `account_id` OR `account_name` | this repo only uses `account_name` |

Two further findings from that repo, neither of which is in any documentation:

- **There is a separate MCP access-token endpoint**: `/ucp/mcp/accesstoken`, not
  the standard `/ucp/accesstoken`. That is a deliberate, separate auth path for
  agent clients.
- **It requests least-privilege tokens by default**:
  `["LNK_POST_Create", "LNK_GET_List", "LNK_GET_Single"]`, and the README tells
  you to provision an app with only LNK permissions. This is GP doing exactly
  what `02-product-teardown.md` argues their token model is good for.

The code in this repo was corrected to match. See `06-mcp-server.md`.

## Grade C -- reconstructed, VERIFY BEFORE QUOTING

I could not open the API reference, so these come from search-result summaries
plus the SDK enums. They are my best reconstruction and are what this code
implements, but check them against the real sandbox before you assert them.

- ~~The exact nesting of the create-link body.~~ **RESOLVED** -- see Grade A2 above.
- The idempotency header spelling (`x-gp-idempotency`). The MCP server does not
  send an idempotency key at all, so it could not confirm this.
- The webhook signing scheme. The mock uses a plain SHA-256 of the body as a
  placeholder; real GP's scheme is certainly different. Do not describe GP's
  webhook security from this repo.
- ~~`usage_limit` as a string rather than an integer.~~ **RESOLVED** -- it is a
  number, and only sent for `MULTIPLE`.
- Whether a decline is HTTP 400 with `error_code: "DECLINED"` (what I built) or
  HTTP 200 with a declined status in the body. **This one genuinely matters** and
  is worth five minutes against the sandbox, because the two shapes demand
  completely different client code.

## Grade D -- could not verify at all

- Anything about pricing, roadmap, volumes, or the internal org.
- Whether the Social Commerce app's own API (as opposed to the GP API) is
  reachable to a self-serve signup. All `truust.io` hosts are blocked here.

---

# Update: the Truust question is now answered

A second onboarding email (17 Sep 2026, "Global Payments API - PRE") resolves
what was previously the biggest unknown.

**Evidence, from the message headers and body:**

- The sender is **`globalpayments@truust.io`**. Global Payments' Social Commerce
  onboarding mail is sent from Truust's domain.
- The account identifiers issued are `truust_platform_<uuid>`.
- The subject line is "Global Payments API - **PRE**" -- almost certainly a
  pre-production environment, i.e. this signup carries an API context, not only
  the consumer app.

**What that supports:** Truust operates the platform behind Global Payments
Social Commerce. In Truust's model a "platform" looks like the tenant container,
and the merchant is issued a platform reference per signup.

**What it still does not tell us:** the nature of the relationship -- acquisition,
white-label, reseller, joint product. Do not guess at corporate structure. The
question in `03-interview-brief.md` is now much sharper because you can cite the
sender domain rather than an inference from an identifier format.

**A second observation worth more than the first.** The two emails issued
*accumulating* platform references -- two in the first, three in the second, the
earlier ones repeated verbatim. So each signup mints a new platform and none are
deduplicated, and the merchant is shown all of them with no explanation of what
a "business name for reference" is or which one to use. That is a first-hand
onboarding defect you experienced as a user, which is a considerably better
interview artefact than anything you could read in the docs. See
`05-social-commerce-teardown.md`.

## To close the gaps in ~15 minutes

On a normal network:

```bash
npm run gp -- whoami --env sandbox --debug     # proves auth, prints your accounts
npm run gp -- link:create --env sandbox --debug \
  --amount 1.00 --currency GBP --reference VERIFY-1
```

`--debug` prints the exact request and response. Diff that against what this
repo sends and every Grade C item above resolves itself.
