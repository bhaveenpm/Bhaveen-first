/**
 * An offline emulator of the GP API surface this project uses.
 *
 * Why it exists: you cannot always reach apis.sandbox.globalpay.com (locked-down
 * networks, CI, a plane, or before your credentials are provisioned), and an
 * integration you can only exercise against someone else's uptime is an
 * integration you cannot write tests for.
 *
 * What it is: a faithful emulation of the *contract* -- the auth handshake, the
 * required fields, the error envelope, idempotent replay, the link lifecycle,
 * and the outbound status webhook. It deliberately reproduces the API's strict
 * behaviours (minor-unit string amounts, header versioning, 401 shape) so that
 * code which passes here is code that has a chance of passing there.
 *
 * What it is NOT: a payment processor. No card is validated beyond Luhn, no
 * money moves, and the risk/3DS/settlement layers do not exist here.
 *
 *   node mock/server.js            # listens on :8088
 *   GP_MOCK_PORT=9000 node mock/server.js
 */

import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const PORT = Number(process.env.GP_MOCK_PORT || 8088);
const HOST = process.env.GP_MOCK_HOST || "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const state = {
  tokens: new Map(),      // token -> { appId, expiresAt }
  links: new Map(),       // LNK_x -> link
  transactions: new Map(),// TRN_x -> transaction
  idempotency: new Map(), // key -> { status, body }
};

/** A card that always declines, so failure paths are testable too. */
const DECLINE_CARDS = new Set(["4000120000001154"]);

/**
 * Which currencies a merchant can transact in is a property of how the ACCOUNT
 * was provisioned by the acquirer, not of the API. This trips people up: the
 * request is well-formed, the code is a real ISO 4217 code, and it still fails,
 * because this merchant was never set up to settle in it.
 */
const SUPPORTED_CURRENCIES = new Set(["GBP", "EUR", "USD", "CAD", "JPY"]);

const id = (prefix) => `${prefix}${randomBytes(12).toString("hex").toUpperCase()}`;
const nowIso = () => new Date().toISOString();

function fail(res, status, errorCode, description, detailedErrorCode) {
  send(res, status, {
    error_code: errorCode,
    detailed_error_code: detailedErrorCode ?? String(40000 + status),
    detailed_error_description: description,
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "x-gp-request-id": randomUUID(),
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new SyntaxError("invalid JSON body"));
      }
    });
  });
}

function requireAuth(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const record = state.tokens.get(token);
  if (!record) {
    fail(res, 401, "NOT_AUTHENTICATED", "Invalid or expired access token", "40001");
    return null;
  }
  if (Date.now() > record.expiresAt) {
    state.tokens.delete(token);
    fail(res, 401, "NOT_AUTHENTICATED", "Access token expired", "40002");
    return null;
  }
  return record;
}

/** Amounts must be integer strings of minor units -- "10.00" is a bug, not a courtesy. */
function badAmount(amount) {
  return typeof amount !== "string" || !/^\d+$/.test(amount);
}

function isLuhnValid(number) {
  const digits = String(number).replace(/\D/g, "");
  if (digits.length < 12) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Fires the merchant's status_url webhook. Real GP signs these; the point
 * reproduced here is the shape and the asynchrony -- the webhook is a separate
 * inbound HTTP request that can arrive before, after, or instead of the payer
 * returning to your return_url.
 */
async function fireWebhook(link, transaction) {
  const url = link.notifications?.status_url;
  if (!url) return;
  const payload = {
    id: link.id,
    status: link.status,
    reference: link.reference,
    transactions: [
      { id: transaction.id, status: transaction.status, amount: transaction.amount, currency: transaction.currency },
    ],
    time_created: nowIso(),
  };
  const body = JSON.stringify(payload);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Real GP uses its own signing scheme; this stands in for "verify me".
        "x-gp-signature": createHash("sha256").update(body).digest("hex"),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    console.log(`  -> webhook delivered to ${url}`);
  } catch (error) {
    console.log(`  -> webhook to ${url} failed: ${error.message}`);
  }
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// --- auth -------------------------------------------------------------------
route("POST", /^\/ucp\/accesstoken$/, async (req, res, _m, body) => {
  if (!body.app_id) return fail(res, 400, "MANDATORY_DATA_MISSING", "app_id is required", "40005");
  if (!body.nonce) return fail(res, 400, "MANDATORY_DATA_MISSING", "nonce is required", "40005");
  if (!/^[a-f0-9]{128}$/.test(String(body.secret || ""))) {
    return fail(res, 400, "INVALID_REQUEST_DATA", "secret must be sha512(nonce + app_key) as lowercase hex", "40006");
  }
  if (body.grant_type !== "client_credentials") {
    return fail(res, 400, "INVALID_REQUEST_DATA", "grant_type must be client_credentials", "40006");
  }

  const token = randomBytes(24).toString("hex");
  const secondsToExpire = Number(body.seconds_to_expire) || 1800;
  state.tokens.set(token, { appId: body.app_id, expiresAt: Date.now() + secondsToExpire * 1000 });

  send(res, 200, {
    id: id("TKN_"),
    type: "Bearer",
    token,
    app_id: body.app_id,
    app_name: "gp-api-lab-mock",
    time_created: nowIso(),
    seconds_to_expire: secondsToExpire,
    scope: {
      merchant_id: "MER_MOCK_0001",
      merchant_name: "GP API Lab (mock)",
      accounts: [
        { id: "TRA_MOCK_0001", name: "transaction_processing", permissions: ["TRN_POST_Authorize", "LNK_POST_Create"] },
        { id: "TKA_MOCK_0001", name: "tokenization", permissions: ["PMT_POST_Create"] },
      ],
    },
  });
});

// --- pay by link ------------------------------------------------------------
route("POST", /^\/ucp\/links$/, async (req, res, _m, body) => {
  if (!requireAuth(req, res)) return;

  for (const field of ["account_name", "type", "usage_mode", "reference"]) {
    if (!body[field]) return fail(res, 400, "MANDATORY_DATA_MISSING", `${field} is required`, "40005");
  }
  const txn = body.transactions || {};
  if (badAmount(txn.amount)) {
    return fail(res, 400, "INVALID_REQUEST_DATA", "transactions.amount must be a string of minor units, e.g. \"1000\"", "40006");
  }
  if (!/^[A-Z]{3}$/.test(String(txn.currency || ""))) {
    return fail(res, 400, "INVALID_REQUEST_DATA", "transactions.currency must be an ISO 4217 code", "40006");
  }
  if (!SUPPORTED_CURRENCIES.has(txn.currency)) {
    return fail(res, 400, "INVALID_REQUEST_DATA",
      `Currency ${txn.currency} is not enabled on account ${body.account_name}. Enabled: ${[...SUPPORTED_CURRENCIES].join(", ")}`, "40007");
  }
  if (body.usage_mode === "SINGLE" && String(body.usage_limit ?? "1") !== "1") {
    return fail(res, 400, "INVALID_REQUEST_DATA", "usage_limit must be 1 when usage_mode is SINGLE", "40006");
  }

  const linkId = id("LNK_");
  const link = {
    id: linkId,
    status: body.status || "ACTIVE",
    account_name: body.account_name,
    type: body.type,
    usage_mode: body.usage_mode,
    usage_limit: String(body.usage_limit ?? "1"),
    usage_count: "0",
    reference: body.reference,
    name: body.name,
    description: body.description,
    shippable: body.shippable ?? "NO",
    shipping_amount: body.shipping_amount,
    expiration_date: body.expiration_date,
    country: body.country,
    transactions: { amount: txn.amount, currency: txn.currency, allowed_payment_methods: txn.allowed_payment_methods ?? ["CARD"] },
    notifications: body.notifications,
    // The payer-facing hosted page. Real GP returns a pay.globalpay.com URL.
    // Built from the request's own host so the link is reachable at whatever
    // address this server is actually listening on (tests use port 0).
    url: `${originOf(req)}/pay/${linkId}`,
    time_created: nowIso(),
  };
  state.links.set(linkId, link);
  send(res, 200, link);
});

route("GET", /^\/ucp\/links\/([^/]+)$/, async (req, res, m) => {
  if (!requireAuth(req, res)) return;
  const link = state.links.get(m[1]);
  if (!link) return fail(res, 404, "RESOURCE_NOT_FOUND", `Link ${m[1]} not found`, "40008");
  send(res, 200, link);
});

route("PATCH", /^\/ucp\/links\/([^/]+)$/, async (req, res, m, body) => {
  if (!requireAuth(req, res)) return;
  const link = state.links.get(m[1]);
  if (!link) return fail(res, 404, "RESOURCE_NOT_FOUND", `Link ${m[1]} not found`, "40008");
  if (link.status === "PAID") {
    return fail(res, 400, "INVALID_TRANSACTION_ACTION", "A PAID link cannot be edited", "40010");
  }
  if (body.transactions?.amount !== undefined) {
    if (badAmount(body.transactions.amount)) {
      return fail(res, 400, "INVALID_REQUEST_DATA", "transactions.amount must be a string of minor units", "40006");
    }
    link.transactions.amount = body.transactions.amount;
  }
  for (const field of ["status", "name", "description", "expiration_date", "usage_mode", "usage_limit"]) {
    if (body[field] !== undefined) link[field] = body[field];
  }
  send(res, 200, link);
});

route("GET", /^\/ucp\/links$/, async (req, res, _m, _b, url) => {
  if (!requireAuth(req, res)) return;
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("page_size") || 20);
  const status = url.searchParams.get("status");

  const reference = url.searchParams.get("reference");
  let all = [...state.links.values()].sort((a, b) => b.time_created.localeCompare(a.time_created));
  if (status) all = all.filter((l) => l.status === status);
  if (reference) all = all.filter((l) => l.reference === reference);

  const start = (page - 1) * pageSize;
  send(res, 200, {
    total_record_count: String(all.length),
    page_size: String(pageSize),
    page: String(page),
    order: "DESC",
    links: all.slice(start, start + pageSize),
  });
});

// --- transactions -----------------------------------------------------------
route("POST", /^\/ucp\/transactions$/, async (req, res, _m, body) => {
  if (!requireAuth(req, res)) return;
  if (badAmount(body.amount)) {
    return fail(res, 400, "INVALID_REQUEST_DATA", "amount must be a string of minor units", "40006");
  }
  if (!body.account_name) return fail(res, 400, "MANDATORY_DATA_MISSING", "account_name is required", "40005");
  if (!SUPPORTED_CURRENCIES.has(body.currency)) {
    return fail(res, 400, "INVALID_REQUEST_DATA",
      `Currency ${body.currency} is not enabled on account ${body.account_name}. Enabled: ${[...SUPPORTED_CURRENCIES].join(", ")}`, "40007");
  }

  const card = body.payment_method?.card;
  if (card && !isLuhnValid(card.number)) {
    return fail(res, 400, "INVALID_REQUEST_DATA", "payment_method.card.number failed Luhn check", "40006");
  }

  const declined = card && DECLINE_CARDS.has(String(card.number));
  const captureMode = body.capture_mode || "AUTO";
  const transaction = {
    id: id("TRN_"),
    time_created: nowIso(),
    type: body.type || "SALE",
    status: declined ? "DECLINED" : captureMode === "AUTO" ? "CAPTURED" : "PREAUTHORIZED",
    channel: body.channel,
    capture_mode: captureMode,
    amount: body.amount,
    currency: body.currency,
    country: body.country,
    reference: body.reference,
    // GP returns a result code plus a message; "00" is approved.
    action: { id: id("ACT_"), type: "AUTHORIZE", time_created: nowIso(), result_code: declined ? "DECLINED" : "SUCCESS" },
    payment_method: {
      result: declined ? "51" : "00",
      message: declined ? "DECLINED - INSUFFICIENT FUNDS" : "APPROVED",
      entry_mode: body.payment_method?.entry_mode,
      card: card ? { masked_number_last4: `****${String(card.number).slice(-4)}`, brand: brandOf(card.number) } : undefined,
    },
  };
  state.transactions.set(transaction.id, transaction);

  // A decline is not a malformed request: GP signals it with an HTTP error
  // status AND an error envelope, while still returning the transaction that
  // was created. Clients that only look at the status code cannot tell a
  // declined card from a broken integration.
  if (declined) {
    return send(res, 400, {
      error_code: "DECLINED",
      detailed_error_code: "50013",
      detailed_error_description: "The card was declined by the issuer",
      ...transaction,
    });
  }
  send(res, 200, transaction);
});

route("GET", /^\/ucp\/transactions$/, async (req, res, _m, _b, url) => {
  if (!requireAuth(req, res)) return;
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("page_size") || 20);
  const reference = url.searchParams.get("reference");
  const status = url.searchParams.get("status");

  let all = [...state.transactions.values()]
    .sort((a, b) => b.time_created.localeCompare(a.time_created));
  if (reference) all = all.filter((t) => t.reference === reference);
  if (status) all = all.filter((t) => t.status === status);

  const start = (page - 1) * pageSize;
  send(res, 200, {
    total_record_count: String(all.length),
    page_size: String(pageSize),
    page: String(page),
    order: "DESC",
    transactions: all.slice(start, start + pageSize),
  });
});

route("GET", /^\/ucp\/transactions\/([^/]+)$/, async (req, res, m) => {
  if (!requireAuth(req, res)) return;
  const txn = state.transactions.get(m[1]);
  if (!txn) return fail(res, 404, "RESOURCE_NOT_FOUND", `Transaction ${m[1]} not found`, "40008");
  send(res, 200, txn);
});

for (const [action, nextStatus] of [["capture", "CAPTURED"], ["refund", "REFUNDED"], ["reversal", "REVERSED"]]) {
  route("POST", new RegExp(`^/ucp/transactions/([^/]+)/${action}$`), async (req, res, m, body) => {
    if (!requireAuth(req, res)) return;
    const txn = state.transactions.get(m[1]);
    if (!txn) return fail(res, 404, "RESOURCE_NOT_FOUND", `Transaction ${m[1]} not found`, "40008");

    if (action === "capture" && txn.status !== "PREAUTHORIZED") {
      return fail(res, 400, "INVALID_TRANSACTION_ACTION", `Cannot capture a transaction in status ${txn.status}`, "40010");
    }
    if (action === "reversal" && txn.status === "CAPTURED" && txn.capture_mode !== "AUTO") {
      return fail(res, 400, "INVALID_TRANSACTION_ACTION", "Captured transactions must be refunded, not reversed", "40010");
    }
    if (action === "refund" && txn.status === "PREAUTHORIZED") {
      return fail(res, 400, "INVALID_TRANSACTION_ACTION", "Cannot refund an uncaptured authorisation; reverse it instead", "40010");
    }
    if (body.amount !== undefined && badAmount(body.amount)) {
      return fail(res, 400, "INVALID_REQUEST_DATA", "amount must be a string of minor units", "40006");
    }

    txn.status = nextStatus;
    txn.action = { id: id("ACT_"), type: action.toUpperCase(), time_created: nowIso(), result_code: "SUCCESS" };
    if (body.amount !== undefined) txn.amount = body.amount;
    send(res, 200, txn);
  });
}

// --- hosted payment page (stands in for pay.globalpay.com) -------------------
route("GET", /^\/pay\/([^/]+)$/, async (req, res, m) => {
  const link = state.links.get(m[1]);
  if (!link) {
    res.writeHead(404, { "Content-Type": "text/html" });
    return res.end("<h1>Link not found</h1>");
  }
  const payable = link.status === "ACTIVE";
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${link.name ?? "Payment"}</title>
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f4f5f7;color:#111}
.card{background:#fff;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.12);max-width:380px;width:100%}
h1{font-size:18px;margin:0 0 4px}.amt{font-size:32px;font-weight:600;margin:16px 0}
button{width:100%;padding:12px;font-size:16px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}
.muted{color:#666;font-size:13px}</style>
<div class="card"><h1>${escapeHtml(link.name ?? "Payment")}</h1>
<div class="muted">${escapeHtml(link.description ?? "")}</div>
<div class="amt">${(Number(link.transactions.amount) / 100).toFixed(2)} ${link.transactions.currency}</div>
<div class="muted">Ref ${escapeHtml(link.reference)} &middot; status ${link.status}</div>
${payable
  ? `<form method="POST" action="/pay/${link.id}"><button type="submit">Pay now (simulated)</button></form>`
  : `<p class="muted">This link is ${link.status} and can no longer be paid.</p>`}
<p class="muted">Mock hosted page. No real payment is taken.</p></div>`);
});

route("POST", /^\/pay\/([^/]+)$/, async (req, res, m) => {
  const link = state.links.get(m[1]);
  if (!link) return fail(res, 404, "RESOURCE_NOT_FOUND", "Link not found", "40008");
  if (link.status !== "ACTIVE") {
    return fail(res, 400, "INVALID_TRANSACTION_ACTION", `Link is ${link.status}`, "40010");
  }

  const transaction = {
    id: id("TRN_"),
    time_created: nowIso(),
    type: "SALE",
    status: "CAPTURED",
    amount: link.transactions.amount,
    currency: link.transactions.currency,
    reference: link.reference,
    link_id: link.id,
    payment_method: { result: "00", message: "APPROVED" },
  };
  state.transactions.set(transaction.id, transaction);

  link.usage_count = String(Number(link.usage_count) + 1);
  if (link.usage_mode === "SINGLE" || Number(link.usage_count) >= Number(link.usage_limit)) {
    link.status = "PAID";
  }
  console.log(`  paid ${link.id} -> ${transaction.id}`);

  // Deliberately not awaited before responding: the payer's browser is
  // redirected immediately while the webhook races in the background. That
  // race is the whole reason return_url is not proof of payment.
  fireWebhook(link, transaction);

  const returnUrl = link.notifications?.return_url;
  if (returnUrl) {
    res.writeHead(302, { Location: returnUrl });
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:40px">
<h1>Paid</h1><p>Transaction <code>${transaction.id}</code> for link <code>${link.id}</code>.</p></body>`);
});

function originOf(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  return `http://${host}`;
}

function brandOf(number) {
  const n = String(number);
  if (n.startsWith("4")) return "VISA";
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return "MASTERCARD";
  if (/^3[47]/.test(n)) return "AMEX";
  return "UNKNOWN";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, originOf(req));

  let body = {};
  if (req.method === "POST" || req.method === "PATCH") {
    try {
      body = await readBody(req);
    } catch {
      return fail(res, 400, "INVALID_REQUEST_DATA", "Request body is not valid JSON", "40006");
    }
  }

  for (const { method, pattern, handler } of routes) {
    if (req.method !== method) continue;
    const match = pattern.exec(url.pathname);
    if (!match) continue;

    // Idempotent replay: the same key returns the first response, which is the
    // property that makes a client-side retry safe.
    const key = req.headers["x-gp-idempotency"];
    if (key && method === "POST") {
      const cached = state.idempotency.get(key);
      if (cached) {
        res.writeHead(cached.status, { "Content-Type": "application/json", "x-gp-idempotency-replayed": "true" });
        return res.end(JSON.stringify(cached.body, null, 2));
      }
      const originalSend = res.writeHead.bind(res);
      let status = 200;
      res.writeHead = (code, headers) => { status = code; return originalSend(code, headers); };
      const originalEnd = res.end.bind(res);
      res.end = (chunk, ...rest) => {
        if (chunk && status < 400) {
          try { state.idempotency.set(key, { status, body: JSON.parse(chunk) }); } catch { /* html */ }
        }
        return originalEnd(chunk, ...rest);
      };
    }

    try {
      return await handler(req, res, match, body, url);
    } catch (error) {
      console.error(error);
      return fail(res, 500, "SYSTEM_ERROR", error.message, "50001");
    }
  }

  fail(res, 404, "RESOURCE_NOT_FOUND", `No route for ${req.method} ${url.pathname}`, "40008");
});

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  server.listen(PORT, HOST, () => {
    console.log(`GP API mock listening on ${BASE}/ucp`);
    console.log(`Point the client at it with GP_ENVIRONMENT=mock`);
  });
}
