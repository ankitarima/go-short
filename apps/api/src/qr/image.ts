import { decode as decodeJpeg } from 'jpeg-js';
import { PNG } from 'pngjs';

export class ImageError extends Error {}

export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

export const MAX_LOGO_BYTES = 512 * 1024;
const MAX_DECODED_DIMENSION = 2048;
const LOGO_TARGET = 256;

export type ImageKind = 'png' | 'jpeg';

/** Trust the bytes, not the declared content type. SVG, GIF, WebP and everything else is refused. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

/** Reads width/height from the header BEFORE decoding, so a tiny file cannot expand into gigabytes of pixels. */
function declaredSize(buf: Buffer, kind: ImageKind): { width: number; height: number } | null {
  if (kind === 'png') {
    return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
  }
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function decodeImage(buf: Buffer): Rgba {
  const kind = sniffImage(buf);
  if (!kind) throw new ImageError('Only PNG and JPEG images are supported');
  const size = declaredSize(buf, kind);
  if (
    !size ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > MAX_DECODED_DIMENSION ||
    size.height > MAX_DECODED_DIMENSION
  ) {
    throw new ImageError(
      `Image dimensions must be at most ${MAX_DECODED_DIMENSION}x${MAX_DECODED_DIMENSION}`,
    );
  }
  try {
    if (kind === 'png') {
      const p = PNG.sync.read(buf);
      return { width: p.width, height: p.height, data: p.data };
    }
    const j = decodeJpeg(buf, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: 5,
      maxMemoryUsageInMB: 64,
    });
    return { width: j.width, height: j.height, data: Buffer.from(j.data) };
  } catch {
    throw new ImageError('The image is corrupt or unsupported');
  }
}

/** Bilinear resample. */
export function resize(src: Rgba, width: number, height: number): Rgba {
  const out = Buffer.alloc(width * height * 4);
  const xr = src.width / width;
  const yr = src.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, (y + 0.5) * yr - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, (x + 0.5) * xr - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      for (let c = 0; c < 4; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c]!;
        const b = src.data[(y0 * src.width + x1) * 4 + c]!;
        const d = src.data[(y1 * src.width + x0) * 4 + c]!;
        const e = src.data[(y1 * src.width + x1) * 4 + c]!;
        out[(y * width + x) * 4 + c] = Math.round(
          (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy,
        );
      }
    }
  }
  return { width, height, data: out };
}

export function encodePng(img: Rgba): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}

/**
 * Uploaded logo -> safe asset: decoded, scaled to fit 256x256, re-encoded as a fresh PNG. Re-encoding
 * drops every chunk we did not write (EXIF, text, ICC, embedded payloads).
 */
export function sanitizeLogo(buf: Buffer): Buffer {
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES)
    throw new ImageError(`Logo must be between 1 byte and ${MAX_LOGO_BYTES / 1024} KB`);
  const img = decodeImage(buf);
  const scale = Math.min(1, LOGO_TARGET / Math.max(img.width, img.height));
  const out =
    scale < 1
      ? resize(
          img,
          Math.max(1, Math.round(img.width * scale)),
          Math.max(1, Math.round(img.height * scale)),
        )
      : img;
  return encodePng(out);
}
