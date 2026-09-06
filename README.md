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
npm test          # 38 tests, no network needed
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
  resources/transactions.js  sale / auth / capture / refund / reverse
  cli.js                 the CLI
mock/server.js           offline emulator, incl. a stand-in hosted payment page
ui/server.js             local web UI: proxies to GP, streams the wire to the page
ui/index.html            the page itself, no build step, no framework
scripts/demo.js          narrated end-to-end walkthrough
scripts/doctor.js        preflight: what's set up, what's missing, how to fix it
test/                    38 tests, all against the emulator
notes/                   what I actually learned -- start here
```

## Notes (the point of the repo)

| | |
|---|---|
| [`00-sources-and-confidence.md`](notes/00-sources-and-confidence.md) | **Read first.** What's verified from GP's own SDK source vs. reconstructed. |
| [`01-api-teardown.md`](notes/01-api-teardown.md) | Ten nuances that bite, each demonstrated in code. |
| [`02-product-teardown.md`](notes/02-product-teardown.md) | The API as a product: users, gaps, what I'd build. |
| [`03-interview-brief.md`](notes/03-interview-brief.md) | Talking points and questions. |
| [`04-docs-checklist.md`](notes/04-docs-checklist.md) | Open items to confirm against the docs portal. |

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
