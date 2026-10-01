#!/usr/bin/env bash
# Downloads the free DB-IP "IP to City Lite" database (CC BY 4.0) to GEOIP_DATABASE_PATH.
#
# Licence: https://db-ip.com/db/lite.php - the data is free to use with ATTRIBUTION. If you display
# or redistribute geolocation results, include: "IP Geolocation by DB-IP (https://db-ip.com)".
# Alternative: MaxMind GeoLite2-City (free account + licence key); any .mmdb city database works.
#
# DB-IP publishes monthly and the current month is not always up yet, so this walks back up to 3 months.
set -euo pipefail

DEST="${GEOIP_DATABASE_PATH:-./storage/geoip/dbip-city-lite.mmdb}"
mkdir -p "$(dirname "$DEST")"
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.gz"' EXIT

for back in 0 1 2 3; do
  if date -u -d "$(date -u +%Y-%m-01) -$back month" +%Y-%m >/dev/null 2>&1; then
    MONTH="$(date -u -d "$(date -u +%Y-%m-01) -$back month" +%Y-%m)"      # GNU date
  else
    MONTH="$(date -u -v-"${back}"m +%Y-%m)"                                # BSD/macOS date
  fi
  URL="https://download.db-ip.com/free/dbip-city-lite-${MONTH}.mmdb.gz"
  echo "Trying ${URL}"
  if curl -fL --retry 3 -o "$TMP.gz" "$URL"; then
    gunzip -c "$TMP.gz" > "$TMP"
    mv "$TMP" "$DEST"
    echo "Saved ${DEST} (DB-IP ${MONTH}). Remember the CC BY 4.0 attribution."
    exit 0
  fi
done
echo "Could not download a DB-IP database; set GEOIP_DATABASE_PATH to your own .mmdb" >&2
exit 1
