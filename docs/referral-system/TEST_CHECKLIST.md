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
- 추천인 테이블 direct client access는 금지되어 있으므로, pending/confirm/조회 케이스는 trusted Edge Function 호출 증적까지 남긴다.
- 2026-03-25 기준 현재 런타임 구현은 `추천코드 운영 기반`이 먼저 들어갔다. 따라서 `/api/admin/referrals` 및 `/dashboard/referrals` 검증은 별도 P0 게이트로 취급한다.
- 2026-03-31 기준 모바일 가입 검증은 Android 실기기에서 `소문자 입력 -> 단일 대문자 변환` 회귀와 `hanwhafcpass://signup?code=...` warm/cold deep link를 반드시 포함한다.

## 4. 권장 실행 순서

1. 추천코드 운영 기반
2. 추천코드 기본 흐름
3. 초대링크 직접 진입
4. 스토어 이동/설치 후 복원
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

### 5.2 초대링크

- `RF-LINK-01` 앱 설치 상태에서 초대링크 진입 후 자동 추천 확정
- `RF-LINK-02` 앱 미설치 상태에서 스토어 이동 후 첫 실행 복원
- `RF-LINK-03` 링크 자동 추천 후 수동 코드 입력 시 우선순위 적용
- `RF-LINK-04` 변조/만료 링크 graceful fallback
- 수동 실행 예시:
  - `adb.exe shell am start -W -a android.intent.action.VIEW -d 'hanwhafcpass://signup?code=KCSACZXU'`
  - 기대값: 앱이 `/signup`으로 열리고 추천코드가 1회만 자동 입력된다.

### 5.3 상태 복원

- `RF-STATE-01` 가입 도중 이탈 후 재진입해도 pending attribution 유지
- `RF-STATE-02` cold start/background resume에서도 중복 이벤트 없이 복원

### 5.4 운영/관리자

- `RF-ADMIN-01` 운영자가 추천 관계와 source를 조회 가능
- `RF-ADMIN-02` 운영 override/cancel 시 감사 로그 기록
- `RF-ADMIN-03` 기존 FC 추천코드 백필은 대상만 발급하고 재실행해도 중복 활성 코드가 생기지 않음
- `RF-ADMIN-04` 추천코드 재발급/비활성은 활성 코드와 이벤트 로그를 일관되게 갱신함
- `RF-ADMIN-05` `manager`는 추천인 코드 화면/GET은 조회 가능하지만 mutate UI와 `POST` 권한은 없음

### 5.5 관찰성/정합성

- `RF-OBS-01` 클릭부터 확정까지 이벤트 타임라인 복원 가능
- `RF-DATA-01` invitee orphan/중복 confirmed row 부재 및 inviter snapshot 보존
- `RF-HISTORY-01` inviter 계정 삭제 후에도 attribution/event snapshot으로 이력 복원 가능
- `RF-SEC-01` 반복 무효 입력/링크 변조가 추천 관계를 만들지 않음
- `RF-SEC-02` direct client access는 차단되고 trusted server path만 추천인 read/write를 수행

### 5.6 저장소 경계

- `RF-INT-01` request_board가 추천 관계 원본 없이도 정상 동작

## 6. 증적 기준

- 최소 2종:
  - 화면 캡처 또는 녹화
  - 서버 로그
  - DB 확인 결과
  - 테스트 명령 출력
- 상태 전이 케이스는 “변경 전/후” 둘 다 남긴다.
- override/cancel은 이유(reason)와 actor가 같이 남는지 확인한다.
- trusted API 경로 케이스는 함수 호출 payload, 응답, service 로그 중 최소 1개를 포함한다.
- 추천코드 입력 회귀는 실제 입력 문자열(`j -> J`, `ab -> AB`)과 결과 화면을 함께 남긴다.

## 7. 장애 발생 시 추가 절차

1. `TEST_RUN_RESULT.json`에 `FAIL` 또는 `BLOCKED` 기록
2. `INCIDENTS.md`에 새 항목 추가
3. `test-cases.json`에 회귀 포인트가 빠졌으면 케이스 보강
4. 같은 문제가 다시 나오지 않게 검증 쿼리/로그 경로를 notes에 명시
