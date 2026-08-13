# Supabase Rules

- Migrations are ordered, idempotent where practical, and accompanied by matching types/RPC/caller contracts.
- RLS and database constraints are the security boundary. Service-role use is limited to trusted server or Edge Function code.
- Multi-table board/exam writes must be atomic and retry-safe; never activate callers before the target schema is verified.
- No production migration, query, write, function deploy, or secret change without explicit approval.
- Verify SQL statically and in an authorized isolated target before any rollout claim.
