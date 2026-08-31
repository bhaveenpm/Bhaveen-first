/**
 * The mock provider is only useful if its output is genuinely contract-clean.
 * This asserts every fixture × every tone parses against GenerationSchema and passes
 * groundingLint — and that the deliberately-dirty fixture actually fails.
 */
import { StrictGenerationSchema, ToneEnum, type Tone } from "@/lib/schema";
import { groundingLint } from "@/lib/groundingLint";
import { MOCK_FIXTURES } from "@/lib/mockFixtures";

let failures = 0;
const note = (m: string) => {
  console.log("  ✗ " + m);
  failures++;
};

for (const [id, fixture] of Object.entries(MOCK_FIXTURES)) {
  for (const tone of ToneEnum.options as Tone[]) {
    for (const attempt of ["first", "corrected"] as const) {
      const g = fixture.build({ tone, attempt });
      const label = `${id}/${tone}/${attempt}`;
      const parsed = StrictGenerationSchema.safeParse(g);
      if (!parsed.success) {
        note(`${label}: zod — ${JSON.stringify(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`))}`);
        continue;
      }
      const lint = groundingLint(parsed.data);
      const dirtyExpected = id === "lint-violation-01" && attempt === "first";
      if (dirtyExpected) {
        if (lint.ok) note(`${label}: expected lint violations, got none`);
        else {
          const rules = new Set(lint.violations.filter((v) => v.severity === "reject").map((v) => v.rule));
          if (!rules.has("L1") || !rules.has("L2")) {
            note(`${label}: expected L1+L2, got ${[...rules].join(",")}`);
          }
        }
      } else if (!lint.ok) {
        for (const v of lint.violations.filter((x) => x.severity === "reject")) {
          note(`${label}: ${v.rule} ${v.field} — ${v.message} :: ${v.offending}`);
        }
      } else {
        const warns = lint.violations.filter((v) => v.severity === "warn");
        if (warns.length) console.log(`  ! ${label}: ${warns.map((w) => `${w.rule} ${w.offending}`).join(", ")}`);
      }
    }
  }
}

console.log(failures === 0 ? "PASS fixtures" : `FAIL fixtures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
