/**
 * A local web UI for the GP API.
 *
 *   npm run ui                 # against the offline emulator, no credentials
 *   GP_ENVIRONMENT=sandbox npm run ui   # against the real sandbox
 *
 * The browser never sees your app_key. This server holds the credentials, does
 * the auth handshake, and proxies calls -- which is also how you would build a
 * real integration, because the GP API is a server-to-server API and any design
 * that puts the key in a browser has already lost.
 *
 * Everything the server sends to GP and gets back is streamed to the page, so
 * you can watch the wire while you click.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createGp, GpApiError, formatAmount } from "../src/index.js";
import { server as mockApi } from "../mock/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UI_PORT || 3000);
const ENVIRONMENT = process.env.GP_ENVIRONMENT || "mock";

const wire = [];      // recent request/response pairs
const webhooks = [];  // callbacks GP has delivered to us
let clients = [];     // connected browsers (server-sent events)

function broadcast(type, data) {
  const frame = `data: ${JSON.stringify({ type, data })}\n\n`;
  clients = clients.filter((res) => {
    try { res.write(frame); return true; } catch { return false; }
  });
}

function recordWire(record) {
  const entry = { ...record, at: new Date().toISOString(), seq: wire.length + 1 };
  wire.push(entry);
  if (wire.length > 200) wire.shift();
  broadcast("wire", entry);
}

// If we're pointed at the emulator, run it in-process so `npm run ui` is one
// command rather than two terminals.
let mockPort = null;
if (ENVIRONMENT === "mock") {
  await new Promise((r) => mockApi.listen(0, "127.0.0.1", r));
  mockPort = mockApi.address().port;
}

const gp = createGp({
  environment: ENVIRONMENT,
  ...(mockPort ? { baseUrl: `http://127.0.0.1:${mockPort}/ucp` } : {}),
  onWire: recordWire,
});

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("error", reject);
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new SyntaxError("bad JSON")); }
    });
  });
}

/** Turns any failure into something the page can display without guessing. */
function sendError(res, error) {
  if (error instanceof GpApiError) {
    return json(res, 200, {
      ok: false,
      kind: error.declined ? "declined" : "api",
      status: error.status,
      errorCode: error.errorCode,
      detailedErrorCode: error.detailedErrorCode,
      message: error.description || error.message,
      retryable: error.retryable,
    });
  }
  return json(res, 200, {
    ok: false,
    kind: "client",
    message: error.message,
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  try {
    // --- the page -----------------------------------------------------------
    if (path === "/" && req.method === "GET") {
      const html = await readFile(join(HERE, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // --- live feed ----------------------------------------------------------
    if (path === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.push(res);
      req.on("close", () => { clients = clients.filter((c) => c !== res); });
      return;
    }

    // --- who are we ---------------------------------------------------------
    if (path === "/api/session" && req.method === "GET") {
      try {
        await gp.client.accessToken();
        return json(res, 200, {
          ok: true,
          environment: ENVIRONMENT,
          baseUrl: gp.client.config.baseUrl,
          scope: gp.client.scope,
          accountName: await gp.client.accountName(),
          wire,
          webhooks,
        });
      } catch (error) {
        return sendError(res, error);
      }
    }

    // --- pay by link --------------------------------------------------------
    if (path === "/api/links" && req.method === "POST") {
      const input = await readJson(req);
      try {
        const link = await gp.links.create({
          ...input,
          // Point the link's webhook back at this server so the page can show
          // the callback arriving.
          statusUrl: `http://127.0.0.1:${PORT}/webhook`,
        });
        return json(res, 200, { ok: true, link });
      } catch (error) {
        return sendError(res, error);
      }
    }

    if (path === "/api/links" && req.method === "GET") {
      try {
        const page = await gp.links.search({ pageSize: 50 });
        return json(res, 200, { ok: true, page });
      } catch (error) {
        return sendError(res, error);
      }
    }

    const deactivate = /^\/api\/links\/([^/]+)\/deactivate$/.exec(path);
    if (deactivate && req.method === "POST") {
      try {
        return json(res, 200, { ok: true, link: await gp.links.deactivate(deactivate[1]) });
      } catch (error) {
        return sendError(res, error);
      }
    }

    // --- transactions -------------------------------------------------------
    if (path === "/api/sale" && req.method === "POST") {
      const input = await readJson(req);
      try {
        const [expiryMonth, expiryYear] = String(input.exp || "12/2027").split("/");
        const txn = await gp.transactions.sale({
          amount: input.amount,
          currency: input.currency,
          reference: input.reference,
          card: { number: String(input.card).replace(/\s/g, ""), expiryMonth, expiryYear, cvv: input.cvv },
        });
        return json(res, 200, { ok: true, transaction: txn });
      } catch (error) {
        return sendError(res, error);
      }
    }

    const refund = /^\/api\/transactions\/([^/]+)\/refund$/.exec(path);
    if (refund && req.method === "POST") {
      try {
        return json(res, 200, { ok: true, transaction: await gp.transactions.refund(refund[1]) });
      } catch (error) {
        return sendError(res, error);
      }
    }

    // --- the webhook sink ---------------------------------------------------
    if (path === "/webhook" && req.method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const event = {
        at: new Date().toISOString(),
        signature: req.headers["x-gp-signature"] ?? null,
        body,
      };
      webhooks.unshift(event);
      if (webhooks.length > 50) webhooks.pop();
      broadcast("webhook", event);
      // Answer fast: a slow webhook endpoint gets retried.
      return json(res, 200, { received: true });
    }

    json(res, 404, { ok: false, message: `No route for ${req.method} ${path}` });
  } catch (error) {
    json(res, 500, { ok: false, message: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  GP API Lab UI   http://127.0.0.1:${PORT}`);
  console.log(`  environment     ${ENVIRONMENT}${mockPort ? ` (emulator on :${mockPort})` : ""}`);
  if (ENVIRONMENT === "mock") {
    console.log(`  no credentials needed — this is the offline emulator\n`);
  } else {
    console.log(`  using GP_APP_ID from your .env — the browser never sees the key\n`);
  }
});

export { formatAmount };
