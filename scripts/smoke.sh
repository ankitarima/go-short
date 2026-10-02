#!/usr/bin/env bash
# Post-deploy smoke test: is the stack up, correctly routed, and are the internal endpoints hidden?
#
#   ./scripts/smoke.sh https://app.example.com [https://go.example.com/some-slug]
#   CURL_OPTS=-k ./scripts/smoke.sh https://localhost:8443          # self-signed local test
#
# Exits non-zero on the first failed check. It only reads; it creates nothing.
set -uo pipefail
BASE="${1:?usage: smoke.sh <app base url> [short link url]}"
BASE="${BASE%/}"
SHORT="${2:-}"
CURL_OPTS="${CURL_OPTS:-}"
fail=0
check() { # description, then the command to run: it passes when the command succeeds
  local desc="$1"; shift
  if "$@"; then printf '  ok    %s\n' "$desc"; else printf '  FAIL  %s\n' "$desc"; fail=1; fi
}
c() { # shellcheck disable=SC2086
  curl -s --max-time 15 $CURL_OPTS "$@"; }
has() { grep -qi "$1" <<<"$2"; }
lacks() { ! grep -qiE "$1" <<<"$2"; }
is() { [ "$1" = "$2" ]; }
is_redirect() { case "$1" in 301|302|307|308) return 0 ;; *) return 1 ;; esac; }

echo "App: $BASE"
code=$(c -o /dev/null -w '%{http_code}' "$BASE/"); check "web app serves / (got $code)" is "$code" 200
hdr=$(c -D- -o /dev/null "$BASE/")
check "CSP with script-src 'self'" has "^content-security-policy:.*script-src 'self'" "$hdr"
check "X-Content-Type-Options" has "^x-content-type-options: nosniff" "$hdr"
check "HSTS" has "^strict-transport-security:" "$hdr"
check "X-Frame-Options" has "^x-frame-options: deny" "$hdr"
code=$(c -o /dev/null -w '%{http_code}' "$BASE/api-keys"); check "client route /api-keys is the SPA, not the API (got $code)" is "$code" 200
code=$(c -o /dev/null -w '%{http_code}' "$BASE/api/v1/me"); check "API is reachable and rejects anonymous /me (got $code)" is "$code" 401
check "OpenAPI document served" has '"openapi"' "$(c "$BASE/openapi.json")"
check "API responses are no-store" has "^cache-control:.*no-store" "$(c -D- -o /dev/null "$BASE/api/v1/me")"

for p in /metrics /internal/tls-check /ready; do
  check "$p is not exposed through the edge" lacks 'goshort_|"checks"|process_cpu' "$(c "$BASE$p")"
done

if [ -n "$SHORT" ]; then
  echo "Short link: $SHORT"
  code=$(c -o /dev/null -w '%{http_code}' "$SHORT"); check "short link redirects (got $code)" is_redirect "$code"
fi
if [ "$fail" = 0 ]; then echo "All checks passed."; else echo "Some checks FAILED."; exit 1; fi
