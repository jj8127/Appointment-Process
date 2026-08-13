# Admin Web Rules

- Enforce session, role, and manager access at the server/data boundary; UI visibility is not authorization.
- Keep route, API, schema, and shared type contracts aligned. Do not expose service-role credentials to the browser.
- Preserve loading, empty, error, stale-session, and accessibility behavior on changed routes.
- Production data and screenshots must be sanitized; never retain names, phone numbers, resident numbers, tokens, or raw DOM dumps as harness evidence.
- Verify focused tests plus affected type/lint checks; run a Sentry-disabled build for release-sensitive changes.
