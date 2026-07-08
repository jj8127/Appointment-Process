# 2026-04-22 Vercel Deployment Risk Remediation

## Scope
- Repo: `fc-onboarding-app`
- Surface: `web/*` admin web running on Vercel
- Goal: close the three deployment risks identified in the Vercel audit with concrete code and deployment changes

## Risk 1: Preview silently hits production GaramLink
- Root cause:
  - `web/src/app/dashboard/messenger/page.tsx` falls back to `https://requestboard-steel.vercel.app` when `NEXT_PUBLIC_REQUEST_BOARD_URL` is missing.
  - Preview Vercel env does not define `NEXT_PUBLIC_REQUEST_BOARD_URL`.
- Remediation:
  - Add a small helper that resolves the request-board base URL by deployment environment.
  - Allow production fallback only in production.
  - In preview/development, return `null` when the env is missing and make the messenger card/navigation explicitly disabled with user-facing copy.
- Verification:
  - Preview build with no env must not link to production GaramLink.
  - Production build must keep working without a regression.

## Risk 2: Preview web push fails opaquely
- Root cause:
  - Preview Vercel env is missing `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, and `ADMIN_PUSH_SECRET`.
  - Client code surfaces `missing-vapid-key` as a generic failure and auto-registration still attempts a register path without environment-aware copy.
- Remediation:
  - Add an explicit runtime/env helper for web-push availability.
  - Distinguish unsupported browser, preview env not configured, and permission-denied cases in the client.
  - Update settings/dashboard copy so operators see a clear preview-disabled reason instead of a generic failure.
  - Seed preview Vercel env for the web-push keys/secrets from the current local secure source so preview QA can exercise the flow.
- Verification:
  - Preview UI must show an explicit supported/disabled state before env seeding.
  - After env seeding, `vercel env ls preview` must include the four variables.
  - Production behavior must remain unchanged.

## Risk 3: Resident-number reads depend silently on Edge Function fallback
- Root cause:
  - `FC_IDENTITY_KEY` is absent in the Vercel project.
  - `web/src/lib/server-resident-numbers.ts` silently falls back to the Edge Function after direct decrypt is unavailable.
- Remediation:
  - Make the resident-number read mode explicit in code and logs.
  - Add a helper that reports `direct`, `fallback`, or `unavailable` mode so failures are diagnosable.
  - Improve error messages/logs so Vercel runtime dependency on `FC_IDENTITY_KEY` or Edge Function is observable.
  - If a safe secret source exists locally, seed `FC_IDENTITY_KEY` into Vercel preview and production; otherwise keep the fallback explicit and document the remaining operational dependency.
- Verification:
  - Code path should log/report whether direct decrypt or fallback was used.
  - `vercel env ls` should confirm whether `FC_IDENTITY_KEY` is present after remediation.

## Execution Order
1. Implement request-board URL resolver and wire messenger UI to a safe disabled state outside production.
2. Implement web-push runtime availability helper and improve operator-facing copy.
3. Implement resident-number runtime mode helper and fallback observability.
4. Apply Vercel env changes for preview web-push and, if available, `FC_IDENTITY_KEY`.
5. Run `npm run lint`, `npm run build`, and governance/doc updates.

## Non-Goals
- Re-architect `request_board` itself.
- Change mobile app behavior.
- Replace the existing resident-number Edge Function fallback contract.

## Resolved local deploy path
- This Vercel project is linked as `admin_web` and already has `rootDirectory=web`.
- Because of that, running `vercel deploy` from `E:\hanhwa\fc-onboarding-app\web` is the wrong path for local deployment; it can resolve to `web\web`.
- The repeatable local deploy path is:
  - working directory: `E:\hanhwa\fc-onboarding-app`
  - command: `vercel deploy --yes --archive=tgz --cwd E:\hanhwa\fc-onboarding-app`
- Successful preview reference from this session:
  - deployment id: `dpl_DEQhVascXkdkHAkRsNE9AD1Zns2r`
  - url: `https://admin-1v8o3d70h-jun-jeongs-projects.vercel.app`
