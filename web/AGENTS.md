# AGENTS.md

## Module Context
- Scope: Admin web app in `web/*` (Next.js App Router).
- Responsibility: Admin/manager operations for FC onboarding workflow, approvals, messaging, notices, and exam operations.
- Dependencies: Supabase SSR client utilities, route handlers under `web/src/app/api/*`, shared types/contracts.

## Tech Stack & Constraints
- Next.js 16 App Router + React 19.
- Mantine UI and TanStack Query.
- Service-role operations must run server-side only (route handlers or trusted backend path).
- Manager mode remains strictly read-only in UI and mutation paths.

## Implementation Patterns
- Keep server operations in `web/src/app/api/*/route.ts` or server actions.
- Use consistent response/error envelopes for web API endpoints.
- Use query keys consistently and invalidate on successful mutations.
- Keep dashboard status logic aligned with shared status definitions.
- Preserve role-aware control states (disabled/grayed actions for read-only accounts).

## Testing Strategy
- Commands:
  - `cd web && npm run lint`
  - `cd web && npm run build`
- Manual checks:
  - Admin auth and dashboard loading
  - Manager read-only behavior (no enabled write action)
  - FC list/detail updates and document/exam operations
  - API route behavior for `/api/admin/*`, `/api/fc-delete`, `/api/fc-notify`

## Local Golden Rules

### Do's
- Keep privileged logic in server-only modules.
- Keep API handlers explicit about authorization and validation.
- Reuse shared type definitions from `web/src/types` and root `types`.

### Don'ts
- Do not expose service role keys or privileged operations to client bundles.
- Do not add write capability for manager sessions.
- Do not bypass existing admin action flow for sensitive updates.
