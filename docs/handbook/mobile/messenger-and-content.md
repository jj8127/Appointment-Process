doc_id: FC-APP-MESSENGER-CONTENT
owner_repo: fc-onboarding-app
owner_area: mobile
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: app/messenger.tsx + app/chat.tsx + app/board*.tsx + app/notice*.tsx + app/notifications.tsx

# Mobile Playbook: Messenger And Content

## 목적

- 내부 메신저, 알림센터, 게시판, 공지 상세의 동작을 묶어 설명

## 진입 경로

- `messenger`
- `chat`
- `notifications`
- `board`, `board-detail`
- `notice`, `notice-detail`

## 읽는 데이터

- internal unread
- request_board unread 합산치
- board post / notice post
- attachment signed URL

## 쓰는 데이터

- 메시지 전송/읽음
- 게시글/댓글/리액션
- 알림 읽음/삭제

## 주의점

- internal unread와 GaramLink unread가 함께 보일 수 있음
- 게시판 공지는 legacy notice와 board notice가 동시에 존재할 수 있음
- optimistic send가 적용된 화면과 아닌 화면을 혼동하지 않음

## 연관 문서

- [../backend/notifications-inbox-push.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/notifications-inbox-push.md)
- [../backend/board-api-and-notice-model.md](E:/hanhwa/fc-onboarding-app/docs/handbook/backend/board-api-and-notice-model.md)
