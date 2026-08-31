/**
 * Unit + integration tests for the parts that must not silently rot:
 * image validation, rate limiting, the grounding lint, the partial-JSON streamer,
 * and the P4 acceptance test — a deliberate violation is caught and corrected.
 */
import { readFileSync } from "node:fs";
import { sniffMime, readDimensions, targetSize, validateUpload, MAX_DIMENSION } from "@/lib/image";
import { rateLimit, resetRateLimit } from "@/lib/rateLimit";
import { groundingLint } from "@/lib/groundingLint";
import { parsePartialJson, PartialJsonStream } from "@/lib/partialJson";
import { runPipeline } from "@/lib/pipeline";
import { AutoWriteError, type Generation } from "@/lib/schema";
import { MOCK_FIXTURES } from "@/lib/mockFixtures";

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
/**
 * Structural, not `instanceof`: tsx resolves `@/lib/schema` and `./schema` to two
 * module instances, so the class identities differ here even though they are the same
 * file. (Webpack dedupes by resolved path, so the app itself sees one instance.)
 */
function isAutoWriteError(e: unknown): e is AutoWriteError {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AutoWriteError";
}
async function throwsCode(name: string, fn: () => unknown, code: string) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, isAutoWriteError(e) && e.code === code, isAutoWriteError(e) ? `got ${e.code}` : String(e));
  }
}

const png = readFileSync("public/samples/ceramic-mug.png");
const pngDataUrl = `data:image/png;base64,${png.toString("base64")}`;

// ---- image ------------------------------------------------------------------
check("sniff PNG", sniffMime(png) === "image/png");
check("sniff rejects text", sniffMime(Buffer.from("not an image at all")) === null);
check("PNG dimensions", JSON.stringify(readDimensions(png, "image/png")) === JSON.stringify({ width: 640, height: 640 }));
check("targetSize scales long edge", JSON.stringify(targetSize(4000, 2000)) === JSON.stringify({ width: 1568, height: 784 }));
check("targetSize leaves small images alone", JSON.stringify(targetSize(800, 600)) === JSON.stringify({ width: 800, height: 600 }));

const v = validateUpload(pngDataUrl);
check("validateUpload accepts PNG", v.mediaType === "image/png" && v.width === 640);
await throwsCode("validateUpload rejects non-data-URL", () => validateUpload("https://example.com/x.png"), "UNSUPPORTED_TYPE");
await throwsCode(
  "validateUpload rejects a spoofed MIME",
  () => validateUpload(`data:image/png;base64,${Buffer.from("<html>gotcha</html>").toString("base64")}`),
  "UNSUPPORTED_TYPE",
);
await throwsCode(
  "validateUpload rejects >8MB",
  () => validateUpload(`data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}`),
  "IMAGE_TOO_LARGE",
);
// An oversized-but-valid PNG header: 8000x8000 must trip the dimension clamp.
{
  const big = Buffer.from(png);
  big.writeUInt32BE(8000, 16);
  big.writeUInt32BE(8000, 20);
  await throwsCode(
    `validateUpload rejects >${MAX_DIMENSION}px`,
    () => validateUpload(`data:image/png;base64,${big.toString("base64")}`),
    "IMAGE_TOO_LARGE",
  );
}

// ---- rate limit --------------------------------------------------------------
resetRateLimit();
const results = Array.from({ length: 11 }, () => rateLimit("1.2.3.4"));
check("rate limit allows 10", results.slice(0, 10).every((r) => r.allowed));
check("rate limit blocks the 11th", results[10].allowed === false && results[10].retryAfter > 0);
check("rate limit is per key", rateLimit("5.6.7.8").allowed);
resetRateLimit();

// ---- partial JSON ------------------------------------------------------------
check("partial object", JSON.stringify(parsePartialJson('{"a":"he')) === '{"a":"he"}');
check("partial drops a half-written key", JSON.stringify(parsePartialJson('{"a":"x","bb')) === '{"a":"x"}');
check("partial array", JSON.stringify(parsePartialJson('{"b":["one","tw')) === '{"b":["one","tw"]}');
{
  const s = new PartialJsonStream();
  const acc: Record<string, string> = {};
  for (const ch of '{"title":"Mug","bullets":["a","b"]}') {
    for (const d of s.push(ch)) acc[d.path] = d.replace ? d.chunk : (acc[d.path] ?? "") + d.chunk;
  }
  check("stream reconstructs paths", acc["title"] === "Mug" && acc["bullets.1"] === "b", JSON.stringify(acc));
}

// ---- grounding lint ----------------------------------------------------------
const clean = MOCK_FIXTURES["ceramic-mug"].build({ tone: "neutral", attempt: "corrected" });
check("lint passes clean copy", groundingLint(clean).ok);

function withCopy(patch: Partial<Generation>): Generation {
  return { ...clean, ...patch };
}
const rulesOf = (g: Generation) => new Set(groundingLint(g).violations.filter((v) => v.severity === "reject").map((v) => v.rule));

check("L1 catches an invented capacity", rulesOf(withCopy({ shortDescription: "Holds 500ml of coffee." })).has("L1"));
check(
  "L1 allows a unit inside a placeholder",
  !rulesOf(withCopy({ shortDescription: "Holds [SPECIFY: capacity] of coffee." })).has("L1"),
);
check(
  "L1 allows a unit that is legibly printed",
  !rulesOf(
    withCopy({
      shortDescription: "The base is printed 500ml.",
      observedClaims: [...clean.observedClaims, { attribute: "capacity", value: "500ml", confidence: "observed", evidence: "printed on the base" }],
    }),
  ).has("L1"),
);
check("L2 catches a superlative", rulesOf(withCopy({ title: "The best eco-friendly mug" })).has("L2"));
check(
  "L3 catches a placeholder with no blocking assumption",
  rulesOf(withCopy({ title: "Mug [SPECIFY: thread count]" })).has("L3"),
);
check(
  "L4 catches duplicate bullets",
  rulesOf(withCopy({ bullets: ["Matte white ceramic finish body", "Matte white ceramic finish body", "c", "d", "e"] })).has("L4"),
);
check("L5 catches an over-long bullet", rulesOf(withCopy({ bullets: ["x".repeat(120), "b", "c", "d", "e"] })).has("L5"));
check("rule 7 short-circuits lint", groundingLint(MOCK_FIXTURES["not-a-product"].build({ tone: "neutral", attempt: "first" })).ok);

// ---- P4 acceptance: a deliberate violation is caught and corrected -------------
{
  const image = validateUpload(pngDataUrl);
  const dirty = MOCK_FIXTURES["lint-violation-01"].build({ tone: "neutral", attempt: "first" });
  const dirtyRules = rulesOf(dirty);
  check("P4 fixture really is dirty", dirtyRules.has("L1") && dirtyRules.has("L2"), [...dirtyRules].join(","));

  const r = await runPipeline({ image, tone: "neutral", mockId: "lint-violation-01" }, {});
  check("P4 pipeline retried once", r.attempts === 1, `attempts=${r.attempts}`);
  check("P4 violations were recorded", r.allViolations.some((x) => x.rule === "L1"));
  check("P4 output is clean after retry", r.unresolvedViolations.length === 0, JSON.stringify(r.unresolvedViolations.map((x) => x.rule)));
  const copy = [r.generation.longDescription, ...r.generation.bullets].join(" ").toLowerCase();
  check("P4 the fabricated claim is gone", !copy.includes("500ml") && !copy.includes("eco-friendly"));
}

// ---- rule 7 end to end ---------------------------------------------------------
await throwsCode(
  "non-product is rejected by the pipeline",
  () => runPipeline({ image: validateUpload(pngDataUrl), tone: "neutral", mockId: "neg-person-01" }, {}),
  "NOT_A_PRODUCT",
);

console.log(failed === 0 ? `PASS unit (${passed} checks)` : `FAIL unit: ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
