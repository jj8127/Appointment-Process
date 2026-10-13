import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseReferralAllowanceAdminMutationReceipt,
  parseReferralAllowanceStatement,
  parseReferralAllowanceSummary,
} from '../../../lib/referral-allowance-response.ts';

const source = readFileSync(
  new URL('../app/dashboard/referrals/allowances/page.tsx', import.meta.url),
  'utf8',
);
const adminServiceSource = readFileSync(
  new URL('./referral-allowance-admin.ts', import.meta.url),
  'utf8',
);
const routeSource = readFileSync(
  new URL('../app/api/admin/referral-allowance/route.ts', import.meta.url),
  'utf8',
);

test('allowance reads reject malformed rows and mutation acknowledgements', () => {
  assert.match(source, /value\.recipients\.every\(isPilot\)/);
  assert.match(source, /value\.imports\.every\(isImportRow\)/);
  assert.match(source, /value\.candidates\.every\(isCandidate\)/);
  assert.match(source, /requireMutationSuccess\(data\)/);
  assert.match(source, /parseReferralAllowanceAdminMutationReceipt\(data, expected\)/);
  assert.match(source, /value\.summary === null \|\| isAllowanceSummary\(value\.summary\)/);
  assert.match(source, /!isImportBase\(detailImport\)/);
  assert.doesNotMatch(source, /!isImportRow\(detailImport\)/);
  assert.match(source, /parseReferralAllowanceStatement\(snapshot\)/);
});

test('allowance server reads reject malformed collections and paginate every recipient', () => {
  assert.match(adminServiceSource, /collectSupabaseRows<AllowanceRecipientQueryRow>/);
  assert.match(adminServiceSource, /queryName: 'referral_allowance_recipients'/);
  assert.match(adminServiceSource, /\.range\(from, to\)/);
  assert.doesNotMatch(adminServiceSource, /\.limit\(5000\)/);
  assert.match(adminServiceSource, /requireSupabaseRowsMatching\(\s*profiles,/);
  assert.match(adminServiceSource, /requireSupabaseRowsMatching\(\s*managers,/);
  assert.match(adminServiceSource, /requireSupabaseRowsMatching\(\s*admins,/);
  assert.match(routeSource, /summary:snapshot->summary/);
  assert.match(routeSource, /collectSupabaseRows<AllowanceImportListQueryRow>/);
  assert.match(routeSource, /queryName: 'referral_allowance_imports'/);
  assert.match(routeSource, /\.order\('created_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)\s*\.range\(from, to\)/);
  assert.match(routeSource, /isRow: isAllowanceImportListQueryRow/);
  assert.match(routeSource, /rowKey: \(row\) => row\.id/);
  assert.match(routeSource, /requireSupabaseRowMatching\(data, 'referral_allowance_import', isAllowanceImportDetailQueryRow\)/);
  assert.match(routeSource, /parseReferralAllowanceSummary\(summary\)/);
  assert.doesNotMatch(routeSource, /\.limit\(36\)/);
  assert.doesNotMatch(routeSource, /snapshot\?\.summary \?\? null/);
});

test('shared allowance mutation receipts reject partial or mismatched success', () => {
  const expected = {
    action: 'publish' as const,
    importId: 'import-1',
    sourceSha256: 'a'.repeat(64),
    expectedRevision: 2,
    expectedPilotRevision: 4,
  };
  const receipt = {
    ok: true,
    import: {
      id: 'import-1',
      status: 'published',
      revision: 2,
      sourceSha256: 'a'.repeat(64),
      policyVersion: 'recruitment-2026-09-07-snapshot-pilot-v1',
      performanceMonth: '2026-09',
      pilotRevision: 4,
    },
  };
  assert.equal(parseReferralAllowanceAdminMutationReceipt(receipt, expected), receipt);
  assert.doesNotThrow(() => parseReferralAllowanceAdminMutationReceipt({
    ...receipt,
    import: { ...receipt.import, status: 'superseded' },
  }, { action: 'upload', beneficiaryFcId: 'fc-1', performanceMonth: '2026-09', expectedPilotRevision: 4 }));
  assert.throws(() => parseReferralAllowanceAdminMutationReceipt({ ok: true, import: { id: 'import-1' } }, expected));
  assert.throws(() => parseReferralAllowanceAdminMutationReceipt({
    ...receipt,
    import: { ...receipt.import, id: 'import-2' },
  }, expected));
});

test('shared allowance response validation rejects partial summaries and snapshots', () => {
  const summary = {
    currentMonthNetKrw: 0,
    newPaymentKrw: 0,
    carryForwardKrw: 0,
    extinguishedKrw: 0,
    excludedByEligibilityKrw: 0,
  };
  assert.equal(parseReferralAllowanceSummary(summary), summary);
  assert.throws(() => parseReferralAllowanceSummary({}), /수당 조회 응답/);
  assert.throws(() => parseReferralAllowanceSummary({ ...summary, newPaymentKrw: Number.NaN }), /수당 조회 응답/);

  const statement = {
    schemaVersion: 1,
    policyVersion: 'recruitment-2026-09-07-snapshot-pilot-v1',
    performanceMonth: '2026-09',
    paymentDate: '2026-11-15',
    genealogyAsOf: '2026-09-30',
    sourceSnapshotDates: ['2026-09-30'],
    usesLaterSnapshot: false,
    eligibilityBasis: 'uploaded_snapshot',
    status: 'current_month_estimate',
    previousCarryIncluded: false,
    beneficiary: { nodeId: 'root', name: '테스트', eligibleAtBasisDate: true },
    nodes: [{
      id: 'root', parentId: null, depth: 0, name: '테스트', affiliation: '',
      isBeneficiary: true, activeAtPerformance: true, eligibleAtBasisDate: true,
      finalTargetPerformanceKrw: 0, fpRoundedAmountKrw: 0, contributionKrw: 0,
    }],
    summary,
    validation: { visiblePeopleCount: 1, contributorCount: 0, maximumDepth: 10, conservationDifferenceKrw: 0 },
  };
  assert.equal(parseReferralAllowanceStatement(statement), statement);
  assert.throws(() => parseReferralAllowanceStatement({ ...statement, summary: {} }), /수당 조회 응답/);
  assert.throws(() => parseReferralAllowanceStatement({ ...statement, nodes: [{}] }), /수당 조회 응답/);
});

test('allowance detail keeps stale data visible and uses the shared safe retry UI', () => {
  assert.match(source, /const statement = detail\.data\?\.import\.snapshot/);
  assert.doesNotMatch(source, /detail\.isError \|\| detail\.isFetching \? null/);
  assert.match(source, /<QueryErrorAlert[^>]*error=\{detail\.error\}/);
  assert.match(source, /hasData=\{Boolean\(detail\.data\)\}/);
  assert.match(source, /hasData=\{Boolean\(query\.data\)\}/);
  assert.match(source, /!query\.data \? <Text c="dimmed">검토 자료를 확인하지 못했습니다/);
  assert.doesNotMatch(source, /query\.isError \? <Text c="dimmed">검토 자료를 확인하지 못했습니다/);
});
