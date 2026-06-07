import { readFileSync } from 'fs';
import path from 'path';

const source = readFileSync(
  path.join(__dirname, '../../app/request-board-review.tsx'),
  'utf8',
);

describe('request-board review role contract', () => {
  it('renders pending-request response controls only for designer reviewers', () => {
    expect(source).toContain('rbAcceptRequest');
    expect(source).toContain('rbRejectRequest');
    expect(source).toContain('getDesignerRequestDetailActions');
    expect(source).toContain('const designerActions = getDesignerRequestDetailActions({');
    expect(source).toContain('isRequestBoardDesigner,');
    expect(source).toContain('assignmentStatus: assignment.status,');
    expect(source).toContain('{designerActions.canRespond && (');
    expect(source).toContain('handleDesignerRejectOpen(assignment)');
    expect(source).toContain('handleDesignerRejectConfirm');
    expect(source).toContain('normalizeDesignerRejectReason(designerRejectReason)');
    expect(source).toContain('designerRejectTarget.designerId');
    expect(source).toContain('designerRejectTarget.assignmentId');
    expect(source).toContain('handleDesignerAcceptRequest(assignment)');
    expect(source).toContain('의뢰 거절 사유');
    expect(source).toContain('설계 요청을 거절하는 이유를 입력해주세요.');
    expect(source).not.toContain('모바일 상세에서 거절 처리');
    expect(source).toContain('의뢰 거절');
    expect(source).toContain('의뢰 수락');
  });

  it('keeps rejection reason modals above the soft keyboard', () => {
    const keyboardAvoidingViewCount = source.match(/<KeyboardAvoidingView/g)?.length ?? 0;

    expect(source).toContain('KeyboardAvoidingView');
    expect(source).toContain('styles.modalKeyboardAvoidingView');
    expect(source).toContain("behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}");
    expect(keyboardAvoidingViewCount).toBeGreaterThanOrEqual(2);
  });

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
