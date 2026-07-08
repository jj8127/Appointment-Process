doc_id: SHARED-BRIDGE-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-04-16
source_of_truth: supabase/functions/_shared/request-board-auth.ts + supabase/functions/sync-request-board-session/index.ts + supabase/functions/refresh-app-session/index.ts + request_board/server/src/routes/auth.ts + lib/request-board-api.ts

# Cross-Repo Bridge Contract

## 2026-07-03 API And Messenger Contract Notes

- `lib/request-board-api.ts` must remain the GaramIn bridge boundary for GaramLink requests, messages, direct messages, attachments, and delete actions.
- Bridge API changes must keep request-board session retry/error classification, trusted `ssnView=full` reads, and messenger interaction parity aligned with request_board server routes.
- Contract evidence is tracked through `lib/__tests__/request-board-api-contract.test.ts`, `lib/__tests__/request-board-session.test.ts`, `lib/__tests__/feature-contract-matrix.test.ts`, and the request_board feature-contract tests.

## 2026-07-08 Designer Account Parity

- A request_board-linked designer account is a cross-system identity, not a request_board-only row.
- Completion requires all of these to be true:
  - request_board has `users.role='designer'` for the phone.
  - request_board has an active `designers` row for the same user and company.
  - GaramIn/fc-onboarding-app has `fc_profiles.phone=<digits>`, `signup_completed=true`, `phone_verified=true`, and `affiliation='<company> 설계매니저'`.
  - GaramIn/fc-onboarding-app has `fc_credentials.password_set_at` for that `fc_profiles.id`.
- Never consider a designer bootstrap complete until request_board `npm run ops:check-designer-parity -- --phone <phone> --company <company>` passes against the production request_board and GaramIn Supabase projects.
- The affiliation marker `설계매니저` is part of the login/bridge contract. `login-with-password` derives request_board `designer` mode from that marker, and `supabase/functions/_shared/__tests__/request-board-auth.test.ts` guards the parser.

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

## 2026-05-30 characterization 메모

- `supabase/functions/_shared/request-board-password-sync.ts`의 outbound body builder는 `buildRequestBoardPasswordSyncBody`로 직접 characterization한다.
- body builder는 `phone`, `password`, `role`을 항상 보내고, truthy `name`/`companyName`/`initiatorRole`/`syncReason`만 추가한다.
- `affiliation`은 `fc`와 `manager` role에서만 포함한다. linked designer mirror는 `companyName`을 보내고 `affiliation`은 request_board direct designer payload에서 제외한다.
- 이 helper는 값 trim/normalization을 하지 않는다. caller가 정한 phone/password/name/company/affiliation 값을 그대로 request_board sync body로 전달하는 것이 현재 계약이다.
- 관리자 웹 session restore는 cookie-first가 우선이다. 유효한 cookie session이 있으면 localStorage snapshot이 drift되어도 먼저 읽어 복원하지 않는다.

## 2026-06-03 관리자 세션 헬퍼 메모

- `web/src/lib/server-session.ts`는 admin-only mutation 경로와 manager 포함 read-only 경로를 분리하기 위해 `getVerifiedAdminSession()`과 `getVerifiedReadOnlyAdminSession()` wrapper를 제공한다.
- 본부장/manager read-only 경로는 주민번호 full-view 같은 trusted read를 허용할 수 있지만, 쓰기 API는 계속 admin-only helper를 사용해야 한다.

## 관련 문서

- [security-and-secret-operations.md](./security-and-secret-operations.md)
- [request_board operations runbook](../../../../request_board/docs/handbook/operations-runbook.md)
