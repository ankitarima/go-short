# Frontend (`apps/web`)

A single-page app: React 19, Vite, TypeScript (strict), Tailwind CSS v4, Radix primitives, TanStack Query, React Router 7. The visual language follows the Vercel/Geist design system: hairline borders, a black primary button, soft status pills, a restrained palette, true-black dark mode and the Geist fonts (OFL-1.1, self-hosted via `@fontsource-variable`).

## Running it

```bash
npm run dev:infra   # Postgres + Valkey (Docker)
npm run dev         # api :4000, worker, redirect :4001 and web :5173 together
```

Vite proxies `/api/*`, `/docs`, `/openapi.json`, `/health` and `/ready` to `VITE_API_PROXY` (default `http://localhost:4000`), so the browser talks to one origin and session cookies work without CORS.

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

Vitest + jsdom + Testing Library + MSW (`onUnhandledRequest: 'error'`, so a screen calling an endpoint the test did not expect fails). Tests mount the real route table, so guards, redirects, the shell and lazy routes are exercised, not mocked. They cover auth flows, session expiry, role-based UI, links, campaigns, QR designer, analytics filters and requests, team rules, API key reveal/revoke, and smoke tests for the dashboard, domains, settings and admin. Browser-level end-to-end tests with Playwright are phase 16; Playwright was only used during development to check the UI visually in light, dark and mobile widths.
