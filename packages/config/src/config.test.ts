import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAbsolute, join } from 'node:path';
import { findProjectRoot, loadConfig, parseTrustProxy } from './index';

const REAL_SECRET = randomBytes(32).toString('hex'); // generated per run: no secret-looking literal in the repo
const base = {
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  APP_URL: 'http://localhost:5173',
  DEFAULT_SHORT_DOMAIN: 'go.example.com',
  SESSION_SECRET: 'x'.repeat(40),
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
  it('requires an internal token in production when custom domains are enabled', () => {
    expect(() =>
      loadConfig({ ...base, SESSION_SECRET: REAL_SECRET, NODE_ENV: 'production' }),
    ).toThrow(/INTERNAL_API_TOKEN/);
    expect(
      loadConfig({
        ...base,
        SESSION_SECRET: REAL_SECRET,
        NODE_ENV: 'production',
        INTERNAL_API_TOKEN: 'x'.repeat(20),
      }).isProd,
    ).toBe(true);
    expect(
      loadConfig({
        ...base,
        SESSION_SECRET: REAL_SECRET,
        NODE_ENV: 'production',
        FEATURE_CUSTOM_DOMAINS: 'false',
      }).isProd,
    ).toBe(true);
  });

  it('anchors relative storage/GeoIP paths to the monorepo root, whatever the working directory', () => {
    const root = findProjectRoot(join(process.cwd(), '..', '..', 'apps', 'worker'));
    expect(root).toBe(findProjectRoot());
    const c = loadConfig({
      ...base,
      GEOIP_DATABASE_PATH: './storage/geoip/x.mmdb',
      STORAGE_PATH: 'storage',
    });
    expect(isAbsolute(c.GEOIP_DATABASE_PATH)).toBe(true);
    expect(c.GEOIP_DATABASE_PATH).toBe(join(root, 'storage/geoip/x.mmdb'));
    expect(c.STORAGE_PATH).toBe(join(root, 'storage'));
    expect(loadConfig({ ...base, STORAGE_PATH: '/var/data' }).STORAGE_PATH).toBe('/var/data');
  });
  it('falls back to the starting directory when no monorepo root exists', () => {
    expect(findProjectRoot('/')).toBe('/');
  });
});

describe('production secrets and metrics exposure', () => {
  const prod = { ...base, NODE_ENV: 'production', INTERNAL_API_TOKEN: 'a'.repeat(20) };
  const good = REAL_SECRET;
  it('refuses placeholder and low-variety SESSION_SECRET in production only', () => {
    const placeholder = 'change-me-change-me-change-me-change-me-change-me-1234';
    expect(() => loadConfig({ ...prod, SESSION_SECRET: placeholder })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...prod, SESSION_SECRET: 'a1'.repeat(20) })).toThrow(/variety/);
    expect(() => loadConfig({ ...prod, SESSION_SECRET: good })).not.toThrow();
    expect(() => loadConfig({ ...base, SESSION_SECRET: placeholder })).not.toThrow(); // dev is fine
  });
  it('requires a metrics token when metrics listen beyond loopback in production', () => {
    const env = { ...prod, SESSION_SECRET: good };
    expect(loadConfig(env).METRICS_HOST).toBe('127.0.0.1'); // private by default
    expect(() => loadConfig({ ...env, METRICS_HOST: '0.0.0.0' })).toThrow(/METRICS_TOKEN/);
    expect(() =>
      loadConfig({ ...env, METRICS_HOST: '0.0.0.0', METRICS_TOKEN: 't'.repeat(20) }),
    ).not.toThrow();
    expect(() =>
      loadConfig({ ...env, METRICS_HOST: '0.0.0.0', METRICS_ENABLED: 'false' }),
    ).not.toThrow();
  });
});
