# AGENTS.md

## Module Context
- Scope: Database schema, migrations, storage policies, and edge-function deployment context in `supabase/*`.
- Responsibility: Data integrity, security policies, and backend contract stability.
- Dependencies: `supabase/schema.sql`, `supabase/migrations/*`, `supabase/functions/*`, app/web consumers.

## Tech Stack & Constraints
- Supabase Postgres with RLS.
- Supabase Edge Functions (Deno) for privileged backend operations.
- Storage bucket access governed by policy and role constraints.
- Sensitive identity data must remain encrypted and segregated.

## Implementation Patterns
- Keep schema changes additive and migration-backed.
- Update `schema.sql` and a new migration in the same change.
- Preserve stable column names and status values unless explicit migration path is included.
- Keep policy and function assumptions aligned (RLS + service-role behavior).
- Reuse existing tables and contracts where possible before adding new entities.

## Testing Strategy
- Validate SQL changes in local/linked Supabase before merge.
- Smoke checks:
  - key onboarding queries on `fc_profiles`, `fc_documents`, `notifications`
  - role-aware data access under RLS assumptions
- Deploy/test impacted Edge Functions:
  - `supabase functions deploy <function-name> --project-ref <project-ref>`

## Local Golden Rules

### Do's
- Encrypt and hash identity data using established function paths.
- Keep constraints, indexes, and defaults explicit in SQL changes.
- Document behavior-impacting schema changes in project docs/work logs.

### Don'ts
- Do not store resident numbers or passwords in plaintext.
- Do not merge schema updates without migration files.
- Do not change backend contracts without coordinating app/web call sites.
