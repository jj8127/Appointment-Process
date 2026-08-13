# GaramIn Request Board Full Process UI Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and document every reproducible issue in the GaramIn design-request process, with UI simulator evidence where possible and code/test evidence for paths that cannot be safely submitted.

**Architecture:** Treat the flow as a cross-repo contract between GaramIn mobile (`fc-onboarding-app`), Supabase bridge functions, and GaramLink request_board API/client. UI verification runs on the local Expo web mobile viewport as the active simulator; native iOS simulator is separately gated because this repository currently has no `.xcodeproj` or `.xcworkspace`.

**Tech Stack:** Expo Router, React Native Web, Jest, TypeScript, Supabase Edge Functions, request_board Express/React API, Codex in-app browser, XcodeBuildMCP availability checks.

---

## Scope

Audit these user-visible processes:

1. FC/session entry into `설계 요청`.
2. Customer selection and new customer registration.
3. Separate policyholder entry and validation.
4. Product selection, designer selection, FC company code mapping, attachment metadata, and request submit.
5. Request list/status filtering for FC, manager/admin read-only FC inbox, and designer users.
6. Designer accept, reject with typed reason, attachment upload, completion.
7. FC approve/reject completed design.
8. Messenger, unread counts, notifications, and detail/review navigation.
9. Bridge-login/session expiry/server offline/error states.
10. Layout behavior on small mobile, tall mobile, and desktop-width web.

## Files And Responsibilities

- Read/audit: `app/request-board.tsx` for dashboard, quick cards, designer accept/reject, notification summaries.
- Read/audit: `app/request-board-create.tsx` for customer/request wizard, validation, designer/product matrix, submission.
- Read/audit: `app/request-board-review.tsx` for detail, designer complete, FC approve/reject, attachments.
- Read/audit: `app/request-board-requests.tsx` for request list, filters, status display, hydration.
- Read/audit: `app/request-board-messenger.tsx` and `app/request-board-fc-codes.tsx` for side flows.
- Read/audit: `lib/request-board-api.ts`, `lib/request-board-session.ts`, `hooks/use-session.tsx` for bridge/session behavior.
- Read/audit: `supabase/functions/sync-request-board-session/index.ts`, `supabase/functions/login-with-password/index.ts`, `supabase/functions/set-password/index.ts` for bridge/auth/password sync.
- Cross-repo read/audit: `D:\hanhwa\request_board\server` and `D:\hanhwa\request_board\client` request/customer/designer/message routes and UI.
- Test references: `lib/__tests__/request-board-*.test.ts`, `supabase/functions/**/__tests__/*request-board*.test.ts`, request_board tests where present.
- Evidence output: `.codex/harness/request-board-full-audit-20260618/`.
- Issue ledger: `.codex/harness/request-board-full-audit-20260618/issues.md`.

## Simulator Boundary

- Native iOS simulator: run `session_show_defaults`; if project/workspace/scheme/simulator are missing, run `discover_projs` for `D:\hanhwa\fc-onboarding-app`. If no Xcode project/workspace is found, mark native simulator as blocked with tool output.
- UI simulator fallback: use `http://localhost:8091/request-board-create` and related routes in the Codex in-app browser at mobile dimensions.
- Do not submit real requests, upload personal files, or transmit personal data without explicit user confirmation at action time.

### Task 1: Establish Baseline And Evidence Folder

**Files:**
- Create/update evidence only under `.codex/harness/request-board-full-audit-20260618/`.
- Do not edit product code in this audit task.

- [ ] **Step 1: Confirm workspace state**

Run:

```powershell
git status --short
Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
```

Expected:

```text
fc-onboarding-app has no unexpected working-tree changes.
8091 and 3001 are listening, or a startup task is created before UI testing.
```

- [ ] **Step 2: Create issue ledger**

Create `.codex/harness/request-board-full-audit-20260618/issues.md` with this exact template for each issue:

```markdown
## ISSUE-N | P? | Short Korean Title
- Status: open
- Surface: create/review/list/home/messenger/session/API
- Evidence: screenshot path, DOM measurement, command output, or file/line
- Repro steps:
- Expected:
- Actual:
- Suspected cause:
- Recommended fix:
- Recommended regression test:
```

### Task 2: Static Contract Audit

**Files:**
- Read: `app/request-board*.tsx`, `lib/request-board-*.ts`, `hooks/use-session.tsx`, `components/BottomNavigation.tsx`.
- Read: `lib/__tests__/request-board-*.test.ts`.

- [ ] **Step 1: Build route/process inventory**

Run:

```powershell
rg -n "router\\.(push|replace)|pathname: '/request-board|request-board-" app lib hooks components
rg -n "rb(Create|Get|Approve|Reject|Accept|Complete|Upload|Save)|ensureRequestBoardSession|requestBoardRole|isRequestBoardDesigner" app lib hooks supabase/functions
```

Expected:

```text
Every route transition and API call is mapped to one of the 10 scope processes.
```

- [ ] **Step 2: Check payload/UI parity**

Run:

```powershell
npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-api-contract.test.ts lib/__tests__/request-board-customer-input.test.ts lib/__tests__/request-board-driving-status.test.ts
```

Expected:

```text
PASS. Any missing UI field, validation field, or canonical value drift becomes a ledger issue.
```

- [ ] **Step 3: Check status/action contracts**

Run:

```powershell
npm test -- --runInBand lib/__tests__/request-board-review-actions.test.ts lib/__tests__/request-board-review-role.contract.test.ts lib/__tests__/request-board-list-filters.test.ts lib/__tests__/request-board-rejection-summary.test.ts lib/__tests__/request-board-create-flow.test.ts
```

Expected:

```text
PASS. Any status path not covered by tests becomes a ledger issue.
```

### Task 3: Browser UI Simulator Sweep

**Files:**
- Evidence screenshots: `.codex/harness/request-board-full-audit-20260618/*.png`.
- Issue ledger: `.codex/harness/request-board-full-audit-20260618/issues.md`.

- [ ] **Step 1: Attach to in-app browser**

Use the Codex browser skill, select the current `iab` browser tab, and preserve the user's current page unless a route change is part of the test.

Expected:

```text
Current URL is http://localhost:8091/request-board-create or a related request-board route.
```

- [ ] **Step 2: Sweep create route at mobile viewport**

Use viewport `390x844` first, then `442x907`, then `375x667`. For each viewport:

```text
1. Reload route.
2. Dismiss any load error only after screenshot capture.
3. Inspect visible text, buttons, scroll containers, modal bounds, bottom navigation.
4. Scroll from top to bottom.
5. Record any overlap, clipping, unreachable CTA, bottom-nav covering content, or unusable error state.
```

Expected:

```text
No section labels overlap chips/inputs.
All primary actions remain reachable above bottom nav/safe area.
Keyboard-sensitive inputs are scrollable.
```

- [ ] **Step 3: Exercise validation without transmitting data**

On `/request-board-create`, trigger local validations only:

```text
1. Try advancing without a customer.
2. Switch to new customer.
3. Toggle separate policyholder.
4. Leave required fields blank and try save.
5. Fill synthetic non-sensitive values only if needed: 홍길동, 900101-1234567, 010-1234-1234, 서울시 강남구 테헤란로 123.
6. Do not submit the final create request without user confirmation.
```

Expected:

```text
Validation messages are specific, visible, and do not trap the user behind modal/bottom nav/keyboard.
```

- [ ] **Step 4: Sweep review/list/home/messenger routes**

Visit:

```text
http://localhost:8091/request-board
http://localhost:8091/request-board-requests
http://localhost:8091/request-board-review
http://localhost:8091/request-board-messenger
http://localhost:8091/request-board-fc-codes
```

For each route:

```text
1. Capture top state.
2. Capture loading/error/empty state.
3. Scroll if available.
4. Check bottom nav and primary buttons.
5. Record broken copy, mojibake, unreachable controls, or generic errors.
```

Expected:

```text
Blocked/session-expired states explain the next action; pages do not show generic "data load failed" when a relogin or bridge issue is known.
```

### Task 4: Cross-Repo API/Bridge Audit

**Files:**
- Read: `D:\hanhwa\request_board\server\src`, `D:\hanhwa\request_board\client\src`.
- Read: `D:\hanhwa\fc-onboarding-app\lib\request-board-api.ts`.
- Read: `D:\hanhwa\fc-onboarding-app\supabase\functions\sync-request-board-session\index.ts`.

- [ ] **Step 1: Compare mobile payloads with server schemas**

Run in each repo:

```powershell
rg -n "customerBirthDate|customerDrivingStatus|policyholder|insuranceQualifications|designerCodeSelections|requestDesignerId|attachments|expiry" D:\hanhwa\fc-onboarding-app D:\hanhwa\request_board
```

Expected:

```text
Every submitted mobile field is accepted, persisted, returned to list/detail, and displayed somewhere user-visible.
```

- [ ] **Step 2: Check auth/session failure messaging**

Run:

```powershell
npm test -- --runInBand lib/__tests__/request-board-session.test.ts lib/__tests__/request-board-session-error.test.ts
```

Expected:

```text
Session/bridge/server-down failures map to specific Korean UI guidance, not only a generic data-load error.
```

### Task 5: Report And Fix Planning

**Files:**
- Update: `.codex/harness/request-board-full-audit-20260618/issues.md`.
- If fixes are later requested, update: `.claude/MISTAKES.md` for repeatable regression patterns.

- [ ] **Step 1: Merge subagent findings**

For each subagent finding:

```text
1. Verify file/line locally.
2. Deduplicate against browser findings.
3. Convert into ISSUE-N format.
4. Mark confidence as confirmed/probable/needs-data.
```

- [ ] **Step 2: Prioritize**

Use:

```text
P0: creates wrong request, leaks/loses PII, blocks all users.
P1: blocks a normal design-request path or hides required fields/actions.
P2: visible UI break, misleading status, missing edge validation.
P3: polish, test gap, copy problem with no blocked path.
```

- [ ] **Step 3: Produce fix batches**

Batch issues by write-set:

```text
Batch A: create wizard UI/validation.
Batch B: review/list status/action display.
Batch C: session/API/bridge error handling.
Batch D: GaramLink API/client contract drift.
Batch E: regression tests and mistake-ledger entries.
```

Expected:

```text
Each batch can be implemented and verified independently with a focused test list.
```

## Completion Gate

Before claiming this audit is complete, run:

```powershell
npm test -- --runInBand lib/__tests__/request-board-mobile-ui-contract.test.ts lib/__tests__/request-board-create-flow.test.ts lib/__tests__/request-board-review-actions.test.ts lib/__tests__/request-board-list-filters.test.ts lib/__tests__/request-board-session-error.test.ts
npm run lint
npx tsc --noEmit --pretty false
git diff --check
```

Audit completion also requires:

```text
1. Native simulator capability recorded as available or blocked with XcodeBuildMCP evidence.
2. Browser UI simulator screenshots saved for all audited request-board routes.
3. Issue ledger populated, even if it says "no issue found" for a route.
4. Any real data submission was either avoided or explicitly confirmed by the user.
```
