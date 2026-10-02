/**
 * Response headers the production web server (Caddy, phase 15) must send with the SPA.
 * Single source of truth: `vite preview` serves them too, so the build can be checked in a browser
 * against exactly the policy that production uses.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'", // no inline script, no eval, no third-party script
  "style-src 'self' 'unsafe-inline'", // toast library injects a <style> element at runtime
  "img-src 'self' data: blob:", // blob: = the QR designer's live preview
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
