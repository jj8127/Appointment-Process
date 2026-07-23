doc_id: FC-DATA-STORAGE-ATTACH
owner_repo: fc-onboarding-app
owner_area: data
audience: developer, operator
last_verified: 2026-07-23
source_of_truth: supabase/schema.sql + supabase/functions/board-attachment-* + migrations/*bucket*.sql

# Data Handbook: Storage And Attachments

## 2026-07-23 Upload notification boundary

- A completed FC document upload remains committed when its follow-up notification delivery fails.
- The upload screen reports a bounded partial-success warning and must not delete, repeat, or relabel the stored object as failed because of notification fanout.
- Notification diagnostics never include storage paths, signed URLs, recipient identifiers, or provider response bodies.

## 주요 bucket

- `fc-documents`
- `board-attachments`
- `chat-uploads`

## 계약

- signed URL 발급 경로와 metadata row는 함께 봅니다.
- object delete 실패와 DB row delete는 항상 동일하지 않을 수 있습니다.
- request_board bucket과 이름이 비슷해도 저장소 소유가 다릅니다.
