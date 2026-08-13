# Referral System Rules

- `SPEC.md`, current schema/RPC contracts, and focused tests are authoritative; keep mobile, admin web, and database behavior aligned.
- Authorization comes from the signed actor and immutable role/manager facts. Referral ownership and graph traversal must not be inferred from UI state.
- Revenue demos are fictional and isolated from real sales, settlement, payout, or compensation data.
- Production-sized graph checks may retain only aggregate, privacy-safe metrics. Do not store names, phone numbers, account labels, or unsanitized screenshots.
- Layout and interaction changes must preserve bounded crossing/spacing, deterministic focused tests, accessibility, and explicit release gates.
