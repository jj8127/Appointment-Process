doc_id: SHARED-DOCUMENTATION-CONTRACT
owner_repo: fc-onboarding-app
owner_area: shared-contract
audience: developer
last_verified: 2026-07-07
source_of_truth: handbook convention + scripts/ci/check-governance.mjs

# Documentation Contract

## 문서 운영 모델

이 문서는 `fc-onboarding-app`와 `request_board`가 함께 따르는 문서 운영 SSOT입니다. 저장소별 세부 동작은 각 저장소의 `docs/handbook/*`가 소유하지만, 문서의 역할, 우선순위, 갱신 기준은 이 문서를 기준으로 통일합니다.

### 문서 우선순위

1. `docs/handbook/shared/*`
   - 두 저장소를 동시에 묶는 역할, 세션, 브리지, 보안, 문서 운영 계약의 공식 원본입니다.
2. 각 저장소 `docs/handbook/*`
   - 화면, API, 데이터, 런북, 상태 전이, 버튼 동작의 저장소별 공식 원본입니다.
3. 각 저장소 `AGENTS.md`
   - 새 작업자가 빠르게 읽는 관제탑입니다. 핵심 금지사항, 라우팅, 현재 큰 리스크만 둡니다.
4. `.claude/WORK_LOG.md`와 `.claude/WORK_DETAIL.md`
   - 작업 이력과 검증 기록입니다. 정책 원본으로 쓰지 않습니다.
5. `README.md`, `CHANGELOG.md`, `adr/*`, `contracts/*`
   - 프로젝트 개요, 사용자 영향 변경, 의사결정, 보조 계약을 설명합니다.
6. legacy reference
   - 과거 명세, HTML mock, 오래된 개발 메모입니다. handbook와 충돌하면 무효입니다.

### 문서 유형별 책임

- `shared contract`: 두 저장소가 함께 지켜야 하는 정책과 경계. 이 디렉토리만 공식 원본입니다.
- `handbook playbook`: 화면/API/데이터 단위의 현재 운영 동작.
- `matrix`: 역할, 상태, 버튼, feature contract처럼 비교가 필요한 표준 계약.
- `runbook`: 배포, 장애 대응, 수동 운영 절차.
- `work log/detail`: 변경 이력과 검증 증거.
- `mistake ledger`: 반복 가능한 실수와 회귀 방지책.
- `legacy reference`: 참고용 자료. 새 정책을 추가하지 않습니다.

## 갱신 원칙

### 한 규칙은 한 문서에만 공식으로 둡니다

- 같은 운영 규칙을 여러 문서에 길게 복사하지 않습니다.
- 다른 문서에서는 공식 원본 링크와 짧은 요약만 둡니다.
- 새 규칙을 추가할 때 먼저 소유 문서를 정하고, 애매하면 사용자에게 확인합니다.

### 최소 갱신 세트

일반 기능 변경 때는 모든 문서를 갱신하지 않습니다. 다음 중 실제 영향이 있는 문서만 바꿉니다.

- 코드 동작 변경: `.claude/WORK_LOG.md`, `.claude/WORK_DETAIL.md`, 필요한 owning handbook 또는 contract evidence
- 역할/권한/세션/보안 경계 변경: shared contract와 각 저장소 owning handbook
- 사용자 노출 릴리즈 변경: `CHANGELOG.md` 또는 `README.md`
- 반복 가능한 실수/회귀 수정: `.claude/MISTAKES.md`
- 새 코드 영역 추가: `docs/handbook/path-owner-map.json` 먼저 보강
- contract-sensitive 변경: `docs/handbook/contract-test-map.json`에 등재된 증거 중 하나 갱신

### AGENTS.md 사용 범위

- `AGENTS.md`는 빠른 시작, 작업 라우팅, 금지사항, 현재 큰 리스크를 담습니다.
- 누적 구현 상세, 긴 완료 목록, 과거 장애 분석은 `WORK_DETAIL.md`, `CHANGELOG.md`, 관련 handbook로 옮깁니다.
- `AGENTS.md`에 새 긴 정책을 추가해야 할 것 같으면 먼저 이 문서 또는 owning handbook가 더 적절한지 확인합니다.

### legacy reference 처리

- legacy 문서는 삭제하거나 이동하기 전에 사용자 승인을 받습니다.
- 승인 전에는 `legacy-reference.md`와 인덱스에서 참고용임을 명확히 표시합니다.
- legacy 문서에는 새 운영 규칙을 추가하지 않습니다.

### 애매한 규칙 처리

다음은 반드시 사용자에게 확인한 뒤 적용합니다.

- 공식 SSOT를 새로 지정하거나 기존 SSOT를 바꾸는 경우
- 문서를 삭제, 이동, 아카이브하는 경우
- CI/governance에서 새 규칙을 강제 차단으로 올리는 경우
- 주민번호, 권한, 세션, 브리지, 배포처럼 운영 정책 판단이 필요한 경우
- 문서 간 충돌이 있고 코드만으로 의도를 확정할 수 없는 경우

### 인코딩과 글자 깨짐

- Markdown과 JSON 문서는 UTF-8로 저장합니다.
- PowerShell 출력에서 한글이 깨져 보여도 파일 손상으로 단정하지 않습니다. 먼저 `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()` 또는 UTF-8 reader로 재확인합니다.
- 실제 파일에 `U+FFFD replacement character`가 있거나, UTF-8로 읽어도 깨진 문자열이 남으면 수정 대상입니다.

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
- `request_board`는 이 문서를 cross-repo documentation contract로 링크하고, 동일한 정책을 별도 복사하지 않습니다.

## path-owner-map 원칙

- 각 저장소는 `docs/handbook/path-owner-map.json`으로 코드 경로와 owning handbook 문서를 연결합니다.
- map rule은 `internal`, `behavior`, `contract` severity를 가집니다.
- handbook sync를 하지 않는 일반 구현 세션에서는 owning 문서 수정을 강제하지 않습니다.
- handbook sync 세션 또는 handbook를 실제 수정하는 세션에서는 map에 등재된 owning 문서 중 하나를 반드시 같이 수정해야 합니다.
- 새 코드 영역이 생기면 구현보다 먼저 map부터 보강합니다.
- CI 강제 범위를 넓히는 변경은 사용자 확인 후 적용합니다.

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
