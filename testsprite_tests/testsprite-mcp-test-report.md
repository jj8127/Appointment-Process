# TestSprite AI Testing Report (MCP)

## Document Metadata
- **Project Name:** fc-onboarding-app
- **Date:** 2025-12-12
- **Prepared by:** TestSprite AI Team

## Requirement Validation Summary

### Authentication & Session
- **TC001 — Role-Based Login Success** (Status: Passed)  
  Admin/FC 로그인 및 세션 흐름 통과. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/4c46d8dc-a727-4601-84a7-558507f48845
- **TC002 — Role-Based Login Failure (Invalid Credentials)** (Status: Passed)  
  잘못된 자격 증명 거부 확인. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/839488b5-a146-46be-b215-ea07f254fd31
- **TC003 — Push Notification Token Registration** (Status: Passed)  
  로그인 후 푸시 토큰 등록 흐름 통과. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/df49d1db-b4e6-486b-a641-d98d035135f5
- **TC016 — Session Security and Secure Storage** (Status: Failed)  
  로그인 입력 제한(숫자만)과 유효 자격 미제공으로 진행 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/c2cc1ddd-170b-426a-9586-566cc188b847

### Home Dashboard
- **TC004 — Home Dashboard Data Display and Real-time Updates** (Status: Failed)  
  Admin 로그인 미완료로 관리자 대시보드 검증 중단; FC 대시보드는 확인. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/4078ab1f-eb0d-4425-a9e0-40d0c6a51b9d

### Allowance Consent
- **TC005 — Allowance Consent Workflow Completion** (Status: Failed)  
  수당 동의 페이지가 비어 있어 흐름 시작 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/5046c3c4-1e20-450a-8d91-ee9780ae972a
- **TC006 — Allowance Consent Workflow Error Handling** (Status: Failed)  
  동일하게 페이지 로딩 실패로 검증 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/9d3e9893-f6e8-4f0a-837b-4928be04d92e

### Document Upload
- **TC007 — Document Upload Success with Progress Feedback** (Status: Failed)  
  ‘수당 동의’ 클릭 후 빈 화면으로 문서 업로드 단계 진입 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/09860992-879f-4d65-bc2e-dcac39b68544
- **TC008 — Document Upload Failure and Retry** (Status: Failed)  
  동일 빈 화면으로 실패/재시도 시나리오 진행 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/233cb502-672e-41b2-ad86-fe92dce4e626

### Exam Registration & Tracking
- **TC009 — Life Exam Registration and Admin Dashboard Tracking** (Status: Failed)  
  FC 시험 신청이 수당 동의 검토 중 상태로 비활성화되어 제출 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/f932ca4c-c061-4755-bbb5-37a7ffa0870e
- **TC010 — Non-Life Exam Registration and Admin Dashboard Tracking** (Status: Failed)  
  Admin 코드 입력 검증(숫자만) 때문에 유효 코드 미입력으로 중단. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/f0f79869-1efe-4ad4-941d-0d2fac63a20c
- **TC011 — Exam Registration Form Validation** (Status: Failed)  
  로그인/접근 차단으로 시험 등록 폼 검증 진행 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/429ca90e-7c6f-4a1b-a692-84de52aeeb17

### Messaging & Notices
- **TC012 — Real-time Messaging with Media Attachments** (Status: Failed)  
  텍스트 메시지는 동작하나 첨부 아이콘 클릭 후 미디어 업로드 UI 미표시. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/abc7b133-e7c7-4eed-a95d-13f26d120860
- **TC013 — Broadcast Notices Display and Reception** (Status: Passed)  
  공지 수신/표시 확인. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/2bd39024-2377-490e-92e0-855be3845d01

### Profile & Appointment
- **TC014 — FC Profile Editing Persistence** (Status: Failed)  
  프로필 수정 후 앱 재시작 시 변경사항이 저장되지 않음; Supabase 409, /logout 404 에러 관찰. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/5267cec3-d2c2-49cf-9048-b0bb1b07814c
- **TC015 — Appointment Scheduling and URL Handling** (Status: Failed)  
  Admin 코드 입력 검증에 막혀 위촉 일정 관리 흐름 진행 불가. 시각화: https://www.testsprite.com/dashboard/mcp/tests/831122df-731f-41b9-89bb-c8311d44aeff/c41a48c1-f477-4bc0-952d-9657d9f4cc30

## Coverage & Matching Metrics

| Requirement                     | Total Tests | ✅ Passed | ❌ Failed |
|---------------------------------|-------------|-----------|-----------|
| Authentication & Session        | 4           | 3         | 1         |
| Home Dashboard                  | 1           | 0         | 1         |
| Allowance Consent               | 2           | 0         | 2         |
| Document Upload                 | 2           | 0         | 2         |
| Exam Registration & Tracking    | 3           | 0         | 3         |
| Messaging & Notices             | 2           | 1         | 1         |
| Profile & Appointment           | 2           | 0         | 2         |
| **Total**                       | **16**      | **4**     | **12**    |

## Key Gaps / Risks
- Admin 코드 입력 시 일부 시나리오(특히 TC010, TC015, TC016)에서 여전히 잘못된 값으로 시도되어 관리자 기능 검증이 차단됨. 테스트 입력을 모두 `1111`로 맞추거나 UI의 숫자 검증 로직을 재확인 필요.
- 수당 동의 화면이 비어 있어(TC005/6/7/8) 이후 문서 업로드·동의 완료 흐름이 막힘. 정적 번들에서도 재현되므로 라우팅/렌더링 예외를 확인해야 함.
- 시험 신청/프로필 저장에서 상태 차단 또는 저장 실패(409)로 인해 폼 검증/진행이 불가(TC009/11/14/15). 백엔드 상태 제약(allowance review), API 실패(409), /logout 404 등도 함께 조사 필요.
- 메신저 미디어 첨부 UI가 열리지 않아(TC012) 첨부 기능 검증 불가. UI 열기 이벤트/퍼미션/웹 대상 구현 확인 필요.
