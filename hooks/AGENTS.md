# AGENTS.md

## Module Context
- Scope: Shared hook layer in `hooks/*`.
- Responsibility: Session/auth context, identity gating, platform-specific behavior hooks.
- Dependencies: `lib/safe-storage*`, `lib/notifications`, `lib/logger`, route consumers in `app/*` and `web/*`.

## Tech Stack & Constraints
- React hooks with TypeScript.
- Platform split files are supported (`*.android.ts`, `*.web.ts`, fallback `*.ts`).
- Session model is custom and phone-based; preserve persisted payload compatibility.

## Implementation Patterns
- Keep hooks side-effect boundaries explicit (`useEffect` with narrow dependencies).
- Keep public hook APIs stable (`useSession`, identity gate hooks).
- Persist and restore session through safe storage abstraction only.
- Use role/read-only values as first-class state, not derived ad hoc in each screen.
- Keep hook errors non-fatal and logged through shared logger.

## Testing Strategy
- Static checks:
  - `npm run lint`
  - `npm test`
- Behavioral checks:
  - Session restore on app launch
  - Role transition (`loginAs`, `logout`) and storage cleanup
  - Platform split resolution (`useInAppUpdate.*`, color scheme hooks)

## Local Golden Rules

### Do's
- Preserve backward compatibility of session keys and shape when possible.
- Keep hook returns strongly typed and minimal.
- Centralize reusable behavior in hooks instead of duplicating screen-level state logic.

### Don'ts
- Do not leak secrets or sensitive identity values to logs.
- Do not create circular hook dependencies with screen modules.
- Do not bypass existing session provider semantics with alternate global state stores.
