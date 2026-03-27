doc_id: FC-DATA-IDENTITY-PII
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/schema.sql + supabase/functions/store-identity/index.ts + web/src/app/api/admin/resident-numbers/route.ts

# Data Handbook: Identity And PII

## 규칙

- resident number plaintext는 DB/log/client payload에 저장하지 않습니다.
- `fc_profiles`는 masked/hash 중심, `fc_identity_secure`는 암호문/secure payload 중심입니다.
- resident-number full view는 trusted path에서만 허용됩니다.

## 운영 메모

- `FC_IDENTITY_KEY`, `FC_IDENTITY_HASH_SALT`가 핵심 secret입니다.
- request_board SSN 정책과 혼동하지 않습니다.
