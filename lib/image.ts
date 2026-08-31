/**
 * Spec §8: images are downscaled client-side to a 1568px long edge before upload, and
 * the server independently re-validates — MIME sniffed from magic bytes, not trusted
 * from the data-URL header, and dimensions read from the file's own headers.
 *
 * Nothing here writes to disk. The buffer lives for the request and is dropped.
 */
import { AutoWriteError } from "./schema";

export const MAX_BYTES = 8 * 1024 * 1024; // 8MB (§1)
export const MAX_DIMENSION = 4096; // reject beyond this (§5 IMAGE_TOO_LARGE)
export const TARGET_LONG_EDGE = 1568; // client downscale target (§8)

export type SupportedMime = "image/jpeg" | "image/png" | "image/webp";

export type ValidatedImage = {
  mediaType: SupportedMime;
  /** Raw base64 (no data-URL prefix) — what the Anthropic SDK wants. */
  base64: string;
  bytes: number;
  width: number;
  height: number;
};

/** Magic-byte sniff. The data-URL's own declared type is attacker-controlled. */
export function sniffMime(buf: Uint8Array): SupportedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return "image/png";
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Dimensions straight from the container headers — no decode, no native deps. */
export function readDimensions(buf: Uint8Array, mime: SupportedMime): { width: number; height: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (mime === "image/png") {
    if (buf.length < 24) return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding DHT(c4), JPG(c8) and DAC(cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      const len = dv.getUint16(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }

  // WebP: VP8 (lossy), VP8L (lossless), VP8X (extended)
  const fourcc = String.fromCharCode(...buf.slice(12, 16));
  if (fourcc === "VP8X" && buf.length >= 30) {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  if (fourcc === "VP8 " && buf.length >= 30) {
    return {
      width: dv.getUint16(26, true) & 0x3fff,
      height: dv.getUint16(28, true) & 0x3fff,
    };
  }
  if (fourcc === "VP8L" && buf.length >= 25) {
    const b = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Parse + validate a base64 data URL. Throws AutoWriteError with a §5 code. */
export function validateUpload(dataUrl: string): ValidatedImage {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]*)$/.exec(dataUrl.trim());
  if (!m) {
    throw new AutoWriteError("UNSUPPORTED_TYPE", "Expected a base64 image data URL.");
  }
  const base64 = m[2];

  // 4 base64 chars -> 3 bytes. Check the cheap way before allocating.
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_BYTES) {
    throw new AutoWriteError(
      "IMAGE_TOO_LARGE",
      `Image is ~${(approxBytes / 1024 / 1024).toFixed(1)}MB. The limit is 8MB.`,
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    throw new AutoWriteError("UNSUPPORTED_TYPE", "Image data is not valid base64.");
  }
  if (buf.length === 0) {
    throw new AutoWriteError("UNSUPPORTED_TYPE", "Image data is empty.");
  }
  if (buf.length > MAX_BYTES) {
    throw new AutoWriteError("IMAGE_TOO_LARGE", "Image exceeds the 8MB limit.");
  }

  const mediaType = sniffMime(buf);
  if (!mediaType) {
    throw new AutoWriteError(
      "UNSUPPORTED_TYPE",
      "Only JPEG, PNG and WebP images are supported.",
    );
  }

  const dims = readDimensions(buf, mediaType);
  if (!dims || dims.width === 0 || dims.height === 0) {
    throw new AutoWriteError("UNSUPPORTED_TYPE", "Could not read the image dimensions — the file may be corrupt.");
  }
  if (Math.max(dims.width, dims.height) > MAX_DIMENSION) {
    throw new AutoWriteError(
      "IMAGE_TOO_LARGE",
      `Image is ${dims.width}×${dims.height}. The long edge must be ${MAX_DIMENSION}px or less.`,
    );
  }

  return { mediaType, base64, bytes: buf.length, width: dims.width, height: dims.height };
}

// ---------------------------------------------------------------------------
// Client-side downscale (browser only — uses canvas). Keeps the upload small so
// TTFT is not spent shipping a 12MB phone photo (§8).
// ---------------------------------------------------------------------------

export function targetSize(
  width: number,
  height: number,
  longEdge = TARGET_LONG_EDGE,
): { width: number; height: number } {
  const max = Math.max(width, height);
  if (max <= longEdge) return { width, height };
  const scale = longEdge / max;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type DownscaleResult = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
};

/** Read a File, downscale to TARGET_LONG_EDGE, and return a JPEG data URL. */
export async function downscaleFile(file: File, longEdge = TARGET_LONG_EDGE): Promise<DownscaleResult> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new AutoWriteError("UNSUPPORTED_TYPE", "Only JPEG, PNG and WebP images are supported.");
  }
  if (file.size > MAX_BYTES * 4) {
    // Guard the decode itself; the post-downscale size is what really matters.
    throw new AutoWriteError("IMAGE_TOO_LARGE", "That image is far too large to open in the browser.");
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, longEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AutoWriteError("UNSUPPORTED_TYPE", "Could not process the image in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // JPEG at 0.85 — visually lossless for a product photo, a fraction of a PNG.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  if (bytes > MAX_BYTES) {
    throw new AutoWriteError("IMAGE_TOO_LARGE", "Image is still over 8MB after downscaling.");
  }
  return { dataUrl, width, height, bytes, originalBytes: file.size };
}
