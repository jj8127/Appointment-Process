doc_id: FC-DATA-IDENTITY-PII
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/schema.sql + supabase/functions/store-identity/index.ts + web/src/app/api/admin/resident-numbers/route.ts

# Data Handbook: Identity And PII

## 규칙

- resident number plaintext는 DB/log/local persistence에 저장하지 않습니다.
- `fc_profiles`는 masked/hash 중심, `fc_identity_secure`는 암호문/secure payload 중심입니다.
- resident-number full view는 trusted path를 통해 가람in trusted session(`admin`/`manager`/`fc`, `developer`는 admin subtype)과 GaramLink trusted path에 허용됩니다.
- FC self-view는 signed app session의 현재 `fc_profile.id` 범위로 제한합니다. 운영(read-only) 표면은 `admin`/`manager` trusted path를 사용합니다.

## 운영 메모

- `FC_IDENTITY_KEY`, `FC_IDENTITY_HASH_SALT`가 핵심 secret입니다.
- request_board SSN 정책과 혼동하지 않습니다.
- 2026-05-30 기준 `/api/admin/resident-numbers` request parsing은 `fcIds` array-only 입력, `String(value ?? '')`, trim, blank filtering, first-seen de-dupe를 유지한다.
- 같은 route의 branch sequencing은 session check, rate limit, JSON parsing, empty-list success, trusted read 순서를 유지한다. read 실패는 세부 PII 오류를 노출하지 않고 generic 500으로 반환한다.
- resident-number full-view fallback은 direct decrypt mode, edge request shape, edge response validation, edge execution diagnostics helper가 각각 characterization되어 있으므로 화면별 임시 parser/fallback을 다시 만들지 않는다.
