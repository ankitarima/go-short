import { randomToken, sha256 } from '../lib/crypto';

/** `gs_` + 8-char public prefix + `_` + 43-char secret (256 bits). */
export const API_KEY_PATTERN = /^gs_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = `gs_${randomToken(6)}_${randomToken(32)}`;
  // A SHA-256 of a 256-bit random secret is sufficient (no need for a slow KDF); only the hash is stored.
  return { key, keyPrefix: key.slice(0, 11), keyHash: sha256(key) };
}
