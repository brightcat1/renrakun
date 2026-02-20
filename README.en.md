# renrakun

**🌐 App URL:** `https://renrakun.pages.dev`

`renrakun` is a household restock messenger PWA focused on tap-only interactions.  
It keeps shopping requests out of daily chat noise by using a dedicated ordering-style interface and inbox.

## MVP Features

- Touch-panel UI to add household items and send requests quickly
- Push notifications + in-app inbox for group members
- Request status flow: `requested` / `acknowledged` / `completed`
- Admin-only custom tabs and custom item buttons per group
- Daily free-tier guard: write APIs pause on quota and auto-resume at 00:00 JST

## Architecture & Tech Stack

This project separates the frontend and backend, leveraging edge computing:

- **Web (Frontend):** React + TypeScript + Vite + `vite-plugin-pwa`. Delivered globally via Cloudflare Pages.
- **API (Backend):** Cloudflare Workers (Hono) + D1 (SQLite-based Edge DB).
- **State Management:** Durable Objects for daily quota rate-limiting.
- **Shared:** Zod schemas and domain types in `packages/shared`.
- **Monorepo:** pnpm workspace.

## Local Development Setup

1. Install dependencies:

```bash
pnpm install
```

2. Prepare environment files:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

- Set `VITE_API_BASE_URL=http://127.0.0.1:8787` in `apps/web/.env`.
- Set `APP_ORIGIN=http://localhost:5173` in `apps/api/.dev.vars` (local CORS origin).
- If you test push, run `npx web-push generate-vapid-keys --json` and set values in `apps/api/.dev.vars` plus `VITE_VAPID_PUBLIC_KEY` in `apps/web/.env`.
- Keep `APP_ORIGIN` in `wrangler.toml` as the production URL. During `pnpm dev:api` (`wrangler dev`), `.dev.vars` overrides it for local development.

3. Run local D1 migrations:

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --local
```

4. Run development servers:

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Web
pnpm dev:web
```

5. Production DB initialization (one-time):

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --remote
```

## CI/CD & Deployment

This repository implements an automated CI/CD pipeline using GitHub Actions and Cloudflare Pages.

- **API:** Automatically deployed to Cloudflare Workers via GitHub Actions when backend-related files are pushed to the `main` branch.
- **Web:** Automatically built and deployed by Cloudflare Pages on repository updates.

## How to use (Dev flow)

1. Create a group in the web app (display name + passphrase).
2. Share the invite token with your family member.
3. Select tab -> tap items -> optionally choose store -> send.
4. Receiver marks the request as `acknowledged`, then `completed`.

## Why not just use chat apps?

- No typing for regular request operations.
- Dedicated request inbox separated from daily chat conversations.
- Visible outstanding requests and status transitions.
- Household-oriented default catalog and quick buttons.

## Limitations

- PWA push support depends on browser/OS permission policies.
- Write endpoints will pause after the daily free-tier quota is exceeded.
- No price/inventory/commerce integrations in this MVP.
