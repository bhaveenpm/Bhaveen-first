/**
 * Amounts on the GP API are integers in the currency's *minor* units, sent as
 * strings: "1000" in GBP is 10.00, but "1000" in JPY is 1000 yen and "1000" in
 * KWD is 1.000 dinar. The exponent is a property of the currency, not the API,
 * so the API cannot validate it for you -- send 10.00 GBP as "10" and you have
 * silently charged 10 pence. This module makes that conversion explicit.
 *
 * Exponents follow ISO 4217. Only the non-2 cases need listing.
 */

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);

const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(currency) {
  const code = String(currency || "").toUpperCase();
  if (code.length !== 3) throw new TypeError(`Not an ISO 4217 code: ${currency}`);
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * "10.00" GBP -> "1000".  Rejects more precision than the currency allows
 * rather than rounding it away, because a rounded amount is a wrong amount.
 */
export function toMinorUnits(major, currency) {
  const exponent = currencyExponent(currency);
  const text = typeof major === "number" ? major.toFixed(exponent) : String(major).trim();

  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new TypeError(`Not a decimal amount: ${major}`);
  const [, sign, whole, fraction = ""] = match;

  if (fraction.length > exponent) {
    throw new RangeError(
      `${major} has ${fraction.length} decimal places but ${currency} allows ${exponent}`,
    );
  }

  const padded = fraction.padEnd(exponent, "0");
  const minor = `${sign}${whole}${padded}`.replace(/^(-?)0+(?=\d)/, "$1");
  return minor;
}

/** "1000" GBP -> "10.00". The inverse, for rendering API responses. */
export function toMajorUnits(minor, currency) {
  const exponent = currencyExponent(currency);
  const text = String(minor).trim();
  if (!/^-?\d+$/.test(text)) throw new TypeError(`Not an integer minor amount: ${minor}`);
  if (exponent === 0) return text;

  const negative = text.startsWith("-");
  const digits = (negative ? text.slice(1) : text).padStart(exponent + 1, "0");
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatAmount(minor, currency) {
  return `${toMajorUnits(minor, currency)} ${String(currency).toUpperCase()}`;
}
