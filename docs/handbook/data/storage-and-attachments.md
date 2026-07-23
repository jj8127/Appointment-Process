doc_id: FC-DATA-STORAGE-ATTACH
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-07-23
source_of_truth: supabase/schema.sql + supabase/functions/board-attachment-* + migrations/*bucket*.sql + web/src/app/api/admin/exam-applicants/*

# Data Handbook: Storage And Attachments

## 2026-07-23 Upload notification boundary

- A completed FC document upload remains committed when its follow-up notification delivery fails.
- The upload screen reports a bounded partial-success warning and must not delete, repeat, or relabel the stored object as failed because of notification fanout.
- Notification diagnostics never include storage paths, signed URLs, recipient identifiers, or provider response bodies.

## 주요 bucket

- `fc-documents`
- `board-attachments`
- `chat-uploads`
- `exam-payment-proofs`

## 계약

- signed URL 발급 경로와 metadata row는 함께 봅니다.
- object delete 실패와 DB row delete는 항상 동일하지 않을 수 있습니다.
- request_board bucket과 이름이 비슷해도 저장소 소유가 다릅니다.

## 시험 응시료 입금 증빙

- `exam-payment-proofs`는 private bucket이며 허용 MIME은 `image/jpeg`, `image/png`, `image/webp`, 최대 크기는 10MB다.
- 모바일은 bucket RLS를 직접 통과하지 않는다. `exam-payment-proof` Edge Function이 signed app session과 FC 소유권을 확인한 뒤 2시간 upload URL을 발급한다.
- `exam_payment_proof_uploads`는 service-role 전용 metadata/멱등성 ledger다. `anon`과 `authenticated`에는 권한을 주지 않는다.
- object path에는 전화번호나 주민 식별값을 넣지 않고 FC UUID와 무작위 upload UUID만 사용한다.
- 공개 URL과 signed URL은 DB·로그에 저장하지 않는다. DB에는 private path와 제한된 파일 metadata만 보관한다.
- 관리자 웹의 일반 목록 응답은 `payment_proof_attached` 여부만 노출한다. 화면 이미지는 활성 admin/manager 세션을 확인한 서버 route가 현재 `attached` object를 service role로 내려받아 `private, no-store`로 전달한다.
- CSV/Excel export는 활성 admin/manager 요청 시에만 현재 `attached` row의 opaque path와 30일 signed URL을 발급한다. 이 URL은 전달받은 브라우저의 admin web 세션 없이 열리므로 bearer capability로 취급하며, 영구 public URL로 바꾸거나 DB·로그에 저장하지 않는다.
- 신규 앱 저장은 `payment_proof_policy_version=1`과 `payment_proof_attached=true`를 함께 기록한다. 기존 row와 구버전 앱 호환을 위해 additive migration의 기본 version은 0이며, 전환 완료 후 별도 강화 migration으로 기본값과 차단 정책을 올린다.
- 신청 취소는 DB row를 먼저 삭제한 뒤 현재 proof object를 best effort로 제거한다. 제거 실패는 고정 진단 이벤트만 남기고 별도 운영 정리 대상으로 분류한다.
