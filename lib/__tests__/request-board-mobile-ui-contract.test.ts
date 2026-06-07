import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('request-board mobile UI contracts', () => {
  const homeSource = readFileSync(join(process.cwd(), 'app/request-board.tsx'), 'utf8');
  const requestsSource = readFileSync(join(process.cwd(), 'app/request-board-requests.tsx'), 'utf8');
  const fcCodesSource = readFileSync(join(process.cwd(), 'app/request-board-fc-codes.tsx'), 'utf8');
  const createSource = readFileSync(join(process.cwd(), 'app/request-board-create.tsx'), 'utf8');

  it('keeps the 설계코드 회사명 suggestions scrollable instead of limiting them to six rows', () => {
    const filteredCompanyNamesBlock = fcCodesSource.slice(
      fcCodesSource.indexOf('const filteredCompanyNames = useMemo'),
      fcCodesSource.indexOf('const existingForInsurer = useMemo'),
    );

    expect(filteredCompanyNamesBlock).not.toContain('slice(0, 6)');
    expect(fcCodesSource).toContain('nestedScrollEnabled');
    expect(fcCodesSource).toContain('maxHeight: 300');
  });

  it('does not dismiss the 신규 고객 등록 keyboard when the user drags the form to scroll', () => {
    const mainScrollBlock = createSource.slice(
      createSource.indexOf('<KeyboardAvoidingView'),
      createSource.indexOf('<DesignerBottomSheet'),
    );

    expect(mainScrollBlock).toContain('keyboardShouldPersistTaps="always"');
    expect(mainScrollBlock).toContain('keyboardDismissMode="none"');
    expect(mainScrollBlock).not.toContain('keyboardDismissMode="on-drag"');
  });

  it('requires a typed designer rejection reason from the home quick request card', () => {
    expect(homeSource).toContain('normalizeDesignerRejectReason(designerRejectReason)');
    expect(homeSource).toContain('handleDesignerRejectConfirm');
    expect(homeSource).toContain('의뢰 거절 사유');
    expect(homeSource).toContain('designerRejectTarget');
    expect(homeSource).not.toContain('모바일에서 거절 처리');
  });

  it('keeps the home quick-card rejection reason modal above the soft keyboard', () => {
    expect(homeSource).toContain('KeyboardAvoidingView');
    expect(homeSource).toContain('styles.modalKeyboardAvoidingView');
    expect(homeSource).toContain("behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}");
  });

  it('shows designer rejection reason summaries in request list cards without letting long text expand indefinitely', () => {
    expect(requestsSource).toContain('rbGetRequestDetail');
    expect(requestsSource).toContain('requestNeedsDesignerRejectionReasonHydration');
    expect(requestsSource).toContain('mergeDesignerRejectionReasonFromDetail');
    expect(requestsSource).toContain('getDesignerRejectionSummary');
    expect(requestsSource).toContain('const designerRejectionSummary = getDesignerRejectionSummary(item);');
    expect(requestsSource).toContain('styles.rejectionReasonBox');
    expect(requestsSource).toContain('numberOfLines={2}');
    expect(requestsSource).toContain('{designerRejectionSummary.reason}');
  });
});
