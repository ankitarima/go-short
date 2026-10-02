# Third-party licenses

This project's own code is MIT-licensed (see `LICENSE`). It depends on the open-source components below.
Versions and licenses were read from the installed packages / running images, not recalled from memory;
re-verify when upgrading (`npm ls`, `npm view <pkg> license`). Transitive dependencies are not listed individually.

## Runtime dependencies

| Package                                    | Version         | License                   | Used for                                                        |
| ------------------------------------------ | --------------- | ------------------------- | --------------------------------------------------------------- |
| express                                    | 5.2.1           | MIT                       | API server                                                      |
| helmet                                     | 8.3.0           | MIT                       | Security headers                                                |
| cors                                       | 2.8.6           | MIT                       | CORS                                                            |
| cookie-parser                              | 1.4.7           | MIT                       | Session cookie parsing                                          |
| pino / pino-http                           | 10.3.1 / 11.0.0 | MIT                       | Structured logging                                              |
| zod                                        | 4.6.5           | MIT                       | Validation                                                      |
| argon2                                     | 0.45.1          | MIT                       | Password hashing (Argon2id)                                     |
| nanoid                                     | 5.1.16          | MIT                       | Slug generation                                                 |
| ioredis                                    | 6.0.0           | MIT                       | Redis/Valkey client                                             |
| bullmq                                     | 6.3.11          | MIT                       | Job queue                                                       |
| @prisma/client, @prisma/adapter-pg, prisma | 7.10.0          | Apache-2.0                | ORM and migrations                                              |
| pg                                         | 8.23.1          | MIT                       | PostgreSQL driver                                               |
| proxy-addr                                 | 2.0.8           | MIT                       | Trusted-proxy client IP                                         |
| bowser                                     | 2.14.1          | MIT                       | User-agent parsing                                              |
| isbot                                      | 5.2.2           | Unlicense (public domain) | Bot detection                                                   |
| maxmind                                    | 5.0.7           | MIT                       | Offline GeoIP database reader                                   |
| qrcode                                     | 1.5.4           | MIT                       | Local QR code generation (SVG/PNG)                              |
| pngjs                                      | 7.0.0           | MIT                       | PNG decode/encode for logo sanitizing and compositing (pure JS) |
| jpeg-js                                    | 0.4.4           | BSD-3-Clause              | JPEG decode for logo uploads (pure JS)                          |
| swagger-ui-dist                            | 5.33.0          | Apache-2.0                | API reference UI served at `/docs` (bundled, no CDN)            |
| prom-client                                | 15.x            | Apache-2.0                | Prometheus metrics (served on a separate, non-public port)      |

### Frontend (`apps/web`, bundled into the browser app)

| Package                                                                                                                 | License    | Notes                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| react, react-dom, react-router-dom, @tanstack/react-query, recharts, zustand, sonner, clsx, tailwind-merge, @radix-ui/* | MIT        | UI framework, routing, data, charts, state, toasts, primitives                     |
| class-variance-authority                                                                                                | Apache-2.0 | component variants                                                                 |
| lucide-react                                                                                                            | ISC        | icons                                                                              |
| @fontsource-variable/geist, @fontsource-variable/geist-mono                                                             | OFL-1.1    | Geist fonts, self-hosted (the font license applies to the font files, not the app) |

Build/test only: vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, msw, @testing-library/*, jsdom (MIT); @playwright/test (Apache-2.0, used for development screenshots).

## Development dependencies

typescript (Apache-2.0), eslint, typescript-eslint, prettier, vitest, tsup, tsx, concurrently (one-command `npm run dev`), supertest, ajv, ajv-formats and @seriousme/openapi-schema-validator (all MIT); jsqr (Apache-2.0, decodes QR codes in tests to prove they scan).

Security scanners run ad hoc through Docker and are not dependencies: gitleaks (MIT) and Trivy (Apache-2.0).

## Data

| Dataset                 | License   | Notes                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-IP "IP to City Lite" | CC BY 4.0 | Downloaded by `scripts/download-geoip.sh`, **not** redistributed in this repository (`*.mmdb` is git-ignored). If you display geolocation derived from it, attribute: "IP Geolocation by DB-IP (https://db-ip.com)". Any `.mmdb` city database (e.g. MaxMind GeoLite2, which requires a free account and its own license terms) can be used instead. |

## Infrastructure images

| Image             | License            | Notes                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| postgres 17       | PostgreSQL License |                                                                                                                                                                                                                                                                            |
| valkey 8          | BSD-3-Clause       | Used instead of Redis, see below.                                                                                                                                                                                                                                          |
| prometheus 3      | Apache-2.0         | Optional monitoring stack (`docker-compose.monitoring.yml`).                                                                                                                                                                                                               |
| grafana-oss 13    | AGPL-3.0           | Optional monitoring stack. Free to self-host; used unmodified as a **separate service** (nothing in goShort links to it), so the AGPL does not extend to this project. If you modify Grafana and offer it to others over a network, its source-sharing terms apply to you. |
| postgres_exporter | Apache-2.0         | Optional monitoring stack.                                                                                                                                                                                                                                                 |
| redis_exporter    | MIT                | Optional monitoring stack; works with Valkey.                                                                                                                                                                                                                              |

## Decisions about licensing

- **User-agent parsing:** `ua-parser-js` 2.x is AGPL-3.0-or-later (commercial license otherwise), so it is deliberately **not** used. `bowser` (MIT) is used instead.
- **Redis vs Valkey:** Redis 7.4 and later are source-available (RSALv2 / SSPLv1), not OSI open source, and Redis 8 adds an AGPLv3 option. To keep the default stack permissively licensed, the compose files use **Valkey** (BSD-3-Clause, the Linux Foundation fork), which speaks the same protocol; BullMQ and ioredis work unchanged. Operators who prefer Redis (for example 7.2.x, the last BSD release) can substitute it by changing only the image.
- **GeoIP:** no GeoIP database is bundled; operators fetch one and accept its license.
- **Images:** logo processing uses pure-JS libraries (`pngjs`, `jpeg-js`) instead of `sharp`, avoiding native binaries and the LGPL libvips they bundle.
