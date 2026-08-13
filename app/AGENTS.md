# Mobile App Rules

- Routes must use the signed session and shared auth/store contracts; never accept client-supplied actor or role authority.
- Keep only current/previous app-key behavior and clear session-bound state on logout or account change.
- Do not log credentials, tokens, resident numbers, production payloads, or raw WebView content.
- Preserve deep-link, back-navigation, offline, and stale-session behavior when changing a screen.
- Verify the changed route with focused tests and TypeScript; device/OTA claims require actual device or authorized rollout evidence.
