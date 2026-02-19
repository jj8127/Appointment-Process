# AGENTS.md

## Module Context
- Scope: Mobile app screens and route entry points in `app/*`.
- Responsibility: FC onboarding UX, admin mobile operations, and navigation flow integrity.
- Dependencies: `components/*`, `hooks/*`, `lib/*`, `types/*`, Supabase Edge Functions.

## Tech Stack & Constraints
- Expo Router file-based routes.
- React Native + Expo SDK 54.
- TanStack Query for server state.
- Session/auth source is `hooks/use-session.tsx`, not Supabase Auth session on client.
- Sensitive identity operations must use backend functions (`store-identity`, auth/OTP flows).

## Implementation Patterns
- Register route behavior in `app/_layout.tsx` for header, guards, and transitions.
- Keep FC workflow transitions aligned with canonical status strings in `types/fc.ts`.
- Prefer shared UI and wrappers (`components/Button`, `components/FormInput`, `components/KeyboardAwareWrapper`).
- Keep storage/session access through `lib/safe-storage*` and session hooks.
- Use `router.replace(...)` when preventing back-navigation into auth/progress gates.

## Testing Strategy
- Fast checks:
  - `npm run lint`
  - `npm test`
- Manual critical flows:
  - Signup -> OTP -> password set
  - Login -> identity gate -> full home unlock
  - FC onboarding actions: consent, exam apply, docs upload, appointment submission
  - Push navigation route fallback to `/notifications`

## Local Golden Rules

### Do's
- Keep role-based UI behavior explicit for `admin`, `fc`, and read-only users.
- Handle async failures with safe fallback UI and user-facing error messages.
- Reuse existing navigation and query key patterns before introducing new ones.

### Don'ts
- Do not add direct privileged DB writes from mobile client code.
- Do not persist sensitive plaintext values in storage or logs.
- Do not change route names lightly; many flows reference stable route paths.
