doc_id: SHARED-BRIDGE-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/functions/_shared/request-board-auth.ts + supabase/functions/sync-request-board-session/index.ts + request_board/server/src/routes/auth.ts

# Cross-Repo Bridge Contract

## 핵심 흐름

1. `login-with-password`가 app session token과 `requestBoardBridgeToken`을 발급합니다.
2. 모바일/웹 클라이언트는 필요 시 `bridge-login`으로 request_board JWT/session을 교환합니다.
3. request_board auth가 사라지면 `sync-request-board-session`으로 재발급/복구를 시도합니다.
4. 비밀번호 변경은 가람in이 canonical entrypoint이고 request_board bcrypt sync는 후행 동작입니다.

## role mapping

| app identity | bridge role |
| --- | --- |
| `fc` | `fc` |
| `manager` | `fc` |
| `developer` | `fc` |
| linked designer | `designer` |
| plain `admin` | direct bridge 대상 아님 |

## 운영 실패 패턴

- 한쪽 secret만 회전해서 bridge-login 실패
- phone normalization 차이로 password sync 누락
- affiliation 누락으로 FC/designer label 비정상
- request_board JWT 만료 후 재발급 루프
- unread/badge는 한쪽만 줄고 다른 쪽은 남는 현상

## 먼저 볼 항목

- `REQUEST_BOARD_AUTH_BRIDGE_SECRET` / `FC_ONBOARDING_AUTH_BRIDGE_SECRET`
- `REQUEST_BOARD_PASSWORD_SYNC_TOKEN` / `FC_ONBOARDING_PASSWORD_SYNC_TOKEN`
- `requestBoardRole`
- `users.affiliation` / app affiliation source

## 관련 문서

- [security-and-secret-operations.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/security-and-secret-operations.md)
- [request_board operations runbook](E:/hanhwa/request_board/docs/handbook/operations-runbook.md)
