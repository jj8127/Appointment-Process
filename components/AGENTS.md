# AGENTS.md

## Module Context
- Scope: Shared mobile UI components in `components/*`.
- Responsibility: Reusable presentation blocks used across FC/admin screens.
- Dependencies: `lib/theme.ts`, React Native primitives, icon packages, session/read-only props from hooks.

## Tech Stack & Constraints
- React Native components only.
- Must work on Android, iOS, and web targets used by Expo.
- Styling should follow existing tokens and spacing conventions; avoid one-off style systems.

## Implementation Patterns
- Keep components presentational; pass behavior through props.
- Prefer small composable pieces over large domain-specific widgets.
- Preserve existing prop names and defaults when extending behavior.
- Keep accessibility basics (`accessible`, labels, focus order) for action controls.
- Use shared error/loading wrappers where already present.

## Testing Strategy
- Static checks:
  - `npm run lint`
  - `npm test`
- Manual checks:
  - Cross-role rendering (`admin`, `fc`, read-only mode)
  - Layout behavior with long labels and small screens
  - Keyboard overlap scenarios for input components

## Local Golden Rules

### Do's
- Keep visual behavior deterministic and role-aware.
- Reuse component primitives before duplicating similar UI.
- Keep props typed narrowly and document non-obvious behavior inline.

### Don'ts
- Do not embed API calls or DB logic directly in shared UI components.
- Do not hardcode sensitive strings or environment-specific values.
- Do not introduce breaking prop changes without updating all usages.
