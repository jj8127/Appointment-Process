import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), 'utf8');

describe('exam month conflict feedback source contract', () => {
  const feedback = read('lib/exam-month-conflict-feedback.ts');

  it('uses a non-modal Android toast so duplicate selection cannot strand an alert overlay', () => {
    expect(feedback).toContain("Platform.OS === 'android'");
    expect(feedback).toContain('ToastAndroid.show(');
    expect(feedback).toContain('ToastAndroid.LONG');
    expect(feedback).toContain(
      '같은 달에는 같은 보험 유형 시험을 한 번만 신청할 수 있습니다.',
    );
    expect(feedback).not.toContain('같은 달 제3보험 시험은 한 번만 신청할 수 있습니다.');
  });

  it.each(['app/exam-apply.tsx', 'app/exam-apply2.tsx'])(
    'keeps only the applied round checked and disables sibling rounds in %s',
    (relativePath) => {
      const source = read(relativePath);
      expect(source).toContain('showExamMonthConflictFeedback()');
      expect(source).toContain(
        'const activeApplicationsForMonth = myApplies.filter(',
      );
      expect(source).toContain(
        'const isAppliedRound = activeApplicationsForMonth.some(',
      );
      expect(source).toMatch(
        /isExamRegistrationInRoundMonth\(\s*application,\s*roundForMonthComparison,\s*examFlowType,?\s*\)/,
      );
      expect(source).toMatch(
        /isExamRegistrationInRoundMonth\(\s*application,\s*roundMonth,\s*examFlowType,?\s*\)/,
      );
      expect(source).toContain('const activeForSelectedMonth = selectedRound');
      expect(source).toMatch(
        /isExamRegistrationInRoundMonth\(\s*application,\s*getRoundForMonthComparison\(selectedRound\),\s*examFlowType,?\s*\)/,
      );
      const canonicalHistoryAttempt = source.indexOf(
        '{ includeExamMonth: true, includeNestedExamType: true, includeFlowFilter: true }',
      );
      const legacyHistoryAttempt = source.indexOf(
        '{ includeExamMonth: false, includeNestedExamType: true, includeFlowFilter: true }',
      );
      expect(canonicalHistoryAttempt).toBeGreaterThanOrEqual(0);
      expect(canonicalHistoryAttempt).toBeLessThan(legacyHistoryAttempt);
      expect(source).toContain(
        'const unresolvedMonth = getExamRoundMonthKey(roundMonth) === null;',
      );
      expect(source).toMatch(
        /!unresolvedMonth\s+&& activeApplicationsForMonth\.length > 0\s+&& !isAppliedRound/,
      );
      expect(source).toContain('disabled={unavailable}');
      expect(source).toMatch(
        /unresolvedMonth\s+\|\| blockedByMonth\s+\|\| \(closed && !isAppliedRound\)/,
      );
      expect(source).toContain('{isAppliedRound && (');
      expect(source).toContain('return flowType === null || flowType === examFlowType;');
      expect(source).not.toContain('showExamThirdMonthConflictFeedback');
      expect(source).not.toContain('hasConflictingThirdExamRegistrationInRoundMonth');
      expect(source).not.toContain('{alreadyApplied && (');
      expect(source).not.toMatch(/Alert\.alert\(\s*'신청 불가',\s*'같은 달/);
    },
  );

  it.each(['app/exam-apply.tsx', 'app/exam-apply2.tsx'])(
    'fails closed on stale or unavailable application history in %s',
    (relativePath) => {
      const source = read(relativePath);
      const submitHandler = source.slice(
        source.indexOf('const handleApplyPress = async () => {'),
        source.indexOf("if (!hydrated) {"),
      );

      expect(source).toContain('staleTime: 0');
      expect(source).toContain("refetchOnMount: 'always'");
      expect(source).toContain(
        "myApplyHistoryGuardState === 'loading' || myApplyHistoryGuardState === 'error'",
      );
      expect(source).toContain(
        'disabled={applyMutation.isPending || isMyApplyHistoryBlocked}',
      );
      expect(source).toContain('{isMyApplyHistoryLoading ? (');
      expect(source).toContain(') : hasMyApplyHistoryError ? (');

      expect(submitHandler).toContain('const freshHistoryResult = await refetchMyApply();');
      expect(submitHandler).toContain('freshMyApplies = freshHistoryResult.data;');
      expect(submitHandler).toContain('const freshExistingForRound = freshMyApplies.find(');
      expect(submitHandler).toMatch(
        /const activeForSelectedMonth = selectedRound\s+\? freshMyApplies\.find/,
      );
      expect(submitHandler).toContain('isExamMonthSlotConsumed(application.status)');
      expect(submitHandler).toContain('applyMutation.mutate({');
      expect(submitHandler).toContain(
        'existingProofAttachedForSubmit: !!freshExistingForRound?.payment_proof_attached',
      );
      expect(submitHandler.indexOf('await refetchMyApply()')).toBeLessThan(
        submitHandler.indexOf('applyMutation.mutate({'),
      );

      expect(source).toContain('useRef(new Set<string>())');
      expect(source).toContain(
        'consumedRouteHydrationKeysRef.current.has(routeHydrationKey)',
      );
      expect(source).toContain(
        'consumedRouteHydrationKeysRef.current.add(routeHydrationKey)',
      );
    },
  );
});
