import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormInput } from '@/components/FormInput';
import { OptionSheetField } from '@/components/OptionSheetField';
import { ChoiceRows } from '@/components/SelectionControls';
import { informationStyles } from '@/components/ServiceInformation';
import { HOSPITAL_PROVINCES } from '@/lib/platform-api';
import { COLORS } from '@/lib/theme';

export type HospitalDraft = {
  provinceCode: string; district: string; specialties: string; description: string; photoUrl: string;
  openingHours: string; verifiedAt: string; materialApproved: boolean;
  reviewRequired: boolean | null; reviewNumber: string; reviewExpiresAt: string;
};
const REVIEW_KEY = { null: 'unknown', true: 'required', false: 'exempt' } as const;

export const EMPTY_HOSPITAL_DRAFT: HospitalDraft = {
  provinceCode: '', district: '', specialties: '', description: '', photoUrl: '',
  openingHours: '', verifiedAt: '', materialApproved: false, reviewRequired: null, reviewNumber: '', reviewExpiresAt: '',
};

export default function HospitalContractFields({ draft, busy, onChange }: {
  draft: HospitalDraft; busy: boolean; onChange: (next: HospitalDraft) => void;
}) {
  return <View style={styles.section}>
    <Text style={informationStyles.sectionTitle}>병원 공개 정보</Text>
    <View style={styles.field}>
      <OptionSheetField label="시·도" value={draft.provinceCode} disabled={busy} onChange={(provinceCode) => onChange({ ...draft, provinceCode })}
        options={HOSPITAL_PROVINCES.map(({ code, name }) => ({ value: code, label: name }))} />
    </View>
    <FormInput label="시·군·구" accessibilityLabel="병원 시·군·구" placeholder="예: 강남구 · 수원시 영통구" value={draft.district} editable={!busy} maxLength={50} onChangeText={(district) => onChange({ ...draft, district })} />
    <FormInput label="진료 분야 (쉼표로 구분)" accessibilityLabel="병원 진료 분야" placeholder="예: 내과, 재활의학과" value={draft.specialties} editable={!busy} maxLength={300} onChangeText={(specialties) => onChange({ ...draft, specialties })} />
    <FormInput label="병원 소개" accessibilityLabel="병원 소개" value={draft.description} editable={!busy} multiline inputWrapperStyle={styles.multiline} inputStyle={styles.multilineInput} maxLength={2000} onChangeText={(description) => onChange({ ...draft, description })} />
    <FormInput label="승인한 병원 사진 주소 (HTTPS)" accessibilityLabel="병원 사진 주소" placeholder="https://" value={draft.photoUrl} editable={!busy} autoCapitalize="none" keyboardType="url" maxLength={500} onChangeText={(photoUrl) => onChange({ ...draft, photoUrl })} />
    <FormInput label="운영시간·휴진 안내" accessibilityLabel="병원 운영시간" value={draft.openingHours} editable={!busy} multiline inputWrapperStyle={styles.multiline} inputStyle={styles.multilineInput} maxLength={500} onChangeText={(openingHours) => onChange({ ...draft, openingHours })} />
    <FormInput label="병원 정보 확인일 (YYYY-MM-DD)" accessibilityLabel="병원 정보 확인일" placeholder="2026-10-11" value={draft.verifiedAt} editable={!busy} maxLength={10} onChangeText={(verifiedAt) => onChange({ ...draft, verifiedAt })} />
    <Pressable accessibilityRole="checkbox" accessibilityLabel="병원 광고 소재 승인 확인" accessibilityState={{ checked: draft.materialApproved, disabled: busy }} disabled={busy} onPress={() => onChange({ ...draft, materialApproved: !draft.materialApproved })} style={styles.confirm}>
      <Text style={informationStyles.item}>{draft.materialApproved ? '☑' : '□'} 병원이 공개 정보·사진·광고 문구를 확인하고 승인했습니다.</Text>
    </Pressable>
    <Text style={styles.label}>의료광고 심의 확인</Text>
    <View style={styles.field}>
      <ChoiceRows label="의료광고 심의 확인" value={REVIEW_KEY[String(draft.reviewRequired) as keyof typeof REVIEW_KEY]} disabled={busy}
        onChange={(key) => onChange({ ...draft, reviewRequired: key === 'required' ? true : key === 'exempt' ? false : null })}
        options={[{ value: 'unknown', label: '미확인' }, { value: 'required', label: '심의 필요' }, { value: 'exempt', label: '심의 비대상 확인' }]} />
    </View>
    {draft.reviewRequired === true && <>
      <FormInput label="심의 승인 번호" accessibilityLabel="의료광고 심의 승인 번호" value={draft.reviewNumber} editable={!busy} maxLength={100} onChangeText={(reviewNumber) => onChange({ ...draft, reviewNumber })} />
      <FormInput label="심의 유효 종료일 (YYYY-MM-DD)" accessibilityLabel="의료광고 심의 유효 종료일" value={draft.reviewExpiresAt} editable={!busy} placeholder="YYYY-MM-DD" maxLength={10} onChangeText={(reviewExpiresAt) => onChange({ ...draft, reviewExpiresAt })} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text.primary, marginBottom: 10 },
  field: { marginBottom: 16 },
  confirm: { minHeight: 48, justifyContent: 'center', paddingVertical: 12 },
  multiline: { height: 112 },
  multilineInput: { paddingVertical: 12, textAlignVertical: 'top' },
});
