# FC Onboarding App Instructions

## Sources of truth

- The nearest nested `AGENTS.md` adds module rules. Product and release contracts live in `docs/handbook/`, `docs/referral-system/`, `.claude/WORK_LOG.md`, and `.claude/MISTAKES.md`.
- Mobile, admin web, Supabase schema/functions, and Request Board integrations are one contract. Keep callers, types, migrations, and deployed-function assumptions aligned.

## Non-negotiable invariants

- Roles and managers are read-only authorization facts. Derive the actor from the signed session/JWT; never trust an actor ID supplied in a request body.
- Persist only the current and immediately previous app key. Do not log or store passwords, resident numbers, tokens, production records, or raw DOM/runtime dumps.
- Board and exam mutations must be atomic and idempotent. Schema/RPC changes require an ordered migration and matching generated/runtime contracts.
- Referral revenue demos remain fictional. Production referral evidence must be privacy-safe and must not weaken quality or access boundaries.

## Action and release boundaries

- Local edits and local tests are allowed. Ask before deploys, migrations, production queries/writes, OTA/mobile release, push delivery, Git push, or destructive cleanup.
- Preserve unrelated dirty files and untracked evidence. External or authenticated verification that has not run keeps the release verdict `HOLD`.

## Minimum verification

- Run the narrowest deterministic tests for the changed contract, then type/lint/build only for affected surfaces.
- For local web builds that must not upload artifacts, clear `SENTRY_AUTH_TOKEN`.
- Run `node scripts/ci/check-governance.mjs` when changing cross-surface contracts, release state, or handoff records.
