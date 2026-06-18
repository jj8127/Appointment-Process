import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('request-board mobile UI contracts', () => {
  const homeSource = readFileSync(join(process.cwd(), 'app/request-board.tsx'), 'utf8');
  const requestsSource = readFileSync(join(process.cwd(), 'app/request-board-requests.tsx'), 'utf8');
  const fcCodesSource = readFileSync(join(process.cwd(), 'app/request-board-fc-codes.tsx'), 'utf8');
  const createSource = readFileSync(join(process.cwd(), 'app/request-board-create.tsx'), 'utf8');
  const reviewSource = readFileSync(join(process.cwd(), 'app/request-board-review.tsx'), 'utf8');

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

  it('keeps separate contractor fields visible and validated in the GaramIn new-customer form', () => {
    const emptyCustomerBlock = createSource.slice(
      createSource.indexOf('const EMPTY_CUSTOMER'),
      createSource.indexOf('const REQUEST_TEMPLATES'),
    );
    const saveNewCustomerBlock = createSource.slice(
      createSource.indexOf('const saveNewCustomer = async () => {'),
      createSource.indexOf('const toggleProduct = (product: MobileRequestProduct) => {'),
    );
    const newCustomerBlock = createSource.slice(
      createSource.indexOf('const renderNewCustomerStep = () => ('),
      createSource.indexOf('const renderComposeStep = () => {'),
    );

    expect(emptyCustomerBlock).toContain('hasSeparatePolicyholder: false');
    expect(emptyCustomerBlock).toContain("policyholderName: ''");
    expect(emptyCustomerBlock).toContain("policyholderSsn: ''");
    expect(emptyCustomerBlock).toContain("policyholderPhone: ''");
    expect(emptyCustomerBlock).toContain("policyholderCarrier: ''");
    expect(emptyCustomerBlock).toContain("policyholderAddress: ''");

    expect(newCustomerBlock).toContain('피보험자 이름');
    expect(newCustomerBlock).toContain('계약자 피보험자 다름');
    expect(newCustomerBlock).toContain('newCustomer.hasSeparatePolicyholder');
    expect(newCustomerBlock).toContain('setHasSeparatePolicyholder(!newCustomer.hasSeparatePolicyholder)');
    expect(newCustomerBlock).toContain('계약자 이름');
    expect(newCustomerBlock).toContain("updateCustomerField('policyholderName', value)");
    expect(newCustomerBlock).toContain('계약자 주민번호');
    expect(newCustomerBlock).toContain('updatePolicyholderSsnField');
    expect(newCustomerBlock).toContain('계약자 휴대폰번호');
    expect(newCustomerBlock).toContain('updatePolicyholderPhoneField');
    expect(newCustomerBlock).toContain('계약자 통신사');
    expect(newCustomerBlock).toContain("updateCustomerField('policyholderCarrier', carrier)");
    expect(newCustomerBlock).toContain('계약자 주소');
    expect(newCustomerBlock).toContain("updateCustomerField('policyholderAddress', value)");

    expect(saveNewCustomerBlock).toContain('newCustomer.hasSeparatePolicyholder');
    expect(saveNewCustomerBlock).toContain('계약자와 피보험자가 다를 경우');
    expect(saveNewCustomerBlock).toContain('newCustomer.policyholderName');
    expect(saveNewCustomerBlock).toContain('newCustomer.policyholderSsn');
    expect(saveNewCustomerBlock).toContain('newCustomer.policyholderPhone');
    expect(saveNewCustomerBlock).toContain('newCustomer.policyholderCarrier');
    expect(saveNewCustomerBlock).toContain('newCustomer.policyholderAddress');
  });

  it('keeps GaramIn customer-profile payload fields enterable and validated in the new-customer form', () => {
    const saveNewCustomerBlock = createSource.slice(
      createSource.indexOf('const saveNewCustomer = async () => {'),
      createSource.indexOf('const toggleProduct = (product: MobileRequestProduct) => {'),
    );
    const newCustomerBlock = createSource.slice(
      createSource.indexOf('const renderNewCustomerStep = () => ('),
      createSource.indexOf('const renderComposeStep = () => {'),
    );

    expect(saveNewCustomerBlock).toContain('isValidRequestBoardCustomerBirthDate');
    expect(saveNewCustomerBlock).toContain('운전구분을 선택해주세요');

    expect(newCustomerBlock).toContain('피보험자 통신사');
    expect(newCustomerBlock).toContain("updateCustomerField('carrier', carrier)");
    expect(newCustomerBlock).toContain('소개자');
    expect(newCustomerBlock).toContain("updateCustomerField('referrer', value)");
    expect(newCustomerBlock).toContain('보험 자격');
    expect(newCustomerBlock).toContain('toggleInsuranceQualification');
    expect(createSource).toContain("label: '손해보험'");
    expect(createSource).toContain("label: '생명보험'");
    expect(createSource).toContain("label: '제3보험'");
    expect(newCustomerBlock).toContain('고혈압 당뇨 고지혈 약 드시나요?');
    expect(newCustomerBlock).toContain("updateCustomerField('currentMedication', value)");
    expect(newCustomerBlock).toContain('updateHeightField');
    expect(newCustomerBlock).toContain('updateWeightField');
  });

  it('keeps wrapped new-customer option groups out of the two-column flex field layout', () => {
    const newCustomerBlock = createSource.slice(
      createSource.indexOf('const renderNewCustomerStep = () => ('),
      createSource.indexOf('const renderComposeStep = () => {'),
    );

    expect(createSource).toContain('stackedField:');
    expect((newCustomerBlock.match(/style=\{styles\.stackedField\}/g) ?? []).length).toBeGreaterThanOrEqual(4);

    const stackedFieldBlock = createSource.slice(
      createSource.indexOf('stackedField:'),
      createSource.indexOf('fieldLabel:'),
    );
    expect(stackedFieldBlock).toContain('gap: 6');
    expect(stackedFieldBlock).not.toContain('flex: 1');
  });

  it('shows separate contractor details on the GaramIn request review screen', () => {
    expect(reviewSource).toContain('has_separate_policyholder');
    expect(reviewSource).toContain('policyholder_name');
    expect(reviewSource).toContain('policyholder_ssn');
    expect(reviewSource).toContain('policyholder_phone');
    expect(reviewSource).toContain('policyholder_carrier');
    expect(reviewSource).toContain('policyholder_address');
    expect(reviewSource).toContain('계약자 정보');
    expect(reviewSource).toContain('피보험자와 동일');
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

  it('creates one GaramIn request per selected product-designer cell', () => {
    const submitRequestBlock = createSource.slice(
      createSource.indexOf('const submitRequest = async () => {'),
      createSource.indexOf('const renderCustomerStep = () => ('),
    );

    expect(submitRequestBlock).toContain('const requestJobs = selectedProductIds.flatMap');
    expect(submitRequestBlock).toContain('productIds: [productId]');
    expect(submitRequestBlock).toContain('designerIds: [designer.id]');
    expect(submitRequestBlock).toContain('designerCodeSelections: [designerCodeSelection]');
    expect(submitRequestBlock).not.toContain('productIds: selectedProductIds');
    expect(submitRequestBlock).not.toContain('designerIds: selectedDesignerIds');
  });

  it('blocks existing customers without driving status before creating a GaramIn request', () => {
    const submitRequestBlock = createSource.slice(
      createSource.indexOf('const submitRequest = async () => {'),
      createSource.indexOf('const renderCustomerStep = () => ('),
    );

    expect(submitRequestBlock).toContain("String(selectedCustomer.drivingStatus ?? '').trim()");
    expect(submitRequestBlock).toContain('운전구분을 먼저 입력해주세요');
  });

  it('uses policyholder-aware customer labels in list and home quick request cards', () => {
    expect(requestsSource).toContain('formatRequestBoardCustomerDisplayName');
    expect(requestsSource).toContain('customerDisplayName');
    expect(homeSource).toContain('formatRequestBoardCustomerDisplayName');
    expect(homeSource).toContain('customerDisplayName');
  });

  it('shows attachment description and expiry date on the GaramIn review screen', () => {
    expect(reviewSource).toContain('file.description');
    expect(reviewSource).toContain('file.expiry_date');
    expect(reviewSource).toContain('formatDate(file.expiry_date)');
  });

  it('collects designer attachment description and expiry metadata before upload', () => {
    expect(reviewSource).toContain('attachmentUploadDraft');
    expect(reviewSource).toContain('expiryDate: expiryDate || null');
    expect(reviewSource).not.toContain("description: '설계 완료 첨부'");
  });

  it('keeps hospitalization disclosure wording aligned between create and review screens', () => {
    expect(createSource).toContain('7일 이상 치료');
    expect(reviewSource).toContain('7일 이상 치료');
  });
});
