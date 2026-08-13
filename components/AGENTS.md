# Component Rules

- Components render product state; authorization, persistence, and network policy belong in shared services/hooks.
- Reuse repository tokens and established accessibility semantics. Do not introduce a parallel design system.
- Preserve loading, empty, error, disabled, and long-text states. Never render raw sensitive values or log props containing them.
- Verify affected behavior with focused component tests and the owning surface's type/lint check.
