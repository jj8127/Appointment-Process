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
      '같은 달에는 생명·손해·제3 시험을 합쳐 한 번만 신청할 수 있습니다.',
    );
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
        'activeApplicationsForMonth.some(',
      );
      expect(source).toContain(
        'activeApplicationsForMonth.length > 0 && !isAppliedRound',
      );
      expect(source).toContain('disabled={unavailable}');
      expect(source).toContain(
        'blockedByMonth || (closed && !isAppliedRound)',
      );
      expect(source).toContain('{isAppliedRound && (');
      expect(source).not.toContain('{alreadyApplied && (');
      expect(source).not.toContain(
        "Alert.alert('신청 불가', '같은 달에는 생명·손해·제3",
      );
    },
  );
});
