doc_id: SHARED-BRIDGE-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-04-16
source_of_truth: supabase/functions/_shared/request-board-auth.ts + supabase/functions/sync-request-board-session/index.ts + supabase/functions/refresh-app-session/index.ts + request_board/server/src/routes/auth.ts + lib/request-board-api.ts

# Cross-Repo Bridge Contract

## 핵심 흐름

1. `login-with-password`가 app session token과 `requestBoardBridgeToken`을 발급합니다.
2. 모바일/웹 클라이언트는 필요 시 `bridge-login`으로 request_board JWT/session을 교환합니다.
3. request_board auth가 사라지면 `sync-request-board-session`으로 재발급/복구를 시도합니다.
4. referral self-service `appSessionToken`이 없거나 만료되면 가람in 클라이언트는 같은 stored `requestBoardBridgeToken`으로 `refresh-app-session`을 1회 호출해 referral 전용 세션을 복구합니다.
5. 비밀번호 변경은 가람in이 canonical entrypoint이고 request_board bcrypt sync는 후행 동작입니다.
6. 가람in에서 request_board 데이터를 임베드 조회할 때는 `ssnView=full` trusted path를 사용해 GaramLink와 같은 full 주민번호 표시 계약을 유지합니다.

## role mapping

| app identity | bridge role |
| --- | --- |
| `fc` | `fc` |
| `manager` | `fc` |
| `developer` | `fc` |
| linked designer | `designer` |
| plain `admin` | direct bridge 대상 아님 |

- bridge role이 `fc`로 보여도 phone이 `admin_accounts`에 속한 developer/plain admin은 `refresh-app-session` 대상이 아니다. referral self-service 세션 발급은 completed FC 또는 active manager만 허용한다.

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
