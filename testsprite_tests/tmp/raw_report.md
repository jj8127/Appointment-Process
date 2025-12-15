
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
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/f96c33ee-cfc2-4b58-baf4-d57ef9ff4223
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC02
- **Test Name:** 총무 임시사번 발행 및 경력 등록
- **Test Code:** [TC02______.py](./TC02______.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/d8eef501-b29e-444d-a6ef-65693adb24d9
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC03
- **Test Name:** FC 수당 동의 및 날짜 입력
- **Test Code:** [TC03_FC_____.py](./TC03_FC_____.py)
- **Test Error:** The allowance agreement slides fail to load after multiple attempts, resulting in an empty page with no interactive elements. This blocks the ability to review the slides, input the temporary ID and agreement date, and submit the agreement. The issue prevents completion of the task to verify the allowance agreement submission flow for an FC with a temporary ID. Recommend reporting this issue for further investigation.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/3a050c16-8638-4070-b266-cbde8f7d717b
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC04
- **Test Name:** 총무 수당 동의 승인 및 필수 서류 목록 등록
- **Test Code:** [TC04_________.py](./TC04_________.py)
- **Test Error:** The task to approve 수당동의 for FC and verify document request display for FC cannot proceed because the approval action does not work. The issue has been reported. Stopping further actions.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:387:6878)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/94241c53-b09a-47df-a966-87794da3b8fa
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC05
- **Test Name:** FC 서류 업로드
- **Test Code:** [TC05_FC__.py](./TC05_FC__.py)
- **Test Error:** Testing stopped due to empty page after navigation attempt to document upload screen. Unable to verify document upload progress and status as required by the task.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/0761a20a-9938-49c8-9dd7-e7821a5d1c58
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC06
- **Test Name:** 총무 서류 개별 승인
- **Test Code:** [TC06____.py](./TC06____.py)
- **Test Error:** No submitted documents are available for approval or rejection. Therefore, the test to verify if FC status updates immediately upon individual approval/rejection cannot be performed. Task stopped.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/1ebea8d7-7fb4-4dfe-9539-cc1dd95a7718
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC07
- **Test Name:** 총무 위촉 차수 및 일정 설정
- **Test Code:** [TC07______.py](./TC07______.py)
- **Test Error:** Tested the ability of 총무 to input and save 생명/손해 위촉 차수 및 일정 정보. After clicking 저장, no confirmation or change was observed, indicating the save action may not be working. Therefore, the verification if FC can see the saved data cannot proceed. Please investigate the save functionality issue.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:387:6878)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/493474e4-bf45-469c-a486-ed0bd143996d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC08
- **Test Name:** FC 위촉 날짜 입력
- **Test Code:** [TC08_FC___.py](./TC08_FC___.py)
- **Test Error:** The appointment date input screen is not accessible after FC login and clicking '수당 동의'. The page is empty and no input fields or buttons are available to enter or submit the appointment date. Task cannot be completed as expected.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/9e176e96-a75e-40e2-85c8-a74c92b352ce
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC09
- **Test Name:** 총무 위촉 날짜 승인
- **Test Code:** [TC09____.py](./TC09____.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/4ed37e74-6ea8-4cdb-a974-ede75a3a4c67
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC10
- **Test Name:** 시험 신청 접근 제약
- **Test Code:** [TC10____.py](./TC10____.py)
- **Test Error:** Test stopped due to persistent validation errors on phone number and resident registration number fields preventing form submission. Unable to verify access restrictions for FC with unpaid allowance consent. Please fix the form validation issue to continue testing.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/cd714765-9965-4379-a545-56fdfe33f073
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC11
- **Test Name:** FC 시험 신청
- **Test Code:** [TC11_FC__.py](./TC11_FC__.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/ebbe5890-db89-41ea-8c33-0f9289916c06
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC12
- **Test Name:** 총무 시험 등록 완료
- **Test Code:** [TC12____.py](./TC12____.py)
- **Test Error:** The task to verify if FC 상태 갱신 occurs after 총무 registers 대상 FC 신청 as 등록 완료 cannot be completed because the required processing functionality is missing or inaccessible on the current system. The issue has been reported. Task stopped.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:387:6878)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/af6da7ca-22eb-4292-bcc7-67fe890b444c/e2351c69-c7b1-4507-a352-a256b7a875fc
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