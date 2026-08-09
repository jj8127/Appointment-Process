# Hook Rules

- Hooks must derive identity and authorization from the signed session, not caller-supplied IDs or roles.
- Cancel or ignore stale async results after dependency, account, or route changes; preserve last-good data where the product contract requires it.
- Centralize cache keys and invalidation. Do not duplicate server policy in UI state.
- Never log credentials, tokens, resident numbers, or raw production responses.
- Verify race, retry, logout, and error paths with focused hook tests and TypeScript.
