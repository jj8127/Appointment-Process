import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ExamPaymentProofSelection } from '@/lib/exam-payment-proof';

const ORANGE = '#f36f21';
const BORDER = '#e5e7eb';
const MUTED = '#6b7280';

type Props = {
  selectedProof: ExamPaymentProofSelection | null;
  existingProofAttached: boolean;
  disabled?: boolean;
  onPick: () => void;
  onRemove: () => void;
};

export function ExamPaymentProofField({
  selectedProof,
  existingProofAttached,
  disabled = false,
  onPick,
  onRemove,
}: Props) {
  const hasProof = Boolean(selectedProof || existingProofAttached);

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>입금 내역 캡처 첨부</Text>
        <Text style={styles.required}>필수</Text>
      </View>

      {selectedProof ? (
        <View style={styles.previewCard}>
          <Image
            source={{ uri: selectedProof.uri }}
            style={styles.preview}
            resizeMode="cover"
            accessibilityLabel="선택한 입금 내역 사진 미리보기"
          />
          <View style={styles.fileSummary}>
            <Feather name="check-circle" size={17} color="#15803d" />
            <Text style={styles.fileName} numberOfLines={1}>
              {selectedProof.fileName}
            </Text>
          </View>
        </View>
      ) : existingProofAttached ? (
        <View style={styles.existingCard}>
          <Feather name="check-circle" size={20} color="#15803d" />
          <Text style={styles.existingText}>기존 입금 내역이 첨부되어 있습니다.</Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Feather name="image" size={24} color={MUTED} />
          <Text style={styles.emptyText}>입금 날짜가 보이는 캡처 사진을 첨부해주세요.</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasProof ? '입금 내역 사진 변경' : '입금 내역 사진 선택'}
          disabled={disabled}
          onPress={onPick}
          style={({ pressed }) => [
            styles.pickButton,
            disabled && styles.disabled,
            pressed && !disabled && styles.pressed,
          ]}
        >
          <Feather name="image" size={17} color="#fff" />
          <Text style={styles.pickButtonText}>{hasProof ? '사진 변경' : '사진 선택'}</Text>
        </Pressable>

        {selectedProof && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="선택한 입금 내역 사진 삭제"
            disabled={disabled}
            onPress={onRemove}
            style={({ pressed }) => [
              styles.removeButton,
              disabled && styles.disabled,
              pressed && !disabled && styles.pressed,
            ]}
          >
            <Feather name="trash-2" size={17} color="#b91c1c" />
            <Text style={styles.removeButtonText}>삭제</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
    marginTop: 14,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  label: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  required: {
    backgroundColor: '#fff1e6',
    borderRadius: 999,
    color: ORANGE,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  previewCard: {
    borderColor: BORDER,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  preview: {
    backgroundColor: '#f3f4f6',
    height: 170,
    width: '100%',
  },
  fileSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileName: {
    color: '#374151',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  existingCard: {
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 14,
  },
  existingText: {
    color: '#166534',
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderColor: BORDER,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  emptyText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  pickButton: {
    alignItems: 'center',
    backgroundColor: ORANGE,
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  pickButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  removeButton: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#fecaca',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  removeButtonText: {
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
});
