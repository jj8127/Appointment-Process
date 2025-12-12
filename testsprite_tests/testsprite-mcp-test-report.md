# TestSprite AI Testing Report (MCP)

---

## 1. Document Metadata
- **Project Name:** fc-onboarding-app
- **Date:** 2025-12-12
- **Prepared by:** TestSprite AI (generated via MCP)

---

## 2. Requirement Validation Summary

### Requirement: Authentication (FC/Admin)
- **TC001 – User Authentication Success for FC:** Failed – 앱 진입 URL `http://localhost:8081/` 로딩 타임아웃(60s) 발생, 화면 진입 불가.
- **TC002 – User Authentication Success for Admin:** Failed – 동일하게 시작 URL 로딩 타임아웃으로 화면 진입 불가.
- **TC003 – User Authentication Failure with Invalid Resident ID:** Failed – 시작 URL 로딩 타임아웃으로 테스트 진행 불가.

### Requirement: FC Registration
- **TC004 – FC Registration Form Validation Success:** Failed – 시작 URL 로딩 타임아웃.
- **TC005 – FC Registration Form Validation for Invalid Input:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: Allowance Consent
- **TC006 – Allowance Consent Multi-step Agreement Completion:** Failed – 시작 URL 로딩 타임아웃.
- **TC007 – Allowance Consent Handling of Missing Actions:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: Document Upload
- **TC008 – Document Upload Success with Notifications:** Failed – 시작 URL 로딩 타임아웃.
- **TC009 – Document Upload Failure Handling:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: Exam Application & Management
- **TC010 – Exam Application Submission Success:** Failed – 시작 URL 로딩 타임아웃.
- **TC011 – Exam Application Form Validation Errors:** Failed – 시작 URL 로딩 타임아웃.
- **TC012 – Admin Exam Management - Candidate Scheduling and Status Update:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: Chat & Messaging
- **TC013 – 1:1 Chat Messaging Between FCs and Admins:** Failed – 시작 URL 로딩 타임아웃.
- **TC014 – Chat Message Failure and Retry Mechanism:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: Admin Notices & Appointments
- **TC015 – Admin Notice Creation and Notification Management:** Failed – 시작 URL 로딩 타임아웃.
- **TC016 – Admin Registration and Appointment Tools Functionality:** Failed – 시작 URL 로딩 타임아웃.

### Requirement: UI Rendering & Responsiveness
- **TC017 – UI Component Rendering Consistency Across Devices:** Failed – 시작 URL 로딩 타임아웃.

---

## 3. Coverage & Matching Metrics
- **Passed:** 0 / 17
- **Failed:** 17 / 17
- **Pass Rate:** 0.00%

| Requirement                           | Total Tests | Passed | Failed |
|---------------------------------------|------------:|-------:|-------:|
| Authentication                        | 3           | 0      | 3      |
| FC Registration                       | 2           | 0      | 2      |
| Allowance Consent                     | 2           | 0      | 2      |
| Document Upload                       | 2           | 0      | 2      |
| Exam Application & Management         | 3           | 0      | 3      |
| Chat & Messaging                      | 2           | 0      | 2      |
| Admin Notices & Appointments          | 2           | 0      | 2      |
| UI Rendering & Responsiveness         | 1           | 0      | 1      |

---

## 4. Key Gaps / Risks
- 모든 테스트가 시작 URL(`http://localhost:8081/`) 로딩 단계에서 60초 타임아웃으로 실패했으며, 이후 시나리오가 실행되지 않음.
- 원인 가능성: (1) Expo dev 서버가 HTTP로 접근 가능한 상태가 아니거나 번들 빌드가 지연/중단됨, (2) 웹 엔드포인트가 없거나 Expo Router 웹 번들이 실패, (3) 터널/프록시 설정 문제로 외부에서 로컬 8081 접근 불가.
- 테스트 커버리지 측면에서 UI·기능 전반이 검증되지 않아 품질 신뢰도가 확보되지 않음.

---

## 5. Recommendations / Next Actions
1) **웹 번들/엔드포인트 확인:** `npm run web` 또는 현재 실행 중인 `npm run start -- --port 8081`가 실제로 http://localhost:8081 에서 로드 가능한지 브라우저로 직접 확인. 필요시 `expo start --web --port 8081`처럼 웹 모드 강제.
2) **빌드 로그 점검:** dev 서버 콘솔에서 번들 실패/에러가 있는지 확인하고 해결(예: 환경변수, Supabase 키, 경로 오류 등).
3) **터널 재검증:** 로컬에서 브라우저로 8081 접속이 정상이라면, Testsprite 터널 재시도(현재는 성공적으로 생성됨). 여전히 타임아웃 시, 터널 측에서 웹 응답이 보이지 않는지 지원팀에 로그 제공.
4) **실패 테스트 재시도:** 위 조치 후 `generateCodeAndExecute`를 다시 실행해 전체 17개 케이스를 재검증.

---

## 6. Attachments / References
- 원시 리포트: `testsprite_tests/tmp/raw_report.md`
- 상세 결과 JSON: `testsprite_tests/tmp/test_results.json`
- 테스트 플랜: `testsprite_tests/testsprite_frontend_test_plan.json`
