import { describe, expect, it } from 'vitest';
import { campaignPhase } from './hooks';

describe('campaignPhase (factual, from dates only)', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  it.each([
    [{ startDate: '2026-11-01T00:00:00Z', endDate: null }, 'Scheduled'],
    [{ startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-31T00:00:00Z' }, 'Running'],
    [{ startDate: '2026-09-01T00:00:00Z', endDate: '2026-10-01T00:00:00Z' }, 'Ended'],
    [{ startDate: null, endDate: null }, 'Ongoing'],
    [{ startDate: null, endDate: '2026-12-01T00:00:00Z' }, 'Running'],
  ])('%j -> %s', (c, phase) => expect(campaignPhase(c, now)).toBe(phase));
});
