import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('exam application fee paid date source contract', () => {
  it.each([
    ['life', 'app/exam-apply.tsx'],
    ['nonlife', 'app/exam-apply2.tsx'],
  ])('%s application restores and displays fee_paid_date from the FC query', (_examType, path) => {
    const source = readSource(path);
    const applyType = sliceBetween(source, 'type MyExamApply = {', '};');
    const myApplyQuery = sliceBetween(source, "queryKey: ['my-exam-apply", 'const currentApply');
    const restoreEffect = sliceBetween(
      source,
      'if (existingForRound) {',
      '}, [existingForRound',
    );

    expect(applyType).toContain('fee_paid_date?: string | null;');
    expect(myApplyQuery).toContain('fee_paid_date');
    expect(restoreEffect).toContain('existingForRound.fee_paid_date');
    expect(restoreEffect).toContain('setFeePaidDate(restoredFeePaidDate)');
    expect(source).toContain('formatFeePaidDate(currentApply.fee_paid_date)');
  });
});

describe('license status follow-up display source contract', () => {
  it('exposes a display formatter that reuses normalized license labels', () => {
    const source = readSource('lib/license-statuses.ts');

    expect(source).toContain('export function formatLicenseStatuses');
    expect(source).toContain('normalizeLicenseStatuses(input)');
    expect(source).toContain('LICENSE_STATUS_LABELS[status]');
  });

  it('loads and displays license_statuses in the admin dashboard profile detail', () => {
    const source = readSource('app/dashboard.tsx');
    const fetchFcs = sliceBetween(source, 'const fetchFcs = async', 'export default function DashboardScreen');
    const rowType = sliceBetween(source, 'type FcRow = {', '};');

    expect(source).toContain("import { formatLicenseStatuses } from '@/lib/license-statuses';");
    expect(fetchFcs).toContain('license_statuses');
    expect(rowType).toContain("license_statuses?: FcProfile['license_statuses'];");
    expect(source).toContain('formatLicenseStatuses(fc.license_statuses)');
  });

  it('loads and displays license_statuses on the FC home status card', () => {
    const source = readSource('app/index.tsx');
    const fetchFcStatus = sliceBetween(source, 'const fetchFcStatus = async', 'type ExamStats');

    expect(source).toContain("import { formatLicenseStatuses } from '@/lib/license-statuses';");
    expect(fetchFcStatus).toContain('license_statuses');
    expect(source).toContain(
      'const licenseStatusDisplay = myFc ? formatLicenseStatuses(myFc.license_statuses) : formatLicenseStatuses(null);',
    );
    expect(source).toContain('styles.licenseSummaryText');
  });
});
