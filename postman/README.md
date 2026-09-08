# Postman collection — Global Payments GP API

`GlobalPayments-GP-API.postman_collection.json` — 23 requests across the API,
with the authentication handshake automated.

## Import and set up (2 minutes)

1. Postman → **Import** → drop in the `.json` file.
2. Open the collection → **Variables** tab.
3. Set **`app_id`** and **`app_key`**. Save. That's it.

Leave everything else alone. `base_url` defaults to US sandbox
(`https://apis.sandbox.globalpay.com/ucp`); if your app was created in an
Ireland/Europe region, change it to `https://apis.sandbox.eu.globalpay.com/ucp`.
Region is fixed at app creation and credentials do not work across regions —
a mismatch looks like bad credentials rather than a wrong host.

## What's automated

GP authentication is a proof-of-possession handshake: you never send `app_key`,
you send a nonce and `sha512(nonce + app_key)`. That is not something you can
type by hand, which is why GP in Postman is usually painful.

A collection-level pre-request script does it for you, **caches the token**
(minting one per request is rate-limited and the classic route to 429s under
load), and reads your `account_name` out of the token's scope — so you never
hardcode it.

Requests also chain: create a link and `link_id` is stored; run a sale and
`transaction_id` is stored. Folders run top to bottom.

## Order to work through

**0 · Auth** — run it once to watch the handshake. Open the Postman console
(`Cmd+Alt+C`) to see your merchant and every account the token can reach.

**1 · Pay by Link** — create, list, fetch, reprice, deactivate.

**2 · Transactions** — sale, authorise, capture, refund, reverse.

**3 · The 14 you haven't touched** — mostly read-only, safe to poke.

## Five experiments worth more than the happy path

1. **Currency → `JPY`, amount `"2499"`.** In GBP that's £24.99. In JPY it's 2499
   yen, because JPY has no minor unit. The API cannot catch this for you.
2. **Card `4000120000001154`.** HTTP 400, `error_code: DECLINED`. The issuer said
   no. Now break the card number instead: HTTP 400,
   `error_code: INVALID_REQUEST_DATA`. **Same status, completely different
   meaning** — code that conflates them pages an engineer over an empty bank
   account.
3. **Refund an uncaptured authorisation.** Refused — you must *reverse* it. A
   reversal voids before settlement and the customer often never sees it; a
   refund appears as a second statement entry. Same intent, different cost and
   different customer experience.
4. **Delete the `X-GP-Version` header.** The API is versioned by header, not URL.
   Omit it and you silently get the default version — which is not necessarily
   the one you built against.
5. **Move `country` to the top level of a create-link body**, out of
   `transactions`. Watch it fail. This is the single most common mistake in
   reconstructions of this endpoint.

## Notes

- Amounts are **minor units, as strings**: `"2499"` is £24.99.
- `reference` is the only join key between GP's records and your own orders.
  A webhook without one is an orphan.
- Some requests may 403 depending on how your app is provisioned — `/merchants`
  especially. That is not a bug; a lot of GP behaviour is set by account
  provisioning rather than by what you send.
- **Never commit your `app_key`.** Postman variables live in your workspace, not
  in this file.
