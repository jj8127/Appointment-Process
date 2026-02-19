# AGENTS.md

## Module Context
- Scope: Supabase Edge Function handlers in `supabase/functions/*`.
- Responsibility: Privileged operations for auth, FC/admin actions, notifications, document workflows, and identity protection.
- Dependencies: `@supabase/supabase-js`, Deno runtime APIs, shared helpers under `supabase/functions/_shared`.

## Tech Stack & Constraints
- Runtime: Deno (HTTP functions via `serve`).
- Language: TypeScript.
- Auth model: service-role checks for privileged/internal operations.
- CORS and origin handling must remain explicit and controlled by environment.

## Implementation Patterns
- Keep handlers small and action-oriented with explicit validation.
- Return stable JSON contracts:
  - success: `{ ok: true, ... }`
  - failure: `{ ok: false, message: string }`
- Centralize shared logic in `_shared/*` instead of duplicating helpers.
- Validate and sanitize all incoming payloads before DB writes.
- Keep sensitive operations gated (internal-only checks where required).

## Testing Strategy
- Local checks:
  - `supabase functions serve <function-name>`
  - invoke with representative payloads for both success and failure paths
- Deployment smoke checks:
  - `supabase functions deploy <function-name> --project-ref <project-ref>`
  - verify environment variables and CORS behavior
- Regression checks:
  - existing client callers still parse `ok/message` correctly
  - admin-only actions reject unauthorized requests

## Local Golden Rules

### Do's
- Fail fast on missing environment variables.
- Keep DB operations explicit and auditable.
- Normalize phone/id inputs before lookups or mutations.

### Don'ts
- Do not return raw internal errors to clients without sanitizing message content.
- Do not expose service-role secrets or assume client trust.
- Do not introduce silent contract changes in response payload shape.
