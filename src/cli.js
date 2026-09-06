#!/usr/bin/env node
/**
 * A CLI for poking the GP API by hand. The point is to see the wire:
 * every command prints the resource the API actually returned, and `--debug`
 * prints the request and response with secrets redacted.
 *
 *   npm run gp -- whoami
 *   npm run gp -- link:create --amount 24.99 --currency GBP --reference ORDER-1
 *   npm run gp -- listen --port 9999
 */

import { createServer } from "node:http";
import { createGp, formatAmount, GpApiError, GpConfigError } from "./index.js";

const RAW = process.argv.slice(2);
const COMMAND = RAW[0];

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseFlags(RAW.slice(1));

const USAGE = `gp-api-lab -- a hands-on CLI for the Global Payments GP API

Usage: npm run gp -- <command> [options]

Auth
  whoami                       Create an access token and print what it can reach

Pay by Link
  link:create                  --amount 24.99 --currency GBP --reference ORDER-1
                               [--name] [--description] [--expires YYYY-MM-DD]
                               [--usage-mode SINGLE|MULTIPLE] [--usage-limit N]
                               [--status-url URL] [--return-url URL] [--cancel-url URL]
                               [--shippable] [--shipping-amount 3.99]
  link:get <LNK_id>
  link:list                    [--status ACTIVE|PAID|EXPIRED|INACTIVE] [--page 1] [--page-size 20]
  link:deactivate <LNK_id>

Transactions
  sale                         --amount 10.00 --currency GBP --card 4263982640269299
                               --exp 12/2027 [--cvv 123] [--reference REF]
  auth                         same flags as sale, but authorise only (capture later)
  txn:get <TRN_id>
  txn:capture <TRN_id>         [--amount 5.00 --currency GBP]
  txn:refund <TRN_id>          [--amount 5.00 --currency GBP]
  txn:reverse <TRN_id>

Webhooks
  listen                       [--port 9999]  Receive and pretty-print status_url callbacks

Global
  --env sandbox|production|sandbox-eu|production-eu|mock
  --debug                      Print the HTTP request and response
  --json                       Print raw JSON only (for piping into jq)
`;

function output(resource, summary) {
  if (flags.json) {
    console.log(JSON.stringify(resource, null, 2));
    return;
  }
  if (summary) console.log(summary);
  console.log(JSON.stringify(resource, null, 2));
}

async function main() {
  if (!COMMAND || COMMAND === "help" || flags.help) {
    console.log(USAGE);
    return;
  }

  if (COMMAND === "listen") {
    return listen(Number(flags.port || 9999));
  }

  const gp = createGp({
    environment: flags.env,
    debug: Boolean(flags.debug),
  });

  switch (COMMAND) {
    case "whoami": {
      await gp.client.accessToken();
      const scope = gp.client.scope ?? {};
      if (flags.json) return output(scope);
      console.log(`Environment : ${gp.client.config.environment}`);
      console.log(`Base URL    : ${gp.client.config.baseUrl}`);
      console.log(`Merchant    : ${scope.merchant_name ?? "?"} (${scope.merchant_id ?? "?"})`);
      console.log(`Accounts    :`);
      for (const account of scope.accounts ?? []) {
        console.log(`  ${account.id.padEnd(20)} ${account.name}`);
      }
      console.log(`\nDefault account for links/transactions: ${await gp.client.accountName()}`);
      return;
    }

    case "link:create": {
      const link = await gp.links.create({
        amount: required(flags.amount, "--amount"),
        currency: required(flags.currency, "--currency"),
        reference: required(flags.reference, "--reference"),
        name: flags.name,
        description: flags.description,
        expirationDate: flags.expires,
        usageMode: flags["usage-mode"],
        usageLimit: flags["usage-limit"] ? Number(flags["usage-limit"]) : undefined,
        shippable: Boolean(flags.shippable),
        shippingAmount: flags["shipping-amount"],
        statusUrl: flags["status-url"],
        returnUrl: flags["return-url"],
        cancelUrl: flags["cancel-url"],
      });
      return output(
        link,
        `\nCreated ${link.id} for ${formatAmount(link.transactions.amount, link.transactions.currency)}\n` +
          `Share this: ${link.url}\n`,
      );
    }

    case "link:get":
      return output(await gp.links.get(requiredArg(0, "<LNK_id>")));

    case "link:deactivate": {
      const link = await gp.links.deactivate(requiredArg(0, "<LNK_id>"));
      return output(link, `\n${link.id} is now ${link.status}\n`);
    }

    case "link:list": {
      const page = await gp.links.search({
        status: flags.status,
        page: Number(flags.page || 1),
        pageSize: Number(flags["page-size"] || 20),
      });
      if (flags.json) return output(page);
      const rows = page.links ?? [];
      console.log(`\n${page.total_record_count} link(s), page ${page.page}\n`);
      for (const link of rows) {
        console.log(
          `${link.id}  ${String(link.status).padEnd(9)}  ` +
            `${formatAmount(link.transactions.amount, link.transactions.currency).padStart(12)}  ${link.reference}`,
        );
      }
      return;
    }

    case "sale":
    case "auth": {
      const [expiryMonth, expiryYear] = String(required(flags.exp, "--exp")).split("/");
      const input = {
        amount: required(flags.amount, "--amount"),
        currency: required(flags.currency, "--currency"),
        reference: flags.reference,
        card: {
          number: String(required(flags.card, "--card")).replace(/\s/g, ""),
          expiryMonth,
          expiryYear,
          cvv: flags.cvv,
        },
      };
      const txn = COMMAND === "sale" ? await gp.transactions.sale(input) : await gp.transactions.authorize(input);
      return output(
        txn,
        `\n${txn.id} ${txn.status} -- ${txn.payment_method?.message ?? ""}\n`,
      );
    }

    case "txn:get":
      return output(await gp.transactions.get(requiredArg(0, "<TRN_id>")));

    case "txn:capture":
      return output(await gp.transactions.capture(requiredArg(0, "<TRN_id>"), amountOpts()));

    case "txn:refund":
      return output(await gp.transactions.refund(requiredArg(0, "<TRN_id>"), amountOpts()));

    case "txn:reverse":
      return output(await gp.transactions.reverse(requiredArg(0, "<TRN_id>")));

    default:
      console.error(`Unknown command: ${COMMAND}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

function amountOpts() {
  if (flags.amount === undefined) return {};
  return { amount: flags.amount, currency: required(flags.currency, "--currency (with --amount)") };
}

function required(value, name) {
  if (value === undefined || value === true) {
    throw new GpConfigError(`${name} is required`);
  }
  return value;
}

function requiredArg(index, name) {
  const value = positional[index];
  if (!value) throw new GpConfigError(`${name} is required`);
  return value;
}

/**
 * A webhook sink. Watching real callbacks arrive -- and noticing that they can
 * land before the payer's browser gets back to your return_url -- is the
 * fastest way to internalise why the webhook is the source of truth.
 */
function listen(port) {
  let count = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      count += 1;
      const raw = Buffer.concat(chunks).toString("utf8");
      console.log(`\n--- #${count} ${req.method} ${req.url} at ${new Date().toISOString()} ---`);
      const signature = req.headers["x-gp-signature"];
      if (signature) console.log(`x-gp-signature: ${signature}`);
      try {
        console.log(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        console.log(raw);
      }
      // Answer 200 fast. A slow webhook endpoint gets retried, and a retried
      // webhook you process twice is a double-fulfilled order.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"received":true}');
    });
  });
  server.listen(port, () => {
    console.log(`Listening for GP webhooks on http://127.0.0.1:${port}`);
    console.log(`Pass it to a link:  --status-url http://127.0.0.1:${port}/webhook`);
    console.log(`Ctrl-C to stop.`);
  });
}

main().catch((error) => {
  if (error instanceof GpApiError) {
    if (error.declined) {
      console.error(`\nDECLINED -- ${error.description}`);
      console.error(`This is the issuer's answer, not an integration fault. Do not retry the same card.`);
    } else {
      console.error(`\n${error.toString()}`);
    }
    if (error.requestId) console.error(`request id: ${error.requestId}`);
    console.error(`retryable: ${error.retryable}`);
  } else if (error instanceof GpConfigError) {
    console.error(`\n${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
