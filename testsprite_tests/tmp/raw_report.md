
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** fc-onboarding-app
- **Date:** 2025-12-22
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TS-FC-006
- **Test Name:** Identity 입력 유효성
- **Test Code:** [TS-FC-006_Identity__.py](./TS-FC-006_Identity__.py)
- **Test Error:** Stopped testing due to missing required field validation for 주민번호 front part. Reported issue to development team.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-1443286179aa7efc1ab422f19ad9d01c.js:1151:219)
[WARNING] Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md (at http://localhost:8081/_expo/static/js/web/entry-1443286179aa7efc1ab422f19ad9d01c.js:387:6878)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/afb2770e-28d6-4937-a2f9-c1c5332427a5/59961ffe-89c9-4d18-86ac-7af4ed1f39f7
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TS-FC-010
- **Test Name:** 설정에서 계정 삭제
- **Test Code:** [TS-FC-010___.py](./TS-FC-010___.py)
- **Test Error:** Account deletion button is non-functional. No confirmation or navigation occurs after clicking it. Reporting this as a critical issue and stopping further testing.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-1443286179aa7efc1ab422f19ad9d01c.js:1151:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/afb2770e-28d6-4937-a2f9-c1c5332427a5/d3b51700-40d9-4050-8eab-e196a7629eb1
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **0.00** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---