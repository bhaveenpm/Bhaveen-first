/**
 * Checks everything needed to make a real call to the GP API, and says exactly
 * what to fix. Run this first, before anything else:
 *
 *   npm run doctor
 *   npm run doctor -- --env mock      # check the offline emulator instead
 */

import { readFileSync } from "node:fs";
import { ENVIRONMENTS, loadDotEnv } from "../src/config.js";
import { GpClient } from "../src/client.js";

const args = process.argv.slice(2);
const envFlag = args.includes("--env") ? args[args.indexOf("--env") + 1] : undefined;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m, fix) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (fix) console.log(`     \x1b[2m→ ${fix}\x1b[0m`);
  failures += 1;
};
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

let failures = 0;

console.log("\n\x1b[1mGP API Lab — preflight\x1b[0m\n");

// 1. Node -------------------------------------------------------------------
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} is too old`, "Install Node 20 or newer from nodejs.org");

// 2. Credentials ------------------------------------------------------------
const file = loadDotEnv();
const env = { ...file, ...process.env };
const environment = envFlag || env.GP_ENVIRONMENT || "sandbox";
const appId = env.GP_APP_ID || "";
const appKey = env.GP_APP_KEY || "";

let hasEnvFile = true;
try { readFileSync(".env", "utf8"); } catch { hasEnvFile = false; }

if (environment !== "mock") {
  if (!hasEnvFile) {
    bad("No .env file", "cp .env.example .env   then paste your credentials into it");
  } else {
    ok(".env found");
  }

  if (!appId) {
    bad("GP_APP_ID is empty", "Get it from https://developer.globalpayments.com → sign up → App Credentials");
  } else {
    ok(`GP_APP_ID set (${appId.slice(0, 6)}…, ${appId.length} chars)`);
  }

  if (!appKey) {
    bad("GP_APP_KEY is empty", "It sits next to the App ID on the same credentials page");
  } else if (appKey.length < 8) {
    bad(`GP_APP_KEY looks too short (${appKey.length} chars)`, "Check you copied the whole value");
  } else {
    ok(`GP_APP_KEY set (${appKey.length} chars, value not shown)`);
  }

  if (appId && appKey && appId === appKey) {
    bad("GP_APP_ID and GP_APP_KEY are identical", "You've pasted the same value twice");
  }
}

// 3. Environment ------------------------------------------------------------
if (environment === "mock" || ENVIRONMENTS[environment]) {
  const host = environment === "mock"
    ? "the offline emulator, no credentials needed"
    : ENVIRONMENTS[environment];
  ok(`Environment '${environment}' → ${host}`);
  if (environment.startsWith("production")) {
    warn("This is PRODUCTION. Real cards, real money. Use 'sandbox' to experiment.");
  }
} else {
  bad(`Unknown environment '${environment}'`,
      `Use one of: ${Object.keys(ENVIRONMENTS).join(", ")}, mock`);
}

// 4. Can we actually reach it, and does auth work? --------------------------
if (failures === 0) {
  process.stdout.write("  … contacting the API");
  const clearLine = () => process.stdout.write("\r" + " ".repeat(30) + "\r");
  try {
    const client = new GpClient({ environment, timeoutMs: 15000 });
    await client.accessToken();
    const scope = client.scope ?? {};
    clearLine();
    ok(`Authenticated as ${scope.merchant_name ?? "?"} (${scope.merchant_id ?? "?"})`);
    for (const account of scope.accounts ?? []) {
      console.log(`     ${account.id.padEnd(18)} ${account.name}`);
    }
  } catch (error) {
    clearLine();
    if (error.name === "AbortError" || error.isNetworkError) {
      bad("Could not reach the API (network or timeout)",
          environment === "mock"
            ? "Start the emulator first: npm run mock"
            : "Check your internet connection, VPN, or corporate proxy");
    } else if (error.status === 400 || error.status === 401) {
      bad(`The API rejected the credentials (${error.status} ${error.errorCode ?? ""})`,
          "Check the App ID and App Key are from the SANDBOX tab, not production");
    } else {
      bad(`Unexpected: ${error.message}`);
    }
  }
}

// 5. Verdict ----------------------------------------------------------------
if (failures === 0) {
  console.log(`\n\x1b[32mReady.\x1b[0m Try:\n`);
  console.log(`  npm run gp -- link:create --amount 1.00 --currency GBP --reference FIRST-1 --debug\n`);
} else {
  console.log(`\n${failures} thing(s) to fix. Nothing else will work until they're sorted.`);
  console.log(`No credentials yet? Everything runs offline with:  npm run demo\n`);
  process.exitCode = 1;
}
