/**
 * Browser smoke test: drives the real UI through empty -> configuring -> streaming ->
 * complete, then exercises the differentiator — filling a [SPECIFY: ...] placeholder,
 * which must substitute client-side with no second model call.
 *
 *   npx playwright install chromium      # once
 *   npm run build && npx next start -p 3114 &
 *   npm run test:e2e
 *
 * BASE_URL and PW_CHROMIUM (an explicit browser path) are both overridable.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3114";
const OUT = process.env.SHOT_DIR ?? "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/01-empty.png` });

await page.getByRole("button", { name: "Ceramic mug" }).click();
await page.waitForSelector("#aw-name", { timeout: 15000 });
await page.screenshot({ path: `${OUT}/02-configuring.png` });

await page.getByRole("radio", { name: "Warm" }).click();
await page.getByRole("button", { name: "Generate listing" }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/03-streaming.png` });

await page.waitForSelector("text=Copy all as Shopify fields", { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/04-complete.png`, fullPage: true });

// The differentiator: fill a [SPECIFY:] placeholder with no model call.
const before = await page.locator("body").innerText();
await page.getByRole("button", { name: "Fill in ▸" }).first().click();
await page.getByRole("textbox", { name: /Value for/ }).fill("350ml");
await page.getByRole("button", { name: "Replace" }).click();
await page.waitForTimeout(400);
const after = await page.locator("body").innerText();
await page.screenshot({ path: `${OUT}/05-filled.png`, fullPage: true });

const checks: [string, boolean][] = [
  ["placeholder rendered before fill-in", before.includes("[SPECIFY:")],
  ["placeholder gone after fill-in", !after.includes("[SPECIFY: capacity]")],
  ["substituted value present in copy", after.includes("350ml")],
  ["assumption cleared from the checklist", !after.includes("What is the capacity?")],
  ["no page errors", errors.length === 0],
];
await browser.close();

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) { bad++; console.log(`  \u2717 ${name}`); }
}
if (errors.length) console.log(errors.join("\n"));
console.log(bad === 0 ? `PASS e2e (${checks.length} checks, shots in ${OUT})` : `FAIL e2e: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
