> Current hosted-Neon setup: [APPLICATION_GUIDE.md](../APPLICATION_GUIDE.md).
> Do not run the legacy migration commands below against Neon. Reporting views
> are supplied by the manual SQL supplement; no local database is required.

﻿# Forever Hotel frontend — DDP-001–008

Next.js App Router, React, TypeScript and Tailwind foundation. The existing white,
gray-bordered design is retained. Login, password change, sign out and responsive
protected navigation are implemented. All 12 navigation destinations are shells;
later-ticket charts, forms and sample records have been removed.

Use Node 22.14.x (see `../.nvmrc`) and npm 10 or later. From this directory:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

| Setting               | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Required public API/gateway URL, validated when Next.js loads its configuration; embedded at build time |
| `BACKEND_API_URL`     | Server-only reachable API/gateway base URL; BFF requests use this address                               |
| `BACKEND_API_MODE`    | `gateway` (default) maps auth/health through `/mad`; `direct` targets MAD directly                       |
| `APP_ORIGIN`          | Exact browser origin, without a path; used for CSRF checks and cookie security                          |

Browser authentication requests go to same-origin `/api/auth/*` routes. The BFF
keeps tokens in HttpOnly, SameSite=Strict cookies (Secure on HTTPS), forwards bearer
tokens on the server and returns only safe session fields. It never stores tokens
or passwords in localStorage/sessionStorage. Set an HTTPS origin for shared hosts.

`npm run build` produces a standalone build. `npm run start` serves the local
production build. Docker starts `.next/standalone/server.js`. `npm run lint` and
`npm run format:check` are read-only; `npm run format` explicitly formats files.
`npm run test:cov` and `npm run test:e2e` are the existing CI verification commands.

`GET /api/health` reports readiness only when the backend reports database
readiness. The login page displays service unavailability and a retry link during
an outage. MAD authenticates managers locally; provision an account before signing in.

See the [application guide](../APPLICATION_GUIDE.md) for the complete local
Compose stack, gateway routing, manager provisioning and troubleshooting.
