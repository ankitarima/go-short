import { describe, expect, it } from 'vitest';
import { loadConfig, parseTrustProxy } from './index';

const base = {
  DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', APP_URL: 'http://localhost:5173',
  DEFAULT_SHORT_DOMAIN: 'go.example.com', SESSION_SECRET: 'x'.repeat(40),
};

describe('config', () => {
  it('applies defaults and parses lists', () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: 'http://a, http://b' });
    expect(c.REDIRECT_STATUS).toBe(302);
    expect(c.CORS_ORIGINS).toEqual(['http://a', 'http://b']);
    expect(c.RESERVED_SLUGS).toContain('api');
    expect(c.FEATURE_API).toBe(true);
  });
  it('fails on weak secret and bad redirect status', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, REDIRECT_STATUS: '303' })).toThrow(/REDIRECT_STATUS/);
  });
  it('parses trust proxy and refuses "true"', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual(['loopback', '10.0.0.0/8']);
    expect(parseTrustProxy('false')).toBe(false);
    expect(() => parseTrustProxy('true')).toThrow();
  });
});
