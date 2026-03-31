# 추천인 시스템 장애 기록

## 1. 목적

- 추천인 시스템에서 한 번이라도 발생한 문제를 재현 가능한 형태로 남긴다.
- 같은 문제가 다시 발생했을 때 AI가 이 파일과 연결된 테스트 케이스만으로 바로 재현/검증할 수 있어야 한다.

## 2. 현재 상태

- `2026-03-19` 기준 등록된 실장애 없음
- 구현 시작 후 장애가 발생하면 아래 템플릿으로 추가한다.

## 3. 작성 규칙

- 장애 1건당 `INC-XXX` 하나를 부여한다.
- 증상만 적지 말고, 어느 단계에서 추천 정보가 끊겼는지 명시한다.
- 반드시 `linkedCases`를 적고, 없으면 새 케이스를 만든다.
- “고쳤다”로 끝내지 말고 어떤 로그/쿼리/화면으로 검증했는지 남긴다.

## 4. 템플릿

```markdown
## INC-001 | YYYY-MM-DD | 짧은 제목

- symptom:
- impact:
- trigger:
- rootCause:
- fix:
- linkedCases:
  - RF-...
- evidence:
  - 로그 경로
  - 스크린샷 경로
  - 쿼리 결과
- reproduction:
  1.
  2.
  3.
- regressionCheck:
  - 어떤 케이스를 어떻게 다시 돌렸는지
- notes:
```

## 5. 인덱스

| ID | 날짜 | 제목 | linkedCases | 상태 |
| --- | --- | --- | --- | --- |
| INC-001 | 2026-03-31 | Android 추천코드 입력 시 대문자가 중복 입력되던 문제 | `RF-CODE-07` | fixed |

## INC-001 | 2026-03-31 | Android 추천코드 입력 시 대문자가 중복 입력되던 문제

- symptom:
  - 회원가입 화면 추천코드 칸에 소문자 `j`를 입력하면 `JJ`, `ab`를 입력하면 `AABB`처럼 문자가 중복 입력됐다.
- impact:
  - Android 실기기에서 추천코드 수동 입력이 사실상 불가능해졌고, 잘못된 코드 검증과 이탈을 유발했다.
- trigger:
  - 추천코드 입력을 controlled `TextInput`으로 유지한 상태에서 `onChangeText` 안에서 대문자 정규화와 추가 native write를 같이 수행했을 때.
- rootCause:
  - Android IME 조합 중인 텍스트와 React Native controlled value 동기화가 충돌했다.
  - 같은 입력 이벤트 안에서 JS 상태 업데이트와 native text overwrite가 겹치면서 조합 문자가 두 번 반영됐다.
- fix:
  - `app/signup.tsx` 추천코드 입력에서 `value` prop을 제거해 uncontrolled 패턴으로 전환했다.
  - `setNativeProps`는 딥링크 prefill처럼 programmatic 입력에만 사용하고, 사용자 타이핑 경로에서는 제거했다.
- linkedCases:
  - RF-CODE-07
- evidence:
  - 코드 변경: `app/signup.tsx`
  - 검증 명령: `npm run lint`
  - 후속 실기기 체크리스트: `docs/referral-system/TEST_CHECKLIST.md`
- reproduction:
  1. Android 실기기에서 회원가입 화면을 연다.
  2. 추천코드 칸에 소문자 `j` 또는 `ab`를 입력한다.
  3. 입력값이 `J`가 아니라 `JJ`, `AB`가 아니라 `AABB`처럼 중복되는지 확인한다.
- regressionCheck:
  - `RF-CODE-07`로 승격했다.
  - 실기기에서 `j -> J`, `ab -> AB`, `kcsaczxu -> KCSACZXU`를 각각 다시 확인한다.
- notes:
  - 이 이슈는 Android IME 특성상 정적 검사만으로는 잡히지 않는다. 실기기 입력 증적이 필수다.
