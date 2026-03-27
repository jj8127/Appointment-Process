doc_id: SHARED-OWNERSHIP-MAP
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer, operator
last_verified: 2026-03-26
source_of_truth: handbook convention + cross-repo runtime ownership

# Ownership Map

## fc-onboarding-app 소유

- 앱 로그인/회원가입/OTP/비밀번호 reset canonical entrypoint
- app session token
- FC 온보딩 상태와 관리자 운영 라이프사이클
- resident number secure storage와 trusted decrypt path
- app inbox aggregation, Expo push, admin web push callback
- referral schema와 admin referral operations

## request_board 소유

- request / request_designer lifecycle
- JWT/web session
- request chat, DM, PWA install, web push, app badge
- `fc_customers`, `fc_company_codes`, designer favorites
- request/message/direct-message attachment metadata

## shared contract로만 정의하는 항목

- role/identity 용어
- bridge-login / session recovery / password sync
- shared secret pairing
- cross-repo smoke path
