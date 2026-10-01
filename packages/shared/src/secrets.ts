import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const key = (master: string): Buffer =>
  Buffer.from(hkdfSync('sha256', master, 'go-short', 'secret-box-v1', 32));
const b64 = (b: Buffer) => b.toString('base64url');

/**
 * Encrypts a secret that must be recoverable (webhook signing secrets) with AES-256-GCM under a key
 * derived from the server master secret. Format: `enc:v1:<iv>:<tag>:<ciphertext>`.
 * Passwords and API keys are NOT stored this way: those are hashed.
 */
export function sealSecret(plain: string, master: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(master), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${b64(iv)}:${b64(c.getAuthTag())}:${b64(ct)}`;
}

export function openSecret(sealed: string, master: string): string {
  const [scheme, version, iv, tag, ct] = sealed.split(':');
  if (scheme !== 'enc' || version !== 'v1' || !iv || !tag || !ct)
    throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', key(master), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/**
 * Webhook signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * The timestamp is part of the signed payload so a captured request cannot be replayed later.
 */
export function signWebhook(secret: string, timestampSeconds: number, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${v1}`;
}

/** What a receiver should do: recompute, compare in constant time, and reject old timestamps. */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = signWebhook(secret, t, body).split('v1=')[1]!;
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
