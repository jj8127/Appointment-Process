import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(
  path.join(__dirname, '../../app/request-board-review.tsx'),
  'utf8',
);

describe('request-board review role contract', () => {
  it('renders completed-design approval controls only for FC reviewers', () => {
    expect(source).toContain('const canReviewAsFc = !isRequestBoardDesigner && needsReview;');
    expect(source).toContain('style={[styles.assignmentCard, canReviewAsFc && styles.assignmentCardHighlight]}');
    expect(source).toContain('{canReviewAsFc && (');
    expect(source).toContain('{isRequestBoardDesigner && needsReview && (');
    expect(source).toContain('FC 검토 대기');
    expect(source).toContain('완료된 설계는 FC 검토 화면에서 처리됩니다.');
    expect(source).not.toContain('{needsReview && (\n          <View style={styles.decisionBtns}>');
  });
});
