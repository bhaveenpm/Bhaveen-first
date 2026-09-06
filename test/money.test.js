import { test } from "node:test";
import assert from "node:assert/strict";
import { toMinorUnits, toMajorUnits, currencyExponent } from "../src/money.js";

test("two-decimal currencies round-trip", () => {
  assert.equal(toMinorUnits("24.99", "GBP"), "2499");
  assert.equal(toMinorUnits("0.05", "GBP"), "5");
  assert.equal(toMajorUnits("2499", "GBP"), "24.99");
  assert.equal(toMajorUnits("5", "GBP"), "0.05");
});

test("a bare integer is major units, not minor -- 10 GBP is 1000, not 10", () => {
  assert.equal(toMinorUnits("10", "GBP"), "1000");
  assert.equal(toMinorUnits(10, "GBP"), "1000");
});

test("zero-decimal currencies are not multiplied", () => {
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(toMinorUnits("1000", "JPY"), "1000");
  assert.equal(toMajorUnits("1000", "JPY"), "1000");
});

test("three-decimal currencies keep their third digit", () => {
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(toMinorUnits("1.500", "KWD"), "1500");
  assert.equal(toMajorUnits("1500", "KWD"), "1.500");
});

test("excess precision is rejected rather than silently rounded", () => {
  assert.throws(() => toMinorUnits("10.005", "GBP"), RangeError);
  assert.throws(() => toMinorUnits("10.5", "JPY"), RangeError);
});

test("garbage in is rejected", () => {
  assert.throws(() => toMinorUnits("ten", "GBP"), TypeError);
  assert.throws(() => currencyExponent("GB"), TypeError);
});
