import { describe, expect, it } from 'vitest';
import {
  countryFlag,
  countryName,
  daysAgo,
  displayUrl,
  formatCompact,
  formatDate,
  formatPercent,
  formatRelative,
  isoDay,
  isoToLocalInput,
  localToIso,
  plural,
  titleCase,
  truncate,
} from '@go-short/ui/lib/format';

describe('format helpers', () => {
  it('formats numbers and percentages', () => {
    expect(formatCompact(1234)).toBe('1,234');
    expect(formatCompact(12_345)).toBe('12.3K');
    expect(formatPercent(1, 4)).toBe('25%');
    expect(formatPercent(1, 0)).toBe('0%');
  });
  it('pluralizes and title-cases', () => {
    expect(plural(1, 'link')).toBe('1 link');
    expect(plural(0, 'link')).toBe('0 links');
    expect(plural(1234, 'QR code')).toBe('1,234 QR codes');
    expect(plural(2, 'person', 'people')).toBe('2 people');
    expect(titleCase('DESKTOP')).toBe('Desktop');
    expect(titleCase('')).toBe('');
  });
  it('formats relative time in both directions', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(formatRelative('2026-10-01T11:59:50Z', now)).toBe('just now');
    expect(formatRelative('2026-10-01T10:00:00Z', now)).toBe('2 hours ago');
    expect(formatRelative('2026-09-29T12:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-10-03T12:00:00Z', now)).toBe('in 2 days');
    expect(formatRelative(null)).toBe('never');
  });
  it('handles missing and invalid dates', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nonsense')).toBe('—');
    expect(formatDate('2026-10-01T12:00:00Z')).toMatch(/2026/);
  });
  it('shortens URLs and text', () => {
    expect(displayUrl('https://go.example.com/sale')).toBe('go.example.com/sale');
    expect(displayUrl('http://localhost:4001/x')).toBe('localhost:4001/x');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });
  it('round-trips datetime-local values', () => {
    const iso = localToIso('2030-06-15T09:30');
    expect(iso).toBeDefined();
    expect(isoToLocalInput(iso!)).toBe('2030-06-15T09:30');
    expect(localToIso('')).toBeUndefined();
    expect(isoToLocalInput(null)).toBe('');
  });
  it('computes local day strings', () => {
    expect(isoDay(new Date(2026, 8, 5))).toBe('2026-09-05');
    expect(isoDay(daysAgo(1, new Date(2026, 8, 1)))).toBe('2026-08-31');
  });
  it('derives country names and flags', () => {
    expect(countryName('IN')).toBe('India');
    expect(countryName('ZZ')).toBeTruthy();
    expect(countryFlag('in')).toBe('🇮🇳');
    expect(countryFlag('India')).toBe('');
  });
});
