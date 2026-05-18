doc_id: SHARED-DOCUMENTATION-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer
last_verified: 2026-04-06
source_of_truth: handbook convention

# Documentation Contract

## 공통 메타데이터

모든 handbook 문서는 다음 메타데이터를 상단에 둡니다.

- `doc_id`
- `owner_repo`
- `owner_area`
- `audience`
- `last_verified`
- `source_of_truth`

## 화면 플레이북 필수 섹션

- 목적
- 진입 경로
- 표시 역할
- 읽는 데이터
- 쓰는 데이터
- 상태/분기
- 사용자 액션
- 성공 결과
- 실패/예외
- 연관 문서

## 액션 매트릭스 필수 컬럼

- `action_id`
- `label`
- `surface`
- `visible_to`
- `enabled_when`
- `does`
- `writes/mutates`
- `success_feedback`
- `error_feedback`
- `related_flow`

## SSOT 원칙

- shared contract는 `fc-onboarding-app/docs/handbook/shared/`가 소유합니다.
- 저장소 상세는 각 저장소 handbook가 소유합니다.
- legacy reference는 참고용이며 handbook를 덮어쓰지 않습니다.

## path-owner-map 원칙

- 각 저장소는 `docs/handbook/path-owner-map.json`으로 코드 경로와 owning handbook 문서를 연결합니다.
- map rule은 `internal`, `behavior`, `contract` severity를 가집니다.
- handbook sync를 하지 않는 일반 구현 세션에서는 owning 문서 수정을 강제하지 않습니다.
- handbook sync 세션 또는 handbook를 실제 수정하는 세션에서는 map에 등재된 owning 문서 중 하나를 반드시 같이 수정해야 합니다.
- 새 코드 영역이 생기면 구현보다 먼저 map부터 보강합니다.

## 실수 기록 원칙

- `.claude/MISTAKES.md`는 반복 가능한 실수와 회귀만 기록하는 전용 문서입니다.
- 다음 조건 중 하나라도 맞으면 `.claude/MISTAKES.md` 갱신은 의무입니다. 코드 fix와 같은 change set에서 같이 갱신합니다.
  - 이미 복구했다고 기록한 동작이 다시 깨진 경우
  - 화면/route/function 간 계약 드리프트가 root cause인 경우
  - 중복 구현 때문에 한 surface만 고치고 다른 surface가 다시 어긋난 경우
  - 검증 누락 때문에 같은 종류의 실수가 재발할 수 있는 경우
  - 현재 세션에서 "우리가 무엇을 잘못 이해했는가/놓쳤는가"가 명확히 드러난 경우
- `WORK_LOG.md`/`WORK_DETAIL.md`는 "무엇을 바꿨는가"를 남기고, `MISTAKES.md`는 "무슨 실수를 했고 앞으로 어떻게 막을 것인가"만 남깁니다.
- `MISTAKES.md`에는 신규 기능, 일반 리팩터링, TODO, 단순 완료 보고를 기록하지 않습니다.
