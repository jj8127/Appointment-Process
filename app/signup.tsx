import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
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

const ORANGE = '#f36f21';
const CHARCOAL = '#111827';
const TEXT_MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const PLACEHOLDER = '#9ca3af';
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
    const digits = phone.replace(/[^0-9]/g, '');
    if (!selectedAffiliation) {
      Alert.alert('입력 확인', '소속을 선택해주세요.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('입력 확인', '이름을 입력해주세요.');
      return;
    }
    if (digits.length !== 11) {
      Alert.alert('입력 확인', '휴대폰 번호는 숫자 11자리로 입력해주세요.');
      return;
    }
    if (!emailValue || !emailValue.includes('@')) {
      Alert.alert('입력 확인', '이메일을 입력해주세요.');
      return;
    }
    if (!carrier.trim()) {
      Alert.alert('입력 확인', '통신사를 입력해주세요.');
      return;
    }

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
              placeholderTextColor={PLACEHOLDER}
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
              placeholderTextColor={PLACEHOLDER}
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
                placeholderTextColor={PLACEHOLDER}
                value={carrier}
                editable={false}
                pointerEvents="none"
              />
              <Pressable style={styles.selectOverlay} onPress={() => setShowCarrierPicker(true)}>
                <Feather name="chevron-down" size={20} color={TEXT_MUTED} />
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>추천인</Text>
            <TextInput
              style={styles.input}
              placeholder="추천인 이름 (선택)"
              placeholderTextColor={PLACEHOLDER}
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
                placeholderTextColor={PLACEHOLDER}
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
                    placeholderTextColor={PLACEHOLDER}
                    value={emailDomain}
                    editable={false}
                    pointerEvents="none"
                  />
                  <Pressable style={styles.selectOverlay} onPress={() => setShowDomainPicker(true)}>
                    <Feather name="chevron-down" size={20} color={TEXT_MUTED} />
                  </Pressable>
                </View>

                {emailDomain === '직접입력' ? (
                  <TextInput
                    style={[styles.input, styles.customDomainInput]}
                    placeholder="직접 입력"
                    placeholderTextColor={PLACEHOLDER}
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
  safe: { flex: 1, backgroundColor: '#ffffff' },
  container: { padding: 20, gap: 18 },
  hero: { gap: 8, paddingVertical: 8 },
  heroEyebrow: { color: ORANGE, fontWeight: '700', fontSize: 15 },
  title: { fontSize: 28, fontWeight: '800', color: CHARCOAL, lineHeight: 34 },
  caption: { color: TEXT_MUTED, lineHeight: 22, fontSize: 16 },
  sectionCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },
  sectionTitle: { fontWeight: '800', fontSize: 20, color: CHARCOAL },
  affiliationBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  affiliationItem: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  affiliationActive: { borderColor: ORANGE, backgroundColor: '#fff1e6' },
  affiliationText: { color: CHARCOAL, fontSize: 16 },
  affiliationTextActive: { color: ORANGE, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontWeight: '700', color: CHARCOAL, fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 16,
    color: CHARCOAL,
    height: 52,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  selectBox: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 52,
    backgroundColor: '#fff',
  },
  selectPicker: {
    color: CHARCOAL,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: 12,
    fontSize: 16,
  },
  primaryButton: {
    marginTop: 8,
    marginBottom: 24,
    backgroundColor: ORANGE,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkButtonText: {
    fontSize: 13,
    color: TEXT_MUTED,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  emailLocal: {
    flex: 0.9,
    minWidth: 0,
  },
  emailAt: {
    fontWeight: '800',
    color: CHARCOAL,
    fontSize: 16,
    marginTop: 12,
  },
  emailDomainBox: {
    flex: 1.1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    height: 54,
    backgroundColor: '#fff',
  },
  selectOverlay: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
  },
  emailPicker: {
    color: CHARCOAL,
    marginLeft: -10,
    marginRight: -10,
    paddingLeft: 12,
    fontSize: 16,
  },
  customDomainInput: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#fff',
    fontSize: 16,
    height: 44,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: CHARCOAL, marginBottom: 12 },
  modalOptions: { gap: 8 },
  modalOption: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  modalOptionText: { fontSize: 14, fontWeight: '600', color: CHARCOAL },
  modalCancel: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: '#4B5563' },
});
