# SMS 실수신 검증 가이드

> 모두온 회원가입 SMS를 전용 시험 단말에서 안전하게 확인하는 운영 절차입니다.

## 1. 적용 범위

이 절차는 `request-signup-otp`의 실제 NCP SENS 접수, 단말 수신, OTP 검증을 확인합니다. 비밀번호 재설정은 같은 전송 어댑터를 사용하지만 별도 계정 수명주기 시험으로 다룹니다.

다음 결과는 서로 다른 단계입니다.

1. 모두온 API가 요청을 수락함
2. NCP 전송 API가 요청을 접수함
3. NCP 최종 이력이 `COMPLETED`, `statusCode=0`, `statusName=success`임
4. 시험 단말이 문자를 실제로 수신함
5. 수신한 OTP로 `verify-signup-otp`가 성공하고 가입 완료 capability를 발급함

앞 단계의 성공만으로 뒤 단계의 성공을 판단하지 않습니다. NCP의 최초 HTTP 202와 `requestId`는 접수 증거이며 최종 단말 수신 증거가 아닙니다.

## 2. 안전 원칙

- 소유자 동의를 받은 전용 시험 단말만 사용합니다. 고객 전화번호를 사용하지 않습니다.
- 전화번호, OTP, NCP `requestId`, 가입 완료 capability, API key, raw 응답 본문은 채팅·티켓·로그·스크린샷·시험 영수증에 남기지 않습니다.
- hosted/production Edge에서는 SMS bypass를 사용하지 않습니다. 현재 구현은 hosted 배포에서 bypass 설정을 거부합니다.
- OTP를 서버 로그에 출력하지 않습니다. `TEST_SMS_MODE` 또는 고정 OTP를 운영 검증 방법으로 사용하지 않습니다.
- 쿨다운·잠금을 풀기 위한 임의 SQL을 운영 DB에 실행하지 않습니다. 만료를 기다리거나 승인된 disposable 환경과 새 시험 계정을 사용합니다.
- 실제 발송은 비용과 외부 상태 변경을 만듭니다. 승인된 시험 창에서 1회 요청하고, 검증 단계에서는 새 문자를 발송하지 않습니다.

## 3. 사전 게이트

실수신 시험 전에 다음 항목을 모두 확인합니다.

- 배포 소스가 의도한 clean commit이고 commit SHA가 기록되어 있음
- 관련 DB migration이 먼저 적용되고 RPC/ACL 검증이 끝남
- `request-signup-otp`와 `verify-signup-otp`가 같은 commit에서 개별 배포됨
- NCP 발신번호, 서비스 ID, IAM key가 승인된 secret 저장소에서 주입됨
- 전용 시험 단말의 소유자 동의와 시험 시간이 기록됨
- 운영자가 NCP 콘솔 또는 승인된 조회 API에서 최종 전송 상태를 확인할 수 있음
- `platform_sms_delivery_attempts`와 관련 RPC가 `service_role` 전용임을 확인함

`platform_sms_delivery_attempts`에는 전화번호, OTP, 문자 본문을 저장하지 않습니다. 내부 추적 행은 승인된 운영자 경로에서만 조회합니다.

## 4. 필요한 환경변수

값은 현재 PowerShell 세션이나 승인된 비밀 저장소에서만 주입합니다. 아래 예시는 변수 이름을 보여줄 뿐입니다. 실제 전화번호나 key를 명령행에 직접 붙여 넣지 않습니다. `SUPABASE_URL`과 `SUPABASE_ANON_KEY`는 승인된 secret 주입 경로로 미리 설정합니다.

```powershell
$env:SMS_TEST_ACK = 'dedicated-consenting-device'
$env:SMS_TEST_PHONE = Read-Host '전용 시험 단말 번호'
# SUPABASE_URL, SUPABASE_ANON_KEY: 승인된 secret store에서 주입
```

선택 관측값은 민감정보가 아닌 실제 배포 버전만 사용합니다.

```powershell
$env:SMS_TEST_APP_VERSION = '<앱 버전>'
$env:SMS_TEST_BUILD_NUMBER = '<빌드 번호>'
```

## 5. 실제 수신 시험

### 5.1 발송 요청

저장소 루트에서 한 번만 실행합니다.

```powershell
Set-Location D:\hanhwa\fc-onboarding-app
node test-sms.js request
```

출력에는 phase, 시작 시각, HTTP status, 앱 수락 여부, 제한된 오류 코드만 포함됩니다. `acceptedByApplication=true`는 NCP 최종 성공이나 단말 수신을 뜻하지 않습니다.

### 5.2 NCP 최종 상태 확인

NCP 콘솔 또는 승인된 조회 API에서 같은 시험 창의 메시지를 확인합니다.

- 요청 단위 상태: `COMPLETED`
- 메시지 상태 코드: `0`
- 메시지 상태 이름: `success`
- 발신번호와 서비스가 의도한 시험 대상과 일치

`requestId`는 조회에 사용할 수 있지만 영수증에는 복사하지 않습니다. 실패 시에는 NCP의 제한된 상태 코드와 관측 시각만 기록합니다.

공식 기준:

- [SMS 발송 API](https://api.ncloud-docs.com/docs/sens-sms-send)
- [SMS 발송 요청 목록 조회](https://api.ncloud-docs.com/docs/sens-sms-list)
- [SMS 발송 요청 결과 조회](https://api.ncloud-docs.com/docs/sens-sms-get)

### 5.3 단말 수신 확인

전용 단말에서 다음만 확인합니다.

- 문자가 실제 도착함
- 서비스 식별 문구가 올바름
- OTP가 6자리임
- 수신 시각이 요청 창과 일치함

OTP나 전체 문자 본문을 캡처하지 않습니다.

### 5.4 수신 OTP 검증

새 발송 요청을 하지 않고, 같은 셸에 수신 OTP를 잠시 주입해 검증합니다.

```powershell
$env:SMS_TEST_OTP = Read-Host '수신한 6자리 OTP'
node test-sms.js verify
Remove-Item Env:SMS_TEST_OTP
```

합격 조건은 `verified=true`와 `completionCapabilityIssued=true`입니다. 스크립트는 capability 원문을 출력하지 않습니다.

시험이 끝나면 전화번호와 credential 변수를 현재 셸에서 제거합니다.

```powershell
Remove-Item Env:SMS_TEST_PHONE -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SMS_TEST_ACK -ErrorAction SilentlyContinue
```

## 6. 실패 판정과 중단 기준

| 관측 | 판정 | 다음 조치 |
| --- | --- | --- |
| 앱 요청 거절 | Edge/DB/config 실패 | 추가 발송을 멈추고 고정 오류 코드와 Edge 진단을 확인 |
| 앱 수락, NCP 이력 없음 | 전송 호출 또는 추적 완료 공백 | 추가 발송 금지, 같은 시간대의 비식별 진단과 추적 행 상태 확인 |
| NCP 최종 실패 | NCP/IAM/발신번호/수신망 문제 | NCP 상태 코드로 운영 owner에게 에스컬레이션 |
| NCP success, 단말 미수신 | 통신사·단말 수신 문제 가능 | 시험 단말 상태 확인 후 NCP 지원 절차 진행 |
| 단말 수신, OTP 검증 실패 | challenge 저장·만료·입력 불일치 | 재발송 전에 만료/소비/잠금 상태를 안전한 운영 경로로 확인 |
| timeout 또는 `sms_delivery_unknown` | 결과 불명확 | challenge를 지우거나 즉시 재발송하지 말고 NCP 최종 상태부터 확인 |

연속 재시도로 상태를 덮지 않습니다. 원인이 확인되지 않으면 릴리스를 HOLD로 유지합니다.

## 7. 비식별 시험 영수증

영수증에는 다음 항목만 남깁니다.

- clean commit SHA
- 환경 이름과 시험 시각
- 앱 버전·빌드 번호
- 각 단계의 pass/fail
- HTTP status와 제한된 내부/NCP 상태 코드
- 실제 단말 수신 여부
- OTP 검증 여부와 capability 발급 여부(boolean)
- 미검증 영역과 후속 owner

전화번호, OTP, `requestId`, token, secret, raw 응답은 포함하지 않습니다.

## 8. 로컬 회귀 검증

실제 SMS를 보내지 않는 보안 회귀 검사는 다음과 같습니다.

```powershell
node --test scripts/ci/test-sms-security.test.mjs
npm run test:edge:node
npm run test:edge:deno
```

이 검사는 NCP 최종 전달이나 실제 단말 수신을 증명하지 않습니다.

**Last verified**: 2026-10-13

**Owner**: Development / Operations
