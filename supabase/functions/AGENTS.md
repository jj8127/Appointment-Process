# Edge Function Rules

- Derive actor and role from the verified JWT/session; reject actor authority supplied only by the body.
- Keep CORS, authentication, authorization, validation, and error envelopes consistent across callers.
- Use service-role access only inside trusted function code and return the minimum required data.
- Never log secrets, tokens, resident numbers, production records, or complete request bodies.
- Mutations must be idempotent or atomic. Verify focused function tests/type checks; deploy only with explicit approval.
