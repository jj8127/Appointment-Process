doc_id: FC-HANDBOOK-INDEX
owner_repo: fc-onboarding-app
owner_area: handbook
audience: developer, operator
last_verified: 2026-07-15
source_of_truth: code + handbook/*

# 가람in Handbook

`docs/handbook/`는 가람in과 가람Link 연동 운영의 최신 handbook SSOT입니다.

## 사용 원칙

- 루트 [AGENTS.md](../../AGENTS.md)는 빠른 제어·안전·현재 큰 차단점만 봅니다.
- 화면 동작, 버튼 의미, 상태 전이, 운영 절차는 이 handbook를 봅니다.
- 교차 저장소 계약은 [`shared/`](./shared/)가 소유하고, 화면 상세는 각 저장소 소유 문서가 소유합니다.
- 문서 우선순위와 갱신 기준은 [shared/documentation-contract.md](./shared/documentation-contract.md)를 공식 원본으로 봅니다.
- `request_board`의 구 HTML/명세 문서는 참고 자료일 뿐 SSOT가 아닙니다.

## 빠른 진입

- 공통 계약: [shared/role-and-identity-contract.md](./shared/role-and-identity-contract.md)
- 브리지/세션: [shared/cross-repo-bridge-contract.md](./shared/cross-repo-bridge-contract.md)
- 보안/시크릿: [shared/security-and-secret-operations.md](./shared/security-and-secret-operations.md)
- 문서 운영 계약: [shared/documentation-contract.md](./shared/documentation-contract.md)
- 실수 전용 기록: [MISTAKES.md](../../.claude/MISTAKES.md)
- ownership map: [shared/ownership-map.md](./shared/ownership-map.md)
- 역할/권한: [role-permission-matrix.md](./role-permission-matrix.md)
- 상태/전이: [workflow-state-matrix.md](./workflow-state-matrix.md)
- 화면 인벤토리: [screen-inventory.md](./screen-inventory.md)
- 액션 사전: [button-action-matrix.md](./button-action-matrix.md)
- 운영 런북: [operations-runbook.md](./operations-runbook.md)
- 개발자 온보딩: [developer-onboarding.md](./developer-onboarding.md)
- 변경 의무: [change-checklist.md](./change-checklist.md)
- 릴리스·배포 체크리스트: [../deployment/DEPLOYMENT.md](../deployment/DEPLOYMENT.md)
- 명령 안전 등급: [../guides/COMMANDS.md](../guides/COMMANDS.md)

## 문서군

- `shared/`
  - 역할/정체성, 브리지, 보안, ownership map
- `mobile/`
  - Expo 앱 화면 플레이북
- `admin-web/`
  - 관리자 웹 화면 플레이북
- `backend/`
  - Edge Function, server route, cron, 알림 운영 문서
- `data/`
  - 스키마, 저장소, PII, referral, presence, migration 문서

## 관련 문서

- [README.md](../../README.md)
- [docs/README.md](../README.md)
- [request_board handbook](../../../request_board/docs/handbook/INDEX.md)

## Feature contract guardrails

- Cross-surface feature contract matrix: [feature-contract-matrix.md](./feature-contract-matrix.md)
- Contract test map enforced by governance: [contract-test-map.json](./contract-test-map.json)
