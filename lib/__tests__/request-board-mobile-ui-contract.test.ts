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
    expect(newCustomerBlock).toContain('onPress={toggleSeparatePolicyholder}');
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

  it('keeps customer management as an explicit edit/delete surface without hijacking request selection', () => {
    const customerStepBlock = createSource.slice(
      createSource.indexOf('const renderCustomerStep = () => ('),
      createSource.indexOf('const renderNewCustomerStep = () => ('),
    );
    const newCustomerBlock = createSource.slice(
      createSource.indexOf('const renderNewCustomerStep = () => ('),
      createSource.indexOf('const renderComposeStep = () => {'),
    );

    expect(createSource).toContain("const sourceValue = Array.isArray(source) ? source[0] : source;");
    expect(createSource).toContain("const isCustomerManagement = sourceValue === 'customer-management';");
    expect(createSource).toContain("step === 'customer' && isCustomerManagement");
    expect(createSource).toContain("? '고객관리'");
    expect(customerStepBlock).toContain('isCustomerManagement ? undefined : selectCustomer(customer)');
    expect(customerStepBlock).toContain('openEditCustomer(customer)');
    const deleteActionStart = customerStepBlock.indexOf('accessibilityLabel={`${customer.name} 고객 삭제`}');
    const deleteActionBlock = customerStepBlock.slice(
      deleteActionStart,
      customerStepBlock.indexOf('</Pressable>', deleteActionStart),
    );

    expect(customerStepBlock).toContain('confirmDeleteCustomer(customer)');
    expect(deleteActionStart).toBeGreaterThan(-1);
    expect(deleteActionBlock).not.toContain('isCustomerManagement');
    expect(customerStepBlock).toContain('요청 작성');
    expect(customerStepBlock).toContain('수정');
    expect(customerStepBlock).toContain('삭제');
    expect(newCustomerBlock).toContain("editingCustomerId ? '고객 정보 수정' : '기본 정보'");
    expect(newCustomerBlock).toContain("editingCustomerId ? '고객 정보 저장' : isCustomerManagement ? '고객 등록' : '고객 등록 후 선택'");
  });


  it('uses a compact horizontal customer-management action bar', () => {
    const customerStepBlock = createSource.slice(
      createSource.indexOf('const renderCustomerStep = () => ('),
      createSource.indexOf('const renderNewCustomerStep = () => ('),
    );
    const customerActionStyles = createSource.slice(
      createSource.indexOf('customerActionRow:'),
      createSource.indexOf('formCard:'),
    );

    expect(customerStepBlock).toContain('styles.customerCardBody');
    expect(customerStepBlock).toContain('styles.customerActionRow');
    expect(customerStepBlock).toContain('styles.customerSecondaryActions');
    expect(customerStepBlock).toContain('styles.customerPrimaryAction');
    expect(customerStepBlock).toContain('Feather name="file-plus"');
    expect(customerStepBlock).toContain('Feather name="edit-3"');
    expect(customerStepBlock).toContain('Feather name="trash-2"');
    expect(customerActionStyles).toContain("flexDirection: 'row'");
    expect(customerActionStyles).toContain('justifyContent: \'space-between\'');
  });

  it('shows separate policyholder context on customer-management cards', () => {
    const customerStepBlock = createSource.slice(
      createSource.indexOf('const renderCustomerStep = () => ('),
      createSource.indexOf('const renderNewCustomerStep = () => ('),
    );

    expect(customerStepBlock).toContain('customer.hasSeparatePolicyholder');
    expect(customerStepBlock).toContain('styles.customerPolicyholderRow');
    expect(customerStepBlock).toContain('계약자 다름');
    expect(customerStepBlock).toContain('customer.policyholderName');
    expect(customerStepBlock).toContain('customer.policyholderPhone');
    expect(customerStepBlock).toContain('customer.policyholderCarrier');
  });

  it('preserves customer profile fields when opening an existing customer for editing', () => {
    const editPayloadBlock = createSource.slice(
      createSource.indexOf('const mapCustomerProfileToSavePayload'),
      createSource.indexOf('const mergeCustomerIntoList'),
    );
    const saveCustomerBlock = createSource.slice(
      createSource.indexOf('const saveNewCustomer = async () => {'),
      createSource.indexOf('const toggleProduct = (product: MobileRequestProduct) => {'),
    );

    expect(editPayloadBlock).toContain('id: customer.id');
    expect(editPayloadBlock).toContain('hasSeparatePolicyholder: Boolean(customer.hasSeparatePolicyholder)');
    expect(editPayloadBlock).toContain('policyholderName: customer.policyholderName ??');
    expect(editPayloadBlock).toContain('drivingStatus: customer.drivingStatus ??');
    expect(editPayloadBlock).toContain('requestDetails: customer.requestDetails ??');
    expect(saveCustomerBlock).toContain('mergeCustomerIntoList(prev, result.data!)');
    expect(saveCustomerBlock).toContain('editingCustomerId');
  });
  it('keeps the separate contractor toggle on one React Native Web Pressable path', () => {
    const toggleBlock = createSource.slice(
      createSource.indexOf('const toggleSeparatePolicyholder = useCallback'),
      createSource.indexOf('const updatePolicyholderSsnField'),
    );
    const newCustomerBlock = createSource.slice(
      createSource.indexOf('const renderNewCustomerStep = () => ('),
      createSource.indexOf('const renderComposeStep = () => {'),
    );

    expect(newCustomerBlock).toContain('<Pressable');
    expect(newCustomerBlock).toContain('onPress={toggleSeparatePolicyholder}');
    expect(newCustomerBlock).not.toContain("Platform.OS === 'web' ? (");
    expect(newCustomerBlock).not.toContain('<div');
    expect(newCustomerBlock).not.toContain('onClick: toggleSeparatePolicyholder');
    expect(newCustomerBlock).not.toContain('onPressIn={toggleSeparatePolicyholder}');
    expect(toggleBlock).not.toContain('policyholderToggleHandledRef');
    expect(toggleBlock).not.toContain('policyholderToggleReleaseTimerRef');
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



  it('splits MVNO carrier choices by network', () => {
    expect(createSource).toContain("const REQUEST_BOARD_CARRIER_OPTIONS = ['SKT', 'KT', 'LG U+', '알뜰폰 SKT', '알뜰폰 KT', '알뜰폰 LG U+'];");
    expect(createSource).not.toContain("const REQUEST_BOARD_CARRIER_OPTIONS = ['SKT', 'KT', 'LG U+', '알뜰폰'];");
  });

  it('keeps single-column and multiline fields on a regular vertical rhythm', () => {
    const fieldBlock = createSource.slice(
      createSource.indexOf('function Field({'),
      createSource.indexOf('export default function RequestBoardCreateScreen'),
    );
    const fieldBaseStyles = createSource.slice(
      createSource.indexOf('field: {'),
      createSource.indexOf('fieldGrow:'),
    );
    const fieldGrowStyles = createSource.slice(
      createSource.indexOf('fieldGrow:'),
      createSource.indexOf('multilineField:'),
    );
    const twoColumnBlock = createSource.slice(
      createSource.indexOf('<View style={styles.twoColumn}>'),
      createSource.indexOf('<View style={styles.genderRow}>'),
    );
    const fieldLayoutStyles = createSource.slice(
      createSource.indexOf('field: {'),
      createSource.indexOf('stackedField:'),
    );

    expect(fieldBlock).toContain('grow = false');
    expect(fieldBlock).toContain('grow && styles.fieldGrow');
    expect(fieldBlock).toContain('multiline && styles.multilineField');
    expect(fieldBlock).toContain('multiline && styles.multilineFieldLabel');
    expect(twoColumnBlock).toContain('grow');
    expect(fieldBaseStyles).not.toContain('flex: 1');
    expect(fieldGrowStyles).toContain('flex: 1');
    expect(fieldGrowStyles).not.toContain('marginTop: SPACING.xs');
    expect(fieldLayoutStyles).not.toContain('marginBottom: SPACING.sm');
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

  it('surfaces separate policyholder context in request-board list and detail summaries', () => {
    const quickRequestBlock = homeSource.slice(
      homeSource.indexOf('designerQuickRequests.map'),
      homeSource.indexOf('styles.managerQuickActions'),
    );
    const requestListBlock = requestsSource.slice(
      requestsSource.indexOf('const renderItem = ({ item }'),
      requestsSource.indexOf('const navPreset = resolveBottomNavPreset'),
    );
    const detailHeaderBlock = reviewSource.slice(
      reviewSource.indexOf('<View style={styles.infoCardHeader}>'),
      reviewSource.indexOf('<InfoSection title="의뢰 정보">'),
    );

    expect(quickRequestBlock).toContain('request.has_separate_policyholder');
    expect(quickRequestBlock).toContain('styles.managerPolicyholderRow');
    expect(quickRequestBlock).toContain('계약자 다름');
    expect(quickRequestBlock).toContain('request.policyholder_name');
    expect(quickRequestBlock).toContain('피보험자:');
    expect(quickRequestBlock).toContain('계약자:');

    expect(requestListBlock).toContain('item.has_separate_policyholder');
    expect(requestListBlock).toContain('styles.requestPolicyholderRow');
    expect(requestListBlock).toContain('계약자 다름');
    expect(requestListBlock).toContain('피보험자:');
    expect(requestListBlock).toContain('계약자:');

    expect(reviewSource).toContain('const hasSeparatePolicyholder = Boolean(detail.has_separate_policyholder);');
    expect(detailHeaderBlock).toContain('hasSeparatePolicyholder');
    expect(detailHeaderBlock).toContain('styles.policyholderSummary');
    expect(detailHeaderBlock).toContain('계약자 다름');
    expect(detailHeaderBlock).toContain('policyholderSummary');
    expect(reviewSource).toContain('detail.policyholder_name');
    expect(reviewSource).toContain('detail.policyholder_phone');
    expect(reviewSource).toContain('계약자:');
    const detailContentBlock = reviewSource.slice(
      reviewSource.indexOf('<InfoSection title="고객 정보">'),
      reviewSource.indexOf('{/* Designer Assignments */}'),
    );

    expect(detailContentBlock).toContain('<Text style={styles.sectionTitle}>계약자 정보</Text>');
    expect(detailContentBlock.indexOf('<InfoSection title="건강 정보">')).toBeLessThan(
      detailContentBlock.indexOf('<Text style={styles.sectionTitle}>계약자 정보</Text>'),
    );
  });

  it('requires a typed designer rejection reason from the home quick request card', () => {
    expect(homeSource).toContain('normalizeDesignerRejectReason(designerRejectReason)');
    expect(homeSource).toContain('handleDesignerRejectConfirm');
    expect(homeSource).toContain('의뢰 거절 사유');
    expect(homeSource).toContain('designerRejectTarget');
    expect(homeSource).not.toContain('모바일에서 거절 처리');
  });

  it('confirms a successful designer rejection from the home quick request card', () => {
    const handlerStart = homeSource.indexOf('const handleDesignerRejectConfirm = async () =>');
    const handlerEnd = homeSource.indexOf('const openNotifications = () =>', handlerStart);
    const handlerBlock = homeSource.slice(handlerStart, handlerEnd);

    expect(handlerBlock).toContain("Alert.alert('거절 완료', '의뢰를 거절했습니다.');");
    expect(handlerBlock.indexOf("Alert.alert('거절 완료'"))
      .toBeLessThan(handlerBlock.indexOf('await fetchData({ force: true });'));
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

  it('shows designer headquarters in the GaramLink messenger directory labels', () => {
    expect(messengerSource).toContain('contact_region');
    expect(messengerSource).toContain('formatDesignerDirectoryCompany');
    expect(messengerSource).toContain('const company = String(designer.company_name ?? \'\').trim()');
    expect(messengerSource).toContain('return `${company} (${headquarters})`;');
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

  it('renders request list rows before optional rejection-reason hydration finishes', () => {
    const fetchBlock = requestsSource.slice(
      requestsSource.indexOf('const fetchData = useCallback'),
      requestsSource.indexOf('const handleRefresh = () =>'),
    );
    expect(fetchBlock).toContain('setRequests(data);');
    expect(fetchBlock).toContain('setTimeout(() =>');
    expect(fetchBlock).toContain('hydrateDesignerRejectionReasons(data)');
    expect(fetchBlock).toContain('requestSequence === requestSequenceRef.current');
    expect(fetchBlock).toContain("logger.warn('[requests] optional rejection-reason hydration failed')");
    expect(fetchBlock.indexOf('setRequests(data);')).toBeLessThan(
      fetchBlock.indexOf('hydrateDesignerRejectionReasons(data)'),
    );
  });

  it('coalesces passive home refreshes but forces pull and post-mutation refreshes', () => {
    expect(homeSource).toContain('shouldSkipRequestBoardPassiveRefresh');
    expect(homeSource).toContain('requestBoardRefreshInFlightRef');
    expect(homeSource).toContain('lastRequestBoardRefreshCompletedAtRef');
    expect(homeSource).toContain('void fetchData({ force: true });');
    expect(homeSource.match(/await fetchData\(\{ force: true \}\);/g)).toHaveLength(2);
  });

  it('opens the customer step before later request catalogs finish loading', () => {
    const loadBlock = createSource.slice(
      createSource.indexOf('const loadData = useCallback'),
      createSource.indexOf('useEffect(() => {', createSource.indexOf('const loadData = useCallback')),
    );
    expect(loadBlock).toContain('const customerRowsPromise = rbGetCustomers();');
    expect(loadBlock).toContain('const catalogRowsPromise = Promise.all([');
    expect(loadBlock.indexOf('setLoading(false);')).toBeLessThan(
      loadBlock.indexOf('await catalogRowsPromise'),
    );
    expect(createSource).toContain('if (catalogLoading)');
    expect(createSource).toContain('상품·설계 매니저 정보를 불러오는 중입니다');
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
  it('surfaces FC design codes on request-board home and list cards', () => {
    const quickRequestBlock = homeSource.slice(
      homeSource.indexOf('designerQuickRequests.map'),
      homeSource.indexOf('styles.managerQuickActions'),
    );
    const requestListBlock = requestsSource.slice(
      requestsSource.indexOf('const renderItem = ({ item }'),
      requestsSource.indexOf('const navPreset = resolveBottomNavPreset'),
    );

    expect(homeSource).toContain('const getRequestDesignCodeDisplay');
    expect(homeSource).toContain('assignment?.fc_code_value');
    expect(homeSource).toContain('요청 FC: ${fcName}');
    expect(homeSource).toContain('설계 코드: ${designCode}');
    expect(homeSource).toContain('전화번호: ${phone}');
    expect(quickRequestBlock).toContain('fcContactSummary');
    expect(quickRequestBlock).toContain('styles.managerFcCodeRow');
    expect(quickRequestBlock).not.toContain('FC코드 {fcCodeDisplay}');

    expect(requestsSource).toContain('const getRequestDesignCodeDisplay');
    expect(requestsSource).toContain('assignment.fc_code_value');
    expect(requestListBlock).toContain('fcContactSummary');
    expect(requestListBlock).toContain('styles.requestFcSummaryRow');
    expect(requestListBlock).not.toContain("'FC코드 ' + fcCodeDisplay");
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
    expect(fcCodesSource).toContain('styles.codeCardActionsRow');
    expect(fcCodesSource).toContain('numberOfLines={1}>{item.insurer_name}');
    expect(fcCodesSource).toContain('<View style={styles.codeCardActionsRow}>');
  });

  it('keeps long designer picker names and sent summaries constrained', () => {
    expect(createSource).toContain('styles.managerPickerCopy');
    expect(createSource).toContain('numberOfLines={1}');
    expect(createSource).toContain('selectedDesigners.map(getDesignerNameWithHeadquarters).join');
  });

  it('sorts the mobile designer picker with life insurers first, company 가나다 순, then name order', () => {
    expect(createSource).toContain('sortRequestBoardDesigners');
    const designerSearchBlock = createSource.slice(
      createSource.indexOf('const filteredDesigners = useMemo(() => {'),
      createSource.indexOf('const closeWithAnimation = useCallback(() => {'),
    );
    expect(designerSearchBlock).toContain('const designerCandidates');
    expect(designerSearchBlock).toContain('designerCandidates');
    expect(designerSearchBlock).toContain('return sortRequestBoardDesigners(designerCandidates);');
  });

  it('highlights designer headquarters in the mobile designer picker', () => {
    expect(createSource).toContain('getDesignerHeadquarters');
    expect(createSource).toContain('styles.designerHeadquartersBadge');
    expect(createSource).toContain('designer.contact_region');
  });

  it('lets long review metadata wrap inside full-width fields', () => {
    expect(reviewSource).not.toContain("width: '48%'");
    expect(reviewSource).toContain("width: '100%'");
    expect(reviewSource).toContain('const valueLineLimit = fullWidth ? undefined : 3;');
    expect(reviewSource).toContain('numberOfLines={valueLineLimit}');
    expect(reviewSource).toContain('요청 FC');
    expect(reviewSource).toContain('전화번호');
    expect(reviewSource).toContain('설계 코드');
    expect(reviewSource).toContain('requestFcSummary');
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
