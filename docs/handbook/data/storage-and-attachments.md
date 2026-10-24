doc_id: FC-DATA-STORAGE-ATTACH
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-10-24
source_of_truth: supabase/schema.sql + supabase/functions/board-attachment-* + migrations/*bucket*.sql + web/src/app/api/admin/exam-applicants/*

# Data Handbook: Storage And Attachments

## 2026-10-24 공개 키 Storage 경계 (2026-10-24 운영 적용)

- `fc-documents`(비공개): `20261024120100_close_anon_document_reads` 뒤 anon SELECT는 업로드 작업(`object.upload`, `object.upload_update`, `object.sign_upload_url`, `object.upload_signed`)의 RETURNING에서만 참이다. anon은 목록·내려받기·서명 URL 발급을 할 수 없다. 서류 열람은 서버가 소유를 확인한 뒤 service role로 서명한다(관리자 웹은 이미 이 방식). 앱은 admin-action `signOwnDocument`(FC 본인)·`signFcDocument`(직원)로 300초 URL을 받는다. FC 업로드는 `prepareOwnDocumentUpload`가 만든 `<fcId>/<uuid>.pdf` 서명 업로드 URL로 올리고 `submitOwnDocument`가 객체를 확인한 뒤 행을 기록한다. service role 서명 전에는 admin-action과 관리자 웹 `signDoc`이 같은 경로 모양 규칙(`supabase/functions/_shared/fc-document-path.ts`: 빈 조각, `.`·`..` 조각, 맨 앞 `/`, `%`·`\`·`?`·`#`·제어 문자 거부)을 검사한다. `20261024120200_restrict_anon_document_path_shape`(2026-10-24 13:10Z 운영 적용)는 anon의 `fc_documents` 쓰기를 `<fc_id>/` 아래 한 조각 이름과 묘비로 좁히고, 승인된 행은 anon이 바꿀 수 없게 한다(upsert·묘비 모두 42501). 계약은 [관리자 운영 API](../backend/admin-operations-api.md#2026-10-24-서류-서명-urlfc-업로드-제출-액션-2026-10-24-운영-배포)에 있다. Supabase Auth 세션용 정책은 없다.
- `notice-attachments`(공개): anon은 이름 `^((images|files)/)?[0-9]{13}_`인 객체를 올리고(upsert 없음) 볼 수만 있다. 덮어쓰기·이동·삭제는 없다. 버킷 크기 제한 50MB.
- `chat-uploads`(공개): API 쓰기 정책이 없다. 기존 객체는 공개 URL로만 읽힌다.
- 앱 서류 화면의 열기·업로드·삭제 버튼 동작(서명 URL 열기, 서명 업로드, 삭제 중 표시)은 [모바일 FC 온보딩](../mobile/fc-onboarding.md)에 있다.

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

## 2026-10-09 Prepared document cleanup recovery

Document state and profile reset commit with a durable `fc_document_cleanup_queue` entry, including any commission PDF whose metadata is reset. Bounded post-commit cleanup treats storage failure, queue deletion failure and unknown confirmation counts as pending. Re-entry status and cleanup-only retry stay reachable from mobile and admin web. Queue paths are never returned to clients; FC queue access is mediated by own-scope Edge actions and current database actor validation. Real Storage behavior and rollout remain gates; SQL/local mocks do not establish real object deletion.
