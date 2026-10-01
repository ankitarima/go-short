const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: string): boolean => HEX.test(v);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. Mirrors the server's QR scannability rule. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `null` when the pair is fine, otherwise the reason it would not scan reliably (same rules the API enforces). */
export function scanProblem(fg: string, bg: string): string | null {
  if (!isHex(fg) || !isHex(bg)) return 'Use 6-digit hex colours such as #000000.';
  if (luminance(fg) >= luminance(bg))
    return 'The foreground must be darker than the background, otherwise many scanners cannot read the code.';
  if (contrastRatio(fg, bg) < 3)
    return 'These colours are too similar to scan reliably (minimum contrast 3:1).';
  return null;
}
