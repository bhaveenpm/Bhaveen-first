import { readFileSync } from "node:fs";
import { GpConfigError } from "./errors.js";

/**
 * The four GP API hosts are not interchangeable. Credentials are issued per
 * environment AND per region: a sandbox app_id will not authenticate against
 * production, and an EU-provisioned merchant will not resolve on the US host.
 * "Invalid credentials" during an integration is most often a wrong host.
 */
export const ENVIRONMENTS = {
  sandbox: "https://apis.sandbox.globalpay.com/ucp",
  production: "https://apis.globalpay.com/ucp",
  "sandbox-eu": "https://apis.sandbox.eu.globalpay.com/ucp",
  "production-eu": "https://apis.eu.globalpay.com/ucp",
};

/** The API is versioned by header, not by URL path. See notes/01-api-teardown.md. */
export const GP_API_VERSION = "2021-03-22";

/** Minimal .env reader so this project stays dependency-free. */
export function loadDotEnv(path = ".env") {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveConfig(overrides = {}) {
  const file = loadDotEnv();
  const env = { ...file, ...process.env };

  const environment = overrides.environment || env.GP_ENVIRONMENT || "sandbox";
  const mockPort = Number(overrides.mockPort || env.GP_MOCK_PORT || 8088);

  let baseUrl = overrides.baseUrl;
  if (!baseUrl) {
    if (environment === "mock") {
      baseUrl = `http://127.0.0.1:${mockPort}/ucp`;
    } else if (ENVIRONMENTS[environment]) {
      baseUrl = ENVIRONMENTS[environment];
    } else {
      throw new GpConfigError(
        `Unknown GP_ENVIRONMENT "${environment}". Expected one of: ${Object.keys(ENVIRONMENTS).join(", ")}, mock`,
      );
    }
  }

  const config = {
    appId: overrides.appId || env.GP_APP_ID || "",
    appKey: overrides.appKey || env.GP_APP_KEY || "",
    environment,
    baseUrl,
    mockPort,
    channel: overrides.channel || env.GP_CHANNEL || "CNP",
    country: overrides.country || env.GP_COUNTRY || "GB",
    accountName: overrides.accountName || env.GP_ACCOUNT_NAME || "",
  };

  // The mock accepts any credentials; it exists so the flow can be exercised
  // before real ones are provisioned.
  if (environment === "mock") {
    config.appId ||= "mock_app_id";
    config.appKey ||= "mock_app_key";
  }

  if (!config.appId || !config.appKey) {
    throw new GpConfigError(
      "GP_APP_ID and GP_APP_KEY are required. Copy .env.example to .env and fill them in,\n" +
        "or run against the offline emulator with GP_ENVIRONMENT=mock (npm run mock).",
    );
  }

  return config;
}
