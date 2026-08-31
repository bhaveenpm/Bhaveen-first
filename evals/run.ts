/**
 * Spec §10 eval harness. "A prototype without an eval is a demo you cannot change
 * safely."
 *
 * Runs the SAME pipeline the route runs (lib/pipeline.ts), so what is measured here is
 * what ships. Assertions A1–A7 from the spec.
 *
 *   npm run eval                  # mock provider, free, deterministic — CI-safe
 *   AUTO_WRITE_PROVIDER=anthropic npm run eval
 *   npm run eval -- --only ceramic-mug-01 --determinism 5
 *
 * IMAGES: for each golden id the harness looks for evals/golden/<id>.{png,jpg,jpeg,webp}.
 * Where none exists it substitutes a bundled sample render and marks the row STAND-IN.
 * A2/A3 are only a real fabrication test against real photographs — the summary says
 * how many rows were stand-ins so a green run cannot be over-read.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { runPipeline } from "@/lib/pipeline";
import { validateUpload } from "@/lib/image";
import { AutoWriteError, type Generation, type Tone } from "@/lib/schema";
import { COST_CEILING_USD } from "@/lib/models";
import { getProvider } from "@/lib/anthropic";

type Golden = { id: string; category: string; visible_attributes: string[]; unknowable_attributes: string[] };
type Negative = { id: string; expect: string; description: string };

const args = process.argv.slice(2);
const only = valueOf("--only");
const determinismRuns = Number(valueOf("--determinism") ?? 3);
const determinismSample = Number(valueOf("--determinism-sample") ?? 2);
const tone = (valueOf("--tone") ?? "neutral") as Tone;

function valueOf(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const STAND_INS = ["public/samples/ceramic-mug.png", "public/samples/canvas-tote.png", "public/samples/sauce-bottle.png"];

function loadImage(dir: string, id: string, fallbackIndex: number): { dataUrl: string; standIn: boolean } {
  for (const ext of IMAGE_EXTS) {
    const p = `${dir}/${id}.${ext}`;
    if (existsSync(p)) {
      const mime = ext === "jpg" ? "jpeg" : ext;
      return { dataUrl: `data:image/${mime};base64,${readFileSync(p).toString("base64")}`, standIn: false };
    }
  }
  const p = STAND_INS[fallbackIndex % STAND_INS.length];
  return { dataUrl: `data:image/png;base64,${readFileSync(p).toString("base64")}`, standIn: true };
}

function copyOf(g: Generation): string {
  return [g.title, g.shortDescription, g.longDescription, ...g.bullets, g.seoMeta.metaDescription, g.seoMeta.altText]
    .join(" \n ")
    .toLowerCase();
}

/** Strip [SPECIFY: ...] spans — a placeholder is the opposite of a fabricated claim. */
function withoutPlaceholders(text: string): string {
  return text.replace(/\[specify:[^\]]*\]/gi, " ");
}

const HEDGES = ["appears", "looks like", "seems", "likely", "probably", "we think", "confirm"];

/** Human-readable tokens for an attribute id like `capacity_ml` or `wash_instructions`. */
function attributeTokens(attr: string): string[] {
  const stop = new Set(["ml", "cm", "kg", "g", "hours", "inches", "certainty", "content", "instructions"]);
  return attr
    .split("_")
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && !stop.has(t));
}

const UNIT_ASSERTION =
  /\b\d+(?:\.\d+)?\s?(?:ml|litres?|liters?|kg|grams?|g|oz|lbs?|cm|mm|inch(?:es)?|"|mah|wh|w|watts?|volts?|v|hours?|hrs?)\b/i;

type Row = {
  id: string;
  standIn: boolean;
  a1: boolean; // schema first try
  a2: boolean; // no fabrication
  a3: boolean; // assumption coverage
  a4: boolean; // lint clean after retry
  /** How many attribute/placeholder checks actually had something to assert on. */
  checked: number;
  ttftMs: number;
  totalMs: number;
  costUsd: number;
  notes: string[];
};

async function runGolden(g: Golden, index: number): Promise<Row> {
  const { dataUrl, standIn } = loadImage("evals/golden", g.id, index);
  const image = validateUpload(dataUrl);
  const notes: string[] = [];

  const started = Date.now();
  let ttftMs = -1;

  const result = await runPipeline(
    { image, tone, category: g.category, mockId: g.id },
    { onDeltas: () => { if (ttftMs < 0) ttftMs = Date.now() - started; } },
  );
  const totalMs = Date.now() - started;

  const a1 = result.attempts === 0 || !result.allViolations.some((v) => v.rule === "L5" && v.message.includes("Expected"));
  const a4 = result.unresolvedViolations.length === 0;
  if (!a4) notes.push(`unresolved ${result.unresolvedViolations.map((v) => v.rule).join(",")}`);

  // ---- A2: no unknowable attribute asserted as fact ----------------------------
  //
  // "Asserted as fact" is NOT "mentioned". Naming an attribute while placeholdering
  // it ("Capacity is [SPECIFY: capacity]") is precisely the behaviour we want, so a
  // sentence only counts against A2 when it pairs the attribute with a concrete
  // value — a number or a unit — outside any placeholder, unhedged, and not backed by
  // an observed claim.
  const rawCopy = copyOf(result.generation);
  const sentences = rawCopy.split(/(?<=[.!?])\s+/);
  let a2 = true;
  let attrsChecked = 0;

  for (const attr of g.unknowable_attributes) {
    const tokens = attributeTokens(attr);
    const hits = sentences.filter((s) => tokens.some((t) => s.includes(t)));
    if (hits.length === 0) continue;
    attrsChecked++;
    for (const hit of hits) {
      const stripped = withoutPlaceholders(hit);
      const hasConcreteValue = /\d/.test(stripped) || UNIT_ASSERTION.test(stripped);
      if (!hasConcreteValue) continue; // named but not valued — the desired shape
      if (HEDGES.some((h) => hit.includes(h))) continue;
      const observed = result.generation.observedClaims.some(
        (c) => c.confidence === "observed" && tokens.some((t) => (c.value + c.evidence).toLowerCase().includes(t)),
      );
      if (observed) continue;
      a2 = false;
      notes.push(`A2 asserts "${attr}"`);
      break;
    }
  }

  // A standalone unit claim anywhere in the copy is fabrication regardless of which
  // attribute it belongs to — this is the check that catches "500ml" on a photograph.
  const strippedCopy = withoutPlaceholders(rawCopy);
  const unitMatch = UNIT_ASSERTION.exec(strippedCopy);
  if (unitMatch) {
    const licensed = result.generation.observedClaims.some(
      (c) => c.confidence === "observed" && c.value.toLowerCase().includes(unitMatch[0].trim()),
    );
    if (!licensed) {
      a2 = false;
      notes.push(`A2 unit "${unitMatch[0].trim()}"`);
    }
  }

  // ---- A3: every unknowable the copy leans on has a blocking assumption ----------
  //
  // "Leans on" == a [SPECIFY: ...] placeholder stands in for it. That is the only way
  // an unknowable legitimately reaches the copy, so it is the only thing to cover.
  const blocking = result.generation.assumptions.filter((a) => a.severity === "blocking");
  const placeholderAttrs = [...rawCopy.matchAll(/\[specify:\s*([^\]]+)\]/gi)].map((m) => m[1].trim().toLowerCase());
  let a3 = true;
  let placeholdersChecked = 0;

  for (const p of placeholderAttrs) {
    placeholdersChecked++;
    const covered = blocking.some((b) =>
      `${b.assumption} ${b.question} ${b.field}`.toLowerCase().includes(p),
    );
    if (!covered) {
      a3 = false;
      notes.push(`A3 uncovered placeholder "${p}"`);
    }
  }
  // A listing with no placeholders and no blocking assumptions is only credible if the
  // golden says there is nothing unknowable about the product. There always is.
  if (placeholderAttrs.length === 0 && blocking.length === 0 && g.unknowable_attributes.length > 0) {
    a3 = false;
    notes.push("A3 no placeholder or blocking assumption for any unknowable");
  }

  return {
    id: g.id,
    standIn,
    a1,
    a2,
    a3,
    a4,
    checked: attrsChecked + placeholdersChecked,
    ttftMs: Math.max(ttftMs, 0),
    totalMs,
    costUsd: result.usage.costUsd,
    notes,
  };
}

async function runNegative(n: Negative, index: number): Promise<{ id: string; pass: boolean; detail: string }> {
  const { dataUrl } = loadImage("evals/negative", n.id, index);
  const image = validateUpload(dataUrl);
  try {
    const r = await runPipeline({ image, tone, mockId: n.id }, {});
    return { id: n.id, pass: false, detail: `produced a listing for "${r.generation.productType}"` };
  } catch (err) {
    if (err instanceof AutoWriteError && err.code === "NOT_A_PRODUCT") {
      return { id: n.id, pass: true, detail: "rejected" };
    }
    return { id: n.id, pass: false, detail: `unexpected ${err instanceof AutoWriteError ? err.code : String(err)}` };
  }
}

function p90(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

const tick = (b: boolean) => (b ? "PASS" : "FAIL");

async function main() {
  const provider = getProvider();
  console.log(`\nAuto Write eval — provider: ${provider.name}, tone: ${tone}\n`);

  const goldens: Golden[] = readdirSync("evals/golden")
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(`evals/golden/${f}`, "utf8")) as Golden)
    .filter((g) => !only || g.id === only)
    .sort((a, b) => a.id.localeCompare(b.id));

  const negatives: Negative[] = readdirSync("evals/negative")
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(`evals/negative/${f}`, "utf8")) as Negative)
    .sort((a, b) => a.id.localeCompare(b.id));

  const rows: Row[] = [];
  for (const [i, g] of goldens.entries()) rows.push(await runGolden(g, i));

  console.log("GOLDEN SET");
  console.log("id".padEnd(24) + "A1   A2   A3   A4   ttft   total   cost      notes");
  console.log("-".repeat(96));
  for (const r of rows) {
    console.log(
      (r.id + (r.standIn ? " *" : "")).padEnd(24) +
        [tick(r.a1), tick(r.a2), tick(r.a3), tick(r.a4)].map((t) => t.padEnd(5)).join("") +
        `${String(r.ttftMs).padStart(5)}ms ${String(r.totalMs).padStart(5)}ms $${r.costUsd.toFixed(4)}  ` +
        r.notes.join("; "),
    );
  }

  console.log("\nNEGATIVE SET (A5)");
  const negs = [];
  for (const [i, n] of negatives.entries()) negs.push(await runNegative(n, i));
  for (const n of negs) console.log(`  ${tick(n.pass).padEnd(5)}${n.id.padEnd(20)}${n.detail}`);

  // ---- A7 determinism -----------------------------------------------------------
  console.log(`\nA7 DETERMINISM (${determinismRuns} runs each, first ${determinismSample} goldens)`);
  const detRows: { id: string; pass: boolean; detail: string }[] = [];
  for (const [i, g] of goldens.slice(0, determinismSample).entries()) {
    const { dataUrl } = loadImage("evals/golden", g.id, i);
    const image = validateUpload(dataUrl);
    const seen: string[] = [];
    for (let k = 0; k < determinismRuns; k++) {
      const r = await runPipeline({ image, tone, category: g.category, mockId: g.id }, {});
      seen.push(`${r.generation.productType}|${[...new Set(r.generation.assumptions.map((a) => a.field))].sort().join(",")}`);
    }
    const stable = new Set(seen).size === 1;
    detRows.push({ id: g.id, pass: stable, detail: stable ? seen[0] : `${new Set(seen).size} distinct shapes` });
    console.log(`  ${tick(stable).padEnd(5)}${g.id.padEnd(20)}${detRows.at(-1)!.detail}`);
  }

  // ---- summary --------------------------------------------------------------------
  const ttft90 = p90(rows.map((r) => r.ttftMs));
  const total90 = p90(rows.map((r) => r.totalMs));
  const maxCost = Math.max(0, ...rows.map((r) => r.costUsd));
  const standIns = rows.filter((r) => r.standIn).length;

  const gates: [string, boolean, string][] = [
    ["A1 schema first try", rows.every((r) => r.a1), `${rows.filter((r) => r.a1).length}/${rows.length}`],
    [
      "A2 no fabrication",
      rows.every((r) => r.a2),
      `${rows.filter((r) => r.a2).length}/${rows.length} (${rows.reduce((n, r) => n + r.checked, 0)} checks)`,
    ],
    ["A3 assumption coverage", rows.every((r) => r.a3), `${rows.filter((r) => r.a3).length}/${rows.length}`],
    ["A4 lint clean after retry", rows.every((r) => r.a4), `${rows.filter((r) => r.a4).length}/${rows.length}`],
    ["A5 negative set rejected", negs.every((n) => n.pass), `${negs.filter((n) => n.pass).length}/${negs.length}`],
    ["A6 TTFT p90 < 2000ms", ttft90 < 2000, `${ttft90}ms`],
    ["A6 total p90 < 12000ms", total90 < 12000, `${total90}ms`],
    ["A7 structure determinism", detRows.every((d) => d.pass), `${detRows.filter((d) => d.pass).length}/${detRows.length}`],
    ["S7 cost < $0.03", maxCost < COST_CEILING_USD, `max $${maxCost.toFixed(4)}`],
  ];

  console.log("\nSUMMARY");
  console.log("-".repeat(60));
  for (const [name, pass, detail] of gates) console.log(`  ${tick(pass).padEnd(6)}${name.padEnd(30)}${detail}`);

  if (standIns > 0) {
    console.log(
      `\n  NOTE: ${standIns}/${rows.length} golden rows ran on stand-in renders (marked *).\n` +
        `  A2/A3 are only a real fabrication test against real product photographs.\n` +
        `  Drop them into evals/golden/<id>.jpg to make this run meaningful.`,
    );
  }
  if (provider.name === "mock") {
    console.log(
      `\n  NOTE: mock provider. This run proves the pipeline, the lint and the harness —\n` +
        `  not the model's grounding. Re-run with AUTO_WRITE_PROVIDER=anthropic to gate a ship.`,
    );
  }

  const failed = gates.filter(([, p]) => !p);
  console.log(failed.length === 0 ? "\nALL GATES GREEN\n" : `\n${failed.length} GATE(S) RED\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
