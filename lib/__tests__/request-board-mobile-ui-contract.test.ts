import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('request-board mobile UI contracts', () => {
  const homeSource = readFileSync(join(process.cwd(), 'app/request-board.tsx'), 'utf8');
  const requestsSource = readFileSync(join(process.cwd(), 'app/request-board-requests.tsx'), 'utf8');
  const fcCodesSource = readFileSync(join(process.cwd(), 'app/request-board-fc-codes.tsx'), 'utf8');
  const createSource = readFileSync(join(process.cwd(), 'app/request-board-create.tsx'), 'utf8');
  const reviewSource = readFileSync(join(process.cwd(), 'app/request-board-review.tsx'), 'utf8');
  const messengerSource = readFileSync(join(process.cwd(), 'app/request-board-messenger.tsx'), 'utf8');
  const sessionSource = readFileSync(join(process.cwd(), 'hooks/use-session.tsx'), 'utf8');

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

  it('keeps the create wizard free of the global bottom navigation that can cover form fields', () => {
    expect(createSource).not.toContain("import { BottomNavigation }");
    expect(createSource).not.toContain('<BottomNavigation');
    expect(createSource).not.toContain('resolveBottomNavActiveKey');
    expect(createSource).not.toContain('resolveBottomNavPreset');
    expect(createSource).toContain('screenKeyboardHeight + 96 + insets.bottom');
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
    expect(newCustomerBlock).toContain('toggleSeparatePolicyholder');
    expect(newCustomerBlock).toContain('onPressIn={toggleSeparatePolicyholder}');
    expect(newCustomerBlock).toContain('onPress={toggleSeparatePolicyholder}');
    expect(newCustomerBlock).toContain('onClick: toggleSeparatePolicyholder');
    expect(newCustomerBlock).toContain('accessibilityLabel="계약자 피보험자 다름"');
    expect(newCustomerBlock).toContain('accessibilityState={{ selected: newCustomer.hasSeparatePolicyholder }}');
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

  it('keeps the separate contractor toggle from double-toggling on press-in plus press', () => {
    const toggleBlock = createSource.slice(
      createSource.indexOf('const toggleSeparatePolicyholder = useCallback'),
      createSource.indexOf('const updatePolicyholderSsnField'),
    );

    expect(toggleBlock).toContain('policyholderToggleReleaseTimerRef');
    expect(toggleBlock).toContain('setTimeout');
    expect(toggleBlock).toContain('}, 1000);');
    expect(toggleBlock).not.toContain('requestAnimationFrame');
  });

  it('requires complete phone and resident-number inputs before saving new customers', () => {
    const saveNewCustomerBlock = createSource.slice(
      createSource.indexOf('const saveNewCustomer = async () => {'),
      createSource.indexOf('const toggleProduct = (product: MobileRequestProduct) => {'),
    );

    expect(saveNewCustomerBlock).toContain('isCompleteRequestBoardCustomerPhone(newCustomer.phone)');
    expect(saveNewCustomerBlock).toContain('isCompleteRequestBoardCustomerSsn(newCustomer.ssn)');
    expect(saveNewCustomerBlock).toContain("isCompleteRequestBoardCustomerPhone(newCustomer.policyholderPhone ?? '')");
    expect(saveNewCustomerBlock).toContain("isCompleteRequestBoardCustomerSsn(newCustomer.policyholderSsn ?? '')");
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

  it('does not log out the whole GaramIn session when only request-board reauthentication is needed', () => {
    const autoSyncStart = sessionSource.indexOf('void ensureRequestBoardSession().then');
    const autoSyncEnd = sessionSource.indexOf('return () => {', autoSyncStart);
    const autoSyncBlock = sessionSource.slice(autoSyncStart, autoSyncEnd);

    expect(autoSyncBlock).toContain('clearRequestBoardState({ clearAppSession: false })');
    expect(autoSyncBlock).not.toContain('clearSessionState({ clearAppSession: true })');
  });

  it('uses 설계매니저 wording consistently in the request-board messenger list', () => {
    expect(messengerSource).toContain("rbUser?.role === 'designer' ? 'FC 목록' : '설계매니저 목록'");
    expect(messengerSource).not.toContain('설계사 목록');
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

  it('handles partial multi-request creation without inviting duplicate retry submissions', () => {
    const submitRequestBlock = createSource.slice(
      createSource.indexOf('const submitRequest = async () => {'),
      createSource.indexOf('const renderCustomerStep = () => ('),
    );

    expect(submitRequestBlock).toContain('Promise.allSettled');
    expect(submitRequestBlock).toContain('fulfilledRequests');
    expect(submitRequestBlock).toContain('failedRequests');
    expect(submitRequestBlock).toContain('일부 설계요청만 전송되었습니다');
    expect(submitRequestBlock).not.toContain('const createdResults = await Promise.all(');
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

  it('keeps request list filters horizontally scrollable on narrow phones', () => {
    const filterTabsBlock = requestsSource.slice(
      requestsSource.indexOf('<ScrollView'),
      requestsSource.indexOf('{/* Error */}'),
    );

    expect(filterTabsBlock).toContain('<ScrollView');
    expect(filterTabsBlock).toContain('horizontal');
    expect(filterTabsBlock).toContain('showsHorizontalScrollIndicator={false}');
    expect(requestsSource).toContain('filterTabsContent');
  });

  it('renders FC code rows as mobile cards instead of a clipped multi-column table', () => {
    expect(fcCodesSource).not.toContain('styles.tableHeader');
    expect(fcCodesSource).not.toContain('tableHeaderCell');
    expect(fcCodesSource).toContain('styles.codeCard');
    expect(fcCodesSource).toContain('styles.codeCardHeader');
    expect(fcCodesSource).toContain('styles.codeValuePill');
    expect(fcCodesSource).toContain('numberOfLines={2}>{item.insurer_name}');
  });

  it('keeps long designer picker names and sent summaries constrained', () => {
    expect(createSource).toContain('styles.managerPickerCopy');
    expect(createSource).toContain('numberOfLines={1}');
    expect(createSource).toContain('numberOfLines={2}>{selectedDesigners.map(getDesignerName).join');
  });

  it('lets long review metadata wrap inside full-width fields', () => {
    expect(reviewSource).not.toContain("width: '48%'");
    expect(reviewSource).toContain("width: '100%'");
    expect(reviewSource).toContain('const valueLineLimit = fullWidth ? undefined : 3;');
    expect(reviewSource).toContain('numberOfLines={valueLineLimit}');
    expect(reviewSource).toContain('요청 FC');
    expect(reviewSource).toContain('FC 코드');
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
