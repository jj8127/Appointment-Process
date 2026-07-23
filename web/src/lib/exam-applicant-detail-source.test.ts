import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listSource = readFileSync('web/src/app/dashboard/exam/applicants/page.tsx', 'utf8');
const detailSource = readFileSync('web/src/app/dashboard/exam/applicants/[id]/page.tsx', 'utf8');
const roundApplicantSource = readFileSync('web/src/app/admin/exams/[id]/page.tsx', 'utf8');
const apiSource = readFileSync('web/src/app/api/admin/exam-applicants/route.ts', 'utf8');
const cssSource = readFileSync('web/src/app/dashboard/exam/applicants/page.module.css', 'utf8');
const detailCssSource = readFileSync('web/src/app/dashboard/exam/applicants/[id]/page.module.css', 'utf8');
const notificationClientSource = readFileSync(
  'web/src/lib/exam-applicant-notification-client.ts',
  'utf8',
);

test('applicant rows expose hover identity and keyboard-accessible detail navigation', () => {
  assert.match(listSource, /<Tooltip\.Floating/);
  assert.match(listSource, /position="top"/);
  assert.match(listSource, /offset=\{24\}/);
  assert.match(listSource, /floatingIdentityTooltip/);
  assert.match(listSource, /label=\{`\$\{item\.affiliation[^`]+\$\{item\.name/);
  assert.match(listSource, /role="link"/);
  assert.match(listSource, /tabIndex=\{0\}/);
  assert.match(listSource, /router\.push\(`\/dashboard\/exam\/applicants\/\$\{encodeURIComponent\(item\.id\)\}`\)/);
  assert.match(listSource, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(cssSource, /\.applicantRow\[data-reception='confirmed'\]:hover td/);
  assert.match(cssSource, /\.applicantRow:focus-visible/);
  assert.match(cssSource, /background: rgba\(17, 24, 39, 0\.78\)/);
});

test('applicant table headers carry stable keys', () => {
  assert.match(listSource, /<Table\.Th key=\{field\} style=\{headerStyle\}>/);
});

test('top filters render compact selected states and structured round options', () => {
  assert.match(listSource, /kind: 'subject' \| 'round'/);
  assert.match(listSource, /option\.label\.split\(' · '\)/);
  assert.match(listSource, /data-selected=\{isSelected \|\| undefined\}/);
  assert.match(listSource, /inner: \{[\s\S]*height: '100%'[\s\S]*alignItems: 'center'/);
  assert.match(listSource, /label: \{[\s\S]*display: 'flex'[\s\S]*alignItems: 'center'/);
  assert.match(cssSource, /\.topFilterOptions/);
  assert.match(cssSource, /\.roundDateBadge/);
});

test('summary cards filter reception status without changing their counts', () => {
  assert.match(listSource, /const baseFilteredRows = useMemo/);
  assert.match(listSource, /if \(field === 'is_confirmed'\) return true/);
  assert.match(listSource, /const selectedReceptionStatus = filters\.is_confirmed\?\.length === 1/);
  assert.match(listSource, /const currentStatus = current\.is_confirmed\?\.length === 1/);
  assert.match(listSource, /setReceptionStatusFilter\('접수 완료'\)/);
  assert.match(listSource, /setReceptionStatusFilter\('미접수'\)/);
  assert.match(listSource, /aria-pressed=\{selectedReceptionStatus === '접수 완료'\}/);
  assert.match(cssSource, /\.statCard\[data-tone='confirmed'\]\[data-active\]/);
});

test('applicant rows visually distinguish confirmed and pending reception states', () => {
  assert.match(listSource, /data-reception=\{item\.is_confirmed \? 'confirmed' : 'pending'\}/);
  assert.match(cssSource, /\.applicantRow\[data-reception='confirmed'\] td/);
  assert.match(cssSource, /\.applicantRow\[data-reception='pending'\] td/);
  assert.match(listSource, /\$\{formatExamApplicantReceptionStatus\(item\)\}, 상세 보기/);
});

test('detail route loads only the selected registration and provides the reception action', () => {
  assert.match(detailSource, /registrationId=\$\{encodeURIComponent\(registrationId\)\}/);
  assert.match(detailSource, /시험 접수하기/);
  assert.match(detailSource, /disabled=\{isReadOnly \|\| applicant\.is_confirmed\}/);
  assert.match(detailSource, /notifyFcExamApprovalStatus\(item, true\)/);
  assert.match(detailSource, /본부장 계정은 신청 내용을 확인만 할 수 있습니다/);
});

test('detail route navigates to previous and next applicants in stable list order', () => {
  assert.match(apiSource, /async function readApplicantNavigation\(registrationId: string\)/);
  assert.match(apiSource, /\.order\('created_at', \{ ascending: false \}\)[\s\S]+\.order\('id', \{ ascending: false \}\)/);
  assert.match(apiSource, /previousId: currentIndex > 0/);
  assert.match(apiSource, /nextId: currentIndex >= 0/);
  assert.match(detailSource, /aria-label="이전 신청자로 이동"/);
  assert.match(detailSource, /aria-label="다음 신청자로 이동"/);
  assert.match(detailSource, /disabled=\{!navigation\.previousId\}/);
  assert.match(detailSource, /disabled=\{!navigation\.nextId\}/);
  assert.match(detailCssSource, /position: fixed/);
  assert.match(detailCssSource, /top: 50%/);
  assert.match(detailCssSource, /\.sideNavigationPrevious/);
  assert.match(detailCssSource, /\.sideNavigationNext/);
});

test('admin API validates the requested registration and keeps history for application type', () => {
  assert.match(apiSource, /const registrationId = url\.searchParams\.get\('registrationId'\)/);
  assert.match(apiSource, /registrationId && !UUID_PATTERN\.test\(registrationId\)/);
  assert.match(apiSource, /\.eq\('id', registrationId\)[\s\S]+\.maybeSingle\(\)/);
  assert.match(apiSource, /\.eq\('resident_id', selectedRow\.resident_id\)/);
  assert.match(apiSource, /allBase\.filter\(\(row\) => row\.id === registrationId\)/);
});

test('exam reception notification confirms persistence and a mobile target after the status commit', () => {
  assert.match(notificationClientSource, /keepalive: true/);
  assert.match(
    notificationClientSource,
    /classifyFcNotificationResult\(response\.status, responseBody\)/,
  );
  assert.match(notificationClientSource, /reason: result\.reason/);
  assert.match(notificationClientSource, /sent: result\.sent/);
  assert.doesNotMatch(notificationClientSource, /data\.error/);
  assert.doesNotMatch(notificationClientSource, /responseBody,/);
  assert.doesNotMatch(notificationClientSource, /catch \(error/);
});

test('every web reception toggle notifies FCs for both approval and approval release', () => {
  assert.match(listSource, /notifyFcExamApprovalStatus\(item, isConfirmed\)/);
  assert.doesNotMatch(listSource, /if \(!isConfirmed\) return/);
  assert.doesNotMatch(listSource, /title: '알림 확인 필요'/);

  assert.match(roundApplicantSource, /notifyFcExamApprovalStatus\(row, nextConfirmed\)/);
  assert.doesNotMatch(roundApplicantSource, /title: '알림 확인 필요'/);
});
