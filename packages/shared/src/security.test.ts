import { describe, expect, it } from 'vitest';
import {
  UnsafeUrlError,
  isPublicIp,
  openSecret,
  sealSecret,
  signWebhook,
  validateOutboundUrl,
  verifyWebhookSignature,
} from './index';

describe('isPublicIp (SSRF guard)', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
  ])('allows public %s', (ip) => expect(isPublicIp(ip)).toBe(true));

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.255',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '240.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::1',
  ])('blocks non-public %s', (ip) => expect(isPublicIp(ip)).toBe(false));

  it('judges IPv4-mapped IPv6 addresses by the embedded IPv4 address (a common bypass)', () => {
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:10.0.0.5')).toBe(false);
    expect(isPublicIp('::ffff:169.254.169.254')).toBe(false);
    expect(isPublicIp('::ffff:7f00:1')).toBe(false); // hex form of 127.0.0.1
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true);
  });

  it('treats anything unparseable as NOT public', () => {
    for (const bad of [
      '',
      'localhost',
      'example.com',
      '999.1.1.1',
      '1.2.3',
      '0x7f000001',
      '2130706433',
      '127.1',
      '[::1]',
    ])
      expect(isPublicIp(bad)).toBe(false);
  });
});

describe('validateOutboundUrl', () => {
  it('accepts normal https URLs', () => {
    expect(validateOutboundUrl('https://hooks.example.com/path?x=1').hostname).toBe(
      'hooks.example.com',
    );
  });
  it.each([
    'http://hooks.example.com',
    'ftp://x.example.com',
    'javascript:alert(1)',
    'https://user:pw@hooks.example.com',
    'not a url',
    'https://localhost/x',
    'https://app.localhost',
    'https://printer.local',
    'https://db.internal',
    'https://intranet/',
    'https://127.0.0.1/',
    'https://10.1.2.3/',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://' + 'a'.repeat(2100) + '.com',
  ])('rejects %s', (u) => expect(() => validateOutboundUrl(u)).toThrow(UnsafeUrlError));
  it('allows http and private hosts only when explicitly relaxed (dev/test)', () => {
    expect(validateOutboundUrl('http://127.0.0.1:9000/x', { allowInsecure: true }).port).toBe(
      '9000',
    );
    expect(() => validateOutboundUrl('http://127.0.0.1:9000/x')).toThrow();
  });
});

describe('sealSecret / openSecret', () => {
  const master = 'master-secret-master-secret-master-secret-1';
  it('round-trips and never stores the plaintext', () => {
    const sealed = sealSecret('whsec_super-secret-value', master);
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('super-secret');
    expect(openSecret(sealed, master)).toBe('whsec_super-secret-value');
  });
  it('uses a fresh IV each time', () => {
    expect(sealSecret('x', master)).not.toBe(sealSecret('x', master));
  });
  it('fails closed on a wrong key, tampering or an unknown format', () => {
    const sealed = sealSecret('x', master);
    expect(() => openSecret(sealed, 'a-different-master-secret-a-different-1')).toThrow();
    const parts = sealed.split(':');
    parts[4] = parts[4]!.slice(0, -2) + (parts[4]!.endsWith('AA') ? 'BB' : 'AA');
    expect(() => openSecret(parts.join(':'), master)).toThrow();
    expect(() => openSecret('plain-text', master)).toThrow();
    expect(() => openSecret('enc:v2:a:b:c', master)).toThrow();
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"type":"link.created"}';
  const now = 1_800_000_000;
  it('verifies a valid signature', () => {
    expect(verifyWebhookSignature(secret, signWebhook(secret, now, body), body, now)).toBe(true);
  });
  it('rejects a tampered body, wrong secret, malformed header and replayed (old/future) timestamps', () => {
    const h = signWebhook(secret, now, body);
    expect(verifyWebhookSignature(secret, h, body + ' ', now)).toBe(false);
    expect(verifyWebhookSignature('other', h, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, 'garbage', body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, '', body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, now + 301)).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, now - 301)).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, now + 299)).toBe(true);
  });
  it('binds the timestamp: swapping t invalidates the signature', () => {
    const h = signWebhook(secret, now, body).replace(`t=${now}`, `t=${now + 1}`);
    expect(verifyWebhookSignature(secret, h, body, now + 1)).toBe(false);
  });
});
