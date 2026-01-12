import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareWrapper } from '@/components/KeyboardAwareWrapper';
import { useKeyboardPadding } from '@/hooks/use-keyboard-padding';
import { safeStorage } from '@/lib/safe-storage';
import { COLORS, TYPOGRAPHY, SPACING, RADIUS } from '@/lib/theme';
import { validatePhone, validateEmail, validateRequired, normalizePhone } from '@/lib/validation';

const STORAGE_KEY = 'fc-onboarding/signup';

const AFFILIATION_OPTIONS = [
  '1본부 [본부장: 서선미]',
  '2본부 [본부장: 박성훈]',
  '3본부 [본부장: 현경숙]',
  '4본부 [본부장: 최철준]',
  '5본부 [본부장: 박선희]',
  '6본부 [본부장: 김태희]',
  '7본부 [본부장: 김동훈]',
  '8본부 [본부장: 정승철]',
];

const EMAIL_DOMAINS = [
  'naver.com',
  'gmail.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  '직접입력',
];
const CARRIER_OPTIONS = ['SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'];

export default function SignupScreen() {
  const [selectedAffiliation, setSelectedAffiliation] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [recommender, setRecommender] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [carrier, setCarrier] = useState('');
  const [showDomainPicker, setShowDomainPicker] = useState(false);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const keyboardPadding = useKeyboardPadding();

  const emailValue = useMemo(() => {
    const domainToUse = emailDomain === '직접입력' ? customDomain : emailDomain;
    return emailLocal && domainToUse ? `${emailLocal}@${domainToUse}` : '';
  }, [emailLocal, emailDomain, customDomain]);

  const handleNext = async () => {
    const affiliationValidation = validateRequired(selectedAffiliation, '소속');
    if (!affiliationValidation.isValid) {
      Alert.alert('입력 확인', affiliationValidation.error);
      return;
    }

    const nameValidation = validateRequired(name, '이름');
    if (!nameValidation.isValid) {
      Alert.alert('입력 확인', nameValidation.error);
      return;
    }

    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.isValid) {
      Alert.alert('입력 확인', phoneValidation.error);
      return;
    }

    const emailValidation = validateEmail(emailValue);
    if (!emailValidation.isValid) {
      Alert.alert('입력 확인', emailValidation.error);
      return;
    }

    const carrierValidation = validateRequired(carrier, '통신사');
    if (!carrierValidation.isValid) {
      Alert.alert('입력 확인', carrierValidation.error);
      return;
    }

    const digits = normalizePhone(phone);

    await safeStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        affiliation: selectedAffiliation,
        name: name.trim(),
        phone: digits,
        recommender: recommender.trim(),
        email: emailValue,
        carrier: carrier.trim(),
      }),
    );
    router.push('/signup-verify');
  };

  const handleBack = useCallback(() => {
    router.replace('/login');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        handleBack();
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => subscription.remove();
    }, [handleBack]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <LinearGradient
        colors={['#ffffff', '#fff1e6']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <KeyboardAwareWrapper
        contentContainerStyle={[styles.container, { paddingBottom: Math.max(120, keyboardPadding + 40) }]}
        extraScrollHeight={140}
      >
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>회원가입</Text>
          <Text style={styles.title}>기본 정보를 입력해주세요</Text>
          <Text style={styles.caption}>입력 후 비밀번호 설정 단계로 이동합니다.</Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.affiliationBox}>
            {AFFILIATION_OPTIONS.map((opt) => {
              const active = selectedAffiliation === opt;
              return (
                <Pressable
                  key={opt}
                  style={[styles.affiliationItem, active && styles.affiliationActive]}
                  onPress={() => setSelectedAffiliation(opt)}
                >
                  <Text style={[styles.affiliationText, active && styles.affiliationTextActive]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>이름</Text>
            <TextInput
              style={styles.input}
              placeholder="홍길동"
              placeholderTextColor={COLORS.text.muted}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
              scrollEnabled={false}
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>연락처 및 이메일</Text>
          <View style={styles.field}>
            <Text style={styles.label}>휴대폰 번호</Text>
            <TextInput
              style={styles.input}
              placeholder="번호 입력 (- 없이 숫자만)"
              placeholderTextColor={COLORS.text.muted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="number-pad"
              scrollEnabled={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>통신사</Text>
            <View style={styles.selectBox}>
              <TextInput
                style={[styles.input, styles.inputWithIcon]}
                placeholder="통신사 선택"
                placeholderTextColor={COLORS.text.muted}
                value={carrier}
                editable={false}
                pointerEvents="none"
              />
              <Pressable style={styles.selectOverlay} onPress={() => setShowCarrierPicker(true)}>
                <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>추천인</Text>
            <TextInput
              style={styles.input}
              placeholder="추천인 이름 (선택)"
              placeholderTextColor={COLORS.text.muted}
              value={recommender}
              onChangeText={setRecommender}
              scrollEnabled={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>이메일</Text>
            <View style={styles.emailRow}>
              <TextInput
                style={[styles.input, styles.emailLocal]}
                placeholder="이메일 아이디"
                placeholderTextColor={COLORS.text.muted}
                value={emailLocal}
                onChangeText={(txt) => setEmailLocal(txt.trim())}
                autoCapitalize="none"
                keyboardType="email-address"
                scrollEnabled={false}
              />
              <Text style={styles.emailAt}>@</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.emailDomainBox}>
                  <TextInput
                    style={[styles.input, styles.inputWithIcon]}
                    placeholder="도메인 선택"
                    placeholderTextColor={COLORS.text.muted}
                    value={emailDomain}
                    editable={false}
                    pointerEvents="none"
                  />
                  <Pressable style={styles.selectOverlay} onPress={() => setShowDomainPicker(true)}>
                    <Feather name="chevron-down" size={20} color={COLORS.text.secondary} />
                  </Pressable>
                </View>

                {emailDomain === '직접입력' ? (
                  <TextInput
                    style={[styles.input, styles.customDomainInput]}
                    placeholder="직접 입력"
                    placeholderTextColor={COLORS.text.muted}
                    value={customDomain}
                    onChangeText={(txt) => setCustomDomain(txt.trim())}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    scrollEnabled={false}
                  />
                ) : null}
              </View>
            </View>
          </View>

        </View>

        <Pressable style={styles.primaryButton} onPress={handleNext}>
          <Text style={styles.primaryButtonText}>비밀번호 설정으로 이동</Text>
        </Pressable>

        <Pressable style={styles.linkButton} onPress={() => router.replace('/login')}>
          <Text style={styles.linkButtonText}>이미 계정이 있어요</Text>
        </Pressable>
      </KeyboardAwareWrapper>

      <Modal visible={showDomainPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDomainPicker(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>도메인 선택</Text>
            <View style={styles.modalOptions}>
              {EMAIL_DOMAINS.map((domain) => (
                <Pressable
                  key={domain}
                  style={styles.modalOption}
                  onPress={() => {
                    setEmailDomain(domain);
                    if (domain !== '직접입력') setCustomDomain('');
                    setShowDomainPicker(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{domain}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setShowDomainPicker(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={showCarrierPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowCarrierPicker(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>통신사 선택</Text>
            <View style={styles.modalOptions}>
              {CARRIER_OPTIONS.map((value) => (
                <Pressable
                  key={value}
                  style={styles.modalOption}
                  onPress={() => {
                    setCarrier(value);
                    setShowCarrierPicker(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.modalCancel} onPress={() => setShowCarrierPicker(false)}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  container: { padding: SPACING.lg, gap: SPACING.lg },
  hero: { gap: SPACING.sm, paddingVertical: SPACING.sm },
  heroEyebrow: { color: COLORS.primary, fontWeight: TYPOGRAPHY.fontWeight.bold, fontSize: TYPOGRAPHY.fontSize.base },
  title: { fontSize: TYPOGRAPHY.fontSize['3xl'], fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary, lineHeight: 34 },
  caption: { color: COLORS.text.secondary, lineHeight: TYPOGRAPHY.lineHeight.relaxed * TYPOGRAPHY.fontSize.md, fontSize: TYPOGRAPHY.fontSize.md },
  sectionCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: SPACING.md,
  },
  sectionTitle: { fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.xl, color: COLORS.text.primary },
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
  },
  affiliationActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryPale },
  affiliationText: { color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.md },
  affiliationTextActive: { color: COLORS.primary, fontWeight: TYPOGRAPHY.fontWeight.bold },
  field: { gap: 6 },
  label: { fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.text.primary, fontSize: TYPOGRAPHY.fontSize.md },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.text.primary,
    height: 52,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  selectBox: {
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 52,
    backgroundColor: COLORS.white,
  },
  selectPicker: {
    color: COLORS.text.primary,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  primaryButton: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: COLORS.white, fontWeight: TYPOGRAPHY.fontWeight.extrabold, fontSize: TYPOGRAPHY.fontSize.lg },
  linkButton: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  linkButtonText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.text.secondary,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    textDecorationLine: 'underline',
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  emailLocal: {
    flex: 0.9,
    minWidth: 0,
  },
  emailAt: {
    fontWeight: TYPOGRAPHY.fontWeight.extrabold,
    color: COLORS.text.primary,
    fontSize: TYPOGRAPHY.fontSize.md,
    marginTop: SPACING.md,
  },
  emailDomainBox: {
    flex: 1.1,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 54,
    backgroundColor: COLORS.white,
  },
  selectOverlay: {
    position: 'absolute',
    right: SPACING.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: SPACING['2xl'],
  },
  emailPicker: {
    color: COLORS.text.primary,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  customDomainInput: {
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: RADIUS.base,
    padding: SPACING.sm,
    backgroundColor: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md,
    height: 44,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.background.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.base,
  },
  modalTitle: { fontSize: TYPOGRAPHY.fontSize.md, fontWeight: TYPOGRAPHY.fontWeight.extrabold, color: COLORS.text.primary, marginBottom: SPACING.md },
  modalOptions: { gap: SPACING.sm },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.base,
    backgroundColor: COLORS.background.secondary,
  },
  modalOptionText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.semibold, color: COLORS.text.primary },
  modalCancel: {
    marginTop: SPACING.md,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: RADIUS.base,
    backgroundColor: COLORS.gray[100],
  },
  modalCancelText: { fontSize: TYPOGRAPHY.fontSize.sm, fontWeight: TYPOGRAPHY.fontWeight.bold, color: COLORS.gray[600] },
});
