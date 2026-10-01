import QRCode from 'qrcode';
import { AppError } from '@go-short/shared';
import { type Rgba, decodeImage, encodePng, resize } from './image';

export interface QrStyle {
  size: number;
  margin: number;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  foregroundColor: string; // #RRGGBB (validated)
  backgroundColor: string; // #RRGGBB (validated)
}

export interface RenderedQr {
  mimeType: 'image/svg+xml' | 'image/png';
  body: Buffer;
}

/** The logo covers at most this fraction of the QR width (about 5 % of the area, well inside level H's 30 % recovery). */
const LOGO_FRACTION = 0.22;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A QR code that cannot be scanned is worse than an error. Require dark modules on a lighter
 * background (many scanners cannot read inverted codes) with a contrast ratio of at least 3:1.
 */
export function assertScannable(style: Pick<QrStyle, 'foregroundColor' | 'backgroundColor'>): void {
  if (luminance(style.foregroundColor) >= luminance(style.backgroundColor)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Foreground must be darker than the background so the code scans reliably',
      [{ path: 'foregroundColor', message: 'Must be darker than backgroundColor' }],
    );
  }
  if (contrastRatio(style.foregroundColor, style.backgroundColor) < 3) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Foreground and background do not contrast enough to scan reliably (minimum 3:1)',
      [{ path: 'foregroundColor', message: 'Contrast ratio below 3:1' }],
    );
  }
}

/** Logos need the highest error correction; everything else uses the requested level. */
export const effectiveCorrection = (style: QrStyle, hasLogo: boolean) =>
  hasLogo ? 'H' : style.errorCorrection;

export async function renderQr(
  url: string,
  style: QrStyle,
  format: 'svg' | 'png',
  logoPng?: Buffer,
): Promise<RenderedQr> {
  assertScannable(style);
  const errorCorrectionLevel = effectiveCorrection(style, Boolean(logoPng));
  const base = {
    errorCorrectionLevel,
    margin: style.margin,
    width: style.size,
    color: { dark: style.foregroundColor, light: style.backgroundColor },
  } as const;

  if (format === 'png') {
    const png = await QRCode.toBuffer(url, { ...base, type: 'png' });
    return { mimeType: 'image/png', body: logoPng ? compositePng(png, logoPng, style) : png };
  }
  const svg = await QRCode.toString(url, { ...base, type: 'svg' });
  return {
    mimeType: 'image/svg+xml',
    body: Buffer.from(logoPng ? embedLogoSvg(svg, logoPng, style) : svg, 'utf8'),
  };
}

/** Composites a (pre-sanitized) logo onto the centre of a rendered PNG, on a padded background tile. */
function compositePng(qrPng: Buffer, logoPng: Buffer, style: QrStyle): Buffer {
  const qr = decodeImage(qrPng);
  const logo = decodeImage(logoPng);
  const box = Math.max(8, Math.floor(qr.width * LOGO_FRACTION));
  const scale = Math.min(box / logo.width, box / logo.height);
  const lw = Math.max(1, Math.round(logo.width * scale));
  const lh = Math.max(1, Math.round(logo.height * scale));
  const scaled = resize(logo, lw, lh);
  const pad = Math.max(2, Math.round(box * 0.08));
  const [br, bg, bb] = rgb(style.backgroundColor);
  const cx = Math.floor(qr.width / 2);
  const cy = Math.floor(qr.height / 2);
  const tile = {
    x0: cx - Math.ceil(lw / 2) - pad,
    y0: cy - Math.ceil(lh / 2) - pad,
    x1: cx + Math.ceil(lw / 2) + pad,
    y1: cy + Math.ceil(lh / 2) + pad,
  };
  for (let y = Math.max(0, tile.y0); y < Math.min(qr.height, tile.y1); y++) {
    for (let x = Math.max(0, tile.x0); x < Math.min(qr.width, tile.x1); x++) {
      const i = (y * qr.width + x) * 4;
      qr.data[i] = br;
      qr.data[i + 1] = bg;
      qr.data[i + 2] = bb;
      qr.data[i + 3] = 255;
    }
  }
  blend(qr, scaled, cx - Math.floor(lw / 2), cy - Math.floor(lh / 2));
  return encodePng(qr);
}

function blend(dst: Rgba, src: Rgba, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const si = (y * src.width + x) * 4;
      const di = (dy * dst.width + dx) * 4;
      const a = src.data[si + 3]! / 255;
      for (let c = 0; c < 3; c++)
        dst.data[di + c] = Math.round(src.data[si + c]! * a + dst.data[di + c]! * (1 - a));
      dst.data[di + 3] = 255;
    }
  }
}

/**
 * SVG: the qrcode library emits `<svg ... viewBox="0 0 N N">`. We append a background tile and an
 * <image> carrying our own re-encoded PNG as a base64 data URI. Every interpolated value is a number
 * we computed or base64 we produced; no user-supplied text or SVG ever reaches the markup.
 */
function embedLogoSvg(svg: string, logoPng: Buffer, style: QrStyle): string {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!m) throw new AppError('INTERNAL_ERROR', 'Could not place the logo');
  const n = Number(m[1]);
  const logo = decodeImage(logoPng);
  const box = n * LOGO_FRACTION;
  const scale = Math.min(box / logo.width, box / logo.height);
  const w = +(logo.width * scale).toFixed(3);
  const h = +(logo.height * scale).toFixed(3);
  const pad = +(box * 0.08).toFixed(3);
  const x = +((n - w) / 2).toFixed(3);
  const y = +((n - h) / 2).toFixed(3);
  const tile = `<rect x="${+(x - pad).toFixed(3)}" y="${+(y - pad).toFixed(3)}" width="${+(w + 2 * pad).toFixed(3)}" height="${+(h + 2 * pad).toFixed(3)}" fill="${style.backgroundColor}"/>`;
  const image = `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoPng.toString('base64')}"/>`;
  return svg.replace('</svg>', `${tile}${image}</svg>`);
}
