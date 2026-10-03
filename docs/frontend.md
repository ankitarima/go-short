# Frontend (`apps/web`)

A single-page app: React 19, Vite, TypeScript (strict), Tailwind CSS v4, Radix primitives, TanStack Query, React Router 7. The visual language follows the Vercel/Geist design system: hairline borders, a black primary button, soft status pills, a restrained palette, true-black dark mode and the Geist fonts (OFL-1.1, self-hosted via `@fontsource-variable`).

## Running it

```bash
npm run dev:infra   # Postgres + Valkey (Docker)
npm run dev         # api :4000, worker, redirect :4001 and web :5173 together
```

Vite proxies `/api/*`, `/api-docs`, `/openapi.json`, `/health` and `/ready` to `VITE_API_PROXY` (default `http://localhost:4000`), so the browser talks to one origin and session cookies work without CORS.

> **Proxy rule must be `/api/` (with the slash), not `/api`.** The SPA has a client route `/api-keys`; a prefix match on `/api` sends it to the API and returns a 404. The same applies to any reverse proxy in production.

`scripts/seed-demo.ts` fills a local database with a demo user, workspace, campaigns, links, a QR code, an API key, a webhook and synthetic clicks (ingested through the real worker pipeline), so every screen has data.

## Structure

| Path                     | Contents                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/globals.css` | Design tokens (light/dark CSS variables), type scale utilities, animations                                                 |
| `src/components/ui`      | Design-system primitives (button, input, dialog, table, tabs, badge, skeleton, ...)                                        |
| `src/components/layout`  | App shell, sidebar, mobile drawer, workspace switcher, user menu, theme toggle                                             |
| `src/components/charts`  | Timeline chart and breakdown lists                                                                                         |
| `src/features/*`         | One folder per area: auth, workspaces, dashboard, links, campaigns, qr, analytics, domains, team, apikeys, settings, admin |
| `src/lib`                | `api.ts` fetch wrapper, formatting, colour/contrast helpers                                                                |
| `src/hooks/useAuth.tsx`  | `/me` query, active workspace, role helpers                                                                                |
| `src/stores/ui.ts`       | Persisted theme and active workspace id (nothing else is persisted)                                                        |
| `src/test`               | MSW server, fixtures, `renderApp()` that mounts the real route table                                                       |

## Behaviour worth knowing

- **Server is the authority.** The UI hides actions the role cannot perform (`atLeast(role, min)`), but every rule is enforced by the API; the UI never relies on its own checks for security.
- **Auth.** Session cookie (HttpOnly) plus a CSRF token that is returned by `/me`, kept in memory only and sent as a header on non-GET requests. A `401` anywhere resets the session query and redirects to `/login`, remembering where the user was.
- **Pagination** uses the API's cursors with "Load more" (infinite queries); search is debounced.
- **QR designer** renders its live preview through `POST /qr/preview` (stateless, nothing stored), so the preview is byte-identical to what is downloaded. Colour pairs that would not scan (`lib/color.ts` mirrors the server rules) show a warning and block saving. A logo forces error-correction level H.
- **Analytics** shows the numbers the API returns, including the accuracy notes (approximate uniques, bots flag, timezone). Unique visitors are clamped server-side so they can never exceed clicks.
- **API keys** are shown exactly once, in a dialog, at creation.
- **Dark mode** follows the system by default; a script in `index.html` applies the saved theme before first paint.

## Testing

```bash
npm test --workspace @go-short/web
```

Vitest + jsdom + Testing Library + MSW (`onUnhandledRequest: 'error'`, so a screen calling an endpoint the test did not expect fails). Tests mount the real route table, so guards, redirects, the shell and lazy routes are exercised, not mocked. They cover auth flows, session expiry, role-based UI, links, campaigns, QR designer, analytics filters and requests, team rules, API key reveal/revoke, and smoke tests for the dashboard, domains and settings. The platform admin screens live in the separate [console](console.md). Browser-level end-to-end tests with Playwright are phase 16; Playwright was only used during development to check the UI visually in light, dark and mobile widths.

## Production headers

The SPA must be served with the headers in `security-headers.ts` (strict CSP with `script-src 'self'`, `frame-ancestors 'none'`, `nosniff`, referrer and permissions policies). The theme bootstrap lives in `public/theme-init.js` rather than inline for that reason. Check the real build with `npm run build && npm run preview` (port 4173, same proxy rules, same headers).

## Public documentation (`/docs`)

The documentation site lives in the web app, is public (no sign-in), and has two areas selected from the header: **Guides** (how to use the platform) and **API reference**. Search (`Ctrl/⌘ K`), a table of contents, previous/next links, dark mode and a mobile layout are built in.

- **Guides** are Markdown files in `src/features/docs/content/*.md`, bundled at build time. Front matter: `title`, `description`, `area` (`guides` or `api`), `section`, `order`, and an optional `slug`. Callouts use `> [!NOTE]`, `> [!TIP]` or `> [!WARNING]`. Add a page by adding a file; the sidebar, search and previous/next links pick it up.
- **API reference** is generated at runtime from `/openapi.json`, the same OpenAPI document the API enforces in its tests, so it cannot drift from the real API. It shows only the operations an API key can call (the flat `/api/v1/...` routes): parameters, request body fields with limits, responses, and ready-to-copy cURL, JavaScript and Python samples with example responses built from the schemas. Session-only and admin operations are not listed.
- The Swagger UI that used to be at `/docs` moved to **`/api-docs`** on the API itself, for internal developers. The edge does not proxy it in production (reach it on the API container); in development the Vite proxy forwards it.
- Tests (`src/features/docs/docs.test.tsx`) check every guide's front matter, internal links and code fences, that the reference lists exactly the key-callable operations, the samples, search, and the rendered pages.

## Auth screens

Sign-in, registration, password reset, email verification and invitation screens share a split layout (`features/auth/AuthLayout.tsx`): the form on the right, and on the left an always-dark product panel (what goShort is, four capability points, an illustration, links to the docs and security page) whose headline follows the page (`/login`: welcome back, `/register`: get started). On phones only the form is shown.

## Marketing site (`/`)

The public site shares one header (a mega menu for **Products**, **Solutions** and **Resources**, plus Security, Docs, theme toggle and sign-in) and a full footer. It lives in `src/features/marketing/`:

| Route                                                                    | Page                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `/`                                                                      | Home: product tabs, the three products, why goShort, solutions, developers, trust                        |
| `/products/golinks`, `/products/gocampaigns`, `/products/goanalytics`    | Dedicated product pages (hero, feature sections with illustrations, feature grid, FAQ, related products) |
| `/solutions/marketing`, `/agencies`, `/developers`, `/events-and-retail` | Solution pages (challenges, three steps, products used)                                                  |
| `/security`                                                              | Security and privacy, including what is **not** claimed                                                  |

Content is data-driven: `data.ts` (products, solutions, resources used by the mega menu and footer) and `content.tsx` (page copy). To add a product or solution, add it to both and the menus, footer and routes pick it up. Illustrations in `mocks.tsx` are static and decorative; they show no customer data or invented metrics, and the pages label them "Illustrative interface". There are no customer logos, testimonials or pricing, because none exist. Each page sets its own title and description.
