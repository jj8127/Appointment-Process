import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import {
  getDesignerSelectionConfirmState,
  getDesignerSelectionFooterBottomPadding,
  sortRequestBoardDesigners,
} from '@/lib/request-board-designer-selection';
import {
  formatRequestBoardCustomerBirthDateInput,
  formatRequestBoardCustomerPhoneInput,
  formatRequestBoardCustomerSsnInput,
  formatRequestBoardThreeDigitNumberInput,
  isCompleteRequestBoardCustomerBirthDate,
  isCompleteRequestBoardCustomerPhone,
  isCompleteRequestBoardCustomerSsn,
  isValidRequestBoardCustomerBirthDate,
} from '@/lib/request-board-customer-input';
import { REQUEST_BOARD_DRIVING_STATUS_OPTIONS } from '@/lib/request-board-driving-status';
import {
  canCreateRequestBoardRequest,
  resolveRequestBoardCreateInitialStep,
  resolveRequestBoardCreateBackTarget,
  resolveRequestBoardCreateVisibleSteps,
} from '@/lib/request-board-create-flow';
import {
  rbCreateRequest,
  rbDeleteCustomer,
  rbGetCustomers,
  rbGetDesigners,
  rbGetFcCodes,
  rbGetProducts,
  rbGetRequestDetail,
  rbSaveCustomer,
  rbSendMessage,
  rbUploadAttachments,
  type RbCustomerProfile,
  type RbDesigner,
  type RbFcCode,
  type RbRequestUploadFile,
  type RbSaveCustomerPayload,
} from '@/lib/request-board-api';
import {
  GARMIN_REQUEST_PRODUCT_NAMES,
  mapRequestBoardProductsToMobileCatalog,
  type MobileRequestProduct,
} from '@/lib/request-board-mobile-products';
import { toRequestBoardSessionErrorMessage } from '@/lib/request-board-session-error';
import { COLORS, RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/theme';

type StepKey = 'customer' | 'newCustomer' | 'compose' | 'sent';
type SortMode = 'name' | 'created';

type PickedAttachment = RbRequestUploadFile & {
  size?: number | null;
};

const EMPTY_CUSTOMER: RbSaveCustomerPayload = {
  name: '',
  gender: 'male',
  birthDate: '',
  phone: '',
  ssn: '',
  hasSeparatePolicyholder: false,
  policyholderName: '',
  policyholderSsn: '',
  policyholderPhone: '',
  policyholderCarrier: '',
  policyholderAddress: '',
  carrier: '',
  address: '',
  job: '',
  drivingStatus: '',
  income: '',
  email: '',
  height: '',
  weight: '',
  referrer: '',
  recentHospitalVisit: '',
  currentMedication: '',
  hospitalizationHistory: '',
  majorDiseases: '',
  requestDetails: '',
  insuranceQualifications: {
    property: false,
    life: false,
    third: false,
  },
};

const buildSeparatePolicyholderState = (
  prev: RbSaveCustomerPayload,
  value: boolean,
): RbSaveCustomerPayload => ({
  ...prev,
  hasSeparatePolicyholder: value,
  policyholderName: value ? prev.policyholderName : '',
  policyholderSsn: value ? prev.policyholderSsn : '',
  policyholderPhone: value ? prev.policyholderPhone : '',
  policyholderCarrier: value ? prev.policyholderCarrier : '',
  policyholderAddress: value ? prev.policyholderAddress : '',
});

const createEmptyCustomerPayload = (): RbSaveCustomerPayload => ({
  ...EMPTY_CUSTOMER,
  insuranceQualifications: {
    property: false,
    life: false,
    third: false,
  },
});

const mapCustomerProfileToSavePayload = (customer: RbCustomerProfile): RbSaveCustomerPayload => ({
  id: customer.id,
  name: customer.name,
  gender: customer.gender,
  birthDate: customer.birthDate,
  phone: customer.phone,
  ssn: customer.ssn,
  hasSeparatePolicyholder: Boolean(customer.hasSeparatePolicyholder),
  policyholderName: customer.policyholderName ?? '',
  policyholderSsn: customer.policyholderSsn ?? '',
  policyholderPhone: customer.policyholderPhone ?? '',
  policyholderCarrier: customer.policyholderCarrier ?? '',
  policyholderAddress: customer.policyholderAddress ?? '',
  carrier: customer.carrier ?? '',
  address: customer.address ?? '',
  job: customer.job ?? '',
  drivingStatus: customer.drivingStatus ?? '',
  income: customer.income ?? '',
  email: customer.email ?? '',
  height: customer.height ?? '',
  weight: customer.weight ?? '',
  referrer: customer.referrer ?? '',
  recentHospitalVisit: customer.recentHospitalVisit ?? '',
  currentMedication: customer.currentMedication ?? '',
  hospitalizationHistory: customer.hospitalizationHistory ?? '',
  majorDiseases: customer.majorDiseases ?? '',
  requestDetails: customer.requestDetails ?? '',
  insuranceQualifications: {
    property: Boolean(customer.insuranceQualifications?.property),
    life: Boolean(customer.insuranceQualifications?.life),
    third: Boolean(customer.insuranceQualifications?.third),
  },
});

const mergeCustomerIntoList = (
  customers: RbCustomerProfile[],
  customer: RbCustomerProfile,
): RbCustomerProfile[] => [customer, ...customers.filter((item) => item.id !== customer.id)];
const REQUEST_TEMPLATES: Record<string, string> = {
  종신보험: '기존 종신보험 증권 기준으로 사망보장, 납입기간, 특약 구성을 비교한 설계안을 요청드립니다.',
  건강보험: '현재 건강 상태와 기존 보장을 기준으로 주요 진단비와 수술비 보완 설계를 요청드립니다.',
  재가보험: '장기요양/재가 돌봄 상황을 고려해 월 보험료와 보장 범위를 비교한 설계를 요청드립니다.',
  간병보험: '간병비 부담을 줄일 수 있도록 보장 기간과 지급 조건을 비교한 설계를 요청드립니다.',
  고고당대통: '고혈압/고지혈/당뇨 병력 기준으로 인수 가능 조건과 보험료안을 요청드립니다.',
  운전자보험: '운전 빈도와 기존 가입 내용을 기준으로 형사합의금, 벌금, 변호사비용 보완안을 요청드립니다.',
  실비보험: '현재 실손 보장 상태를 확인하고 전환 또는 보완이 가능한지 검토 요청드립니다.',
  연금보험: '은퇴 목표 시점과 납입 가능 금액 기준으로 연금 수령 구조 설계를 요청드립니다.',
};

const REQUEST_BOARD_CARRIER_OPTIONS = ['SKT', 'KT', 'LG U+', '알뜰폰 SKT', '알뜰폰 KT', '알뜰폰 LG U+'];

const INSURANCE_QUALIFICATION_OPTIONS = [
  { key: 'property', label: '손해보험' },
  { key: 'life', label: '생명보험' },
  { key: 'third', label: '제3보험' },
] as const;

const PRODUCT_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  종신보험: 'shield',
  건강보험: 'heart',
  재가보험: 'home',
  간병보험: 'users',
  고고당대통: 'activity',
  운전자보험: 'truck',
  실비보험: 'file-plus',
  연금보험: 'calendar',
};

const normalizeCompany = (value?: string | null) => {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/손해보험/g, '손보')
    .replace(/생명보험/g, '생명')
    .replace(/보험주식회사/g, '보험')
    .replace(/주식회사/g, '')
    .trim()
    .toLowerCase();

  if (normalized === '라이나') {
    return '라이나생명';
  }
  if (normalized === '미래에셋생명') {
    return '미래에셋';
  }

  return normalized;
};

const formatPhone = (value?: string | null) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return value ?? '';
};

const getDesignerName = (designer: RbDesigner) =>
  designer.contact_name ?? designer.users?.name ?? `설계매니저 ${designer.id}`;

const getDesignerCompany = (designer: RbDesigner) =>
  designer.company_name ?? designer.users?.affiliation ?? '회사 미지정';

const getDesignerHeadquarters = (designer: RbDesigner) =>
  String(designer.contact_region ?? '').trim();

const getDesignerNameWithHeadquarters = (designer: RbDesigner) => {
  const headquarters = getDesignerHeadquarters(designer);
  return headquarters ? `${getDesignerName(designer)} (${headquarters})` : getDesignerName(designer);
};

const findFcCodeForDesigner = (designer: RbDesigner, codes: RbFcCode[]) => {
  const companyKey = normalizeCompany(getDesignerCompany(designer));
  return codes.find((code) => normalizeCompany(code.insurer_name) === companyKey) ?? null;
};

const getProductSummary = (products: MobileRequestProduct[], selectedIds: number[]) => {
  const selected = products
    .filter((product) => selectedIds.includes(product.id))
    .map((product) => product.name);
  return selected.length > 0 ? selected.join(', ') : '보험 상품 미선택';
};

function PageHeader({ title, onBack, topInset }: { title: string; onBack: () => void; topInset: number }) {
  return (
    <View style={[styles.header, { paddingTop: Math.max(topInset + 8, 28) }]}>
      <Pressable style={styles.headerIcon} onPress={onBack} hitSlop={10}>
        <Feather name="arrow-left" size={24} color={COLORS.gray[800]} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerIcon} />
    </View>
  );
}

function StepPill({ step, activeStep }: { step: StepKey; activeStep: StepKey }) {
  const order: StepKey[] = ['customer', 'newCustomer', 'compose', 'sent'];
  const isActive = step === activeStep;
  const visibleLabel: Record<StepKey, string> = {
    customer: '고객',
    newCustomer: '등록',
    compose: '요청',
    sent: '완료',
  };
  return (
    <View style={[styles.stepPill, isActive && styles.stepPillActive]}>
      <Text style={[styles.stepPillText, isActive && styles.stepPillTextActive]}>
        {order.indexOf(step) + 1}. {visibleLabel[step]}
      </Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  inputRef,
  returnKeyType,
  onSubmitEditing,
  maxLength,
  autoCapitalize,
  autoCorrect,
  grow = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  inputRef?: RefObject<TextInput | null>;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  grow?: boolean;
}) {
  return (
    <View style={[styles.field, grow && styles.fieldGrow, multiline && styles.multilineField]}>
      <Text style={[styles.fieldLabel, multiline && styles.multilineFieldLabel]}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, multiline && styles.textarea]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.gray[400]}
        multiline={multiline}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={multiline ? Boolean(onSubmitEditing) : returnKeyType === 'done'}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        scrollEnabled={false}
      />
    </View>
  );
}

function DesignerBottomSheet({
  visible,
  designers,
  selectedDesignerIds,
  selectedProductIds,
  fcCodes,
  onToggleDesigner,
  onClose,
}: {
  visible: boolean;
  designers: RbDesigner[];
  selectedDesignerIds: number[];
  selectedProductIds: number[];
  fcCodes: RbFcCode[];
  onToggleDesigner: (designerId: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const [designerSearch, setDesignerSearch] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [translateY, visible]);

  useEffect(() => {
    if (!visible) {
      setDesignerSearch('');
      setKeyboardHeight(0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;

    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [visible]);

  const filteredDesigners = useMemo(() => {
    const keyword = designerSearch.trim().toLowerCase();
    const designerCandidates = !keyword
      ? designers
      : designers.filter((designer) => {
      const code = findFcCodeForDesigner(designer, fcCodes);
      const productNames = (designer.designer_products ?? [])
        .map((item) => item.insurance_products?.name)
        .filter(Boolean)
        .join(' ');
      return [
        getDesignerName(designer),
        getDesignerCompany(designer),
        getDesignerHeadquarters(designer),
        designer.users?.email ?? '',
        designer.contact_phone ?? designer.users?.phone ?? '',
        code?.code_name ?? '',
        code?.code_value ?? '',
        productNames,
      ].some((value) => value.toLowerCase().includes(keyword));
    });

    return sortRequestBoardDesigners(designerCandidates);
  }, [designers, designerSearch, fcCodes]);

  const closeWithAnimation = useCallback(() => {
    Keyboard.dismiss();
    translateY.value = withTiming(420, { duration: 180 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > 90 || event.velocityY > 700) {
        runOnJS(closeWithAnimation)();
        return;
      }
      translateY.value = withTiming(0, { duration: 160 });
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const confirmState = getDesignerSelectionConfirmState(selectedDesignerIds.length);

  const completeSelection = useCallback(() => {
    if (confirmState.disabled) return;
    closeWithAnimation();
  }, [closeWithAnimation, confirmState.disabled]);

  const keyboardAwareSheetStyle = keyboardHeight > 0
    ? {
        marginBottom: Math.max(0, keyboardHeight - 10),
        height: '56%' as const,
      }
    : {
        height: '82%' as const,
      };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeWithAnimation}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetScrim} onPress={closeWithAnimation} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheet, keyboardAwareSheetStyle, sheetStyle]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>설계매니저 선택</Text>
                <Text style={styles.sheetSubtitle}>필수 · {selectedDesignerIds.length}명 선택됨</Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={closeWithAnimation} hitSlop={10}>
                <Feather name="x" size={22} color={COLORS.gray[700]} />
              </Pressable>
            </View>
            <View style={styles.sheetSearchCard}>
              <Feather name="search" size={17} color={COLORS.gray[500]} />
              <TextInput
                style={styles.sheetSearchInput}
                value={designerSearch}
                onChangeText={setDesignerSearch}
                placeholder="이름, 회사, 상품 검색"
                placeholderTextColor={COLORS.gray[400]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {designerSearch.trim().length > 0 ? (
                <Pressable onPress={() => setDesignerSearch('')} hitSlop={8}>
                  <Feather name="x" size={16} color={COLORS.gray[500]} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sheetList}
            >
              {filteredDesigners.length === 0 ? (
                <View style={styles.sheetEmptyState}>
                  <Text style={styles.sheetEmptyTitle}>검색 결과가 없습니다</Text>
                  <Text style={styles.sheetEmptyText}>다른 이름이나 회사명으로 검색해보세요.</Text>
                </View>
              ) : null}
              {filteredDesigners.map((designer) => {
                const selected = selectedDesignerIds.includes(designer.id);
                const matchedProducts = (designer.designer_products ?? [])
                  .filter((item) => selectedProductIds.includes(item.product_id))
                  .map((item) => item.insurance_products?.name)
                  .filter(Boolean);
                const code = findFcCodeForDesigner(designer, fcCodes);
                const headquarters = getDesignerHeadquarters(designer);
                return (
                  <Pressable
                    key={designer.id}
                    style={({ pressed }) => [
                      styles.designerCard,
                      selected && styles.designerCardSelected,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => onToggleDesigner(designer.id)}
                  >
                    <View style={styles.designerMain}>
                      <View style={styles.designerTitleRow}>
                        <Text style={styles.designerName} numberOfLines={1}>
                          {getDesignerName(designer)} · {getDesignerCompany(designer)}
                        </Text>
                        {headquarters ? (
                          <Text style={styles.designerHeadquartersBadge}>{headquarters}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.designerMeta} numberOfLines={2}>
                        {matchedProducts.length > 0
                          ? `선택 종목 가능: ${matchedProducts.join(', ')}`
                          : '선택 종목 매칭 정보 없음'}
                      </Text>
                      <Text style={[styles.codeState, !code && styles.codeStateMissing]}>
                        {code ? `FC 코드 ${code.code_value}` : 'FC 코드 필요'}
                      </Text>
                    </View>
                    <View style={[styles.selectMark, selected && styles.selectMarkActive]}>
                      {selected ? (
                        <Feather name="check" size={18} color="#fff" />
                      ) : (
                        <Text style={styles.selectMarkText}>선택</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View
              style={[
                styles.sheetFooter,
                {
                  paddingBottom: getDesignerSelectionFooterBottomPadding(insets.bottom, {
                    keyboardVisible: keyboardHeight > 0,
                    minimumPadding: Platform.OS === 'android' ? 72 : 20,
                  }),
                },
              ]}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.sheetDoneButton,
                  confirmState.disabled && styles.disabledButton,
                  pressed && !confirmState.disabled && { opacity: 0.9 },
                ]}
                onPress={completeSelection}
                disabled={confirmState.disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmState.disabled }}
              >
                <Text style={styles.sheetDoneButtonText}>{confirmState.label}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

export default function RequestBoardCreateScreen() {
  const router = useRouter();
  const { entry, source } = useLocalSearchParams<{ entry?: string | string[]; source?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const {
    role,
    readOnly,
    staffType,
    hydrated,
    isRequestBoardDesigner,
    requestBoardRole,
    ensureRequestBoardSession,
  } = useSession();

  const [step, setStep] = useState<StepKey>(() => resolveRequestBoardCreateInitialStep(entry));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState<RbCustomerProfile[]>([]);
  const [products, setProducts] = useState<MobileRequestProduct[]>([]);
  const [designers, setDesigners] = useState<RbDesigner[]>([]);
  const [fcCodes, setFcCodes] = useState<RbFcCode[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<RbCustomerProfile | null>(null);
  const [newCustomer, setNewCustomer] = useState<RbSaveCustomerPayload>(() => createEmptyCustomerPayload());
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('created');
  const [composeEntryStep, setComposeEntryStep] = useState<Extract<StepKey, 'customer' | 'newCustomer'>>('customer');
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [selectedDesignerIds, setSelectedDesignerIds] = useState<number[]>([]);
  const [requestText, setRequestText] = useState('');
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sentRequestIds, setSentRequestIds] = useState<number[]>([]);
  const [composeDraftKey, setComposeDraftKey] = useState(0);
  const [screenKeyboardHeight, setScreenKeyboardHeight] = useState(0);
  const visibleSteps = resolveRequestBoardCreateVisibleSteps(entry, source);
  const sourceValue = Array.isArray(source) ? source[0] : source;
  const isCustomerManagement = sourceValue === 'customer-management';
  const customerNameInputRef = useRef<TextInput>(null);
  const birthDateInputRef = useRef<TextInput>(null);
  const phoneInputRef = useRef<TextInput>(null);
  const ssnInputRef = useRef<TextInput>(null);
  const policyholderNameInputRef = useRef<TextInput>(null);
  const policyholderSsnInputRef = useRef<TextInput>(null);
  const policyholderPhoneInputRef = useRef<TextInput>(null);
  const policyholderAddressInputRef = useRef<TextInput>(null);
  const jobInputRef = useRef<TextInput>(null);
  const incomeInputRef = useRef<TextInput>(null);
  const heightInputRef = useRef<TextInput>(null);
  const weightInputRef = useRef<TextInput>(null);
  const addressInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const referrerInputRef = useRef<TextInput>(null);
  const currentMedicationInputRef = useRef<TextInput>(null);
  const recentHospitalVisitInputRef = useRef<TextInput>(null);
  const hospitalizationHistoryInputRef = useRef<TextInput>(null);
  const majorDiseasesInputRef = useRef<TextInput>(null);
  const hasLoadedInitialRequestDataRef = useRef(false);

  const canUseCreateFlow = canCreateRequestBoardRequest({
    role,
    readOnly,
    staffType,
    requestBoardRole,
    isRequestBoardDesigner,
  });

  const loadData = useCallback(async () => {
    if (!hydrated) return;
    if (!canUseCreateFlow) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const sync = await ensureRequestBoardSession();
      if (!sync.ok) {
        throw new Error(sync.error ?? '가람Link 세션 동기화에 실패했습니다.');
      }

      const [customerRows, productRows, designerRows, codeRows] = await Promise.all([
        rbGetCustomers(),
        rbGetProducts(),
        rbGetDesigners(),
        rbGetFcCodes(),
      ]);

      setCustomers(customerRows);
      setProducts(mapRequestBoardProductsToMobileCatalog(productRows).products);
      setDesigners(designerRows);
      setFcCodes(codeRows);
      hasLoadedInitialRequestDataRef.current = true;
    } catch (err) {
      logger.warn('[request-board-create] load failed', err);
      Alert.alert(
        '데이터 로드 실패',
        toRequestBoardSessionErrorMessage(err, '설계 요청 데이터를 불러오지 못했습니다.'),
      );
    } finally {
      setLoading(false);
    }
  }, [canUseCreateFlow, ensureRequestBoardSession, hydrated]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const refreshDesignerCodeData = async () => {
        if (!hydrated || !canUseCreateFlow || !hasLoadedInitialRequestDataRef.current) return;

        try {
          const sync = await ensureRequestBoardSession();
          if (!sync.ok) {
            throw new Error(sync.error ?? '가람Link 세션 동기화에 실패했습니다.');
          }

          const [designerRows, codeRows] = await Promise.all([
            rbGetDesigners(),
            rbGetFcCodes(),
          ]);

          if (!isActive) return;
          setDesigners(designerRows);
          setFcCodes(codeRows);
        } catch (err) {
          logger.warn('[request-board-create] focus refresh failed', err);
        }
      };

      void refreshDesignerCodeData();

      return () => {
        isActive = false;
      };
    }, [canUseCreateFlow, ensureRequestBoardSession, hydrated]),
  );

  useEffect(() => {
    if (!hydrated || canUseCreateFlow) return;
    router.replace('/request-board' as any);
  }, [canUseCreateFlow, hydrated, router]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setScreenKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setScreenKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const sortedCustomers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...customers]
      .filter((customer) => {
        if (!keyword) return true;
        return (
          customer.name.toLowerCase().includes(keyword) ||
          customer.phone.toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => {
        if (sortMode === 'name') return a.name.localeCompare(b.name, 'ko-KR');
        const aDate = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const bDate = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return bDate - aDate;
      });
  }, [customers, search, sortMode]);

  const selectedDesigners = useMemo(
    () => designers.filter((designer) => selectedDesignerIds.includes(designer.id)),
    [designers, selectedDesignerIds],
  );

  const selectedProductNames = useMemo(
    () => products.filter((product) => selectedProductIds.includes(product.id)).map((item) => item.name),
    [products, selectedProductIds],
  );

  const availableTemplates = (selectedProductNames.length > 0
    ? selectedProductNames
    : [...GARMIN_REQUEST_PRODUCT_NAMES]
  ).filter((productName) => REQUEST_TEMPLATES[productName]);

  const canSubmit =
    !!selectedCustomer &&
    selectedProductIds.length > 0 &&
    selectedDesignerIds.length > 0 &&
    requestText.trim().length > 0;

  const updateCustomerField = <K extends keyof RbSaveCustomerPayload>(
    key: K,
    value: RbSaveCustomerPayload[K],
  ) => {
    setNewCustomer((prev) => ({ ...prev, [key]: value }));
  };

  const focusNextInput = useCallback((inputRef: RefObject<TextInput | null>) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const updateBirthDateField = useCallback((value: string) => {
    const formatted = formatRequestBoardCustomerBirthDateInput(value);
    updateCustomerField('birthDate', formatted);
    if (isCompleteRequestBoardCustomerBirthDate(formatted)) {
      focusNextInput(phoneInputRef);
    }
  }, [focusNextInput]);

  const updatePhoneField = useCallback((value: string) => {
    const formatted = formatRequestBoardCustomerPhoneInput(value);
    updateCustomerField('phone', formatted);
    if (isCompleteRequestBoardCustomerPhone(formatted)) {
      focusNextInput(ssnInputRef);
    }
  }, [focusNextInput]);

  const updateSsnField = useCallback((value: string) => {
    const formatted = formatRequestBoardCustomerSsnInput(value);
    updateCustomerField('ssn', formatted);
    if (isCompleteRequestBoardCustomerSsn(formatted)) {
      focusNextInput(newCustomer.hasSeparatePolicyholder ? policyholderNameInputRef : jobInputRef);
    }
  }, [focusNextInput, newCustomer.hasSeparatePolicyholder]);

  const toggleSeparatePolicyholder = useCallback(() => {
    setNewCustomer((prev) => buildSeparatePolicyholderState(prev, !prev.hasSeparatePolicyholder));
  }, []);

  const updatePolicyholderSsnField = useCallback((value: string) => {
    const formatted = formatRequestBoardCustomerSsnInput(value);
    updateCustomerField('policyholderSsn', formatted);
    if (isCompleteRequestBoardCustomerSsn(formatted)) {
      focusNextInput(policyholderPhoneInputRef);
    }
  }, [focusNextInput]);

  const updatePolicyholderPhoneField = useCallback((value: string) => {
    const formatted = formatRequestBoardCustomerPhoneInput(value);
    updateCustomerField('policyholderPhone', formatted);
    if (isCompleteRequestBoardCustomerPhone(formatted)) {
      focusNextInput(policyholderAddressInputRef);
    }
  }, [focusNextInput]);

  const updateHeightField = useCallback((value: string) => {
    const formatted = formatRequestBoardThreeDigitNumberInput(value);
    updateCustomerField('height', formatted);
    if (formatted.length === 3) {
      focusNextInput(weightInputRef);
    }
  }, [focusNextInput]);

  const updateWeightField = useCallback((value: string) => {
    updateCustomerField('weight', formatRequestBoardThreeDigitNumberInput(value));
  }, []);

  const toggleInsuranceQualification = (
    key: keyof NonNullable<RbSaveCustomerPayload['insuranceQualifications']>,
  ) => {
    setNewCustomer((prev) => ({
      ...prev,
      insuranceQualifications: {
        property: Boolean(prev.insuranceQualifications?.property),
        life: Boolean(prev.insuranceQualifications?.life),
        third: Boolean(prev.insuranceQualifications?.third),
        [key]: !prev.insuranceQualifications?.[key],
      },
    }));
  };

  const handleBack = useCallback(() => {
    const target = resolveRequestBoardCreateBackTarget(step, composeEntryStep);
    if (target.type === 'back') {
      router.back();
      return;
    }
    if (target.type === 'replace') {
      router.replace(target.path as any);
      return;
    }
    setStep(target.step);
  }, [composeEntryStep, router, step]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (step === 'customer') return false;
        handleBack();
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [handleBack, step]),
  );

  const resetCustomerForm = useCallback(() => {
    setEditingCustomerId(null);
    setNewCustomer(createEmptyCustomerPayload());
  }, []);

  const openNewCustomerForm = () => {
    resetCustomerForm();
    setStep('newCustomer');
  };

  const openEditCustomer = (customer: RbCustomerProfile) => {
    setEditingCustomerId(customer.id);
    setNewCustomer(mapCustomerProfileToSavePayload(customer));
    setStep('newCustomer');
  };

  const cancelCustomerForm = () => {
    resetCustomerForm();
    setStep('customer');
  };

  const selectCustomer = (customer: RbCustomerProfile) => {
    setSelectedCustomer(customer);
    setSelectedProductIds([]);
    setSelectedDesignerIds([]);
    setRequestText('');
    setAttachments([]);
    setSentRequestIds([]);
    setComposeDraftKey((value) => value + 1);
    setComposeEntryStep('customer');
    setStep('compose');
  };

  const deleteCustomer = async (customer: RbCustomerProfile) => {
    if (deletingCustomerId === customer.id) return;
    try {
      setDeletingCustomerId(customer.id);
      const result = await rbDeleteCustomer(customer.id);
      if (!result.success) {
        throw new Error(result.error ?? '고객 삭제에 실패했습니다.');
      }
      setCustomers((prev) => prev.filter((item) => item.id !== customer.id));
      if (selectedCustomer?.id === customer.id) {
        setSelectedCustomer(null);
      }
      if (editingCustomerId === customer.id) {
        resetCustomerForm();
        setStep('customer');
      }
    } catch (err) {
      logger.warn('[request-board-create] delete customer failed', err);
      Alert.alert(
        '고객 삭제 실패',
        toRequestBoardSessionErrorMessage(err, '고객 삭제에 실패했습니다.'),
      );
    } finally {
      setDeletingCustomerId(null);
    }
  };

  const confirmDeleteCustomer = (customer: RbCustomerProfile) => {
    if (deletingCustomerId) return;
    Alert.alert(
      '고객 삭제',
      `"${customer.name}" 고객을 삭제할까요?\n이미 전송된 설계요청 이력은 삭제되지 않습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => void deleteCustomer(customer),
        },
      ],
    );
  };
  const saveNewCustomer = async () => {
    if (!newCustomer.name.trim() || !newCustomer.birthDate.trim() || !newCustomer.phone.trim()) {
      Alert.alert('필수 정보 확인', '피보험자 이름, 생년월일, 연락처는 필수입니다.');
      return;
    }

    if (!isValidRequestBoardCustomerBirthDate(newCustomer.birthDate)) {
      Alert.alert('생년월일 확인', '생년월일은 YYYY-MM-DD 형식으로 정확히 입력해주세요.');
      return;
    }

    if (!isCompleteRequestBoardCustomerPhone(newCustomer.phone)) {
      Alert.alert('연락처 확인', '피보험자 연락처를 11자리로 입력해주세요.');
      return;
    }

    if (!isCompleteRequestBoardCustomerSsn(newCustomer.ssn)) {
      Alert.alert('주민번호 확인', '피보험자 주민번호 13자리를 모두 입력해주세요.');
      return;
    }

    if (!String(newCustomer.drivingStatus ?? '').trim()) {
      Alert.alert('운전구분 확인', '운전구분을 선택해주세요.');
      return;
    }

    if (
      newCustomer.hasSeparatePolicyholder &&
      [
        newCustomer.policyholderName,
        newCustomer.policyholderSsn,
        newCustomer.policyholderPhone,
        newCustomer.policyholderCarrier,
        newCustomer.policyholderAddress,
      ].some((value) => !String(value ?? '').trim())
    ) {
      Alert.alert(
        '계약자 정보 확인',
        '계약자와 피보험자가 다를 경우 계약자 이름, 주민번호, 휴대폰번호, 통신사, 주소를 모두 입력해주세요.',
      );
      return;
    }

    if (
      newCustomer.hasSeparatePolicyholder &&
      !isCompleteRequestBoardCustomerSsn(newCustomer.policyholderSsn ?? '')
    ) {
      Alert.alert('계약자 주민번호 확인', '계약자 주민번호 13자리를 모두 입력해주세요.');
      return;
    }

    if (
      newCustomer.hasSeparatePolicyholder &&
      !isCompleteRequestBoardCustomerPhone(newCustomer.policyholderPhone ?? '')
    ) {
      Alert.alert('계약자 연락처 확인', '계약자 휴대폰번호를 11자리로 입력해주세요.');
      return;
    }

    try {
      setSubmitting(true);
      const result = await rbSaveCustomer(newCustomer);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? (editingCustomerId ? '고객 정보 저장에 실패했습니다.' : '고객 등록에 실패했습니다.'));
      }
      setCustomers((prev) => mergeCustomerIntoList(prev, result.data!));
      setSelectedCustomer(result.data);
      setSelectedProductIds([]);
      setSelectedDesignerIds([]);
      setRequestText('');
      setAttachments([]);
      setSentRequestIds([]);
      setComposeDraftKey((value) => value + 1);
      setComposeEntryStep(editingCustomerId ? 'customer' : 'newCustomer');

      if (isCustomerManagement) {
        resetCustomerForm();
        setStep('customer');
        return;
      }

      setEditingCustomerId(null);
      setNewCustomer(createEmptyCustomerPayload());
      setStep('compose');
    } catch (err) {
      logger.warn('[request-board-create] save customer failed', err);
      Alert.alert(
        editingCustomerId ? '고객 정보 저장 실패' : '고객 등록 실패',
        toRequestBoardSessionErrorMessage(
          err,
          editingCustomerId ? '고객 정보 저장에 실패했습니다.' : '고객 등록에 실패했습니다.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };
  const toggleProduct = (product: MobileRequestProduct) => {
    setSelectedProductIds((prev) => {
      const exists = prev.includes(product.id);
      return exists ? prev.filter((id) => id !== product.id) : [...prev, product.id];
    });
  };

  const toggleDesigner = (designerId: number) => {
    setSelectedDesignerIds((prev) =>
      prev.includes(designerId)
        ? prev.filter((id) => id !== designerId)
        : [...prev, designerId],
    );
  };

  const applyTemplate = (productName: string) => {
    const text = REQUEST_TEMPLATES[productName] ?? '';
    if (!text) return;
    setRequestText((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
  };

  const pickAttachments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? null,
      }));
      setAttachments((prev) => [...prev, ...picked].slice(0, 10));
    } catch (err) {
      logger.warn('[request-board-create] pick attachments failed', err);
      Alert.alert('첨부 실패', '첨부할 파일을 선택하지 못했습니다.');
    }
  };

  const submitRequest = async () => {
    if (!selectedCustomer) {
      Alert.alert('고객 선택', '설계를 요청할 고객을 선택해주세요.');
      return;
    }
    if (!canSubmit) {
      Alert.alert('요청 정보 확인', '보험 상품, 설계매니저, 요청 내용을 모두 입력해주세요.');
      return;
    }
    const drivingStatus = String(selectedCustomer.drivingStatus ?? '').trim();
    if (!drivingStatus) {
      Alert.alert(
        '운전구분 확인',
        '운전구분을 먼저 입력해주세요. 기존 고객 정보에서 운전구분을 수정한 뒤 다시 요청해주세요.',
      );
      return;
    }

    const designerCodeSelections = selectedDesigners.map((designer) => {
      const code = findFcCodeForDesigner(designer, fcCodes);
      return {
        designerId: designer.id,
        companyName: getDesignerCompany(designer),
        fcCompanyCodeId: code?.id ?? null,
        fcCodeName: code?.code_name ?? code?.insurer_name ?? null,
        fcCodeValue: code?.code_value ?? null,
      };
    });

    const missingCode = designerCodeSelections.find((code) => !code.fcCodeName || !code.fcCodeValue);
    if (missingCode) {
      Alert.alert(
        '설계코드 필요',
        `${missingCode.companyName ?? '선택한 회사'} 설계코드를 먼저 등록해주세요.`,
        [
          { text: '취소', style: 'cancel' },
          { text: '설계코드 관리', onPress: () => router.push('/request-board-fc-codes' as any) },
        ],
      );
      return;
    }
    const designerCodeSelectionByDesignerId = new Map(
      designerCodeSelections.map((selection) => [selection.designerId, selection]),
    );
    const requestJobs = selectedProductIds.flatMap((productId) =>
      selectedDesigners.map((designer) => ({
        productId,
        designer,
        designerCodeSelection: designerCodeSelectionByDesignerId.get(designer.id)!,
      })),
    );

    try {
      setSubmitting(true);
      const settledRequestResults = await Promise.allSettled(
        requestJobs.map(({ productId, designer, designerCodeSelection }) => {
          const payload = {
            customerName: selectedCustomer.name,
            customerSsn: selectedCustomer.ssn,
            customerGender: selectedCustomer.gender,
            customerBirthDate: selectedCustomer.birthDate,
            customerPhone: selectedCustomer.phone,
            customerCarrier: selectedCustomer.carrier,
            customerAddress: selectedCustomer.address,
            customerJob: selectedCustomer.job,
            customerDrivingStatus: drivingStatus,
            customerIncome: selectedCustomer.income,
            customerEmail: selectedCustomer.email,
            customerHeight: selectedCustomer.height,
            customerWeight: selectedCustomer.weight,
            customerReferrer: selectedCustomer.referrer,
            hasSeparatePolicyholder: selectedCustomer.hasSeparatePolicyholder,
            policyholderName: selectedCustomer.policyholderName,
            policyholderSsn: selectedCustomer.policyholderSsn,
            policyholderPhone: selectedCustomer.policyholderPhone,
            policyholderCarrier: selectedCustomer.policyholderCarrier,
            policyholderAddress: selectedCustomer.policyholderAddress,
            insuranceQualifications: selectedCustomer.insuranceQualifications,
            recentHospitalVisit: selectedCustomer.recentHospitalVisit,
            currentMedication: selectedCustomer.currentMedication,
            recentHospitalization: selectedCustomer.hospitalizationHistory,
            hospitalizationHistory: selectedCustomer.hospitalizationHistory,
            majorDiseases: selectedCustomer.majorDiseases,
            requestDetails: requestText.trim(),
            productIds: [productId],
            designerIds: [designer.id],
            designerCodeSelections: [designerCodeSelection],
          };
          return rbCreateRequest(payload);
        }),
      );

      const fulfilledRequests = settledRequestResults
        .filter(
          (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof rbCreateRequest>>> =>
            result.status === 'fulfilled' && result.value.success && Boolean(result.value.data),
        )
        .map((result) => result.value);
      const failedRequests = settledRequestResults.flatMap((result) => {
        if (result.status === 'rejected') {
          return [result.reason instanceof Error ? result.reason.message : String(result.reason ?? '')];
        }
        if (!result.value.success || !result.value.data) {
          return [result.value.error ?? '설계 요청을 보내지 못했습니다.'];
        }
        return [];
      });

      if (fulfilledRequests.length === 0) {
        throw new Error(failedRequests[0] || '설계 요청을 보내지 못했습니다.');
      }

      const createdRequestIds = fulfilledRequests.map((result) => result.data!.id);
      setSentRequestIds(createdRequestIds);

      if (failedRequests.length > 0) {
        Alert.alert(
          '일부 설계요청만 전송되었습니다',
          `${createdRequestIds.length}건은 전송되었고 ${failedRequests.length}건은 실패했습니다. 성공한 의뢰는 중복 방지를 위해 완료 화면에서 확인해주세요.`,
        );
      }

      if (attachments.length > 0) {
        const upload = await rbUploadAttachments(attachments);
        if (upload.success && upload.data && upload.data.length > 0) {
          const detailResults = await Promise.allSettled(
            createdRequestIds.map((requestId) => rbGetRequestDetail(requestId)),
          );
          const assignments = detailResults.flatMap((result) =>
            result.status === 'fulfilled' ? (result.value?.request_designers ?? []) : [],
          );
          await Promise.allSettled(
            assignments.map((assignment) =>
              rbSendMessage(
                assignment.id,
                '설계 요청 첨부파일을 전달드립니다.',
                upload.data,
              ),
            ),
          );
        } else if (!upload.success) {
          Alert.alert(
            '첨부 전송 보류',
            toRequestBoardSessionErrorMessage(upload.error, '요청은 생성됐지만 첨부 전송에 실패했습니다.'),
          );
        }
      }

      setStep('sent');
    } catch (err) {
      logger.warn('[request-board-create] submit failed', err);
      Alert.alert(
        '전송 실패',
        toRequestBoardSessionErrorMessage(err, '설계 요청을 보내지 못했습니다.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderCustomerStep = () => (
    <>
      <View style={styles.searchCard}>
        <Feather name="search" size={18} color={COLORS.gray[500]} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="고객 이름 또는 연락처 검색"
          placeholderTextColor={COLORS.gray[400]}
        />
      </View>
      <View style={styles.segmented}>
        <Pressable
          style={[styles.segmentButton, sortMode === 'created' && styles.segmentButtonActive]}
          onPress={() => setSortMode('created')}
        >
          <Text style={[styles.segmentText, sortMode === 'created' && styles.segmentTextActive]}>
            고객 등록 순
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, sortMode === 'name' && styles.segmentButtonActive]}
          onPress={() => setSortMode('name')}
        >
          <Text style={[styles.segmentText, sortMode === 'name' && styles.segmentTextActive]}>
            이름 순
          </Text>
        </Pressable>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>고객</Text>
        <Pressable onPress={openNewCustomerForm} hitSlop={8}>
          <Text style={styles.linkText}>신규 등록</Text>
        </Pressable>
      </View>
      <View style={styles.cardList}>
        {sortedCustomers.map((customer) => {
          const deleting = deletingCustomerId === customer.id;
          const policyholderSummary = [
            `계약자: ${customer.policyholderName || '미입력'}`,
            formatPhone(customer.policyholderPhone),
            customer.policyholderCarrier,
          ].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={customer.id}
              style={({ pressed }) => [styles.customerCard, pressed && { opacity: 0.85 }]}
              onPress={() => (isCustomerManagement ? undefined : selectCustomer(customer))}
            >
              <View style={styles.customerCardBody}>
                <View style={styles.customerInfo}>
                  <Text style={styles.customerName}>{customer.name}</Text>
                  <Text style={styles.customerMeta}>
                    {customer.birthDate} · {customer.gender === 'female' ? '여' : '남'} · {formatPhone(customer.phone)}
                  </Text>
                  <Text style={styles.customerMeta}>주민번호 {customer.ssn || '미입력'}</Text>
                  {customer.hasSeparatePolicyholder ? (
                    <View style={styles.customerPolicyholderRow}>
                      <Text style={styles.customerPolicyholderBadge} numberOfLines={1}>계약자 다름</Text>
                      <Text style={styles.customerPolicyholderText} numberOfLines={1}>
                        {policyholderSummary}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.customerActionRow}>
                {isCustomerManagement ? (
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.customerPrimaryAction,
                      pressed && { opacity: 0.9 },
                    ]}
                    onPress={() => selectCustomer(customer)}
                  >
                    <Feather name="file-plus" size={16} color="#fff" />
                    <Text style={styles.customerPrimaryActionText} numberOfLines={1}>요청 작성</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.customerPrimaryAction, styles.customerSelectIndicator]}>
                    <Feather name="check" size={16} color={COLORS.primary} />
                    <Text style={[styles.customerPrimaryActionText, styles.customerSelectIndicatorText]} numberOfLines={1}>선택</Text>
                  </View>
                )}
                <View style={styles.customerSecondaryActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${customer.name} 고객 정보 수정`}
                    style={({ pressed }) => [
                      styles.customerSecondaryAction,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => openEditCustomer(customer)}
                    disabled={deleting}
                  >
                    <Feather name="edit-3" size={15} color={COLORS.gray[700]} />
                    <Text style={styles.customerSecondaryActionText} numberOfLines={1}>수정</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${customer.name} 고객 삭제`}
                    style={({ pressed }) => [
                      styles.customerSecondaryAction,
                      styles.customerDangerAction,
                      deleting && styles.disabledButton,
                      pressed && !deleting && { opacity: 0.85 },
                    ]}
                    onPress={() => confirmDeleteCustomer(customer)}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator color={COLORS.error} size="small" />
                    ) : (
                      <>
                        <Feather name="trash-2" size={15} color={COLORS.error} />
                        <Text style={[styles.customerSecondaryActionText, styles.customerDangerActionText]} numberOfLines={1}>삭제</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
  const renderNewCustomerStep = () => (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>{editingCustomerId ? '고객 정보 수정' : '기본 정보'}</Text>
      <View style={styles.twoColumn}>
        <Field
          grow
          label="피보험자 이름"
          value={newCustomer.name}
          onChangeText={(value) => updateCustomerField('name', value)}
          placeholder="홍길동"
          inputRef={customerNameInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(birthDateInputRef)}
        />
        <Field
          grow
          label="생년월일"
          value={newCustomer.birthDate}
          onChangeText={updateBirthDateField}
          placeholder="1990-01-01"
          keyboardType="number-pad"
          maxLength={10}
          inputRef={birthDateInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(phoneInputRef)}
        />
      </View>
      <View style={styles.twoColumn}>
        <Field
          grow
          label="연락처"
          value={newCustomer.phone}
          onChangeText={updatePhoneField}
          placeholder="010-1234-1234"
          keyboardType="phone-pad"
          maxLength={13}
          inputRef={phoneInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(ssnInputRef)}
        />
        <Field
          grow
          label="주민번호"
          value={newCustomer.ssn}
          onChangeText={updateSsnField}
          placeholder="900101-1234567"
          keyboardType="number-pad"
          maxLength={14}
          inputRef={ssnInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(jobInputRef)}
        />
      </View>
      <View style={styles.genderRow}>
        {(['male', 'female'] as const).map((gender) => (
          <Pressable
            key={gender}
            style={[styles.genderButton, newCustomer.gender === gender && styles.genderButtonActive]}
            onPress={() => updateCustomerField('gender', gender)}
          >
            <Text style={[styles.genderText, newCustomer.gender === gender && styles.genderTextActive]}>
              {gender === 'male' ? '남' : '여'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.stackedField}>
        <Text style={styles.fieldLabel}>피보험자 통신사</Text>
        <View style={styles.carrierGrid}>
          {REQUEST_BOARD_CARRIER_OPTIONS.map((carrier) => {
            const active = newCustomer.carrier === carrier;
            return (
              <Pressable
                key={carrier}
                style={({ pressed }) => [
                  styles.carrierButton,
                  active && styles.carrierButtonActive,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => updateCustomerField('carrier', carrier)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.carrierText, active && styles.carrierTextActive]}>
                  {carrier}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.policyholderToggle,
          newCustomer.hasSeparatePolicyholder && styles.policyholderToggleActive,
          pressed && { opacity: 0.9 },
        ]}
        onPress={toggleSeparatePolicyholder}
        accessibilityRole="button"
        accessibilityLabel="계약자 피보험자 다름"
        accessibilityState={{ selected: newCustomer.hasSeparatePolicyholder }}
      >
        <View
          style={[
            styles.policyholderCheck,
            newCustomer.hasSeparatePolicyholder && styles.policyholderCheckActive,
          ]}
        >
          {newCustomer.hasSeparatePolicyholder ? <Feather name="check" size={16} color="#fff" /> : null}
        </View>
        <View style={styles.policyholderToggleCopy}>
          <Text style={styles.policyholderToggleTitle}>계약자 피보험자 다름</Text>
          <Text style={styles.policyholderToggleHint}>
            피보험자는 위 기본 정보로 저장하고 계약자 정보를 별도로 입력합니다.
          </Text>
        </View>
      </Pressable>
      {newCustomer.hasSeparatePolicyholder ? (
        <View style={styles.policyholderPanel}>
          <Text style={styles.policyholderPanelTitle}>계약자 정보</Text>
          <Text style={styles.policyholderPanelHint}>
            계약자와 피보험자가 다를 경우 계약자 정보를 모두 입력해주세요.
          </Text>
          <Field
            label="계약자 이름"
            value={newCustomer.policyholderName ?? ''}
            onChangeText={(value) => updateCustomerField('policyholderName', value)}
            placeholder="계약자 이름"
            inputRef={policyholderNameInputRef}
            returnKeyType="next"
            onSubmitEditing={() => focusNextInput(policyholderSsnInputRef)}
          />
          <Field
            label="계약자 주민번호"
            value={newCustomer.policyholderSsn ?? ''}
            onChangeText={updatePolicyholderSsnField}
            placeholder="900101-1234567"
            keyboardType="number-pad"
            maxLength={14}
            inputRef={policyholderSsnInputRef}
            returnKeyType="next"
            onSubmitEditing={() => focusNextInput(policyholderPhoneInputRef)}
          />
          <Field
            label="계약자 휴대폰번호"
            value={newCustomer.policyholderPhone ?? ''}
            onChangeText={updatePolicyholderPhoneField}
            placeholder="010-1234-1234"
            keyboardType="phone-pad"
            maxLength={13}
            inputRef={policyholderPhoneInputRef}
            returnKeyType="next"
            onSubmitEditing={() => focusNextInput(policyholderAddressInputRef)}
          />
          <View style={styles.stackedField}>
            <Text style={styles.fieldLabel}>계약자 통신사</Text>
            <View style={styles.carrierGrid}>
              {REQUEST_BOARD_CARRIER_OPTIONS.map((carrier) => {
                const active = newCustomer.policyholderCarrier === carrier;
                return (
                  <Pressable
                    key={carrier}
                    style={({ pressed }) => [
                      styles.carrierButton,
                      active && styles.carrierButtonActive,
                      pressed && { opacity: 0.85 },
                    ]}
                    onPress={() => updateCustomerField('policyholderCarrier', carrier)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.carrierText, active && styles.carrierTextActive]}>
                      {carrier}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Field
            label="계약자 주소"
            value={newCustomer.policyholderAddress ?? ''}
            onChangeText={(value) => updateCustomerField('policyholderAddress', value)}
            placeholder="서울시 강남구 테헤란로 123"
            inputRef={policyholderAddressInputRef}
            returnKeyType="next"
            onSubmitEditing={() => focusNextInput(jobInputRef)}
          />
        </View>
      ) : null}
      <Text style={styles.formTitle}>설계 참고 정보</Text>
      <View style={styles.twoColumn}>
        <Field
          grow
          label="직업"
          value={newCustomer.job ?? ''}
          onChangeText={(value) => updateCustomerField('job', value)}
          placeholder="회사원"
          inputRef={jobInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(incomeInputRef)}
        />
        <Field
          grow
          label="소득"
          value={newCustomer.income ?? ''}
          onChangeText={(value) => updateCustomerField('income', value)}
          placeholder="월 300만원"
          inputRef={incomeInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(heightInputRef)}
        />
      </View>
      <View style={styles.stackedField}>
        <Text style={styles.fieldLabel}>운전 구분</Text>
        <View style={styles.drivingStatusGrid}>
          {REQUEST_BOARD_DRIVING_STATUS_OPTIONS.map((option) => {
            const active = newCustomer.drivingStatus === option.value;
            return (
              <Pressable
                key={option.value}
                style={({ pressed }) => [
                  styles.drivingStatusChip,
                  active && styles.drivingStatusChipActive,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => updateCustomerField('drivingStatus', option.value)}
              >
                <Text style={[styles.drivingStatusText, active && styles.drivingStatusTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.stackedField}>
        <Text style={styles.fieldLabel}>보험 자격</Text>
        <View style={styles.qualificationGrid}>
          {INSURANCE_QUALIFICATION_OPTIONS.map((option) => {
            const active = Boolean(newCustomer.insuranceQualifications?.[option.key]);
            return (
              <Pressable
                key={option.key}
                style={({ pressed }) => [
                  styles.qualificationChip,
                  active && styles.qualificationChipActive,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => toggleInsuranceQualification(option.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <Text style={[styles.qualificationText, active && styles.qualificationTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.twoColumn}>
        <Field
          grow
          label="키(cm)"
          value={newCustomer.height ?? ''}
          onChangeText={updateHeightField}
          placeholder="170"
          keyboardType="number-pad"
          maxLength={3}
          inputRef={heightInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(weightInputRef)}
        />
        <Field
          grow
          label="몸무게(kg)"
          value={newCustomer.weight ?? ''}
          onChangeText={updateWeightField}
          placeholder="65"
          keyboardType="number-pad"
          maxLength={3}
          inputRef={weightInputRef}
          returnKeyType="next"
          onSubmitEditing={() => focusNextInput(addressInputRef)}
        />
      </View>
      <Field
        label="주소"
        value={newCustomer.address ?? ''}
        onChangeText={(value) => updateCustomerField('address', value)}
        placeholder="서울시 강남구 테헤란로 123"
        inputRef={addressInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(emailInputRef)}
      />
      <Field
        label="이메일"
        value={newCustomer.email ?? ''}
        onChangeText={(value) => updateCustomerField('email', value)}
        placeholder="customer@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        inputRef={emailInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(referrerInputRef)}
      />
      <Field
        label="소개자"
        value={newCustomer.referrer ?? ''}
        onChangeText={(value) => updateCustomerField('referrer', value)}
        placeholder="소개자 이름"
        inputRef={referrerInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(currentMedicationInputRef)}
      />
      <Field
        label="고혈압 당뇨 고지혈 약 드시나요?"
        value={newCustomer.currentMedication ?? ''}
        onChangeText={(value) => updateCustomerField('currentMedication', value)}
        placeholder="예: 고혈압약 복용 중 / 해당 없음"
        inputRef={currentMedicationInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(recentHospitalVisitInputRef)}
        multiline
      />
      <Field
        label="최근 병원 진료"
        value={newCustomer.recentHospitalVisit ?? ''}
        onChangeText={(value) => updateCustomerField('recentHospitalVisit', value)}
        placeholder="최근 3개월 내 진료 내용"
        inputRef={recentHospitalVisitInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(hospitalizationHistoryInputRef)}
        multiline
      />
      <Field
        label="최근 5년 이내 입원/수술 및 7일 이상 치료 이력"
        value={newCustomer.hospitalizationHistory ?? ''}
        onChangeText={(value) => updateCustomerField('hospitalizationHistory', value)}
        placeholder="입원, 수술, 7일 이상 치료 이력"
        inputRef={hospitalizationHistoryInputRef}
        returnKeyType="next"
        onSubmitEditing={() => focusNextInput(majorDiseasesInputRef)}
        multiline
      />
      <Field
        label="주요 질병"
        value={newCustomer.majorDiseases ?? ''}
        onChangeText={(value) => updateCustomerField('majorDiseases', value)}
        placeholder="고혈압, 당뇨 등 주요 질병"
        inputRef={majorDiseasesInputRef}
        returnKeyType="done"
        multiline
      />
      <View style={styles.fixedActionSpacer} />
      <View style={[styles.fixedActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          style={[styles.ctaOutline, submitting && styles.disabledButton]}
          onPress={cancelCustomerForm}
          disabled={submitting}
        >
          <Text style={styles.ctaOutlineText}>취소</Text>
        </Pressable>
        <Pressable
          style={[styles.cta, submitting && styles.disabledButton]}
          onPress={saveNewCustomer}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {editingCustomerId ? '고객 정보 저장' : isCustomerManagement ? '고객 등록' : '고객 등록 후 선택'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderComposeStep = () => {
    if (!selectedCustomer) return null;
    return (
      <>
        <View style={styles.summaryCard}>
          <View style={styles.summaryMain}>
            <Text style={styles.summaryName}>{selectedCustomer.name}</Text>
            <Text style={styles.summaryMeta}>
              {selectedCustomer.birthDate} · {selectedCustomer.gender === 'female' ? '여' : '남'} · {formatPhone(selectedCustomer.phone)}
            </Text>
            <Text style={styles.summaryMeta}>주민번호 {selectedCustomer.ssn || '미입력'}</Text>
          </View>
          <View style={styles.selectedBadge}>
            <Text style={styles.selectedBadgeText}>선택됨</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>보험 상품</Text>
          <View style={styles.productGrid}>
            {products.map((product) => {
              const selected = selectedProductIds.includes(product.id);
              return (
                <Pressable
                  key={product.id}
                  style={({ pressed }) => [
                    styles.productButton,
                    selected && styles.productButtonActive,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => toggleProduct(product)}
                >
                  <Feather
                    name={PRODUCT_ICON[product.name] ?? 'shield'}
                    size={17}
                    color={selected ? COLORS.primary : COLORS.gray[700]}
                  />
                  <Text style={[styles.productText, selected && styles.productTextActive]}>
                    {product.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>요청 예시</Text>
            <Text style={styles.sectionMeta}>탭하면 문구에 추가됩니다</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.templateRail}
          >
            {availableTemplates.map((productName) => (
              <Pressable
                key={productName}
                style={({ pressed }) => [styles.templateCard, pressed && { opacity: 0.85 }]}
                onPress={() => applyTemplate(productName)}
              >
                <Text style={styles.templateTitle}>{productName}</Text>
                <Text style={styles.templateBody}>{REQUEST_TEMPLATES[productName]}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            key={`request-text-${composeDraftKey}`}
            style={[styles.input, styles.requestTextarea]}
            multiline
            value={requestText}
            onChangeText={setRequestText}
            placeholder="설계 매니저에게 요청할 내용을 입력하세요"
            placeholderTextColor={COLORS.gray[400]}
          />
        </View>

        <View style={styles.block}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>첨부</Text>
              <Text style={styles.optionalBadge}>선택</Text>
            </View>
            <Pressable onPress={pickAttachments} hitSlop={8}>
              <Text style={styles.linkText}>추가</Text>
            </Pressable>
          </View>
          {attachments.length === 0 ? (
            <Pressable style={styles.attachmentEmpty} onPress={pickAttachments}>
              <Feather name="paperclip" size={18} color={COLORS.primary} />
              <Text style={styles.attachmentEmptyText}>필요한 경우 파일 첨부</Text>
            </Pressable>
          ) : (
            <View style={styles.attachmentList}>
              {attachments.map((file, index) => (
                <View key={`${file.uri}-${index}`} style={styles.attachmentRow}>
                  <Feather name="file" size={16} color={COLORS.gray[600]} />
                  <Text style={styles.attachmentName} numberOfLines={1}>{file.name}</Text>
                  <Pressable
                    onPress={() => setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    hitSlop={8}
                  >
                    <Feather name="x" size={16} color={COLORS.gray[500]} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.block}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>설계매니저</Text>
              <Text style={styles.requiredBadge}>필수</Text>
            </View>
            <Pressable onPress={() => setSheetVisible(true)} hitSlop={8}>
              <Text style={styles.linkText}>선택</Text>
            </Pressable>
          </View>
          <Pressable style={styles.managerPicker} onPress={() => setSheetVisible(true)}>
            <View style={styles.managerPickerCopy}>
              <Text style={styles.managerPickerTitle} numberOfLines={1}>
                {selectedDesigners.length > 0
                  ? selectedDesigners.map(getDesignerNameWithHeadquarters).join(', ')
                  : '설계매니저 선택'}
              </Text>
              <Text style={styles.managerPickerMeta} numberOfLines={2}>
                {selectedDesigners.length > 0
                  ? `${selectedDesigners.length}명 · ${getProductSummary(products, selectedProductIds)}`
                  : '회사별 FC 코드가 등록된 매니저를 선택하세요'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={COLORS.gray[500]} />
          </Pressable>
        </View>

        <View style={styles.fixedActionSpacer} />
        <View style={[styles.fixedActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            style={[styles.cta, (!canSubmit || submitting) && styles.disabledButton]}
            onPress={submitRequest}
            disabled={!canSubmit || submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>설계 요청 보내기</Text>}
          </Pressable>
        </View>
      </>
    );
  };

  const renderSentStep = () => (
    <View style={styles.sentCard}>
      <View style={styles.sentIcon}>
        <Feather name="check" size={34} color="#fff" />
      </View>
      <Text style={styles.sentTitle}>설계 요청을 보냈습니다</Text>
      <Text style={styles.sentDesc}>담당 설계매니저가 수락하면 진행 상태와 메신저가 열립니다.</Text>
      <View style={styles.sentSummary}>
        <Text style={styles.sentLabel}>고객</Text>
        <Text style={styles.sentValue} numberOfLines={2}>{selectedCustomer?.name ?? '-'}</Text>
        <Text style={styles.sentLabel}>상품</Text>
        <Text style={styles.sentValue} numberOfLines={2}>{getProductSummary(products, selectedProductIds)}</Text>
        <Text style={styles.sentLabel}>매니저</Text>
        <Text style={styles.sentValue} numberOfLines={2}>
          {selectedDesigners.map(getDesignerNameWithHeadquarters).join(', ')}
        </Text>
      </View>
      <Pressable style={styles.cta} onPress={() => router.replace('/request-board-requests' as any)}>
        <Text style={styles.ctaText}>진행중인 의뢰 보기</Text>
      </Pressable>
      <Pressable style={styles.ctaOutline} onPress={() => router.replace('/request-board' as any)}>
        <Text style={styles.ctaOutlineText}>설계요청 홈</Text>
      </Pressable>
      {sentRequestIds.length > 0 ? (
        <Text style={styles.sentRequestId}>
          요청번호 {sentRequestIds.map((requestId) => `#${requestId}`).join(', ')}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title={
          step === 'customer' && isCustomerManagement
            ? '고객관리'
            : step === 'customer'
              ? '고객 선택'
            : step === 'newCustomer'
              ? '신규 고객 등록'
              : step === 'sent'
                ? '전송 완료'
                : '요청 구성'
        }
        onBack={handleBack}
        topInset={insets.top}
      />

      {visibleSteps.length > 0 ? (
        <View style={styles.stepRow}>
          {visibleSteps.map((item) => (
            <StepPill key={item} step={item} activeStep={step} />
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={styles.loadingText}>설계 요청 데이터를 불러오는 중입니다</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.contentArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingBottom: Math.max(
                  step === 'sent' ? 110 + insets.bottom : 150 + insets.bottom,
                  screenKeyboardHeight + 96 + insets.bottom,
                ),
              },
            ]}
          >
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 260 }}
            >
              {step === 'customer' && renderCustomerStep()}
              {step === 'newCustomer' && renderNewCustomerStep()}
              {step === 'compose' && renderComposeStep()}
              {step === 'sent' && renderSentStep()}
            </MotiView>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <DesignerBottomSheet
        visible={sheetVisible}
        designers={designers}
        selectedDesignerIds={selectedDesignerIds}
        selectedProductIds={selectedProductIds}
        fcCodes={fcCodes}
        onToggleDesigner={toggleDesigner}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
  },
  contentArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.md,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800',
  },
  stepRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  stepPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  stepPillActive: {
    backgroundColor: COLORS.primary,
  },
  stepPillText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700',
    color: COLORS.gray[600],
  },
  stepPillTextActive: {
    color: '#fff',
  },
  scrollContent: {
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.md,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  searchCard: {
    minHeight: 54,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.base,
    ...SHADOWS.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.gray[900],
    paddingVertical: SPACING.sm,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: COLORS.gray[100],
    borderRadius: RADIUS.lg,
    padding: 4,
    marginTop: SPACING.md,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
  },
  segmentButtonActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[600],
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#fff',
  },
  sectionHeader: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800',
    color: COLORS.gray[900],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  sectionMeta: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: COLORS.gray[500],
  },
  requiredBadge: {
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryPale,
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  optionalBadge: {
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[100],
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  linkText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  cardList: {
    gap: SPACING.md,
  },
  customerCard: {
    minHeight: 122,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    gap: SPACING.sm,
    ...SHADOWS.sm,
  },
  customerCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  customerInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  customerName: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
    color: COLORS.gray[900],
  },
  customerMeta: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray[600],
  },
  customerPolicyholderRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  customerPolicyholderBadge: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.warning.border,
    backgroundColor: COLORS.warning.light,
    color: COLORS.warning.dark,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800',
    lineHeight: 16,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
  },
  customerPolicyholderText: {
    flexShrink: 1,
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700',
    lineHeight: 18,
  },
  customerActionRow: {
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
    paddingTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
  },
  customerPrimaryAction: {
    flex: 1,
    minWidth: 108,
    minHeight: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
  },
  customerPrimaryActionText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
    color: '#fff',
  },
  customerSelectIndicator: {
    backgroundColor: COLORS.primaryPale,
  },
  customerSelectIndicatorText: {
    color: COLORS.primary,
  },
  customerSecondaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  customerSecondaryAction: {
    minWidth: 62,
    minHeight: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
  },
  customerSecondaryActionText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
    color: COLORS.gray[700],
  },
  customerDangerAction: {
    borderColor: COLORS.errorLight,
    backgroundColor: '#FEF2F2',
  },
  customerDangerActionText: {
    color: COLORS.error,
  },
  formCard: {
    gap: SPACING.md,
  },
  formTitle: {
    marginTop: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
    color: COLORS.gray[900],
  },
  twoColumn: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  field: {
    gap: 6,
  },
  fieldGrow: {
    flex: 1,
  },
  multilineField: {
    gap: 4,
  },
  multilineFieldLabel: {
    marginBottom: 0,
  },
  stackedField: {
    gap: 6,
  },
  fieldLabel: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700',
  },
  input: {
    minHeight: 52,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingVertical: SPACING.md,
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  textarea: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  genderRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  genderButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  genderText: {
    color: COLORS.gray[700],
    fontWeight: '800',
  },
  genderTextActive: {
    color: COLORS.primary,
  },
  policyholderToggle: {
    minHeight: 72,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.base,
  },
  policyholderToggleActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  policyholderCheck: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border.medium,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  policyholderCheckActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  policyholderToggleCopy: {
    flex: 1,
    gap: 4,
  },
  policyholderToggleTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  policyholderToggleHint: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.xs,
    lineHeight: 18,
  },
  policyholderPanel: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    padding: SPACING.base,
    gap: SPACING.md,
  },
  policyholderPanelTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  policyholderPanelHint: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 20,
  },
  carrierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  carrierButton: {
    width: '48%',
    minHeight: 42,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  carrierButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  carrierText: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
    textAlign: 'center',
  },
  carrierTextActive: {
    color: COLORS.primary,
  },
  qualificationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  qualificationChip: {
    minHeight: 42,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
  },
  qualificationChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  qualificationText: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  qualificationTextActive: {
    color: COLORS.primary,
  },
  drivingStatusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  drivingStatusChip: {
    minHeight: 42,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
  },
  drivingStatusChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  drivingStatusText: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  drivingStatusTextActive: {
    color: COLORS.primary,
  },
  summaryCard: {
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    ...SHADOWS.sm,
  },
  summaryMain: {
    flex: 1,
    gap: 3,
  },
  summaryName: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  summaryMeta: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  selectedBadge: {
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.successLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
  },
  selectedBadgeText: {
    color: COLORS.success,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800',
  },
  block: {
    marginTop: SPACING.lg,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.base,
    ...SHADOWS.sm,
  },
  productGrid: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  productButton: {
    width: '48%',
    minHeight: 58,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  productButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  productText: {
    flex: 1,
    color: COLORS.gray[800],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  productTextActive: {
    color: COLORS.primary,
  },
  templateRail: {
    gap: SPACING.sm,
    paddingRight: SPACING.base,
    marginBottom: SPACING.md,
  },
  templateCard: {
    width: 230,
    minHeight: 112,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  templateTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  templateBody: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 20,
  },
  requestTextarea: {
    minHeight: 128,
    textAlignVertical: 'top',
  },
  attachmentEmpty: {
    minHeight: 54,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  attachmentEmptyText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  attachmentList: {
    gap: SPACING.sm,
  },
  attachmentRow: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  attachmentName: {
    flex: 1,
    color: COLORS.gray[800],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '700',
  },
  managerPicker: {
    minHeight: 72,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  managerPickerCopy: {
    flex: 1,
    minWidth: 0,
  },
  managerPickerTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  managerPickerMeta: {
    marginTop: 4,
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  fixedActionSpacer: {
    height: SPACING.sm,
  },
  fixedActions: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  cta: {
    minHeight: 54,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.base,
  },
  ctaText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  ctaOutline: {
    minHeight: 52,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.base,
  },
  ctaOutlineText: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.45,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#fff',
    paddingHorizontal: SPACING.base,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[300],
    marginBottom: SPACING.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sheetTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: '800',
  },
  sheetSubtitle: {
    marginTop: 3,
    color: COLORS.gray[500],
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray[100],
  },
  sheetSearchCard: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  sheetSearchInput: {
    flex: 1,
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.sm,
    paddingVertical: SPACING.sm,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetList: {
    gap: SPACING.sm,
    paddingBottom: SPACING.lg,
  },
  sheetFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    paddingTop: SPACING.md,
    backgroundColor: '#fff',
  },
  sheetDoneButton: {
    minHeight: 52,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneButtonText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  sheetEmptyState: {
    minHeight: 94,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.base,
  },
  sheetEmptyTitle: {
    color: COLORS.gray[800],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  sheetEmptyText: {
    marginTop: 4,
    color: COLORS.gray[500],
    fontSize: TYPOGRAPHY.fontSize.xs,
  },
  designerCard: {
    minHeight: 96,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  designerCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryPale,
  },
  designerMain: {
    flex: 1,
    gap: 4,
  },
  designerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  designerName: {
    flexShrink: 1,
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: '800',
  },
  designerHeadquartersBadge: {
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: RADIUS.full,
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  designerMeta: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 19,
  },
  codeState: {
    color: COLORS.success,
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '800',
  },
  codeStateMissing: {
    color: COLORS.error,
  },
  selectMark: {
    minWidth: 50,
    height: 38,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  selectMarkActive: {
    minWidth: 38,
    backgroundColor: COLORS.primary,
  },
  selectMarkText: {
    color: COLORS.gray[700],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  sentCard: {
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.md,
    ...SHADOWS.sm,
  },
  sentIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentTitle: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  sentDesc: {
    color: COLORS.gray[600],
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 21,
    textAlign: 'center',
  },
  sentSummary: {
    alignSelf: 'stretch',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gray[50],
    padding: SPACING.base,
    gap: 6,
  },
  sentLabel: {
    color: COLORS.gray[500],
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700',
  },
  sentValue: {
    color: COLORS.gray[900],
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: '800',
  },
  sentRequestId: {
    color: COLORS.gray[500],
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: '700',
  },
});
