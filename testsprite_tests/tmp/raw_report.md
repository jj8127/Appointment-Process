
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** fc-onboarding-app
- **Date:** 2025-12-15
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC01
- **Test Name:** FC 기본 정보 입력
- **Test Code:** [TC01_FC___.py](./TC01_FC___.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/8a7f0856-532f-441c-9b46-04f9b96b66d2
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC02
- **Test Name:** 총무 임시사번 발행 및 경력 등록
- **Test Code:** [TC02______.py](./TC02______.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/ef6f648d-f04a-4cc3-9c22-8ed72ca8582f
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC03
- **Test Name:** FC 수당 동의 및 날짜 입력
- **Test Code:** [TC03_FC_____.py](./TC03_FC_____.py)
- **Test Error:** The allowance agreement slides page failed to load after multiple attempts, resulting in a blank page. This prevents completing the task of verifying that an FC with a temporary number can view all allowance agreement slides, input the temporary number and agreement date, and submit the agreement. Further investigation is needed to resolve this issue.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/5b652767-5c70-47e5-8c5d-77994b97a1d4
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC04
- **Test Name:** 총무 수당 동의 승인 및 필수 서류 목록 등록
- **Test Code:** [TC04_________.py](./TC04_________.py)
- **Test Error:** The task to verify 총무 approval and document request display for FC could not be completed because login as 총무 failed due to invalid 관리자 코드. The issue has been reported. No further actions possible.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/bb0283dd-00d1-431b-be81-dfdb22ae6ed7
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC05
- **Test Name:** FC 서류 업로드
- **Test Code:** [TC05_FC__.py](./TC05_FC__.py)
- **Test Error:** The page became empty after clicking '수당 동의', preventing further progress to the document upload screen. Reporting this as a website issue and stopping the task.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/0071fdec-df43-49a3-b626-85fd8ee0f32d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC06
- **Test Name:** 총무 서류 개별 승인
- **Test Code:** [TC06____.py](./TC06____.py)
- **Test Error:** The task cannot proceed because the submitted documents list page is empty after clicking '수당 동의'. The issue has been reported. Stopping further actions.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/c19c78d9-89f0-4e03-a1ea-9d382b253296
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC07
- **Test Name:** 총무 위촉 차수 입력
- **Test Code:** [TC07____.py](./TC07____.py)
- **Test Error:** The task to verify if the 생명/손해 위촉 차수 input by 총무 is visible to FC cannot be completed because login as 총무 failed. The 관리자 코드 '123456' was rejected and the login page remained with an error highlight. The issue has been reported. Further testing is blocked without successful login.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/1749d4c5-d142-4fc0-a3ed-017ebd05e79d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC08
- **Test Name:** FC 위촉 날짜 입력
- **Test Code:** [TC08_FC___.py](./TC08_FC___.py)
- **Test Error:** The appointment date input screen is not accessible due to a blank page issue after login and navigation attempts. The task to verify if FC can input and submit the appointment date cannot be completed. Please fix the website issue.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/c5795885-9502-43df-b29e-24ae0da0347f
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC09
- **Test Name:** 총무 위촉 날짜 승인
- **Test Code:** [TC09____.py](./TC09____.py)
- **Test Error:** The task to verify if the 총무 can approve the 위촉 날짜 entered by FC and change the status to 완료 could not be completed due to inability to login as 총무. Multiple attempts to login with 관리자 코드 failed due to validation errors. The issue has been reported. Task stopped.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/4bd60b83-943f-499b-8534-d3732bc043fd
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC10
- **Test Name:** 시험 신청 접근 제약
- **Test Code:** [TC10____.py](./TC10____.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/64b8753f-6b7c-4716-9866-10d3fffc8d9f
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC11
- **Test Name:** FC 시험 신청
- **Test Code:** [TC11_FC__.py](./TC11_FC__.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/c89cf7b1-c265-4fe6-aea2-fe11d2e2ef81
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC12
- **Test Name:** 총무 시험 등록 완료
- **Test Code:** [TC12____.py](./TC12____.py)
- **Test Error:** The task to verify if FC 상태 updates upon 등록 완료 처리 by 총무 cannot be completed due to login failure. The admin code input is invalid, preventing access to the 시험 신청 대시보드. The issue has been reported. Stopping all further actions.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/bc74143a-a647-418d-9a7f-8b2963429caa/aa2b6907-c6e5-40a5-a0a0-5596f861027c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **33.33** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---