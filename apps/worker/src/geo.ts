import { readFileSync, existsSync } from 'node:fs';
import { Reader, type CityResponse } from 'maxmind';
import type { Logger } from 'pino';

export interface GeoResult {
  country: string | null; // ISO 3166-1 alpha-2
  region: string | null;
  city: string | null;
}
export interface GeoLookup {
  lookup(ip: string): GeoResult;
}

const NONE: GeoResult = { country: null, region: null, city: null };
export const noGeo: GeoLookup = { lookup: () => NONE };

/**
 * Offline lookup against a local .mmdb (DB-IP / MaxMind city database); never makes a network call.
 * Only country, region and city names are used: coordinates are deliberately not extracted, so
 * location is never more precise than a city. Missing database => all-null results (clicks are
 * still recorded).
 */
export function loadGeo(path: string, logger: Logger): GeoLookup {
  if (!existsSync(path)) {
    logger.warn(
      { path },
      'GeoIP database not found; country/region/city will be empty. Run scripts/download-geoip.sh',
    );
    return noGeo;
  }
  const reader = new Reader<CityResponse>(readFileSync(path));
  const clip = (v: string | undefined) => (v ? v.slice(0, 100) : null);
  return {
    lookup(ip) {
      try {
        const r = reader.get(ip);
        if (!r) return NONE;
        return {
          country: r.country?.iso_code ?? r.registered_country?.iso_code ?? null,
          region: clip(r.subdivisions?.[0]?.names?.en),
          city: clip(r.city?.names?.en),
        };
      } catch {
        return NONE; // invalid IP string etc.
      }
    },
  };
}
