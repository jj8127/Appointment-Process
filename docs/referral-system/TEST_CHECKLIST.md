# 추천인 시스템 테스트 체크리스트

## 1. 목적

- 추천인 시스템에서 자동 입력 추천코드, 초대링크, fallback, 운영 보정, 장애 추적 흐름을 누락 없이 검증하기 위한 단일 실행 기준이다.
- 케이스 원본은 `test-cases.json`, 실행 결과는 `TEST_RUN_RESULT.json`, 장애 이력은 `INCIDENTS.md`를 사용한다.

## 2. 사용 방법

1. `AGENTS.md`, `SPEC.md`, `INCIDENTS.md`를 먼저 읽는다.
2. `test-cases.json`에서 대상 케이스를 확인한다.
3. 실행 후 `TEST_RUN_RESULT.json`에 상태와 증적을 남긴다.
4. 실패/회귀면 `INCIDENTS.md`에 문제를 등록하고 회귀 케이스 ID를 연결한다.

## 3. 실행 규칙

- `P0`는 배포 차단 게이트다.
- 자동 입력이 기본이므로, 자동 입력 성공 케이스와 가입 전 수동 수정 fallback 케이스를 반드시 같이 검증한다.
- 한 케이스 실행 전후로 테스트 계정/기기 상태를 초기화하거나, 초기화가 불가능하면 notes에 잔여 상태를 남긴다.
- PASS라도 화면 증적만으로 끝내지 말고, 가능하면 서버 로그 또는 DB 검증을 함께 남긴다.
- 추천인 테이블 direct client access는 금지되어 있으므로, confirm/운영 조회 케이스는 trusted Edge Function 또는 server route 호출 증적까지 남긴다.
- 현재 repo에는 server-side pending attribution API가 없으므로, deep link/pending 복원 케이스는 로컬 pending storage 또는 signup prefill 증적을 기준으로 남긴다.
- `/dashboard/referrals`는 현재 `추천코드 운영 + 레거시 추천인 검토 큐` 화면이다. full `referral_attributions` 탐색기처럼 기대하는 케이스는 PASS로 처리하지 않는다.
- 앱 미설치 -> 스토어 설치 -> 첫 실행 자동 복원은 현재 계약이 아니다. 해당 케이스는 `자동 복원 없음 + 수동 fallback 필요`를 확인하는 방향으로만 실행한다.
- `RF-SEC-02`는 repo source 기준 intended contract와 runtime rollout 상태를 구분해서 적는다.
  - repo source: `20260401000002_reassert_get_invitee_referral_code_service_role_only.sql` 이후 `get_invitee_referral_code(uuid)`는 `service_role` only
  - runtime rollout 미검증이면 PASS 대신 `NOT_RUN` 또는 `BLOCKED`
- self-service 조회 문서는 현재 hook 경로 `hooks/use-my-referral-code.ts -> get-my-referral-code`를 기준으로 맞춘다.
- 관리자 invitee 코드 조회 케이스는 사용자 의미를 `가입 시 사용한 추천코드`로 기록한다. 내부 lookup order를 이유로 `추천인 현재 활성 코드`라고 풀어 쓰지 않는다.
- `RF-DATA-02`는 inviter가 이후 코드를 rotate해도 confirmed attribution이 있으면 historical signup code가 우선 표시되는지까지 확인해야 PASS다.
- `RF-SEC-03`, `RF-SEC-04`는 `set-password` direct/duplicate 호출 hardening을 검증한다. source review만으로 PASS 처리하지 않는다.
- `RF-SEC-05`는 FC 기본정보 화면에서 추천인 표시 cache가 읽기 전용인지 확인한다.
- graph 검증은 API smoke와 브라우저 상호작용을 분리해서 남긴다.
  - API smoke: merged edge count, `relationshipState`, unresolved legacy node count
  - 브라우저: node drag, 빈 공간 pan, fit/reset, label 가시성, manager read-only

## 4. 권장 실행 순서

1. 추천코드 운영 기반
2. 추천코드 기본 흐름
3. 초대링크 직접 진입
4. 앱 미설치 경로 fallback
5. 이탈/재진입 복원
6. 관리자 조회/보정
7. 보안/관찰성/정합성

## 5. 케이스 카탈로그

### 5.1 추천코드

- `RF-CODE-01` 자동 입력된 유효 추천코드로 회원가입 시 추천 관계 확정
- `RF-CODE-02` 무효 또는 비활성 추천코드 차단
- `RF-CODE-03` 자기추천 차단
- `RF-CODE-04` 이미 확정된 추천 관계 재확정 차단
- `RF-CODE-05` 한 추천인이 여러 가입자를 추천 가능
- `RF-CODE-06` 한 가입자는 최종 추천인 1명만 가짐
- `RF-CODE-07` Android 추천코드 입력 시 소문자가 대문자 1회로만 정규화되고 중복 문자(`JJ`)가 생기지 않음
- `RF-SELF-01` FC/본부장 self-service 추천코드 조회는 현재 runtime hook(`get-my-referral-code`) 기준으로 active code를 반환함
- `RF-SELF-02` FC/본부장 self-service 추천인 변경은 trusted path로 현재 추천인 표시와 attribution/event audit trail을 함께 갱신하고, 저장 직후 같은 화면의 ancestor chain/current recommender가 재진입 없이 즉시 갱신됨
- `RF-SELF-03` FC/본부장 self-service `app/referral.tsx`의 `나를 추천한 경로` / `내가 추천한 사람들` tree는 attribution과 `recommender_fc_id` 구조화 링크를 함께 반영하고, ancestor chain + subtree drill-down이 caller 자기 서브트리 범위 안에서만 동작하며, tree read 실패 시에도 기존 추천인 사용자는 같은 화면에서 변경 UI를 계속 열 수 있고 Android production build에서 render crash(`ReactClippingViewManager.addView`, `dispatchGetDisplayList null child`) 없이 진입/편집/새로고침이 가능해야 함

### 5.2 초대링크

- `RF-LINK-01` 앱 설치 상태에서 초대링크 진입 후 자동 추천 확정
- `RF-LINK-02` 앱 미설치 상태에서는 자동 복원이 없고 수동 추천코드 fallback이 필요하며, iOS 공유 문구는 direct App Store URL 또는 명시적 검색 안내를 포함함
- `RF-LINK-03` 링크 자동 추천 후 수동 코드 입력 시 우선순위 적용
- `RF-LINK-04` 변조/만료 링크 graceful fallback

수동 실행 예시:

- `adb.exe shell am start -W -a android.intent.action.VIEW -d 'hanwhafcpass://signup?code=KCSACZXU'`
- 기대값: 앱이 `/signup`으로 열리고 추천코드가 1회만 자동 입력된다.

### 5.3 상태 복원

- `RF-STATE-01` 가입 도중 이탈 후 재진입해도 로컬 pending 추천코드가 유지됨
- `RF-STATE-02` cold start/background resume에서도 중복 확정 없이 복원됨

### 5.4 운영/관리자

- `RF-ADMIN-01` 운영자가 추천코드 운영 상태, invitee의 `가입 시 사용한 추천코드` 표시값, 레거시 추천인 검토 대상을 조회 가능
- `RF-ADMIN-02` 운영 override 또는 clear는 감사 로그를 남김
- `RF-ADMIN-03` 기존 FC/본부장-linked FC 추천코드 백필은 대상만 발급하고 재실행해도 중복 활성 코드가 생기지 않음
- `RF-ADMIN-04` 추천코드 재발급/비활성은 활성 코드와 이벤트 로그를 일관되게 갱신함
- `RF-ADMIN-05` `manager`는 추천인 코드 화면/GET은 조회 가능하지만 mutate UI와 `POST` 권한은 없음
- `RF-ADMIN-06` 레거시 추천인 검토 큐에서 구조화 링크가 없는 FC를 계정 선택형으로 연결하고 감사 로그를 남김
- `RF-ADMIN-07` `/dashboard/referrals/graph`는 structured link 기준으로 빈 선 없이 그려지고 manager read-only를 유지함
- `RF-ADMIN-08` graph canvas는 node drag, 빈 공간 pan, reset, 기본 node name label을 지원함
- `RF-ADMIN-09` 레거시 추천인 검토 큐는 `자동 연결 가능/동명이인 후보 다수/후보 없음/잘못된 자기추천` 상태를 정확히 분류함
- `RF-ADMIN-10` `안전 자동 정리`는 exact-unique만 구조화하고 자기추천/후보 없음/동명이인은 남김

### 5.5 관찰성/정합성

- `RF-OBS-01` 현재 persisted runtime 범위(`signup_completed`, `referral_confirmed`, `referral_rejected`, code lifecycle, `admin_override_applied`)에서 이벤트 타임라인 복원 가능
- `RF-DATA-01` invitee orphan/중복 confirmed row 부재 및 inviter snapshot 보존
- `RF-DATA-02` 동명이인 이름과 무관하게 `get_invitee_referral_code(uuid)`가 structured attribution 기준으로 historical signup code를 우선 반환함
- `RF-HISTORY-01` inviter 계정 삭제 후에도 attribution/event snapshot으로 이력 복원 가능
- `RF-SEC-01` 반복 무효 입력/링크 변조가 추천 관계를 만들지 않음
- `RF-SEC-02` direct client access는 차단되고 trusted server path만 추천인 read/write를 수행함
- `RF-SEC-03` `set-password`는 OTP로 검증된 기존 profile 없이 신규 FC를 만들지 않음
- `RF-SEC-04` 중복 `set-password` 호출은 `already_set`로 거절되고 기존 추천인/온보딩 상태를 지우지 않음
- `RF-SEC-05` FC 기본정보 화면은 추천인 cache를 읽기 전용으로만 노출하고 일반 사용자 저장으로 덮어쓰지 않음

### 5.6 저장소 경계

- `RF-INT-01` request_board가 추천 관계 원본 없이도 정상 동작

## 6. 증적 기준

- 최소 2종:
  - 화면 캡처 또는 녹화
  - 서버 로그
  - DB 확인 결과
  - 테스트 명령 출력
- 상태 전이 케이스는 “변경 전/후” 둘 다 남긴다.
- override/clear는 이유(reason)와 actor가 같이 남는지 확인한다.
- 추천인 override는 `before/after/reason/actor`와 함께 `recommender_fc_id` / `referral_attributions`가 동시에 바뀌는지 확인한다.
- 추천인 clear는 `recommender` 문자열만 있던 레거시 FC에서도 동작해야 하고, clear 이벤트가 추천인 운영 화면 최근 이벤트에 보이는지까지 확인한다.
- `잘못된 자기추천` 제거 케이스는 `recommender_fc_id`가 null로 정리되고 같은 invitee에 새 confirmed attribution이 생기지 않는지 확인한다.
- `안전 자동 정리`는 처리 수/건너뜀 수/실패 수 요약과 실제 DB 반영 건수가 일치하는지 확인한다.
- trusted API 경로 케이스는 함수 호출 payload, 응답, service 로그 중 최소 1개를 포함한다.
- self-service 조회 케이스는 현재 hook 경로(`get-my-referral-code`)와 FC/본부장 공통 응답 계약을 함께 남긴다.
- self-service invitee 목록 케이스는 `referral_attributions` 개수와 `recommender_fc_id` 구조화 링크 개수를 함께 대조하고, 구조화 링크만 있는 invitee도 목록에 포함되는지 확인한다.
- self-service tree 케이스는 `get-referral-tree` 응답의 `ancestors`, `descendants`, `truncated`와 node expand 후 후속 요청 결과를 함께 남긴다.
- Android `/referral` 안정성 케이스는 production build에서 첫 진입, edit mode 전환, pull-to-refresh, tree/error 상태 전환을 최소 1회씩 밟고 `null child at index` / `ReactClippingViewManager.addView` 크래시가 없는지 확인한다.
- 본부장 보조 링크 케이스는 모바일 화면에서 FC 미노출, 본부장 노출, 외부 브라우저 open만 확인하고 graph 자체 사용성 검증은 `RF-ADMIN-07/08`로 분리한다.
- 추천코드 입력 회귀는 실제 입력 문자열(`j -> J`, `ab -> AB`)과 결과 화면을 함께 남긴다.
- source repo만 보고 맞춘 계약 정리는 evidence가 아니다. 그런 항목은 notes에 `code review only`로 명시한다.

## 7. 장애 발생 시 추가 절차

1. `TEST_RUN_RESULT.json`에 `FAIL` 또는 `BLOCKED` 기록
2. `INCIDENTS.md`에 새 항목 추가
3. `test-cases.json`에 회귀 포인트가 빠졌으면 케이스 보강
4. 같은 문제가 다시 나오지 않게 검증 쿼리/로그 경로를 notes에 명시
