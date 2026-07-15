# Privacy-safe historical QA evidence — July 2026

This document replaces ignored raw logs, screenshots, UI dumps, and account-like
QA artifacts. The sources were not copied or archived. Aggregate structure and
opaque manifests are held in the central Pro sprint privacy receipt. These are
historical evidence classes, not current PASS claims.

## Runtime and role checks

- Admin chat development log: raw runtime output retired; rerun the owning
  characterization and safe logger tests for a current conclusion.
- Expo role E2E: historical role-flow output retired; authenticated device/browser
  recheck remains required.
- Admin chat send permissions: role allow/deny evidence was reduced to the
  invariant that privileged sends require an authenticated, authorized actor;
  current contract tests are authoritative.
- Production-admin scenario: raw account-like evidence retired. No active
  credential conclusion is made; an authorized external exposure review remains.

## Referral graph visual and branch QA

Historical branch, graph, and visual artifacts were retired. The durable
invariants are: graph traversal must be cycle-safe, nested descendants remain
bounded by the owning contract, and visual layouts must be rechecked without
exposing contact data. Current source tests and a fresh disposable visual run are
authoritative; the retired artifacts do not establish current UI PASS.

## Mobile request design

Historical design screenshots and UI material were retired. Only the decision
class is preserved: mobile request intake must protect draft input, use explicit
recovery states, and keep role/attachment policies visible. Current product code,
handbook contracts, and fresh viewport verification own the result.

## UI QA

Historical screenshots, XML/UI dumps, and related raw captures were retired.
Authenticated viewport and failure-injection QA remains blocked until a
disposable identity and interception environment are available. Source tests do
not substitute for that visual evidence.

## Reverification and release

Use the repository's current safe quality commands and owning handbook. Do not
restore the raw artifacts, use shared destructive data, or copy credentials into
new evidence. Production-account review, authenticated visual QA, remote rollout,
and migration evidence remain external blockers. Release posture: `HOLD`.
