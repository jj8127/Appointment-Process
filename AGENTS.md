# AGENTS.md

## Project Context & Operations

### Business Goal
- Build and operate a dual-platform FC onboarding system for insurance agents.
- Keep FC onboarding workflow and admin operations consistent across mobile app, admin web, and backend services.
- Protect sensitive identity data while preserving existing API and workflow behavior.

### Tech Stack
- Mobile app: Expo (React Native, Expo Router, TanStack Query)
- Admin web: Next.js App Router (Mantine, TanStack Query)
- Backend: Supabase Postgres, Storage, Edge Functions (Deno)
- Shared language/runtime: TypeScript, Node.js

### Operational Commands
```bash
# Root (mobile app and shared code)
npm install
npm start
npm run android
npm run ios
npm run lint
npm test
npm run test:coverage
```

```bash
# Admin web
cd web
npm install
npm run dev
npm run build
npm run lint
```

```bash
# Supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy <function-name> --project-ref <project-ref>
supabase secrets list --project-ref <project-ref>
```

## Current Status & Roadmap

### Snapshot (2026-02-16)
- Project is operating as a dual-platform monorepo: Expo mobile app + Next.js admin web + Supabase backend.
- Core FC onboarding flow is implemented end-to-end: signup, OTP/password, identity gate, consent, exam, docs, appointment, completion.
- Manager read-only mode is implemented and must stay enforced across dashboard, exam, notice, and chat areas.
- Auth is custom (phone + password via Edge Functions) and session state is based on `use-session`, not Supabase Auth session.
- Sensitive identity flow is established: encrypted resident number storage and service-role mediated access path.
- Recent stabilization work (2026-02-10 to 2026-02-11) focused on RLS-safe server APIs, notifications/notices reliability, exam deadline handling, and release hygiene cleanup.

### Canonical Workflow State
- User roles
  - `fc`: signup, identity, consent, exam apply, docs upload, appointment execution
  - `admin`: status updates, approvals, notices/notifications, exam operations
  - `manager`: read-only monitoring on web (no write actions)
- FC status values (source of truth: `types/fc.ts`)
  - `draft`
  - `temp-id-issued`
  - `allowance-pending`
  - `allowance-consented`
  - `docs-requested`
  - `docs-pending`
  - `docs-submitted`
  - `docs-rejected`
  - `docs-approved`
  - `appointment-completed`
  - `final-link-sent`
- Primary business flow
  - Signup and OTP/password set
  - Identity verification and basic info
  - Temp ID issue
  - Allowance consent and approval
  - Exam schedule/apply
  - Docs request/upload/review
  - Appointment schedule/completion
  - Final completion

### Active Roadmap
1. Backend and security hardening
- Keep admin write paths on trusted server/Edge Function routes only.
- Continue tightening CORS/origin/env validation and response-contract stability.
- Keep schema and migrations synchronized for every DB change.

2. Workflow consistency and regression prevention
- Align status transitions across mobile app, web dashboard, and Edge Functions.
- Prevent regressions in identity gate, docs approval/rejection, and appointment transitions.
- Expand targeted tests around status branching and authorization behavior.

3. Admin and manager UX reliability
- Preserve manager read-only behavior with explicit disabled controls in all write-capable views.
- Improve error visibility and fallback behavior for notice/chat/notification flows.
- Keep query invalidation and refresh paths deterministic after mutations.

4. Release and operations readiness
- Maintain Android/iOS release settings and deployment command accuracy.
- Keep governance docs and code changes synchronized in every functional PR.
- Maintain clean repository state by avoiding committed build artifacts and sensitive local configs.

### Working Backlog (Track in This File)
- In progress
  - Harden admin write paths to be consistently server-mediated.
  - Guard status transition consistency between mobile, web, and Edge Functions.
  - Add focused regression coverage for docs and appointment branching.
- Next
  - Expand notice/notification fallback and failure visibility.
  - Verify manager read-only behavior on all new dashboard actions.
  - Normalize date/deadline handling rules across UI and backend.
- Blockers/Risks
  - RLS and service-role path mismatch can silently break admin writes.
  - Schema-to-migration drift can cause deployment failures.
  - Status condition drift across app/web/function layers can cause UX inconsistencies.

### Progress Recording Protocol
- `AGENTS.md` is the primary quick-status file for current progress and roadmap.
- Update this section whenever work changes delivery status, risks, or roadmap priorities.
- Add new entries at the top of the ledger and keep the latest 30 entries.
- Entry format:
  - `YYYY-MM-DD | Scope | Change | Key Files | Verification | Next`
- If details are large, keep one-line summary here and reference deeper docs as optional support.

### Session Start Checklist
- Read `Current Status & Roadmap` and `Progress Ledger` in this file.
- Verify latest commits: `git log --oneline -10`.
- Check changed files and active branch before editing.
- Review similar implementation patterns in nearby modules before coding.

### Session Close Checklist
1. Add a new top entry in `Progress Ledger` with changed files and verification method.
2. Update `Working Backlog` statuses (move completed tasks, add new risks/next items).
3. If status model or rules changed, update `Snapshot` and `Canonical Workflow State`.
4. If schema changed, verify both `supabase/schema.sql` and `supabase/migrations/*.sql` were updated.
5. If CI/governance assumptions changed, update this file in the same change set.

### Governance Validation Rules
- Documentation and schema governance checks are enforced in CI:
  - `.github/workflows/governance-check.yml`
  - `.github/pull_request_template.md`
- Required consistency checks:
  - docs and code changes stay synchronized for behavior-impacting work
  - schema and migrations stay synchronized for DB changes
  - auth/role behavior remains compatible with existing read-only and status constraints

### Progress Ledger
- `2026-02-11 | Release/Build | Applied Android release minify and shrink resources settings | app.json | Config reviewed in repo | Validate release pipeline on next build`
- `2026-02-11 | Security/Governance | Removed sensitive local configs and non-source test artifacts from tracking | .gitignore, testsprite_tests/* | Git status and policy checks | Keep local-secret hygiene rules enforced`
- `2026-02-11 | Stability Cleanup | Removed unneeded build bundles and unreferenced modules | dist-web-new2/*, app/admin-register.tsx | Repo scan and dependency checks | Watch for accidental artifact reintroduction`
- `2026-02-11 | Notifications | Fixed app notification center persistence path (`fc-notify`) and linked delivery flow | supabase/functions/fc-notify/index.ts, web/src/app/actions.ts | Functional flow reviewed | Add regression checks for push + stored notice parity`
- `2026-02-11 | Exams | Normalized exam registration deadline handling to end-of-day semantics | app/exam-apply.tsx, web/src/app/dashboard/exam/schedule/page.tsx | Cross-view behavior check | Keep date rule consistency in API/server paths`
- `2026-02-11 | Docs Deadline | Corrected docs deadline reminder timing and admin API alignment | supabase/functions/docs-deadline-reminder/index.ts, web/src/app/api/admin/fc/route.ts | Logic-path review | Add alert coverage for reminder edge times`
- `2026-02-11 | Notices | Routed web notices through server API for RLS-safe access | web/src/app/api/admin/notices/route.ts | Endpoint behavior verified | Keep notice access server-mediated`
- `2026-02-10 | Web Runtime | Mitigated Windows Next.js dev lockfile conflicts | web/scripts/clean-next.mjs | Local dev command validation | Monitor for dev startup regressions`
- `2026-02-10 | Auth Session | Stabilized web session cookie sync and API auth reliability | web/src/hooks/use-session.tsx | Dashboard auth flow validation | Continue auth edge-case hardening`
- `2026-02-10 | Applicants UX | Improved exam applicants UI typing and resident-number display handling | web/src/app/dashboard/exam/applicants/page.tsx | UI and type checks | Keep PII display policy consistent`

## Golden Rules

### Immutable
1. Never store resident number plaintext in database, logs, or client payloads.
2. Keep admin write operations behind trusted server paths (Edge Functions/service-role context), not direct anon client writes.
3. Preserve role model behavior: `admin` write, `manager` read-only, `fc` self-service.
4. When schema changes, update both `supabase/schema.sql` and matching `supabase/migrations/*.sql`.
5. Preserve existing Edge Function response contract (`ok`, `message`) unless migration is explicitly coordinated.

### Do's
- Use `use-session` state (`role`, `residentId`, read-only flags) as the app authorization source.
- Reuse existing shared modules before adding new utilities (`lib/*`, `components/*`, `hooks/*`).
- Use TanStack Query patterns (`useQuery` for reads, `useMutation` + invalidation for writes).
- Keep route/file conventions of Expo Router and Next App Router.
- Add/update docs when behavior or rules change (`.claude/PROJECT_GUIDE.md`, `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`).

### Don'ts
- Do not hardcode keys, tokens, or service credentials.
- Do not bypass RLS constraints by adding unsafe client-side privileged writes.
- Do not break status progression or redefine existing status strings without migration planning.
- Do not add manager write paths in UI or API.
- Do not ship schema-only or code-only changes when both layers are required.

## Standards & References

### Coding Standards
- TypeScript strictness first; avoid broad `any`.
- Handle unknown errors defensively (`unknown` -> `Error` narrowing).
- Keep business logic centralized and avoid duplicate workflow logic across mobile/web.
- Prefer small, composable modules and explicit types in shared contracts (`types/*`, `contracts/*`).

### Git Strategy and Commit Format
- Branch from latest mainline and keep changes scoped by domain.
- Use conventional commit style observed in repository history:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `chore(scope): ...`
  - `docs(scope): ...`
- Keep each commit buildable and logically atomic.

### References
- Primary policy: `.claude/PROJECT_GUIDE.md`
- Work logs: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`
- Commands: `docs/guides/COMMANDS.md`
- Contracts: `contracts/database-schema.md`, `contracts/api-contracts.md`, `contracts/component-contracts.md`
- Architecture decisions: `adr/README.md`
- Legacy AI context doc: `CLAUDE.md` (optional deep reference)

### Maintenance Policy
- If implementation and AGENTS rules diverge, update AGENTS and linked docs in the same change set.
- If a new high-context zone appears (new framework, new package boundary, or dense domain module), add a local `AGENTS.md`.
- Prefer explicit rule updates over ad-hoc comments in PRs.

## Context Map (Action-Based Routing)
- **[Mobile screens and navigation (Expo Router)](./app/AGENTS.md)** - Use when editing `app/*` routes, navigation stacks, or FC/admin mobile flows.
- **[Mobile shared UI components](./components/AGENTS.md)** - Use when changing reusable React Native UI, status controls, headers, or shared visual patterns.
- **[Mobile session and behavior hooks](./hooks/AGENTS.md)** - Use when modifying auth/session, identity gates, or platform-specific hook logic.
- **[Admin web application (Next.js)](./web/AGENTS.md)** - Use when working in `web/*`, including dashboard pages, route handlers, and manager read-only behavior.
- **[Supabase schema and backend policy](./supabase/AGENTS.md)** - Use when changing DB schema, migrations, storage/RLS, or backend data contracts.
- **[Supabase Edge Functions implementation](./supabase/functions/AGENTS.md)** - Use when implementing or updating Deno function handlers and shared function utilities.
