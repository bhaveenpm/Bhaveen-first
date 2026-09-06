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

## Grade C -- reconstructed, VERIFY BEFORE QUOTING

I could not open the API reference, so these come from search-result summaries
plus the SDK enums. They are my best reconstruction and are what this code
implements, but check them against the real sandbox before you assert them.

- **The exact nesting of the create-link body.** I put amount and currency under
  `transactions: { amount, currency, allowed_payment_methods }`. Some sources
  show `amount`/`currency` at the top level. If the sandbox 400s on
  `MANDATORY_DATA_MISSING`, this is the first thing to flip -- it is a two-line
  change in `src/resources/links.js`.
- The idempotency header spelling (`x-gp-idempotency`).
- The webhook signing scheme. The mock uses a plain SHA-256 of the body as a
  placeholder; real GP's scheme is certainly different. Do not describe GP's
  webhook security from this repo.
- `usage_limit` as a string rather than an integer.
- Whether a decline is HTTP 400 with `error_code: "DECLINED"` (what I built) or
  HTTP 200 with a declined status in the body. **This one genuinely matters** and
  is worth five minutes against the sandbox, because the two shapes demand
  completely different client code.

## Grade D -- could not verify at all

- **The Truust connection.** Your welcome email issued
  `truust_platform_<uuid>` business references, which strongly suggests Global
  Payments Social Commerce is built on Truust. I could not confirm any GP/Truust
  relationship: `api.truust.io` and `truust.io` are blocked here, and a web
  search surfaced the two companies only as separate entities. **Treat "GP
  Social Commerce runs on Truust" as an inference to ask about, not a fact to
  state.** It is a genuinely good question to ask (see `03-interview-brief.md`).
- Anything about pricing, roadmap, volumes, or the internal org.

## To close the gaps in ~15 minutes

On a normal network:

```bash
npm run gp -- whoami --env sandbox --debug     # proves auth, prints your accounts
npm run gp -- link:create --env sandbox --debug \
  --amount 1.00 --currency GBP --reference VERIFY-1
```

`--debug` prints the exact request and response. Diff that against what this
repo sends and every Grade C item above resolves itself.
