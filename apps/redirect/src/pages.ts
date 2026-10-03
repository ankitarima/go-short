import { createHash } from 'node:crypto';

/** Static, self-contained error pages. No user-controlled content except the encoded slug in the unlock form. */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const layout = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f6f7f9;color:#14171c}
main{max-width:26rem;width:100%;background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:32px;text-align:center}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0;color:#4b5563}
form{display:grid;gap:12px;margin-top:20px}
input{font:inherit;padding:10px 12px;border:1px solid #c7ccd4;border-radius:8px}
.pw{position:relative;display:grid}.pw input{padding-right:44px}
.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;display:grid;place-items:center;background:transparent;color:#6b7280}
.eye[hidden]{display:none}.eye .off{display:none}.eye[aria-pressed=true] .on{display:none}.eye[aria-pressed=true] .off{display:block}
button{font:inherit;padding:10px 12px;border:0;border-radius:8px;background:#2f5bea;color:#fff;cursor:pointer}
.err{color:#b42318;margin-top:12px}
@media (prefers-color-scheme:dark){body{background:#0e1116;color:#e6e8eb}main{background:#161b22;border-color:#2a313a}p{color:#9aa4b2}input{background:#0e1116;color:inherit;border-color:#2a313a}}
</style></head><body><main>${body}</main></body></html>`;

export const notFoundPage = () =>
  layout(
    'Link not found',
    '<h1>Link not found</h1><p>This short link does not exist or has been removed.</p>',
  );
export const expiredPage = () =>
  layout(
    'Link expired',
    '<h1>This link has expired</h1><p>The owner set this link to stop working after a certain date.</p>',
  );
export const disabledPage = () =>
  layout(
    'Link disabled',
    '<h1>This link is no longer available</h1><p>The owner has disabled this link.</p>',
  );
export const errorPage = () =>
  layout(
    'Temporarily unavailable',
    '<h1>Temporarily unavailable</h1><p>Please try again in a moment.</p>',
  );
export const tooManyPage = () =>
  layout(
    'Too many attempts',
    '<h1>Too many attempts</h1><p>Please wait a few minutes before trying again.</p>',
  );

/**
 * The show/hide-password toggle is the ONLY script these pages ever run. It is allowed by its SHA-256
 * hash in the page's Content-Security-Policy (see handler), never by 'unsafe-inline', so no other inline
 * script could execute. Without JavaScript the button stays hidden and the field simply works.
 */
const TOGGLE_SCRIPT =
  "var i=document.querySelector('input[name=password]'),b=document.getElementById('pw-toggle');" +
  "if(i&&b){b.hidden=false;b.addEventListener('click',function(){var s=i.type==='password';" +
  "i.type=s?'text':'password';b.setAttribute('aria-pressed',String(s));" +
  "b.setAttribute('aria-label',s?'Hide password':'Show password');});}";
export const TOGGLE_SCRIPT_CSP_HASH = `'sha256-${createHash('sha256').update(TOGGLE_SCRIPT).digest('base64')}'`;

const EYE =
  '<svg class="on" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>' +
  '<svg class="off" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A16.5 16.5 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

export const passwordPage = (slug: string, error?: string) =>
  layout(
    'Password required',
    `<h1>This link is password protected</h1><p>Enter the password to continue.</p>
<form method="post" action="/${encodeURIComponent(slug)}/unlock" autocomplete="off">
<div class="pw"><input type="password" name="password" required maxlength="128" autofocus aria-label="Password">
<button type="button" id="pw-toggle" class="eye" hidden aria-label="Show password" aria-pressed="false">${EYE}</button></div>
<button type="submit">Continue</button></form><script>${TOGGLE_SCRIPT}</script>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}`,
  );
