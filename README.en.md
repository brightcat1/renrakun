# renrakun

`renrakun` is a household restock messenger PWA built for tap-only interactions.  
It keeps shopping requests out of daily chat noise with a dedicated panel + inbox workflow.

## MVP Features

- Touch-panel UI for fast request creation
- Group join via invite link + passphrase (no account registration)
- Request status flow: `Requested` / `In progress` / `Completed`
- Lock-screen push summaries (who + what)
- Group creator can manage custom tabs/items
- Free-tier guardrails (daily limits, auto resume, staged cleanup)

## Architecture & Tech Stack

- **Web**: React + TypeScript + Vite + `vite-plugin-pwa` (Cloudflare Pages)
- **API**: Cloudflare Workers (Hono) + D1
- **State**: Durable Objects (QuotaGate)
- **Shared**: `packages/shared` (Zod schemas + shared types)
- **Monorepo**: pnpm workspace

```mermaid
graph TD
  subgraph Client["Client (Browser / PWA)"]
    UI["Web App\n(React + Vite PWA)"]
    SW["Service Worker"]
    LS[("LocalStorage\n(Session/Device)")]
  end

  subgraph Edge["Cloudflare Edge"]
    API["Workers API\n(Hono)"]
    DO[("Durable Object\nQuotaGate")]
    DB[("D1 Database")]
    CRON["Cron Trigger\n(Daily Maintenance)"]
  end

  subgraph Push["Web Push Service"]
    PS["Apple / Google / Mozilla"]
  end

  UI -->|REST| API
  UI -->|Store/Read| LS
  UI -->|Sync Context| SW

  API -->|Read/Write + Activity Tracking| DB
  API -->|Quota Check| DO
  API -->|Trigger Push| PS

  PS -.->|Push Event| SW
  SW -->|GET /api/push/pending| API
  API -->|Fetch & Mark Delivered| DB
  SW -->|Show Notification| UI

  CRON -->|Quota Reset & Auto Cleanup| API
  API --> DB
```

## Local Development Setup

1. Install dependencies

```bash
pnpm install
```

2. Prepare env files

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

- Set `VITE_API_BASE_URL=http://127.0.0.1:8787` in `apps/web/.env`
- Set `APP_ORIGIN=http://localhost:5173` in `apps/api/.dev.vars`
- For push testing, generate keys with `npx web-push generate-vapid-keys --json` and set values in both files

3. Apply local migrations

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --local
```

4. Start dev servers

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Web
pnpm dev:web
```

## Production Setup

1. Apply remote migrations (initial + schema updates)

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --remote
```

2. Register push secrets

```bash
cd apps/api
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_SUBJECT
```

## CI/CD

- API: GitHub Actions -> Cloudflare Workers auto deploy
- Web: Cloudflare Pages auto build/deploy
- API migrations in CI run with:

```bash
d1 migrations apply renrakun --remote --auto-confirm
```

This avoids interactive prompts in GitHub Actions.

## Push Troubleshooting

If push is not arriving, check in this order:

1. Tap `Resync notifications` in the app
2. Check member push state in `Members in group`
3. Verify migration status (`--local` / `--remote`)
4. Check API logs via `wrangler tail`

## PWA Lifecycle & Data Sync (Specifications)

- The client is delivered and updated through the Service Worker update flow; reinstall is not part of the release/update model.
- A new Service Worker activates (`skipWaiting` + `clientsClaim`). The UI bundle is picked up by a client reload that is intentionally triggered when the document transitions to background (`visibilityState: hidden`) to avoid disruptive mid-task reloads.
- Private data refresh policy (authenticated sessions only) is a hybrid strategy:
  - push-driven refresh via Service Worker `postMessage` (`REFRESH_DATA`),
  - refresh on `focus` / `online` / `visibilitychange` (return to visible),
  - visible-only polling every 45 seconds.
- Auto-sync refresh is serialized and throttled (minimum interval: 5 seconds) and is suppressed while an explicit load is in progress.
- A manual `Refresh` action remains available as a fallback mechanism.

## Manual Maintenance via Activity Tracking (last_activity_at)

To ensure long-term stability within D1 free-tier storage limits (500MB), the system tracks user activity.

### 1. Design Rationale & Trade-offs

We deliberately prioritized "activity metrics for manual cleanup" over "full automation" for the following reasons:

* **Write Quota Optimization (Rows Written)**: Read-only operations (e.g., fetching inbox, catalog, or layout) do not update the last_activity_at timestamp. This preserves the Cloudflare D1 "Rows Written" quota by avoiding unnecessary writes during routine browsing.
* **Data Integrity**: Given the personal nature of the data, we avoid the risk of accidental deletion by automated scripts. Final deletion decisions are left to the operator.
* **Pragmatism**: The text-based data model is extremely lightweight. Since it takes years to reach the 500MB limit, fully automated GC for active groups is currently considered "over-engineering."

### 2. Update Rules

* **Updated on**: Write actions (e.g., group creation/joining, request creation/updates, catalog edits).
* **Not Updated on**: Read-only APIs (catalog, layout, inbox, push pending, etc.).

### 3. Manual SQL Example (180+ Days Inactive)

SELECT 
  g.id, 
  COALESCE(g.last_activity_at, g.created_at) as effective_last_activity, 
  COUNT(m.id) as members
FROM groups g
LEFT JOIN members m ON g.id = m.group_id
WHERE COALESCE(g.last_activity_at, g.created_at) < date('now', '-180 days') -- 別名ではなく元の式を書く
  AND NOT EXISTS (
    SELECT 1 FROM requests r 
    WHERE r.group_id = g.id AND r.status IN ('requested', 'acknowledged')
  )
GROUP BY g.id;

## Specifications & Limitations

- **iOS Compatibility**: iOS Web Push depends on OS version, Home Screen install, and notification permission.
- **Privacy**: Lock-screen summaries can expose request text; avoid sensitive data in requests.
- **Write Limits**: APIs are paused at daily free-tier limits and auto-resume at 00:00 JST to protect infrastructure.
- **Retention**: Completed requests are purged after 14 days by default. "Requested" and "In progress" statuses are not auto-purged.
- **Unused Groups**: Groups meeting specific criteria (e.g., single member, no push setup) are staged for cleanup via Cron Trigger (60-day candidate period + 30-day grace).
- **Scope**: Price comparison, inventory sync, and external e-commerce integrations are out of MVP scope.
