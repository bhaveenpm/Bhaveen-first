# Global Payments' MCP server

`github.com/globalpayments/mcp-server` — a Model Context Protocol server that
lets an AI agent create and list payment links in natural language. Three tools:
`create_payment_link`, `get_links`, `get_documentation`.

Worth trying before Tuesday, and worth reading regardless: it is the only
GP-authored client that actually calls `/links`, so it resolved several open
questions in `00-sources-and-confidence.md`.

---

## Why this matters beyond the demo

`02-product-teardown.md` argues, speculatively, that GP's account-scoped,
permission-carrying token is an unusually good primitive for constraining what
an agent may do — you can mint a token that creates links and nothing else.

**This repo is GP doing precisely that.** Its default token permissions are:

```
["LNK_POST_Create", "LNK_GET_List", "LNK_GET_Single"]
```

and the README instructs you to provision an app with only LNK resources. So the
argument is no longer speculative — it is shipped. That upgrades the point from
"here's an idea" to "you already do this; how far do you intend to take it?",
which is a much better question to ask in the room.

There is also a **separate access-token endpoint for agents**:
`/ucp/mcp/accesstoken` rather than `/ucp/accesstoken`. That is undocumented
anywhere I could reach, and it implies agent traffic is deliberately
distinguishable from ordinary integration traffic at the auth layer. Being able
to tell those apart is exactly what you'd want if you were going to price,
rate-limit, or risk-score agent-initiated payments differently.

## What reading it corrected in this repo

The create-link body, verified from `src/clients/client.ts`:

```jsonc
{
  "type": "PAYMENT",
  "usage_mode": "SINGLE",
  "name": "...", "description": "...", "reference": "...",
  "shippable": "NO",
  "transactions": {
    "allowed_payment_methods": ["CARD"],
    "amount": "2499",
    "channel": "CNP",
    "currency": "GBP",
    "country": "GB"        // INSIDE transactions, not top level
  },
  "account_name": "..."    // or "account_id"
  // usage_limit: number, ONLY when usage_mode is MULTIPLE
  // no "status" on create
}
```

This repo had `country` at the top level, sent `usage_limit` as a string always,
and sent `status: "ACTIVE"`. All three are now fixed.

## A bug worth knowing about before you run it

With `ENV=SANDBOX`, the server authenticates against one host and then uses the
token against a different one:

| Call | Host | Where |
|---|---|---|
| `POST /ucp/mcp/accesstoken` | `apis-cert.globalpay.com` | `settings.ts` maps SANDBOX → `BASE_URL_CERT` |
| `POST /ucp/links`, `GET /ucp/links` | `apis.sandbox.globalpay.com` | `client.ts` overrides with `BASE_URL_SANDBOX` |

`BASE_URL_SANDBOX` is defined in `constants.ts` and never used by `settings.ts`;
`client.ts` reaches past the setting for the two link calls only. So a token
minted on cert is presented to sandbox.

Whether that fails depends on whether those two environments share a token
store, which I could not test — both hosts are unreachable from where this was
written. **If authentication succeeds but link creation returns 401, this is
why.** The workaround is a one-line change in `settings.ts` to use
`BASE_URL_SANDBOX`.

Either way it is a real inconsistency in a public repo, and a fair thing to
raise gently: *"I noticed the sandbox base URL is set in two places and they
disagree — is cert the intended sandbox for MCP?"*

## Papercuts in the README

- It says `git clone .../mcp-server.git` then `cd gpapi-mcp-server/Typescript`.
  Neither the directory name nor the subdirectory exists — the repo root **is**
  the TypeScript project. So `cd mcp-server` is correct.
- The Claude Desktop example uses `X://absolute//path//...`, a Windows path with
  doubled separators, with no macOS or Linux equivalent given.
- `package.json` declares `"main": "./lib/src/index.js"`, but `tsconfig.json`
  sets `rootDir: ./src` and `outDir: ./lib`, so the build actually emits
  `lib/index.js`. Verified by building it. The README's path is the correct one
  and the package manifest points at a file that does not exist — which would
  break anyone consuming this as a published package rather than a clone.

Small, but this is the first ten minutes of the only integration path GP offers
for agents, which makes them expensive minutes.

## Dependency health, stated carefully

A fresh `npm install` reports 20 advisories (2 critical, 11 high). Most of that
is noise and it would be unfair to lead with the headline number: the two
criticals (`handlebars`, `shell-quote`) are transitive **dev** dependencies,
pulled in by eslint and jest, and never ship or run in the served process.

The part that is fair to raise concerns the five **runtime** dependencies:
`@modelcontextprotocol/sdk`, `axios`, `dotenv`, `yaml`, `zod`. Two of those
carry high-severity advisories today:

- **`axios`** — a long list including SSRF via `NO_PROXY` bypass, header
  injection, and `Proxy-Authorization` credential leakage across redirects.
- **`@modelcontextprotocol/sdk`** — cross-client data leak via shared
  server/transport instance reuse, plus a ReDoS.

The reason it is worth mentioning at all is the context, not the CVEs: **this
process holds a merchant's payment API credentials**, and a credential-leak
advisory in its HTTP client is squarely on point. `npm audit fix` resolves them.

The PM question underneath is not "are there CVEs" — every repo has CVEs — but
**who owns dependency currency for a published integration artefact, and on what
cadence**. An MCP server is not a sample; it runs unattended on a merchant's
machine holding live keys. That is a different support commitment from a code
sample, and worth asking whether it is treated as one.

## Setup

```bash
git clone https://github.com/globalpayments/mcp-server.git
cd mcp-server          # NOT gpapi-mcp-server/Typescript
npm install
npm run build
```

`.env` in that directory:

```env
GPAPI_APP=your_app_id:your_app_key     # note the colon-joined format
ENV=SANDBOX
# GPAPI_ACCOUNT_NAME=...               # optional; auto-detected from the token
```

Claude Desktop config — `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS:

```json
{
  "mcpServers": {
    "global-payments": {
      "command": "node",
      "args": ["/Users/YOU/mcp-server/lib/index.js"],
      "env": { "GPAPI_APP": "app_id:app_key", "ENV": "SANDBOX" }
    }
  }
}
```

Restart Claude Desktop, then ask in plain English: *"Create a payment link for
£24.99 for a hand-poured candle."*

## The follow-on to have ready

The tools are `create_payment_link`, `get_links`, `get_documentation` — creation
and reading, nothing else. Which makes the obvious question: what comes next,
and who decides? Transactions and refunds are the natural additions and also
where an agent doing the wrong thing costs real money, so the interesting answer
is about guardrails rather than endpoints. The audit trail matters too: GP can
already tell agent traffic apart at the auth layer, so the question is whether a
merchant can see which of their payments an agent initiated.
