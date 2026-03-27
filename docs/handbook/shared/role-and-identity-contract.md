doc_id: SHARED-ROLE-IDENTITY-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: supabase/functions/login-with-password/index.ts + lib/request-board-session.ts + request_board/server/src/routes/auth.ts

# Role And Identity Contract

## 브랜드/용어

- `가람in`: FC 온보딩/운영 앱 이름
- `가람Link`: request_board 사용자 노출 이름
- `request_board`: 기술 저장소 이름
- `설계요청`: 기능명, 브랜드명 아님

## 역할 의미

- `fc`: 가람in 온보딩 당사자이자 GaramLink 설계요청 생성 주체
- `manager`: 가람in에서는 read-only 운영 관찰자, GaramLink에서는 `fc` 브리지
- `admin`: 가람in 총무, GaramLink direct actor 아님
- `developer`: 가람in에서는 `admin` subtype, GaramLink에서는 `fc` 브리지/direct 계정
- `designer`: GaramLink 설계매니저. 가람in에서는 linked identity로만 다룸

## identity 예외

- linked designer는 앱 내부 별도 role이 아니라 `fc_profiles`/`fc_credentials` 기반으로 관리될 수 있습니다.
- `affiliation='<보험사> 설계매니저'` 패턴은 브리지 role 판정에 영향을 줍니다.
- `manager`는 앱에서 first-class role이지만 request_board는 `fc|designer`만 이해합니다.

## 소유권

- 가람in이 소유: 앱 로그인, app session token, PBKDF2 계정, 온보딩 역할 계약
- 가람Link가 소유: request lifecycle, JWT/web session, direct designer 계정, DM/request chat, web push

## 관련 문서

- [cross-repo-bridge-contract.md](E:/hanhwa/fc-onboarding-app/docs/handbook/shared/cross-repo-bridge-contract.md)
- [request_board role matrix](E:/hanhwa/request_board/docs/handbook/role-permission-matrix.md)
