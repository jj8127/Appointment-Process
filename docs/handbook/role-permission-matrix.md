doc_id: FC-HANDBOOK-ROLE-MATRIX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-07-12
source_of_truth: hooks/use-session.tsx + web/src/hooks/use-session.tsx + web/src/lib/server-session.ts + web/src/lib/fc-notify-proxy-policy.ts + handbook/shared/*

# 역할/권한 매트릭스

## 2026-07-12 Admin web notification proxy matrix

| verified session | inbox/unread | message |
| --- | --- | --- |
| `admin` + `staff_type=admin` | shared admin scope | verified completed non-designer FC only; sender `admin` / `총무팀` |
| `admin` + `staff_type=developer` | own admin or own FC bridge scope | verified completed non-designer FC only; sender is own phone/name |
| `manager` | own read-only admin or own FC bridge scope | forbidden |
| completed `fc` | own FC scope | shared admin conversation only; sender is signed profile phone/name |

The regression owner is `lib/__tests__/fc-notify-route-auth.test.ts`. It covers caller payload parity, forged identities, canonical Host enforcement, completed-FC binding, Request Board token/category validation, and raw-body forwarding prohibition.

## 2026-07-12 Verified Board actor matrix

| verified actor | read/detail | post/category/pin | comments/reactions | attachments/delete |
| --- | --- | --- | --- | --- |
| `admin` / `developer` subtype | allowed | global admin policy | allowed | global admin policy |
| `manager` | allowed | create and update/delete own manager-authored post; category/pin forbidden | allowed as manager | own manager-authored post only |
| completed `fc` | allowed | forbidden | own signed identity only | forbidden |
| insurance automation | category/list only | canonical `general` digest create only | forbidden | forbidden |

The Board actor is derived from a signed app session plus active database record. Client `actor`,
display name, disabled buttons, or a known phone number never grant authority. Admin web uses
`/api/board`; mobile uses the common token-attaching Board transport. Regression owners are
`board-edge-auth-policy.test.ts`, `board-edge-auth-source.test.ts`, and `board-caller-auth.test.ts`.

| role | 주 저장소 역할 | 쓰기 권한 | 대표 화면 | 비고 |
| --- | --- | --- | --- | --- |
| `fc` | 가람in 온보딩 사용자 | 본인 정보/온보딩/설계요청 | `index`, `fc/new`, `consent`, `docs-upload`, `appointment` | request_board에서는 요청 주체 |
| `manager` | FC 리더 | 가람in/웹에서는 읽기 전용 | `dashboard`, 시험/설계요청 조회 | request_board 브리지 role은 `fc` |
| `admin` | 총무 | 운영 쓰기 가능 | 관리자 웹 `dashboard`, 공지, 시험, 추천인 | request_board direct actor 아님 |
| `developer` | `admin_accounts.staff_type='developer'` | 앱/웹 권한은 `admin`과 동일 | 관리자 화면 + 개발자 표기 | request_board에서는 `fc`로 sync |
| `designer` | request_board 설계매니저 | request_board 의뢰 처리 | `request-board*` + GaramLink | 가람in 내부 first-class role 아님 |

## 강제 규칙

- `manager`는 화면이 같아도 write action이 비활성 또는 숨김이어야 합니다.
- `developer`는 앱 권한은 총무와 같지만 이름/브리지 정체성은 따로 취급합니다.
- `admin`은 request_board의 의뢰 요청 주체가 아니며 direct GaramLink actor로 취급하지 않습니다.
- `designer`는 `affiliation='<보험사> 설계매니저'` 기반 linked identity일 수 있습니다.

## 세부 계약

- 상세 role 의미: [shared/role-and-identity-contract.md](./shared/role-and-identity-contract.md)
- 브리지 role mapping: [shared/cross-repo-bridge-contract.md](./shared/cross-repo-bridge-contract.md)
- request_board 권한: [request_board role matrix](../../../request_board/docs/handbook/role-permission-matrix.md)
