import { describe, expect, it } from 'vitest';
import { contrastRatio, isHex, scanProblem } from './color';

describe('QR colour rules (mirror the server)', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
  it('accepts dark-on-light with enough contrast', () => {
    expect(scanProblem('#000000', '#FFFFFF')).toBeNull();
    expect(scanProblem('#0B3D91', '#FFF8E7')).toBeNull();
  });
  it.each([
    ['inverted (light on dark)', '#FFFFFF', '#000000', /darker/],
    ['identical', '#123456', '#123456', /darker/],
    ['low contrast', '#777777', '#888888', /similar/],
    ['bad hex', 'red', '#FFFFFF', /hex/],
    ['short hex', '#fff', '#000', /hex/],
  ])('flags %s', (_n, fg, bg, re) => expect(scanProblem(fg, bg)).toMatch(re));
  it('validates hex colours', () => {
    expect(isHex('#a1B2c3')).toBe(true);
    expect(isHex('a1b2c3')).toBe(false);
  });
});
