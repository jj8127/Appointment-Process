
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** fc-onboarding-app
- **Date:** 2025-12-12
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001
- **Test Name:** Role-Based Login Success
- **Test Code:** [TC001_Role_Based_Login_Success.py](./TC001_Role_Based_Login_Success.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/8a002e68-3bbe-495d-b2a6-b6c1aeadfa98
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002
- **Test Name:** Role-Based Login Failure for Invalid Credentials
- **Test Code:** [TC002_Role_Based_Login_Failure_for_Invalid_Credentials.py](./TC002_Role_Based_Login_Failure_for_Invalid_Credentials.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/80f68ff3-63bc-4516-a618-3a5d05a471fa
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003
- **Test Name:** Push Notification Token Registration
- **Test Code:** [TC003_Push_Notification_Token_Registration.py](./TC003_Push_Notification_Token_Registration.py)
- **Test Error:** The task to verify push notification token registration for Admin and FC roles could not be completed because the Admin login failed due to input validation issues. The issue has been reported. Further testing is blocked until the login problem is resolved.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/c28817ab-570b-4737-a2da-9f08fd2ecda1
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004
- **Test Name:** Home Dashboard Data Display and Real-time Updates
- **Test Code:** [TC004_Home_Dashboard_Data_Display_and_Real_time_Updates.py](./TC004_Home_Dashboard_Data_Display_and_Real_time_Updates.py)
- **Test Error:** Unable to proceed with the task due to lack of valid Admin code or FC phone number for login. Without successful login, verification of dashboard metrics and real-time updates cannot be performed. Please provide valid credentials to continue.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/e6c77b03-c517-4ce5-983f-8ded10abfc16
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005
- **Test Name:** Allowance Consent Workflow Completion
- **Test Code:** [TC005_Allowance_Consent_Workflow_Completion.py](./TC005_Allowance_Consent_Workflow_Completion.py)
- **Test Error:** The FC user cannot complete the allowance consent workflow because the user has no temporary ID issued, which is a prerequisite for accessing the consent slides and submitting data. The dashboard confirms no temporary ID issuance records exist. Therefore, the workflow cannot proceed, and no profile status update or admin notification can be verified. This is a blocker for the task.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/e301d617-b367-424b-b38b-f63e4f32e21e
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006
- **Test Name:** Allowance Consent Workflow Error Handling
- **Test Code:** [TC006_Allowance_Consent_Workflow_Error_Handling.py](./TC006_Allowance_Consent_Workflow_Error_Handling.py)
- **Test Error:** The allowance consent form page is not loading, so error handling for missing or invalid mandatory fields cannot be tested. Please check the application for issues preventing the form from displaying.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/ce783caf-fc2e-4328-a73a-a2cc9689aa3c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007
- **Test Name:** Document Upload Success with Progress Feedback
- **Test Code:** [TC007_Document_Upload_Success_with_Progress_Feedback.py](./TC007_Document_Upload_Success_with_Progress_Feedback.py)
- **Test Error:** The page goes blank after clicking the Allowance Agreement button, preventing navigation to the document upload interface. Task cannot proceed further.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/b030f82b-1bf3-4a44-9a01-83fe7a9cc354
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008
- **Test Name:** Document Upload Failure and Retry
- **Test Code:** [TC008_Document_Upload_Failure_and_Retry.py](./TC008_Document_Upload_Failure_and_Retry.py)
- **Test Error:** Stopped testing due to empty page at document upload step preventing further progress. Reported the issue for resolution.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/2dce9197-dff8-453d-83f9-f61e35ad0cd3
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009
- **Test Name:** Life Exam Registration and Admin Dashboard Tracking
- **Test Code:** [TC009_Life_Exam_Registration_and_Admin_Dashboard_Tracking.py](./TC009_Life_Exam_Registration_and_Admin_Dashboard_Tracking.py)
- **Test Error:** The FC user was able to log in and navigate to the life exam registration form, but the form submission was blocked due to pending allowance consent review. Attempts to log in as admin to approve the consent failed due to invalid admin code. Without valid admin credentials, the test cannot be completed. Please provide a valid admin code to continue testing.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/6a8f5e0a-c155-4277-be8b-778febbd0192
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010
- **Test Name:** Non-Life Exam Registration and Admin Dashboard Tracking
- **Test Code:** [TC010_Non_Life_Exam_Registration_and_Admin_Dashboard_Tracking.py](./TC010_Non_Life_Exam_Registration_and_Admin_Dashboard_Tracking.py)
- **Test Error:** Admin login attempts failed with provided codes. Unable to proceed with approval process to enable FC user registration. Task cannot be fully completed due to missing valid Admin credentials.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) (at http://localhost:8081/logout:0:0)
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) (at http://localhost:8081/admin:0:0)
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) (at http://localhost:8081/login:0:0)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/3e918abc-d5b7-4bd6-9c20-ab612bbab7cf
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011
- **Test Name:** Exam Registration Form Validation
- **Test Code:** [TC011_Exam_Registration_Form_Validation.py](./TC011_Exam_Registration_Form_Validation.py)
- **Test Error:** Cannot proceed to exam registration forms due to invalid admin code input validation blocking access. Reporting issue and stopping further testing.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/7c9d59b3-2e46-4463-8f96-06c07a43964b
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012
- **Test Name:** Real-time Messaging with Media Attachments
- **Test Code:** [TC012_Real_time_Messaging_with_Media_Attachments.py](./TC012_Real_time_Messaging_with_Media_Attachments.py)
- **Test Error:** Testing stopped due to non-functional attachment button in chat interface. Media attachment feature could not be tested. Text messaging between FC and Admin works as expected. Please fix the attachment button issue to continue testing.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/e7f7b925-dbd4-4ad5-a280-9356a8c4f3e4
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013
- **Test Name:** Broadcast Notices Display and Reception
- **Test Code:** [TC013_Broadcast_Notices_Display_and_Reception.py](./TC013_Broadcast_Notices_Display_and_Reception.py)
- **Test Error:** The test could not be completed because the Admin login failed with the provided code '1234'. The input field was highlighted in red indicating invalid input, preventing access to create broadcast notices and verify FC user view. The issue has been reported and testing stopped.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/83713776-65ff-407b-843b-8799dd321db3
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014
- **Test Name:** FC Profile Editing Persistence
- **Test Code:** [TC014_FC_Profile_Editing_Persistence.py](./TC014_FC_Profile_Editing_Persistence.py)
- **Test Error:** Testing stopped due to critical issue: Address search popup does not allow selecting an address, preventing profile changes from being saved and verified for persistence.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
[ERROR] Failed to load resource: the server responded with a status of 400 (Bad Request) (at http://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js:0:0)
[WARNING] Event (at :0:0)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/cd5df642-ec32-40eb-9304-3d7ab7222e65
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015
- **Test Name:** Appointment Scheduling and URL Handling
- **Test Code:** [TC015_Appointment_Scheduling_and_URL_Handling.py](./TC015_Appointment_Scheduling_and_URL_Handling.py)
- **Test Error:** Testing stopped due to admin login failure caused by input validation error on admin code field. FC user appointment creation is blocked due to pending allowance agreement review. Admin capabilities to manage appointments could not be verified.
Browser Console Logs:
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) (at http://localhost:8081/admin-login:0:0)
[WARNING] [expo-notifications] Listening to push token changes is not yet fully supported on web. Adding a listener will have no effect. (at http://localhost:8081/_expo/static/js/web/entry-cb4438a037bacd97ec859bd38ea77d93.js:1154:219)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/86e78e10-ceca-4233-9799-bbbfd7c54159
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC016
- **Test Name:** Session Security and Secure Storage
- **Test Code:** [TC016_Session_Security_and_Secure_Storage.py](./TC016_Session_Security_and_Secure_Storage.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/ea705522-97a0-49b5-b693-c75991e11bf6/0696a6cf-3734-4b56-b29b-a6391aedad57
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **18.75** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---