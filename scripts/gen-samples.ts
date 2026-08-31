/**
 * Generates the demo images in public/samples/ and the eval placeholder images.
 *
 * These are synthetic renders, not photographs — enough to exercise the whole pipeline
 * offline. For a real grounding eval, drop actual product photos into evals/golden/
 * with matching ids (see evals/README.md); the harness reads whatever is there.
 *
 * Pure Node: a minimal PNG encoder over zlib. No native image deps to install.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

type RGB = [number, number, number];

class Canvas {
  readonly data: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: RGB) {
    this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.data[i * 3] = bg[0];
      this.data[i * 3 + 1] = bg[1];
      this.data[i * 3 + 2] = bg[2];
    }
  }
  px(x: number, y: number, c: RGB, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(this.data[i + k] * (1 - alpha) + c[k] * alpha);
  }
  /** Fill where `inside(x,y)` is true, with 2×2 supersampling for soft edges. */
  fill(inside: (x: number, y: number) => boolean, c: RGB | ((x: number, y: number) => RGB)) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let hits = 0;
        for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) if (inside(x + dx, y + dy)) hits++;
        if (hits === 0) continue;
        this.px(x, y, typeof c === "function" ? c(x, y) : c, hits / 4);
      }
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc(this.h * (this.w * 3 + 1));
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0; // filter: none
      Buffer.from(this.data.subarray(y * this.w * 3, (y + 1) * this.w * 3)).copy(raw, y * (this.w * 3 + 1) + 1);
    }
    const chunk = (type: string, body: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length);
      const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const W = 640;
const H = 640;
const BG: RGB = [232, 230, 225];

function shade(base: RGB, cx: number, halfW: number) {
  return (x: number): RGB => {
    // Simple lambert-ish falloff so the form reads as a solid, not a flat sticker.
    const t = Math.min(1, Math.abs(x - cx) / halfW);
    const k = 1 - 0.28 * t * t - (x < cx ? 0 : 0.06);
    return [base[0] * k, base[1] * k, base[2] * k].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
  };
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function groundShadow(c: Canvas, cx: number, cy: number, rx: number, ry: number) {
  c.fill(ellipse(cx, cy, rx, ry), (x, y) => {
    const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    const a = Math.max(0, 1 - d);
    return [BG[0] - 42 * a, BG[1] - 42 * a, BG[2] - 40 * a].map(Math.round) as RGB;
  });
}

function mug(): Canvas {
  const c = new Canvas(W, H, BG);
  groundShadow(c, 310, 470, 175, 34);
  const body: RGB = [248, 247, 244];
  // handle (annulus), drawn first so the body overlaps it cleanly
  c.fill((x, y) => {
    const d = Math.sqrt((x - 430) ** 2 + (y - 340) ** 2);
    return d <= 78 && d >= 46 && x > 400;
  }, shade([236, 234, 230], 430, 78));
  c.fill((x, y) => x >= 170 && x <= 440 && y >= 225 && y <= 465, shade(body, 250, 150));
  c.fill(ellipse(305, 465, 135, 30), shade([240, 238, 234], 250, 150));
  c.fill(ellipse(305, 225, 135, 32), [222, 220, 215]);
  c.fill(ellipse(305, 227, 118, 25), [200, 197, 191]);
  return c;
}

function tote(): Canvas {
  const c = new Canvas(W, H, BG);
  groundShadow(c, 320, 520, 190, 26);
  const cloth: RGB = [226, 214, 190];
  c.fill((x, y) => x >= 165 && x <= 475 && y >= 235 && y <= 520, (x, y) => {
    const s = shade(cloth, 320, 170)(x);
    // visible cross-hatch weave — an "observed" texture the copy may reference
    const w = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0 ? 6 : -6;
    return [s[0] + w, s[1] + w, s[2] + w].map((v) => Math.max(0, Math.min(255, v))) as RGB;
  });
  for (const sx of [235, 405]) {
    c.fill((x, y) => {
      const d = Math.abs(Math.sqrt((x - sx) ** 2 + (y - 235) ** 2) - 92);
      return d <= 11 && y <= 240;
    }, [206, 192, 166]);
  }
  c.fill((x, y) => x >= 165 && x <= 475 && y >= 235 && y <= 247, [205, 191, 165]);
  return c;
}

function bottle(): Canvas {
  const c = new Canvas(W, H, BG);
  groundShadow(c, 320, 545, 120, 24);
  const glass: RGB = [206, 216, 214];
  c.fill((x, y) => x >= 250 && x <= 390 && y >= 250 && y <= 545, shade(glass, 300, 80));
  c.fill((x, y) => {
    if (y < 165 || y > 250) return false;
    const t = (y - 165) / 85;
    const halfW = 26 + t * t * 44;
    return Math.abs(x - 320) <= halfW;
  }, shade(glass, 300, 80));
  c.fill((x, y) => x >= 292 && x <= 348 && y >= 128 && y <= 172, shade([58, 56, 54], 305, 32));
  for (let rx = 294; rx < 348; rx += 6) c.fill((x, y) => x >= rx && x <= rx + 2 && y >= 128 && y <= 172, [34, 33, 32]);
  c.fill((x, y) => x >= 258 && x <= 382 && y >= 335 && y <= 455, [242, 238, 228]);
  c.fill((x, y) => x >= 258 && x <= 382 && y >= 335 && y <= 368, [186, 62, 46]);
  c.fill((x, y) => x >= 276 && x <= 364 && y >= 392 && y <= 402, [186, 62, 46]);
  c.fill((x, y) => x >= 288 && x <= 352 && y >= 414 && y <= 421, [150, 146, 140]);
  return c;
}

const OUT: Record<string, () => Canvas> = {
  "ceramic-mug": mug,
  "canvas-tote": tote,
  "sauce-bottle": bottle,
};

mkdirSync("public/samples", { recursive: true });
for (const [name, make] of Object.entries(OUT)) {
  const path = `public/samples/${name}.png`;
  writeFileSync(path, make().png());
  console.log("wrote", path);
}
