doc_id: FC-DATA-MODEL-CANON
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-10-04
source_of_truth: supabase/schema.sql + supabase/migrations/*

# Data Handbook: Data Model Canon

## 2026-10-07 시험 본인 취소 마감 전이 계약

- **로컬 구현·검증 완료, 운영 반영 대기.** `supabase/migrations/20261007082835_exam_self_cancellation_deadline.sql`과 `supabase/schema.sql`은 같은 RPC 계약을 유지한다. 운영 DB migration, Edge Function 및 앱 배포의 별도 승인·검증이 완료되기 전에는 적용 완료로 보고하지 않는다.
- `transition_exam_registration`의 `cancel_by_fc`는 연결된 `exam_rounds.registration_deadline`을 DB 시각과 `Asia/Seoul` 기준으로 판정한다. 마감일은 당일 끝까지 포함하고 다음 날 00:00부터 거부한다. 회차·마감일 누락 또는 오류는 열린 일정으로 취급하지 않는다. 신청 소유권·기존 상태와 접수 확정 차단도 함께 유지한다.
- `public.exam_self_cancellation_deadline_passed(date, timestamptz)`와 전이 RPC는 `SECURITY INVOKER` 및 `service_role` 전용 실행권을 유지한다. `PUBLIC`/`anon`/`authenticated`에 실행권을 부여하지 않는다. 실제 취소 전이는 잠긴 신청·회차와 `clock_timestamp()`로 helper를 호출하며, 요청 body의 시각을 받지 않는다. signed caller/role 검증은 Edge·관리자 API가 수행하며, 서비스 DB 역할이 사용자 역할을 대신하지 않는다.
- 마감 거부 시 `exam_registrations`, 연결 입금 증빙 및 `exam_registration_decision_events`에 변화가 없어야 한다. 관리자 `cancel_by_admin`은 기존 `applied`/`confirmed` 전이만 유지하고, 본부장·설계매니저 쓰기나 종료 상태 되돌리기를 허용하지 않는다. 계정 삭제의 신원 분리와 과거 기록은 별도 계약이다.
- 회귀 확인은 한국시간 마감일 마지막 시각/다음 날 경계, 다른 세션 시간대, 누락 마감일, 접수 확정·해제, 타인 신청 및 manager/designer 거부, 관리자 취소와 차단 시 무변경을 포함한다. 서버 제한을 먼저 배포하고 Edge 안내·모바일 동작을 확인한다. 구 앱 호환과 운영 DB 적용은 로컬 SQL 검사와 구분한다.
- 용어·정확한 안내는 [모바일 정책](../mobile/exam-flows.md#2026-10-07-마감-후-본인-취소-제한-정책), 직접 회차 이동 미지원과 취소 후 새 신청 절차는 [관리자 운영 계약](../admin-web/exam-and-referral-ops.md#2026-10-07-마감-후-취소변경-운영-계약)을 따른다.

## 2026-10-04 Account generations and comment receipts (production)

- Production history records `20261004133135_board_comment_idempotency`, `20261004133155_credential_session_generations` and activation `20261004143855_activate_credential_session_generations`. Local numbered87 migrations match live87 history entries with no pending or missing entry. Generation activation was last, after compatible issuer/verifier and web/bridge deployments; three BEFOREUPDATE triggers and service-only RPC execution were verified.

- `fc_credentials`, `admin_accounts` and `manager_accounts` carry a nonnegative session_version, initially zero. Password hash/salt changes advance the generation atomically after the revocation trigger is activated. Unchanged credentials and failed-login counters do not advance it. Issuers bind the generation read with the verified credential; refresh cannot upgrade an older session into a new generation.
- `board_comment_requests` has the canonical actor role/UUID and operation UUID as its key, with a SHA-256 payload digest and committed response. It has no cascading foreign key to posts/comments; deletion must not make old operations reusable. RLS is enabled and only service_role accesses it or calls the invoker RPC.
- Comment creation and its inbox notification rows use one transaction. Per-recipient delivery keys and replayed notification IDs prevent duplicate persistence. The ordered production rollout and bounded post-activation checks are recorded in the canonical release evidence.


## 2026-10-01 Password reset challenge state

- Migration `20261001071216_password_reset_atomic_challenges.sql` adds `reset_failed_count` (integer, default 0, range 0–5) to `admin_accounts`, `manager_accounts` and `fc_credentials`. It retains the existing hashed code, expiry and issuance timestamp fields; no plaintext OTP is stored. It adds named `CHECK ... NOT VALID` constraints, which immediately enforce new writes without scanning existing rows under the initial exclusive table locks.
- Commit the first migration before applying `20261001071222_password_reset_validate_challenge_counters.sql`. This second migration validates the three constraints with `SHARE UPDATE EXCLUSIVE`, allowing ordinary reads and writes. Both migrations use transaction-local `lock_timeout='3s'` and `statement_timeout='30s'`; these bound each lock wait and statement, not the total rollout time. A lock timeout aborts the migration transaction rather than waiting indefinitely. The initial DDL still requires short exclusive locks, so zero login disruption is not guaranteed.
- `process_password_reset_challenge` is the service-role-only `SECURITY INVOKER` boundary for both issuance and consumption. It locks the credential row, and for FC locks the profile first, before checking current identity/eligibility and the database clock.
- Issuance enforces 60 seconds and resets the failed-guess counter with a 15-minute challenge. Wrong guesses commit a bounded count. The fifth exhausts the current challenge without changing ordinary login lockout state. Successful consumption changes credentials and clears the challenge atomically, retaining the issuance cooldown.
- PUBLIC/anon/authenticated have no RPC execution grant. `supabase/schema.sql` mirrors the final validated schema and RPC. `supabase/tests/password-reset-challenge-sql.test.mjs` passes 16 PGlite tests; `supabase/tests/password-reset-challenge-postgres.test.mjs` passes 10 tests with independent connections to disposable PostgreSQL 17.6. The latter verifies actual lock contention, timeout rollback, concurrent credential writes during validation, one successful consume, bounded guess counts and issuance/replacement races for all three account types.
- Production verification on 2026-10-01: both migrations are recorded in project `ubeginyxaotcamuqpmud`; all three constraints are validated, counter columns are `NOT NULL` with default `0`, and RPC execution is limited to `service_role`. This verified schema metadata, without reading customer-row counter values. Both reset Edge callers were then activated. Local migration filenames match the production history identifiers above.

## 2026-09-07 월별 증원수당 대상자 데이터

- 원본 migration `20260907053913` 이후 `20260907115710_referral_allowance_recipients.sql`은 `referral_allowance_recipients`를 추가하고 기존 단일 시범 설정을 그대로 이관한다. 기존 게시 snapshot과 revision은 바꾸지 않는다. `referral_allowance_pilot`은 초기 설정 기록이며 현재 권한 조회는 recipients를 사용한다.
- 수령인 FC UUID가 기본키이며 외부 사번은 유일하다. 본부장의 manager UUID는 선택적·유일 값이고 일반 FC는 null이다. 관리자 연결 확인과 SQL 검증은 정규화 전화번호·유일 FC identity·현재 가입/manager 상태를 확인하며 admin/designer를 제외한다. 일반 FC는 가입 완료와 manager identity 없음이 필요하다. 역할을 변경하거나 이름만으로 권한을 주지 않는다.
- 설정 revision은 수령인별로 증가한다. 한 대상의 변경·중지·재활성화는 다른 대상의 게시본에 영향을 주지 않는다. imports는 당시 계정 쌍·외부 사번·업적월·지급일·참고일·출처 hash·정책·설정 revision·draft revision·작업자를 기록한다. snapshot은 불변이며 draft → published → superseded로만 전환한다. 수령인/업적월별 현재 게시본은 하나다.
- 모든 수당 테이블은 RLS를 활성화하고 public/anon/authenticated 직접 접근을 금지한다. configure/create/publish/read는 service-only SECURITY INVOKER다. Edge는 현재 서명된 FC/manager만 해석하고 정확한 수령인 행을 재조회한다. 일반 관리자 쓰기 권한은 별도 활성 admin 경계에서만 허용한다.
- 원본 XLSX를 보관하지 않고 해당 수령인 10단계 명세만 저장한다. 공개 명세에 전화번호·외부 사번은 없다. 정책 `recruitment-2026-09-07-snapshot-pilot-v1` / `uploaded_snapshot`, 지급월 M+2, 참고일 ≤ 지급일, 날짜/금액/수령인/보존 제약을 유지한다. 최종 대상업적은 소수 2자리까지, 실제 수당은 안전 정수로 검증한다.
- 6월 실적·8월 1일 지급·7월 31일 참고일을 유지한다. 실제 7~8월 원본 날짜는 sourceSnapshotDates에 보존하고 usesLaterSnapshot을 명시한다. 이전 이월금·별도 시상·실제 지급 승인은 포함하지 않는다.
- 승인된 확장 후 Edge v2 ACTIVE, 19명(기존 본부장과 신규 FC 18명)의 6월 게시본·원본·작업자·조회 응답이 일치한다. 사용자가 보류한 24명은 등록하지 않았다. 계보 보완은 기존 audited RPC로 null 연결 25건만 추가했고 기존 non-null 연결 변경은 0건이다. 기기 검증·공개 모바일/웹 릴리스는 HOLD다.
- PGlite SQL 14개 테스트는 기존 시범 이관, FC/manager 간 격리, 개별 권한 회수, 게시 불변성/재시도 및 직접 접근 차단을 검증한다. 이는 다중 연결/실기기 인수 검증을 대신하지 않는다.

## Notification delivery idempotency (2026-07-25)

- `notifications.delivery_key` is a nullable server-owned idempotency key with a non-partial unique index. Null remains valid for legacy/non-idempotent sources; a non-null domain event/recipient key can resolve to only one inbox row.
- Board create/update and notification-only retry use `board-post:<sha256(postId + updated_at)>:<recipientRole>`. The server derives all three broadcast roles and verifies the returned row before provider fanout.
- `update_board_post_atomic` always advances `board_posts.updated_at`, including attachment-order-only commits, so every committed board update receives a distinct notification event version. The function is `security invoker`, revoked from public/anon/authenticated, and executable only by `service_role`.

## 2026-07-24 시험 입금 증빙 신청 RPC 보정

- `public.submit_exam_registration_with_payment_proof`의 반환 컬럼 `registration_id`와 입금 증빙 테이블의 동명 컬럼이 충돌하지 않도록, `exam_payment_proof_uploads` 조회와 갱신에서 테이블 별칭을 명시한다.
- 이 RPC는 `security invoker`를 유지하고 `service_role`만 실행할 수 있다. `anon`과 `authenticated`에는 실행 권한을 부여하지 않는다.
- 운영 반영 파일은 `20260724003500_fix_exam_payment_proof_registration_id_ambiguity.sql`이며 `supabase/schema.sql`에도 같은 정의를 유지한다.

## 2026-07-23 시험 응시료 입금 증빙 계약

- `exam-payment-proofs`는 비공개 Storage 버킷이며 JPG, PNG, WebP 이미지만 최대 10MB까지 받습니다. `anon`/`authenticated` 직접 정책은 열지 않고, 서명된 앱 세션을 검증한 `exam-payment-proof` Edge Function이 단기 signed upload URL을 발급합니다.
- `exam_payment_proof_uploads`는 FC, 요청 UUID, 비공개 object path, 파일 메타데이터, 만료 시각, 소비 상태를 기록하는 service-role-only 업로드 장부입니다. `(fc_id, request_id)`는 재시도 멱등성 키이고, 한 시험 신청에는 현재 증빙 한 건만 연결할 수 있습니다.
- `exam_registrations.payment_proof_attached`와 `payment_proof_policy_version`은 증빙 적용 여부를 기록합니다. 기존 모바일 호환을 위해 기본 버전은 `0`이며, 새 Edge 제출 경로는 반드시 증빙을 확인하고 버전 `1`로 저장합니다.
- `public.submit_exam_registration_with_payment_proof`는 신청 생성/수정과 업로드 장부 연결·기존 증빙 교체를 한 트랜잭션에서 처리하는 `SECURITY INVOKER` RPC입니다. 실행 권한은 `service_role`에만 있고, FC 소유권·업로드 만료·재사용·신청당 단일 현재 증빙을 DB에서도 검증합니다.
- 기준 migration은 `supabase/migrations/20260723040446_add_exam_payment_proofs.sql`입니다. 배포 순서는 additive migration과 Edge 확인이 먼저이고, 그 다음 증빙 필수 모바일을 배포합니다. 원격 적용과 관리자 검수 화면은 별도 릴리스 증거가 생길 때까지 완료로 보지 않습니다.

## 2026-07-06 Device Token Access Contract

- `device_tokens` is service-role-only storage. The schema snapshot must not grant anon/authenticated direct table access or recreate broad direct-client RLS policies.
- The paired migration for this contract is `supabase/migrations/20260706131220_harden_device_tokens_trusted_path.sql`.
- The exact `device_tokens` role constraint is owned by `supabase/migrations/20260721052837_allow_manager_device_tokens.sql`; it permits `admin`, `fc`, and Request Board designer scope `manager` without restoring client table access.

## 2026-07-03 Board Category Schema Snapshot

- `supabase/schema.sql` board category seed must mirror the canonical board category SQL generated by `scripts/ops/board-category-canonical-sql.mjs`.
- The current canonical reassertion migration is `supabase/migrations/20260703000001_reassert_board_categories_canonical.sql`, which seeds `notice`, `education`, `general`, `garam-pick`, and `policy` with `is_active=true`.
- Local governance requires schema snapshots and migration files to move together in the same diff; this migration pairs the current schema snapshot with an idempotent canonical repair.

## canonical 원칙

- `fc-onboarding-app`는 `supabase/schema.sql`과 matching migration을 함께 canonical snapshot으로 봅니다.
- schema 변경은 `schema.sql`과 `supabase/migrations/*.sql`를 반드시 동시 갱신합니다.
- request_board는 별도 canonical runtime contract를 사용하므로 혼동하지 않습니다.

## 핵심 테이블군

- `fc_profiles`
- `fc_identity_secure`
- `fc_credentials`
- `admin_accounts`
- `manager_accounts`
- docs/board/notification/presence/referral 관련 테이블

## 2026-06-05 게시판 글 종류 canonical 메모

- `board_categories`의 현재 가람in 게시판 글 종류는 `공지`, `교육 일정`, `일반`, `상품추천`, `시책` 5종입니다.
- stable slug는 각각 `notice`, `education`, `general`, `garam-pick`, `policy`를 유지합니다.
- `20260605000001_set_board_categories_to_four_types.sql`은 legacy `insurance-news`와 그 외 legacy category 게시글을 `general`로 재배치한 뒤 old category를 inactive 처리합니다.
- `20260608000001_update_board_categories_product_recommendation_policy.sql`은 `garam-pick` 표시명을 `상품추천`으로 맞추고 `policy`/`시책` canonical row를 추가합니다. `schema.sql` seed도 같은 5종 snapshot을 유지해야 합니다.

## 온보딩 상태 핵심 컬럼

- `fc_profiles.status`
- `fc_profiles.temp_id`
- `fc_profiles.allowance_date`
- `fc_profiles.allowance_prescreen_requested_at`
- `fc_profiles.allowance_reject_reason`
- `fc_profiles.hanwha_commission_date_sub`
- `fc_profiles.hanwha_commission_date`
- `fc_profiles.hanwha_commission_reject_reason`
- `fc_profiles.hanwha_commission_pdf_path`
- `fc_profiles.hanwha_commission_pdf_name`
- `fc_profiles.appointment_schedule_life`
- `fc_profiles.appointment_schedule_nonlife`
- `fc_profiles.appointment_date_life_sub`
- `fc_profiles.appointment_date_nonlife_sub`
- `fc_profiles.appointment_date_life`
- `fc_profiles.appointment_date_nonlife`
- `fc_profiles.life_commission_completed`
- `fc_profiles.nonlife_commission_completed`

## 2026-03-30 보증 보험 동의 보조 필드 메모

- `allowance_prescreen_requested_at`은 보증 보험 동의 단계 내부에서 `FC 보증 보험 동의 입력 완료`와 `사전 심사 요청 완료`를 구분하는 전용 보조 필드입니다.
- top-level status는 그대로 `allowance-pending / allowance-consented`를 유지하고, 앱/웹 라벨 helper가 `allowance_date`, `allowance_prescreen_requested_at`, `allowance_reject_reason` 조합으로 파생 표시를 계산합니다.
- `20260330000001_add_allowance_prescreen_requested_at.sql`은 위 컬럼을 추가합니다.
- `20260330000002_relax_allowance_flow_requires_date.sql`은 보증 보험 동의 제약식을 다시 적용하면서, `allowance_date`가 비어 있는 행의 `allowance_prescreen_requested_at`, `allowance_reject_reason`, 잘못된 `allowance-consented` 상태를 정리합니다.
- 결과적으로 총무는 trusted 경로에서 `allowance_date`가 있어야 보증 보험 동의 입력 완료/사전 심사/승인 단계를 조작할 수 있으며, 파생 라벨도 `allowance_date` 존재 여부를 우선 반영합니다.

## 2026-03-31 시험 신청 회차-지역 무과성 메모

- `exam_registrations.round_id`와 `exam_registrations.location_id`는 각각만 FK로 보지 않고, 같은 row에서 동일 회차를 가리켜야 합니다.
- `20260331000001_enforce_exam_registration_location_round_match.sql`은 `exam_locations (id, round_id)` 복합 unique 제약과 `exam_registrations (location_id, round_id) -> exam_locations (id, round_id)` 복합 FK를 추가합니다.
- 이 migration은 기존 오염 row `fc0421cd-6016-4732-b28f-324246085bc4`를 `4월 4차 생명보험 / 춘천`으로 재매핑한 뒤 제약을 추가합니다.
- 결과적으로 시험 신청은 선택한 회차에 속한 응시 지역만 저장 가능하며, 다른 회차의 `location_id`를 섞어 저장할 수 없습니다.

## 2026-03-31 추천인 코드 조회 RPC 메모

- `referral_attributions`는 관리자 전용 RLS 테이블이므로, 모바일 anon 클라이언트는 직접 조회하지 않습니다.
- `20260331000002_get_invitee_referral_code_fn.sql`은 `public.get_invitee_referral_code(uuid)` `SECURITY DEFINER` 함수를 추가합니다.
- `20260331000003_fix_get_invitee_referral_code_lookup.sql`은 위 함수를 이름 문자열이 아니라 `recommender_fc_id`와 structured attribution만 사용하도록 수정합니다.
- `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql`은 execute grant를 `service_role` only로 다시 고정합니다.
- `20260402000002_fix_invitee_referral_code_history_priority.sql`은 lookup order를 historical-first로 바꿔, confirmed attribution이 있으면 `referral_code_id -> referral_code snapshot -> inviter active code` 순으로 먼저 읽고 `recommender_fc_id` 현재 활성 코드는 마지막 degraded fallback으로만 사용하게 합니다.
- `20260410000001_add_referral_subtree_rpc.sql`은 `public.get_referral_subtree(root_fc_id uuid, max_depth int)`를 추가해 root row + ancestor chain + descendant subtree + descendant counts를 `service_role` only trusted read로 반환합니다.

## 2026-04-04 추천인 self-service / manager eligibility 메모

- `20260404000001_allow_manager_referral_codes.sql` 이후 completed manager-linked FC도 referral code issuance/backfill 대상 canonical set에 포함됩니다.
- `referral_attributions.source`는 `auto_prefill | manual_entry | admin_override`, `selection_source`는 `auto_prefill_kept | auto_prefill_edited | manual_entry_only | admin_override`만 허용합니다.
- self-service recommender update도 위 enum 계약을 그대로 따라야 하며, schema와 다른 provenance 문자열을 새로 추가하지 않습니다.
- `referral_events` canonical 컬럼명은 `invitee_fc_id`, `metadata`입니다. self-service audit write도 이 계약을 따릅니다.
- mobile referral tree self-service는 direct table/RPC 호출을 열지 않고 `get-referral-tree` Edge Function만 사용합니다. descendant lazy expand는 caller 자기 서브트리 membership이 확인된 `fcId`만 허용해야 합니다.

## 2026-04-23 추천인 링크 current-state canonicalization 메모

- `20260423000001_unify_referral_link_state.sql`은 `fc_profiles`에 `recommender_code_id`, `recommender_code`, `recommender_linked_at`, `recommender_link_source`를 canonical current-state 컬럼으로 추가한다.
- 같은 migration은 `fc_profiles.recommender_fc_id`와 새 `recommender*` snapshot을 structured referral current state 기준으로 backfill하고, `schema.sql`은 이 컬럼/체크 제약/인덱스를 같은 변경 세트로 반영해야 한다.
- `recommender_link_source` enum은 `signup | self_service | admin_override | legacy_migration`만 허용한다.
- `referral_events.event_type` canonical set에는 `referral_linked`, `referral_changed`, `referral_cleared`가 포함되며, `referral_events.source` canonical set에는 `signup`, `self_service`, `legacy_migration`이 추가된다.
- `public.get_invitee_referral_code(uuid)` canonical 반환값은 이제 invitee-facing current snapshot `fc_profiles.recommender_code`다. historical resolution이 필요하면 별도 admin/read model에서 처리하고, 이 helper 의미를 다시 넓히지 않는다.

## 2026-07-13 원자 저장 RPC 메모

- `public.update_board_post_atomic`은 게시글 field 변경과 전체 attachment order 검증·재정렬을 한 트랜잭션에서 처리한다. 전달된 attachment id 집합은 해당 post의 현재 전체 집합과 정확히 일치해야 하며 실행 권한은 `service_role`에만 있다.
- `public.save_exam_round_atomic`은 회차와 장소 목록을 함께 저장한다. 마감일/시험일 순서, 라벨·비고 길이, 시험 유형, 장소 개수·길이·중복을 DB에서도 검증하고, 기존 신청이 참조하는 제거 대상 장소는 보존한다. 이 RPC도 `service_role`만 실행할 수 있다.

## 2026-07-29 가람in 1:1 메신저 대상 분리

- `garamin_direct_conversations`는 기존 앱 호환을 위한 FC당 1개 envelope로
  유지하고, `garamin_direct_threads`가 `admin | manager | developer` 및
  immutable actor UUID로 실제 상대를 식별한다.
- `messages.conversation_id`는 legacy envelope, `messages.thread_id`는 실제
  target thread를 가리킨다. 새 메시지는 두 값을 함께 저장한다.
- 대상이 없는 기존 앱 요청은 shared admin thread로 해석한다. 기존
  `admin` 수신 메시지는 shared에 남고, immutable sender actor가 확인되는
  과거 manager/developer 답변만 해당 personal thread로 귀속할 수 있다.
- direct text/file/broadcast RPC와 attachment reservation/download 권한은
  같은 thread tuple을 검증하며, 모든 새 table/function 권한은
  `service_role` 전용이다.

## 2026-08-04 시험 회차 canonical 월

- `exam_rounds.exam_month`는 `YYYY-MM-01` 형태의 non-null canonical 시험 월이다. `exam_date`가 있으면 두 값은 같은 달이어야 하고, `exam_date` null은 정확한 날짜만 미정이라는 뜻이다.
- `20260804081357_exam_round_month_for_tbd.sql`은 실제 날짜, 이미 저장된 신청 월 snapshot, 미사용 legacy TBD 라벨 순으로 백필한다. 회차를 일의의 월로 해석할 수 없거나 active 신청 snapshot과 다르면 추측하지 않고 migration을 중단한다.
- `save_exam_round_atomic_v2`는 명시적 `p_exam_month`를 받는 `service_role` 전용 writer다. 기존 `save_exam_round_atomic`은 정확일에서 월을 파생하거나 기존 TBD 회차의 저장된 월을 재사용하며, 월 없는 신규 TBD 작성은 fail closed한다.
- `exam_registrations.exam_type`은 신청이 참조한 회차의 `life | nonlife` snapshot이며, 회차와 다른 종목을 저장할 수 없다. active partial unique 키 `(fc_id, exam_month, exam_type)`은 주시험·제3보험 선택 조합과 관계없이 같은 달의 생명과 손해를 각각 한 건씩 허용한다. 생명/손해를 가로지르는 별도 제3보험 unique guard는 두지 않는다.
- 신청 RPC v2/v3는 `exam_date`가 아니라 저장된 `round.exam_month` + `round.exam_type`로 advisory lock과 active 월 유일성을 계산한다. 증빙, actor, 장소-회차, 마감일, 감사 이벤트 계약은 그대로 유지한다.
- 신청 이력이 있는 TBD 회차는 같은 canonical 월 안의 null → 정확일 확정만 한 번 허용한다. 시험 월, 시험 종류, 확정된 날짜의 재작성은 history drift로 차단한다.
- 구 `save_exam_round_atomic` wrapper는 exact-date caller 호환만 담당한다. 기존 TBD 회차를 명시적 month 없이 exact date로 바꾸는 implicit 전환은 wrapper와 `admin-action` 양쪽에서 fail closed하며, canonical writer는 `save_exam_round_atomic_v2`다.
- active-slot migration preflight의 applicant collision grouping은 `fc_id IS NULL`인 탈퇴·분리 이력을 제외한다. null FC는 `(fc_id, exam_month, exam_type)` applicant slot을 만들지 않으며, 그 밖의 month/type/history 무결성 검사는 그대로 유지한다.

## 2026-08-10 관리자 보조 가입 데이터 계약

- `20260810070757_admin_assisted_signup_v1.sql`은 관리자가 서면 동의를 확인한 FC의 가입 프로필과 최초 비밀번호 변경 상태를 하나의 원자적 절차로 기록한다.
- 보조 가입 관련 테이블은 RLS를 유지하고 service-role 경로에서만 기록한다. anon/authenticated 역할에는 직접 실행 권한을 부여하지 않는다.
- 추천인 연결, 동의 증빙 메타데이터, 자격 상태, 전화 미인증 상태와 최초 비밀번호 변경 요구값은 `supabase/schema.sql`의 canonical snapshot과 동일해야 한다.

## 2026-10-04 전체 배포 정합성
가람in 4.2.15(Android/iOS), 관리자 웹, 가람Link, DB/Edge를 사용자 승인 범위에서 최신 소스로 맞춘다. 운영0497367의 서류·위촉 조회 경로와 파일 소유권 검증을 최신 관리자 웹에 통합하고 기존 canonical 알림·첨부 계약을 유지한다. 서류 저장 뒤 진행 상태 실패는 warning으로 반환한다. Supabase plugin이 발급한 실제 마이그레이션 버전과 로컬 파일/테스트 참조를 맞추며 세션 세대 활성화는 모든 호출자 준비 뒤 적용한다. exact Git source·빌드 입력 해시·플랫폼 완료·운영 alias·경로 응답·배포 후 오류를 확인하기 전 완료로 보고하지 않는다.
